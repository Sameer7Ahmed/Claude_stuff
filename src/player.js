import { buildHuman, animateHuman } from './models.js';
import { clamp, damp, dampAngle } from './util.js';

const LOOK = { skin: '#c68863', shirt: '#14b8a6', pants: '#1f2937', hair: '#140e0b', shoes: '#f5f5f5', shades: true, bald: false };

export class Player {
  constructor(G) {
    this.G = G;
    this.model = buildHuman(LOOK);
    this.model.root.traverse((o) => { if (o.isMesh && o !== this.model.blob) o.castShadow = true; });
    G.scene.add(this.model.root);
    this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.vy = 0;
    this.vel = { x: 0, z: 0 };
    this.health = 100;
    this.vehicle = null;
    this.alive = true;
    this.punchT = 0;
    this.punchHit = false;
    this.phase = 0;
    this.downT = 0;
    this.onGround = true;
    this._pos = { x: 0, y: 0, z: 0 };
  }

  get pos() {
    const p = this._pos;
    if (this.vehicle) { p.x = this.vehicle.x; p.y = this.vehicle.y; p.z = this.vehicle.z; }
    else { p.x = this.x; p.y = this.y; p.z = this.z; }
    return p;
  }

  place(x, z, h = 0) {
    this.x = x; this.z = z; this.h = h;
    this.y = this.G.world.groundY(x, z);
    this.vy = 0; this.vel.x = this.vel.z = 0;
    this.downT = 0;
    this.model.root.rotation.set(0, h, 0);
  }

