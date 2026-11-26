import * as THREE from '../vendor/three.module.min.js';
import { Vehicle } from './vehicle.js';
import { DriverAI } from './ai.js';
import { buildHeli } from './models.js';
import { damp, dampAngle, rand } from './util.js';

const COUNTS = [0, 1, 2, 3, 4, 6];

export class Wanted {
  constructor(G) {
    this.G = G;
    this.heat = 0;
    this.stars = 0;
    this.unseenT = 0;
    this.seen = false;
    this.police = [];
    this.spawnT = 0;
    this.bustT = 0;
    this.heli = null;
    this.locked = false; // missions can hold the level

    const spot = new THREE.SpotLight('#dfe9ff', 0, 120, 0.22, 0.5, 1.2);
    spot.castShadow = false;
    G.scene.add(spot, spot.target);
    this.spot = spot;
    const coneGeo = new THREE.ConeGeometry(5.5, 36, 20, 1, true).translate(0, -18, 0);
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.cone.visible = false;
    G.scene.add(this.cone);
  }

  get evading() { return this.stars > 0 && !this.seen; }

  policeNear(x, z, r) {
    for (const p of this.G.vehicles) if (p.isPolice && !p.destroyed && Math.hypot(p.x - x, p.z - z) < r) return true;
    return false;
  }

  crime(amount, x, z, serious = false) {
    const witnessed = this.policeNear(x, z, 70);
    const a = amount * (witnessed ? 1.7 : 1) * (serious ? 1.2 : 1);
    this.heat = Math.min(5.99, this.heat + a);
    const s = Math.min(5, Math.floor(this.heat));
    if (s > this.stars) {
      this.stars = s;
      this.G.hud.starsChanged(true);
      this.G.audio.alert();
    }
    if (this.stars > 0) this.unseenT = 0;
  }

  setStars(n) {
    this.heat = Math.max(this.heat, n + 0.05);
    if (n > this.stars) { this.stars = n; this.G.hud.starsChanged(true); this.G.audio.alert(); }
    this.unseenT = 0;
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.bustT = 0;
    this.unseenT = 0;
    for (const v of this.police) {
      v.sirenOn = false;
      if (v.ai) { v.ai.mode = 'traffic'; v.ai.resync(); }
      v.despawnable = true;
    }
    this.police.length = 0;
    this.G.hud.starsChanged(false);
  }

