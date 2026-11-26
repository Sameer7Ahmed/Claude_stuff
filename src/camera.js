import * as THREE from '../vendor/three.module.min.js';
import { clamp, damp, dampAngle, rand } from './util.js';

export class CameraRig {
  constructor(G, camera) {
    this.G = G;
    this.camera = camera;
    this.yaw = Math.PI / 2;
    this.pitch = 0.22;
    this.idleT = 0;
    this.shakeA = 0;
    this.fov = 70;
    this.tgt = new THREE.Vector3();
    this.distS = 6;
    this.aimK = 0;
    this.first = true;
  }

  shake(a) { this.shakeA = Math.min(1, this.shakeA + a); }
  kick(a) {
    this.pitch = clamp(this.pitch - a * 0.6, -0.75, 1.15);
    this.yaw += rand(-a, a) * 0.35;
  }
  // jump straight behind the player (used after doors and respawns)
  snap(yaw) {
    this.yaw = yaw;
    this.pitch = 0.18;
    this.first = true;
  }

  update(dt) {
    const G = this.G, inp = G.input, P = G.player, cam = this.camera;
    const W = P.space;
    const indoors = W !== G.world;
    const dx = inp.lookDX(), dy = inp.lookDY();
    const sens = P.aiming ? 0.0017 : 0.0026;
    if (dx || dy) {
      this.yaw -= dx * sens;
      this.pitch = clamp(this.pitch + dy * sens * 0.85, -0.75, 1.15);
      this.idleT = 0;
    } else this.idleT += dt;

    const v = P.vehicle;
    const aimFoot = P.aiming && !v;
    this.aimK = damp(this.aimK, aimFoot ? 1 : 0, 14, dt);
    let tx, ty, tz, dist;
    if (v) {
      tx = v.x; ty = v.y + 1.7; tz = v.z;
      dist = 8.2 + Math.min(4, v.speed * 0.07) + (v.type === 'van' || v.type === 'suv' ? 1.2 : 0);
      if (this.idleT > 0.9 && !P.aiming) {
        const sp = v.speed;
        const follow = sp > 2 ? (v.fwdSpeed < -2 ? v.h : Math.atan2(v.vx, v.vz)) : v.h;
        this.yaw = dampAngle(this.yaw, follow, sp > 2 ? 3.2 : 1.2, dt);
        this.pitch = damp(this.pitch, 0.2, 2, dt);
      }
    } else {
      // over the right shoulder when aiming
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      tx = P.x + rx * 0.7 * this.aimK; ty = P.y + 1.55 + 0.05 * this.aimK; tz = P.z + rz * 0.7 * this.aimK;
      dist = (indoors ? 4.2 : 5.2) * (1 - this.aimK) + 2.4 * this.aimK;
      const moving = Math.hypot(P.vel.x, P.vel.z) > 1;
      if (this.idleT > 2 && moving && !P.aiming && P.combatT <= 0) this.yaw = dampAngle(this.yaw, P.h, 0.8, dt);
    }
    if (this.first) { this.tgt.set(tx, ty, tz); this.distS = dist; this.first = false; }
    this.tgt.x = damp(this.tgt.x, tx, 18, dt);
    this.tgt.y = damp(this.tgt.y, ty, 10, dt);
    this.tgt.z = damp(this.tgt.z, tz, 18, dt);
    this.distS = damp(this.distS, dist, aimFoot ? 10 : 3, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fx = Math.sin(this.yaw) * cp, fy = -sp, fz = Math.cos(this.yaw) * cp;
    const T = this.tgt;
    let d = this.distS;
    for (let s = 0.6; s <= this.distS; s += 0.3) {
      const x = T.x - fx * s, z = T.z - fz * s, y = T.y - fy * s;
      if (y - W.groundY(x, z) < 40 && W.colliders.pointBlocked(x, z, 0.25, indoors ? 1.8 : 0)) { d = Math.max(0.9, s - 0.4); break; }
    }
    let cx = T.x - fx * d, cy = T.y - fy * d, cz = T.z - fz * d;
    cy = Math.max(cy, W.groundY(cx, cz) + 0.35);
    if (indoors) cy = Math.min(cy, W.ceilY - 0.3);
    if (this.shakeA > 0.001) {
      const a = this.shakeA * 0.35;
      cx += rand(-a, a); cy += rand(-a, a); cz += rand(-a, a);
      this.shakeA *= Math.exp(-6 * dt);
    }
    cam.position.set(cx, cy, cz);
    cam.lookAt(T.x + fx * 4, T.y + fy * 4 + 0.1, T.z + fz * 4);
    let fov = v ? 68 + Math.min(14, v.speed * 0.28) + (v.boosting ? 8 : 0) : 68;
    fov -= 16 * this.aimK;
    this.fov = damp(this.fov, fov, 6, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }

  // slow orbit for the title screen
  orbit(t) {
    const cam = this.camera;
    const a = t * 0.05 + 0.6;
    cam.position.set(Math.cos(a) * 300, 95, Math.sin(a) * 300);
    cam.lookAt(0, 35, 0);
    this.yaw = Math.atan2(-cam.position.x, -cam.position.z);
  }
}
