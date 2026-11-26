import * as THREE from '../vendor/three.module.min.js';
import { buildHuman, animateHuman, buildGun, poseAim, TWO_HANDED } from './models.js';
import { WEAPONS, ORDER, playerShoot, raycast } from './weapons.js';
import { clamp, damp, dampAngle } from './util.js';

const LOOK = { skin: '#c68863', shirt: '#14b8a6', pants: '#1f2937', hair: '#140e0b', shoes: '#f5f5f5', shades: true, bald: false };
const _d = new THREE.Vector3();

export class Player {
  constructor(G) {
    this.G = G;
    this.model = buildHuman(LOOK);
    this.model.root.traverse((o) => { if (o.isMesh && o !== this.model.blob) o.castShadow = true; });
    G.root.add(this.model.root);
    this.guns = {};
    for (const id of ORDER.slice(1)) {
      const g = buildGun(id);
      g.visible = false;
      g.castShadow = true;
      this.model.armR.add(g);
      this.guns[id] = g;
    }
    this.space = G.world;
    this.x = 0; this.y = 0; this.z = 0; this.h = 0; this.vy = 0;
    this.vel = { x: 0, z: 0 };
    this.health = 100;
    this.armor = 0;
    this.vehicle = null;
    this.alive = true;
    this.punchT = 0;
    this.punchHit = false;
    this.phase = 0;
    this.downT = 0;
    this.onGround = true;
    this.aiming = false;
    this.combatT = 0;
    this.aimTarget = null;
    this._pos = { x: 0, y: 0, z: 0 };
    this._out = { x: 0, y: 0, z: 0 };
  }

  get pos() {
    const p = this._pos;
    if (this.vehicle) { p.x = this.vehicle.x; p.y = this.vehicle.y; p.z = this.vehicle.z; }
    else { p.x = this.x; p.y = this.y; p.z = this.z; }
    return p;
  }
  // where the outside world thinks you are: the door of the building you're inside
  get outdoorPos() {
    if (this.space === this.G.world) return this.pos;
    const d = this.space.door, o = this._out;
    o.x = d.x; o.y = 0; o.z = d.z;
    return o;
  }

  place(x, z, h = 0) {
    this.x = x; this.z = z; this.h = h;
    this.y = this.space.groundY(x, z);
    this.vy = 0; this.vel.x = this.vel.z = 0;
    this.downT = 0;
    this.model.root.rotation.set(0, h, 0);
    this.model.root.position.set(x, this.y, z);
  }

  muzzle(out) {
    if (this.vehicle) return out.set(this.vehicle.x, this.vehicle.y + 1.5, this.vehicle.z);
    const g = this.guns[this.G.arsenal.current];
    if (g && g.visible) return g.localToWorld(out.set(0, 0, g.userData.len));
    return out.set(this.x, this.y + 1.4, this.z);
  }

  damage(amount, fromX, fromZ) {
    if (!this.alive || amount <= 0) return;
    if (this.armor > 0) {
      const a = Math.min(this.armor, amount * 0.75);
      this.armor -= a;
      amount -= a;
    }
    this.health -= amount;
    this.G.hud.flashDamage(fromX !== undefined ? Math.atan2(fromX - this.pos.x, fromZ - this.pos.z) : null);
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
    if (this.space !== this.G.world) return null;
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
    this.aiming = false;
    this.model.root.visible = false;
    G.audio.setInCar(true);
    G.hud.vehicleName(v.spec.name + (v.personal ? ' · personal' : ''));
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
    v.nitroOn = false;
    v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = true;
    G.lastCar = v;
    this.vehicle = null;
    this.place(px, pz, v.h);
    this.model.root.visible = true;
    G.audio.setInCar(false);
    G.hud.vehicleName(null);
  }

