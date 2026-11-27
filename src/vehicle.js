import * as THREE from '../vendor/three.module.min.js';
import { CAR_TYPES, buildCar, MAT } from './models.js';
import { clamp, damp, rand } from './util.js';

export class Vehicle {
  constructor(G, type, color, x, z, h) {
    this.G = G;
    this.type = type;
    this.spec = CAR_TYPES[type];
    this.color = color;
    this.model = buildCar(type, color);
    G.scene.add(this.model.root);
    this.x = x; this.z = z; this.h = h;
    this.y = G.world.groundY(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0; this.spin = 0;
    this.steer = 0;
    this.ctrl = { throttle: 0, steer: 0, handbrake: false };
    this.health = 100;
    this.fireT = 0;
    this.destroyed = false;
    this.deadT = 0;
    this.driver = null;     // 'player' | 'ai' | null
    this.ai = null;
    this.isPolice = type === 'police';
    this.sirenOn = false;
    this.r = this.spec.W * 0.52;
    this.off = this.spec.L / 2 - this.spec.W * 0.5;
    this.pitch = 0; this.roll = 0;
    this.onGround = true;
    this.airT = 0;
    this.slip = 0;
    this.offroad = false;
    this.smokeT = 0;
    this.lastImpact = 0;
    this._circles = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
    // upgrades bought at Paint & Pay Customs
    this.mods = { engine: 0, armor: 0, grip: 0, nitro: 0 };
    this.nitro = 1;        // tank 0..1
    this.nitroOn = false;
    this.personal = false;
  }

  bulletHit(dmg, byPlayer) {
    this.damage(dmg * 0.3);
    if (!byPlayer) return;
    this.playerTouched = this.G.time;
    if (this.isPolice && this.driver === 'ai') this.G.wanted.attackCop(this.x, this.z);
    else if (this.ai && this.ai.mode === 'traffic') this.ai.flee(14);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwdSpeed() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }

  circles() {
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const c = this._circles;
    c[0].x = this.x + fx * this.off; c[0].z = this.z + fz * this.off;
    c[1].x = this.x; c[1].z = this.z;
    c[2].x = this.x - fx * this.off; c[2].z = this.z - fz * this.off;
    return c;
  }

  canOccupy(x, z) {
    const W = this.G.world;
    if (!W.isLand(x, z)) return false;
    return W.groundY(x, z) - this.y <= 0.65 || !this.onGround && W.groundY(x, z) < this.y;
  }

  damage(amount) {
    if (this.destroyed || amount <= 0) return;
    this.health -= amount * [1, 0.6, 0.35][this.mods.armor];
    if (this.health <= 0 && this.fireT <= 0) {
      this.health = 0;
      this.fireT = 5;
      if (this.driver === 'player') this.G.notify('Your car is on fire. Get out!', 3);
    }
  }

  explode() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fireT = 0;
    this.model.body.material = MAT.charred;
    this.model.lights.visible = false;
    this.model.beam.visible = false;
    if (this.model.siren) this.sirenOn = false;
    this.vy = 7;
    this.onGround = false;
    this.spin = rand(-2, 2);
    this.G.explosion(this.x, this.y + 1, this.z, this);
  }

  update(dt) {
    const s = this.spec, W = this.G.world, c = this.ctrl;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;
    const g0 = W.groundY(this.x, this.z);
    this.onGround = this.y <= g0 + 0.06;
    const surf = W.surface(this.x, this.z);
    this.offroad = surf === 'sand' || surf === 'grass';
    const dead = this.destroyed || this.health <= 0;
    this.steer = damp(this.steer, dead ? 0 : c.steer, 10, dt);

    const md = this.mods;
    const boosting = this.nitroOn && md.nitro && this.nitro > 0.02 && !dead && c.throttle > 0;
    if (boosting) this.nitro = Math.max(0, this.nitro - dt / 3.2);
    else if (md.nitro) this.nitro = Math.min(1, this.nitro + dt / 14);
    this.boosting = boosting;
    if (this.onGround) {
      const thr = dead ? 0 : c.throttle;
      const maxS = s.maxSpeed * (1 + md.engine * 0.1) * (boosting ? 1.28 : 1) * (this.offroad ? 0.78 : 1);
      const acc = s.accel * (1 + md.engine * 0.18) + (boosting ? 16 : 0);
      if (thr > 0) {
        if (vF < -0.5) vF += s.brake * thr * dt;
        else vF += acc * thr * Math.max(0, 1 - vF / maxS) * dt * (vF < 10 ? 1.25 : 1);
      } else if (thr < 0) {
        if (vF > 0.5) vF += s.brake * thr * dt;
        else if (vF > -s.maxSpeed * 0.32) vF += s.accel * 0.65 * thr * dt;
      } else {
        vF -= Math.sign(vF) * Math.min(Math.abs(vF), (dead ? 6 : 2.2) * dt);
      }
      vF -= vF * (this.offroad ? 0.25 : 0.04) * dt;
      // gravity along the slope: hills slow you down going up and push you going down
      const half = s.L * 0.45;
      const grade = (W.groundY(this.x + fx * half, this.z + fz * half) - W.groundY(this.x - fx * half, this.z - fz * half)) / (2 * half);
      if (Math.abs(grade) < 0.8) vF -= 9.8 * grade * 0.85 * dt;
      if (c.handbrake && !dead) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 8 * dt);
      const grip = (c.handbrake && !dead ? 1.4 : s.grip * (1 + md.grip * 0.25)) * (this.offroad ? 0.7 : 1);
      this.slip = Math.abs(vR);
      vR *= Math.exp(-grip * dt);
      const sf = clamp(vF / 5, -1, 1);
      let yaw = -this.steer * s.turn * sf * (1 - 0.42 * clamp(Math.abs(vF) / s.maxSpeed, 0, 1));
      if (c.handbrake) yaw *= 1.35;
      this.h += yaw * dt;
    } else {
      this.slip = 0;
    }
    this.h += this.spin * dt;
    this.spin *= Math.exp(-3.5 * dt);
    this.vx = fx * vF + rx * vR;
    this.vz = fz * vF + rz * vR;