  damage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.G.hud.flashDamage();
    if (this.health <= 0) {
      this.health = 0;
      this.G.onPlayerDown();
    }
  }

  hitByCar(v, nx, nz) {
    if (this.downT > 0) return;
    const sp = v.speed;
    this.damage(sp * 1.6);
    this.downT = 2.2;
    this.vel.x = v.vx * 0.6 + nx * 3; this.vel.z = v.vz * 0.6 + nz * 3;
    this.vy = Math.min(8, 2 + sp * 0.2);
    this.G.audio.thud();
    this.G.shake(0.4);
  }

  nearestVehicle() {
    let best = null, bd = Infinity;
    for (const v of this.G.vehicles) {
      if (v.destroyed || v.fireT > 0) continue;
      const d = Math.hypot(v.x - this.x, v.z - this.z) - v.spec.L * 0.5;
      if (d < 3.0 && d < bd && Math.abs(v.y - this.y) < 1.5) { bd = d; best = v; }
    }
    return best;
  }

  enterVehicle(v) {
    const G = this.G;
    if (v.driver === 'ai') {
      G.ejectDriver(v);
      G.wanted.crime(v.isPolice ? 1.6 : 0.6, v.x, v.z, true);
      G.notify(v.isPolice ? 'You stole a patrol car. Bold.' : 'Carjacked!', 2);
    } else if (v.isPolice) {
      G.wanted.crime(1.2, v.x, v.z, true);
    }
    G.releaseVehicleAI(v);
    v.driver = 'player';
    v.ctrl.handbrake = false;
    this.vehicle = v;
    this.model.root.visible = false;
    G.audio.setInCar(true);
    G.hud.vehicleName(v.spec.name);
  }

  exitVehicle(force = false) {
    const G = this.G, W = G.world, v = this.vehicle;
    if (!v) return;
    if (!force && v.speed > 9) { G.notify('Slow down to get out.', 1.5); return; }
    const lx = Math.cos(v.h), lz = -Math.sin(v.h);
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const side = v.spec.W / 2 + 0.8;
    const spots = [[lx * side, lz * side], [-lx * side, -lz * side], [-fx * (v.spec.L / 2 + 1), -fz * (v.spec.L / 2 + 1)], [fx * (v.spec.L / 2 + 1), fz * (v.spec.L / 2 + 1)]];
    let px = v.x + spots[0][0], pz = v.z + spots[0][1];
    for (const [ox, oz] of spots) {
      const x = v.x + ox, z = v.z + oz;
      if (W.isLand(x, z) && !W.colliders.pointBlocked(x, z, 0.4)) { px = x; pz = z; break; }
    }
    v.driver = null;
    v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = true;
    this.vehicle = null;
    this.place(px, pz, v.h);
    this.model.root.visible = true;
    G.audio.setInCar(false);
    G.hud.vehicleName(null);
  }

  update(dt) {
    if (!this.alive) return;
    if (this.vehicle) this.updateDriving(dt);
    else this.updateFoot(dt);
  }

  updateDriving(dt) {
    const G = this.G, inp = G.input, v = this.vehicle;
    v.ctrl.throttle = clamp(inp.axisY(), -1, 1);
    v.ctrl.steer = clamp(inp.axisX(), -1, 1);
    v.ctrl.handbrake = inp.down('Space') || inp.touch.brake;
    if (inp.hit('KeyH')) {
      G.audio.horn();
      G.panic(v.x + Math.sin(v.h) * 8, v.z + Math.cos(v.h) * 8, 10, false);
    }
    if (inp.hit('KeyR')) G.audio.nextStation();
    if (inp.hit('KeyF') || inp.touch.enter) this.exitVehicle();
    this.vel.x = v.vx; this.vel.z = v.vz;
    if (v.destroyed) {
      this.exitVehicle(true);
      this.damage(60);
      this.downT = 2;
    }
  }

  updateFoot(dt) {
    const G = this.G, W = G.world, inp = G.input, m = this.model;
    let moving = 0;
    if (this.downT > 0) {
      this.downT -= dt;
      this.vel.x *= Math.exp(-3 * dt); this.vel.z *= Math.exp(-3 * dt);
      m.root.rotation.x = damp(m.root.rotation.x, -Math.PI / 2, 10, dt);
    } else {
      m.root.rotation.x = damp(m.root.rotation.x, 0, 12, dt);
      const mx = inp.axisX(), my = inp.axisY();
      const yaw = G.cam.yaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
      let wx = fx * my + rx * mx, wz = fz * my + rz * mx;
      const len = Math.hypot(wx, wz);
      if (len > 1) { wx /= len; wz /= len; }
      const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.touch.sprint;
      const sp = sprint ? 8.4 : 4.6;
      this.vel.x = damp(this.vel.x, wx * sp, 12, dt);
      this.vel.z = damp(this.vel.z, wz * sp, 12, dt);
      if (len > 0.1) this.h = dampAngle(this.h, Math.atan2(wx, wz), 12, dt);
      moving = clamp(Math.hypot(this.vel.x, this.vel.z) / 8.4, 0, 1) * (sprint ? 1 : 0.7);
      this.phase += dt * Math.hypot(this.vel.x, this.vel.z) * 2.2;
      if ((inp.hit('Space') || inp.touch.jump) && this.onGround) { this.vy = 6.5; this.onGround = false; }
      if ((inp.clicked || inp.hit('KeyE') || inp.touch.punch) && this.punchT <= 0) {
        this.punchT = 0.38; this.punchHit = false;
        G.audio.whoosh();
      }
      if (inp.hit('KeyF') || inp.touch.enter) {
        const v = this.nearestVehicle();
        if (v) { this.enterVehicle(v); return; }
      }
    }

    // punch resolution
    if (this.punchT > 0) {
      this.punchT -= dt;
      if (!this.punchHit && this.punchT < 0.22) {
        this.punchHit = true;
        const fx = Math.sin(this.h), fz = Math.cos(this.h);
        for (const p of G.peds) {
          if (!p.active || p.state === 'down') continue;
          const dx = p.x - this.x, dz = p.z - this.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.7 && (dx * fx + dz * fz) / (d || 1) > 0.35) {
            p.knock(fx * 5, fz * 5, 2.5, true);
            G.audio.punch();
            G.shake(0.12);
            break;
          }
        }
      }
    }

    // move with step-height + shoreline checks
    const ox = this.x, oz = this.z;
    const nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
    const ok = (x, z) => W.isLand(x, z) && (W.groundY(x, z) - this.y <= 0.55);
    if (ok(nx, nz)) { this.x = nx; this.z = nz; }
    else if (ok(nx, oz)) this.x = nx;
    else if (ok(ox, nz)) this.z = nz;
    const hit = G.circleVsBoxes(W.colliders, this.x, this.z, 0.35);
    if (hit) { this.x += hit.nx * hit.pen; this.z += hit.nz * hit.pen; }
    // don't walk through parked cars
    for (const v of G.vehicles) {
      const dx0 = this.x - v.x, dz0 = this.z - v.z;
      if (dx0 * dx0 + dz0 * dz0 > 16 || this.y > v.y + 1.4) continue;
      for (const c of v.circles()) {
        const dx = this.x - c.x, dz = this.z - c.z, d = Math.hypot(dx, dz), rr = v.r + 0.35;
        if (d < rr && d > 1e-4) { this.x += (dx / d) * (rr - d); this.z += (dz / d) * (rr - d); }
      }
    }
    const g = W.groundY(this.x, this.z);
    if (this.y > g + 0.02 || this.vy > 0) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      this.onGround = false;
      if (this.y <= g) { this.y = g; this.vy = 0; this.onGround = true; }
    } else { this.y = g; this.onGround = true; }

    m.root.position.set(this.x, this.y + (this.downT > 0 ? 0.15 : 0), this.z);
    m.root.rotation.y = this.h;
    animateHuman(m, this.phase, this.downT > 0 ? 0 : moving, this.punchT > 0 ? 1 - this.punchT / 0.38 : 0);
    if (!this.onGround) { m.legL.rotation.x = -0.5; m.legR.rotation.x = 0.3; }

    // slow regen up to 50
    if (this.health < 50) this.health = Math.min(50, this.health + dt * 0.8);
  }
}