  update(dt) {
    if (!this.alive) return;
    const G = this.G, inp = G.input, A = G.arsenal;
    // weapon selection works on foot and in a car
    for (const id of ORDER) if (inp.hit('Digit' + WEAPONS[id].slot) && A.select(id)) G.audio.equip();
    if ((inp.wheel || inp.hit('KeyQ') || inp.touch.gun) && A.cycle(inp.wheel < 0 ? -1 : 1)) G.audio.equip();
    A.update(dt);
    if (this.vehicle) this.updateDriving(dt);
    else this.updateFoot(dt);
    this.combatT -= dt;
  }

  updateDriving() {
    const G = this.G, inp = G.input, v = this.vehicle, A = G.arsenal;
    v.ctrl.throttle = clamp(inp.axisY(), -1, 1);
    v.ctrl.steer = clamp(inp.axisX(), -1, 1);
    v.ctrl.handbrake = inp.down('Space') || inp.touch.brake;
    v.nitroOn = inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.touch.sprint;
    if (inp.hit('KeyH')) {
      G.audio.horn();
      G.panic(v.x + Math.sin(v.h) * 8, v.z + Math.cos(v.h) * 8, 10, false);
    }
    if (inp.hit('KeyR')) G.audio.nextStation();
    // drive-by with one-handed guns
    this.aiming = A.w.driveBy === true && inp.aimHeld();
    if (this.aiming && (A.w.auto ? inp.fireHeld() : inp.firePressed())) playerShoot(G);
    if (inp.hit('KeyF') || inp.touch.enter) this.exitVehicle();
    this.vel.x = v.vx; this.vel.z = v.vz;
    if (v.destroyed) {
      this.exitVehicle(true);
      this.damage(60);
      this.downT = 2;
    }
  }