    // horizontal move with wall sliding against the shoreline / ramp sides
    const ox = this.x, oz = this.z;
    const nx = ox + this.vx * dt, nz = oz + this.vz * dt;
    if (this.canOccupy(nx, nz)) { this.x = nx; this.z = nz; }
    else {
      const sp = this.speed;
      if (this.canOccupy(nx, oz)) { this.x = nx; this.vz *= -0.3; }
      else if (this.canOccupy(ox, nz)) { this.z = nz; this.vx *= -0.3; }
      else { this.vx *= -0.3; this.vz *= -0.3; }
      if (sp > 7) this.impact(sp * 0.5);
    }

    // vertical: follow ground, launch off ramp edges, fall with gravity
    const g = W.groundY(this.x, this.z);
    if (this.onGround) {
      if (g < this.y - 0.4 && this.vy > 1.5) { this.onGround = false; this.airT = 0; }
      else { this.vy = clamp((g - this.y) / Math.max(dt, 1e-3), -4, 20); this.y = g; }
    }
    if (!this.onGround) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      this.airT += dt;
      if (this.y <= g) {
        if (this.vy < -10) this.impact((-this.vy - 10) * 1.6, true);
        if (this.driver === 'player' && this.airT > 0.9) this.G.onStunt(this.airT);
        this.y = g; this.vy = 0; this.onGround = true; this.airT = 0;
      }
    }

    this.collideWorld();
    this.keepOnLand();

    // fire & explosion
    if (this.fireT > 0) {
      this.fireT -= dt;
      if (this.fireT <= 0) this.explode();
    }
    if (this.destroyed) this.deadT += dt;
    this.effects(dt);
  }

  // collisions can shove a car sideways off a bridge deck or a pier; never let it end up in the sea
  keepOnLand() {
    const W = this.G.world;
    if (W.isLand(this.x, this.z)) { this.landX = this.x; this.landZ = this.z; return; }
    if (this.landX === undefined) return;
    this.x = this.landX; this.z = this.landZ;
    this.vx *= -0.2; this.vz *= -0.2;
    this.y = Math.max(this.y, W.groundY(this.x, this.z));
  }

  impact(amount, silent = false) {
    if (amount < 2) return;
    this.damage(amount);
    const now = this.G.time;
    if (now - this.lastImpact > 0.25 && !silent) {
      this.lastImpact = now;
      if (this.driver === 'player') {
        this.G.audio.crash(Math.min(1, amount / 20));
        this.G.shake(Math.min(0.6, amount / 30));
      }
    }
  }

  collideWorld() {
    const grid = this.G.world.colliders;
    const cs = this.circles();
    const r = this.r;
    for (let k = 0; k < 3; k++) {
      const c = cs[k];
      const hit = this.G.circleVsBoxes(grid, c.x, c.z, r);
      if (!hit) continue;
      if (this.y > 30) continue;
      this.x += hit.nx * hit.pen;
      this.z += hit.nz * hit.pen;
      for (const o of cs) { o.x += hit.nx * hit.pen; o.z += hit.nz * hit.pen; }
      const vn = this.vx * hit.nx + this.vz * hit.nz;
      if (vn < 0) {
        this.vx -= 1.25 * vn * hit.nx;
        this.vz -= 1.25 * vn * hit.nz;
        this.vx *= 0.92; this.vz *= 0.92;
        const offX = c.x - this.x, offZ = c.z - this.z;
        this.spin += (offZ * hit.nx - offX * hit.nz) * -vn * 0.05;
        if (-vn > 4) this.impact((-vn - 3) * 1.2);
      }
    }
  }

  effects(dt) {
    const fx = this.G.effects;
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    this.smokeT = 0.05;
    const hx = this.x + Math.sin(this.h) * this.spec.L * 0.35, hz = this.z + Math.cos(this.h) * this.spec.L * 0.35;
    if (this.fireT > 0 || (this.destroyed && this.deadT < 12)) {
      fx.fire(hx, this.y + 1.1, hz);
      fx.smoke(hx, this.y + 1.6, hz, 0.12, 1.4);
    } else if (this.health < 40 && !this.destroyed) {
      fx.smoke(hx, this.y + 1.0, hz, this.health < 20 ? 0.18 : 0.6, 0.8);
    }
    if (this.boosting) {
      const bx = this.x - Math.sin(this.h) * (this.spec.L / 2 + 0.2), bz = this.z - Math.cos(this.h) * (this.spec.L / 2 + 0.2);
      fx.nitro(bx, this.y + this.spec.wheelR * 0.9, bz);
    }
    if (this.onGround && !this.destroyed) {
      const sp = this.speed;
      if (this.slip > 5 && !this.offroad) {
        const bx = this.x - Math.sin(this.h) * this.spec.L * 0.4, bz = this.z - Math.cos(this.h) * this.spec.L * 0.4;
        fx.smoke(bx, this.y + 0.3, bz, 0.85, 0.7);
      }
      if (this.offroad && sp > 7) {
        const bx = this.x - Math.sin(this.h) * this.spec.L * 0.5, bz = this.z - Math.cos(this.h) * this.spec.L * 0.5;
        fx.dust(bx, this.y + 0.2, bz);
      }
    }
  }

  sync(dt, night, time) {
    const m = this.model;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.h;
    const W = this.G.world;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    let targetPitch;
    if (this.onGround) {
      const gf = W.groundY(this.x + fx * this.spec.L * 0.45, this.z + fz * this.spec.L * 0.45);
      const gb = W.groundY(this.x - fx * this.spec.L * 0.45, this.z - fz * this.spec.L * 0.45);
      targetPitch = Math.atan2(gf - gb, this.spec.L * 0.9);
    } else targetPitch = clamp(Math.atan2(this.vy, Math.max(4, Math.abs(this.fwdSpeed))) * 0.7, -0.6, 0.5);
    this.pitch = damp(this.pitch, targetPitch, this.onGround ? 14 : 3, dt);
    const sp = this.fwdSpeed;
    const rollT = -this.steer * clamp(Math.abs(sp) / this.spec.maxSpeed, 0, 1) * 0.08;
    this.roll = damp(this.roll, rollT, 6, dt);
    m.tilt.rotation.set(-this.pitch, 0, this.roll);
    for (const w of m.wheels) {
      w.spin.rotation.x += (sp * dt) / this.spec.wheelR;
      if (w.front) w.pivot.rotation.y = -this.steer * 0.5;
    }
    m.beam.visible = !this.destroyed && this.driver !== null && night > 0.05;
    if (m.siren) {
      const on = this.sirenOn && !this.destroyed;
      const ph = Math.floor(time * 6) % 2;
      m.siren.red.material = on && ph === 0 ? MAT.sirenRed : MAT.sirenOff;
      m.siren.blue.material = on && ph === 1 ? MAT.sirenBlue : MAT.sirenOff;
    }
  }

  dispose() {
    this.G.scene.remove(this.model.root);
  }
}