  spawnPolice() {
    const G = this.G, W = G.world, P = G.player.pos;
    const fx = Math.sin(G.cam.yaw), fz = Math.cos(G.cam.yaw);
    let cand = null;
    for (let tries = 0; tries < 30; tries++) {
      const n = W.nodes[Math.floor(Math.random() * W.nodes.length)];
      const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz);
      if (d < 85 || d > 175) continue;
      if ((dx * fx + dz * fz) / d > 0.5 && tries < 20) continue;
      cand = n;
      break;
    }
    if (!cand) return;
    // first neighbour that heads toward the player
    let to = cand.nb[0], best = Infinity;
    for (const m of cand.nb) {
      const o = W.nodes[m];
      const d = Math.hypot(o.x - P.x, o.z - P.z);
      if (d < best) { best = d; to = m; }
    }
    const v = new Vehicle(G, 'police', '#16181d', cand.x, cand.z, 0);
    v.driver = 'ai';
    v.ai = new DriverAI(G, v, 'chase');
    v.ai.placeOn(cand.id, to, 0.05);
    v.sirenOn = true;
    G.vehicles.push(v);
    this.police.push(v);
  }

  update(dt) {
    const G = this.G, P = G.player.pos;
    // tidy up the police list
    for (let i = this.police.length - 1; i >= 0; i--) {
      const v = this.police[i];
      if (v.destroyed || v.driver !== 'ai' || !G.vehicles.includes(v)) this.police.splice(i, 1);
    }
    let nearest = Infinity;
    this.seen = false;
    if (this.stars > 0) {
      for (const v of this.police) {
        const d = Math.hypot(v.x - P.x, v.z - P.z);
        nearest = Math.min(nearest, d);
        if (d < 28 || (d < 80 && !G.world.colliders.lineBlocked(v.x, v.z, P.x, P.z, 4))) this.seen = true;
        if (d > 240) { v.despawnable = true; v.ai.mode = 'traffic'; v.sirenOn = false; }
      }
      if (this.heli && this.heli.state === 'chase' && Math.hypot(this.heli.x - P.x, this.heli.z - P.z) < 45) this.seen = true;
      if (this.seen) this.unseenT = 0;
      else if (!this.locked) this.unseenT += dt;
      const evade = 8 + this.stars * 2.5;
      if (this.unseenT > evade) {
        this.clear();
        G.notify('You lost the cops.', 2.5);
        G.onWantedLost();
      }
    } else {
      this.heat = Math.max(0, this.heat - 0.06 * dt);
    }

    if (this.stars > 0) {
      this.spawnT -= dt;
      if (this.police.length < COUNTS[this.stars] && this.spawnT <= 0) {
        this.spawnPolice();
        this.spawnT = 2.2;
      }
      // getting arrested: police right next to a (nearly) stationary player
      const pl = G.player;
      const sp = pl.vehicle ? pl.vehicle.speed : Math.hypot(pl.vel.x, pl.vel.z);
      let close = false;
      for (const v of this.police) {
        const d = Math.hypot(v.x - P.x, v.z - P.z);
        if (d < (pl.vehicle ? 7.5 : 6.5) && v.speed < 7) { close = true; break; }
      }
      if (close && sp < (pl.vehicle ? 2.8 : 2.4) && pl.alive) this.bustT += dt;
      else this.bustT = Math.max(0, this.bustT - dt * 1.5);
      if (this.bustT > 2.3) { this.bustT = 0; G.onBusted(); }
    } else this.bustT = 0;

    G.audio.setSiren(this.stars > 0 && nearest < 200 ? Math.max(0, 1 - nearest / 200) : 0);
    this.updateHeli(dt);
  }

  updateHeli(dt) {
    const G = this.G, P = G.player.pos;
    const want = this.stars >= 4;
    if (want && !this.heli) {
      const m = buildHeli();
      G.scene.add(m.root);
      const a = Math.random() * Math.PI * 2;
      this.heli = { m, x: P.x + Math.cos(a) * 260, z: P.z + Math.sin(a) * 260, y: 60, h: 0, state: 'chase', t: 0 };
    }
    const H = this.heli;
    if (!H) { this.spot.intensity = 0; this.cone.visible = false; return; }
    if (!want) H.state = 'leave';
    H.t += dt;
    let tx, tz, ty;
    if (H.state === 'chase') {
      tx = P.x + Math.cos(H.t * 0.4) * 18; tz = P.z + Math.sin(H.t * 0.4) * 18; ty = P.y + 34;
    } else {
      tx = H.x + (H.x - P.x); tz = H.z + (H.z - P.z); ty = 90;
    }
    const dx = tx - H.x, dz = tz - H.z, d = Math.hypot(dx, dz);
    const sp = Math.min(32, d * 0.9);
    if (d > 0.1) { H.x += (dx / d) * sp * dt; H.z += (dz / d) * sp * dt; }
    H.y = damp(H.y, ty, 1, dt);
    H.h = dampAngle(H.h, Math.atan2(P.x - H.x, P.z - H.z), 1.5, dt);
    H.m.root.position.set(H.x, H.y, H.z);
    H.m.root.rotation.set(Math.min(0.25, sp / 120), H.h, 0);
    H.m.rotor.rotation.y += dt * 28;
    H.m.tail.rotation.x += dt * 30;
    H.m.red.visible = Math.floor(H.t * 2) % 2 === 0;
    const night = G.env.night;
    const onTarget = H.state === 'chase' && d < 40;
    this.spot.position.set(H.x, H.y - 1, H.z);
    this.spot.target.position.set(P.x, P.y, P.z);
    this.spot.intensity = onTarget ? 1600 * night : 0;
    this.cone.visible = onTarget && night > 0.2;
    if (this.cone.visible) {
      const L = Math.hypot(P.x - H.x, P.y - H.y, P.z - H.z);
      this.cone.position.set(H.x, H.y - 1, H.z);
      this.cone.scale.set(L / 36 * 0.75, L / 36, L / 36 * 0.75);
      this.cone.lookAt(P.x, P.y, P.z);
      this.cone.rotateX(-Math.PI / 2);
      this.cone.material.opacity = 0.08 * night;
    }
    if (H.state === 'leave' && Math.hypot(H.x - P.x, H.z - P.z) > 350) {
      G.scene.remove(H.m.root);
      this.heli = null;
    }
    G.audio.setRotor(this.heli ? Math.max(0, 1 - Math.hypot(H.x - P.x, H.y - P.y, H.z - P.z) / 160) : 0);
    void rand;
  }
}