  updateFoot(dt) {
    const G = this.G, W = this.space, inp = G.input, m = this.model, A = G.arsenal;
    const outdoors = W === G.world;
    let moving = 0;
    const armed = A.armed;
    this.aiming = armed && this.downT <= 0 && inp.aimHeld();
    if (inp.hit('KeyR') && A.startReload()) G.audio.reload();

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
      const sprint = !this.aiming && (inp.down('ShiftLeft') || inp.down('ShiftRight') || inp.touch.sprint);
      let sp = this.aiming ? 3.1 : sprint ? 8.4 : 4.6;
      if (G.heist.gold && G.heist.running) sp *= 0.72;
      this.vel.x = damp(this.vel.x, wx * sp, 12, dt);
      this.vel.z = damp(this.vel.z, wz * sp, 12, dt);
      // face where we shoot while aiming or just after firing, otherwise face movement
      if (this.aiming || this.combatT > 0) this.h = dampAngle(this.h, yaw, 20, dt);
      else if (len > 0.1) this.h = dampAngle(this.h, Math.atan2(wx, wz), 12, dt);
      moving = clamp(Math.hypot(this.vel.x, this.vel.z) / 8.4, 0, 1) * (sprint ? 1 : 0.7);
      this.phase += dt * Math.hypot(this.vel.x, this.vel.z) * 2.2;
      if ((inp.hit('Space') || inp.touch.jump) && this.onGround) { this.vy = 6.5; this.onGround = false; }

      if (!armed) {
        if ((inp.firePressed() || inp.hit('KeyE')) && this.punchT <= 0) {
          this.punchT = 0.38; this.punchHit = false;
          G.audio.whoosh();
        }
      } else if (A.w.auto ? inp.fireHeld() : inp.firePressed()) {
        this.combatT = 0.8;
        if (Math.abs(((this.h - G.cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5 || this.aiming) playerShoot(G);
      }
    }

    // punch resolution (people outdoors and inside)
    if (this.punchT > 0) {
      this.punchT -= dt;
      if (!this.punchHit && this.punchT < 0.22) {
        this.punchHit = true;
        const fx = Math.sin(this.h), fz = Math.cos(this.h);
        const inFront = (x, z) => {
          const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
          return d < 1.7 && (dx * fx + dz * fz) / (d || 1) > 0.35;
        };
        let landed = false;
        if (outdoors) for (const p of G.peds) {
          if (!p.active || p.state === 'down' || !inFront(p.x, p.z)) continue;
          p.knock(fx * 5, fz * 5, 2.5, true);
          landed = true;
          break;
        }
        if (!landed) for (const n of G.npcs) {
          if (n.space !== W || n.dead || !inFront(n.x, n.z)) continue;
          n.damage(18, this.x, this.z, true);
          landed = true;
          break;
        }
        if (landed) { G.audio.punch(); G.shake(0.12); }
      }
    }

    // move with step-height + boundary checks
    const ox = this.x, oz = this.z;
    const nx = ox + this.vel.x * dt, nz = oz + this.vel.z * dt;
    const ok = (x, z) => W.isLand(x, z) && (W.groundY(x, z) - this.y <= 0.55);
    if (ok(nx, nz)) { this.x = nx; this.z = nz; }
    else if (ok(nx, oz)) this.x = nx;
    else if (ok(ox, nz)) this.z = nz;
    const hit = G.circleVsBoxes(W.colliders, this.x, this.z, 0.35);
    if (hit) { this.x += hit.nx * hit.pen; this.z += hit.nz * hit.pen; }
    if (outdoors) {
      for (const v of G.vehicles) {
        const dx0 = this.x - v.x, dz0 = this.z - v.z;
        if (dx0 * dx0 + dz0 * dz0 > 16 || this.y > v.y + 1.4) continue;
        for (const c of v.circles()) {
          const dx = this.x - c.x, dz = this.z - c.z, d = Math.hypot(dx, dz), rr = v.r + 0.35;
          if (d < rr && d > 1e-4) { this.x += (dx / d) * (rr - d); this.z += (dz / d) * (rr - d); }
        }
      }
    }
    const g = W.groundY(this.x, this.z);
    if (this.y > g + 0.02 || this.vy > 0) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      this.onGround = false;
      if (this.y <= g) { this.y = g; this.vy = 0; this.onGround = true; }
    } else { this.y = g; this.onGround = true; }

    // pose
    m.root.position.set(this.x, this.y + (this.downT > 0 ? 0.15 : 0), this.z);
    m.root.rotation.y = this.h;
    animateHuman(m, this.phase, this.downT > 0 ? 0 : moving, this.punchT > 0 ? 1 - this.punchT / 0.38 : 0);
    if (!this.onGround) { m.legL.rotation.x = -0.5; m.legR.rotation.x = 0.3; }
    for (const id in this.guns) this.guns[id].visible = id === A.current;
    if (armed && this.downT <= 0) {
      if (this.aiming || this.combatT > 0) poseAim(m, G.cam.pitch, TWO_HANDED[A.current]);
      else m.armR.rotation.x = Math.min(m.armR.rotation.x, -0.3);
      if (A.reloadT > 0) { m.armL.rotation.set(-1.1, 0, -0.5); m.armR.rotation.x = -0.9; }
    }
    this.updateAimTarget();

    // slow regen up to 50
    if (this.health < 50) this.health = Math.min(50, this.health + dt * 0.8);
  }

  // who is under the crosshair (for HUD colour and the bank hold-up)
  updateAimTarget() {
    const G = this.G;
    this.aimTarget = null;
    if (!G.arsenal.armed || !this.aiming) return;
    const cam = G.camera;
    cam.getWorldDirection(_d);
    const o = cam.position;
    const along = (this.x - o.x) * _d.x + (this.y + 1.3 - o.y) * _d.y + (this.z - o.z) * _d.z;
    const s = Math.max(0, along + 0.3);
    const hit = raycast(G, this.space, o.x + _d.x * s, o.y + _d.y * s, o.z + _d.z * s, _d.x, _d.y, _d.z, 60, {});
    if (hit && (hit.kind === 'npc' || hit.kind === 'ped')) this.aimTarget = hit.target;
  }
}