// Car-vs-car impulse resolution using three circles per car.
export function collideVehicles(G) {
  const vs = G.vehicles;
  for (let a = 0; a < vs.length; a++) {
    const A = vs[a];
    for (let b = a + 1; b < vs.length; b++) {
      const B = vs[b];
      const dx0 = B.x - A.x, dz0 = B.z - A.z;
      const lim = (A.spec.L + B.spec.L) * 0.5 + 0.5;
      if (dx0 * dx0 + dz0 * dz0 > lim * lim) continue;
      if (Math.abs(A.y - B.y) > 1.6) continue;
      const ca = A.circles(), cb = B.circles();
      const rr = A.r + B.r;
      let done = false;
      for (let i = 0; i < 3 && !done; i++) {
        for (let j = 0; j < 3 && !done; j++) {
          const dx = cb[j].x - ca[i].x, dz = cb[j].z - ca[i].z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-8) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          const pen = rr - d;
          const ma = A.spec.mass * (A.driver ? 1 : 1.4), mb = B.spec.mass * (B.driver ? 1 : 1.4);
          const ia = 1 / ma, ib = 1 / mb, it = ia + ib;
          A.x -= nx * pen * (ia / it); A.z -= nz * pen * (ia / it);
          B.x += nx * pen * (ib / it); B.z += nz * pen * (ib / it);
          A.keepOnLand(); B.keepOnLand();
          const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
          if (rv < 0) {
            const jimp = (-(1 + 0.25) * rv) / it;
            A.vx -= nx * jimp * ia; A.vz -= nz * jimp * ia;
            B.vx += nx * jimp * ib; B.vz += nz * jimp * ib;
            const offAx = ca[i].x - A.x, offAz = ca[i].z - A.z;
            const offBx = cb[j].x - B.x, offBz = cb[j].z - B.z;
            A.spin -= (offAz * nx - offAx * nz) * jimp * ia * 0.06;
            B.spin += (offBz * nx - offBx * nz) * jimp * ib * 0.06;
            const imp = -rv;
            if (imp > 4) {
              A.impact((imp - 3) * 0.9);
              B.impact((imp - 3) * 0.9);
              G.onCarCrash(A, B, imp);
            }
          }
          done = true;
        }
      }
    }
  }
}
