import * as THREE from '../vendor/three.module.min.js';
import { Vehicle } from './vehicle.js';
import { DriverAI } from './ai.js';
import { Npc } from './npc.js';
import { buildHeli } from './models.js';
import { damp, dampAngle, rand } from './util.js';

const CARS = [0, 1, 2, 3, 4, 6];
const FOOT = [0, 0, 4, 6, 8, 10];

// Escalation:
//  1★ patrol cars try to box you in and arrest you
//  2★ officers step out of stopped cars
//  3★ officers shoot on sight (lethal force)
//  4★ helicopter with a searchlight, rifles in the mix
//  5★ tactical units
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
    this.heliCool = 0;
    this.locked = false; // heists hold the level while you're inside
    this.lethal = false;
    this.raidT = 0;
    this.raidSpawnT = 8;
    this.shotT = 0;
    this.copT = 0;

    const spot = new THREE.SpotLight('#dfe9ff', 0, 120, 0.22, 0.5, 1.2);
    spot.castShadow = false;
    G.root.add(spot, spot.target);
    this.spot = spot;
    const coneGeo = new THREE.ConeGeometry(5.5, 36, 20, 1, true).translate(0, -18, 0);
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.cone.visible = false;
    G.scene.add(this.cone);
  }

  get evading() { return this.stars > 0 && !this.seen; }
  get footCops() { return this.G.npcs.filter((n) => n.isCop && !n.dead && n.space === this.G.world); }

  policeNear(x, z, r) {
    for (const p of this.G.vehicles) if (p.isPolice && !p.destroyed && Math.hypot(p.x - x, p.z - z) < r) return true;
    for (const n of this.G.npcs) if (n.isCop && !n.dead && Math.hypot(n.x - x, n.z - z) < r) return true;
    return false;
  }

  crime(amount, x, z, serious = false) {
    // police seeing it happen matters for getting noticed, not once you're already wanted
    const witnessed = this.stars === 0 && this.policeNear(x, z, 70);
    const a = amount * (witnessed ? 1.7 : 1) * (serious ? 1.2 : 1);
    this.heat = Math.min(5.99, this.heat + a);
    const s = Math.min(5, Math.floor(this.heat));
    if (s > this.stars) {
      this.stars = s;
      this.G.hud.starsChanged(true);
      this.G.audio.alert();
    }
    if (this.stars >= 3) this.lethal = true;
    if (this.stars > 0) this.unseenT = 0;
  }

  // shooting at police: instant escalation to lethal force (heat added at most every 1.5 s)
  attackCop(x, z) {
    this.lethal = true;
    if (this.stars < 3) this.setStars(3);
    if (this.copT > 0) return;
    this.copT = 1.5;
    this.crime(0.6, x, z);
  }

  // gunshots get reported at most every couple of seconds, so a burst isn't five crimes
  reportShots(x, z, amount, serious = false) {
    if (this.shotT > 0) return;
    this.shotT = 2.5;
    this.crime(amount, x, z, serious);
  }

  setStars(n) {
    this.heat = Math.max(this.heat, n + 0.05);
    if (n > this.stars) { this.stars = n; this.G.hud.starsChanged(true); this.G.audio.alert(); }
    if (this.stars >= 3) this.lethal = true;
    this.unseenT = 0;
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.bustT = 0;
    this.unseenT = 0;
    this.lethal = false;
    this.locked = false;
    this.raidT = 0;
    this.raidSpawnT = 8;
    for (const v of this.police) {
      v.sirenOn = false;
      if (v.ai) { v.ai.mode = 'traffic'; v.ai.resync(); }
      v.despawnable = true;
    }
    this.police.length = 0;
    for (const n of this.G.npcs) if (n.isCop && !n.dead) { n.state = 'leave'; n.timer = 20; }
    this.G.hud.starsChanged(false);
  }

  makePoliceCar(node, toward) {
    const G = this.G, W = G.world;
    let to = node.nb[0], best = Infinity;
    for (const m of node.nb) {
      const o = W.nodes[m];
      const d = Math.hypot(o.x - toward.x, o.z - toward.z);
      if (d < best) { best = d; to = m; }
    }
    const v = new Vehicle(G, 'police', '#16181d', node.x, node.z, 0);
    v.driver = 'ai';
    v.ai = new DriverAI(G, v, 'chase');
    v.ai.placeOn(node.id, to, 0.05);
    v.sirenOn = true;
    G.vehicles.push(v);
    this.police.push(v);
    return v;
  }

  spawnPolice() {
    const G = this.G, W = G.world, P = G.player.outdoorPos;
    const fx = Math.sin(G.cam.yaw), fz = Math.cos(G.cam.yaw);
    for (let tries = 0; tries < 30; tries++) {
      const n = W.nodes[Math.floor(Math.random() * W.nodes.length)];
      const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz);
      if (d < 85 || d > 175) continue;
      if ((dx * fx + dz * fz) / d > 0.5 && tries < 20) continue;
      this.makePoliceCar(n, P);
      return;
    }
  }

  // a cordon around a location (used when the heist crew walks out of the bank)
  spawnPoliceNear(x, z, count) {
    const W = this.G.world;
    const nodes = W.nodes.filter((n) => { const d = Math.hypot(n.x - x, n.z - z); return d > 25 && d < 95; });
    nodes.sort(() => Math.random() - 0.5);
    for (const n of nodes.slice(0, count)) {
      const v = this.makePoliceCar(n, { x, z });
      v.deployAt = 1.5 + Math.random() * 2;
    }
  }

  deployOfficers(v) {
    const G = this.G;
    v.deployed = true;
    v.ai.mode = 'stop';
    const lx = Math.cos(v.h), lz = -Math.sin(v.h);
    const heavy = this.stars >= 5 ? 'swat' : 'cop';
    for (const side of [1, -1]) {
      const x = v.x + lx * side * (v.spec.W / 2 + 0.8), z = v.z + lz * side * (v.spec.W / 2 + 0.8);
      if (!G.world.isLand(x, z) || G.world.colliders.pointBlocked(x, z, 0.3)) continue;
      const weapon = heavy === 'swat' ? 'rifle' : this.stars >= 4 ? (Math.random() < 0.5 ? 'rifle' : 'shotgun') : 'pistol';
      const n = new Npc(G, G.world, heavy, x, z, v.h, { weapon });
      n.state = 'combat';
    }
  }

  update(dt) {
    const G = this.G, P = G.player.outdoorPos, pl = G.player;
    if (this.shotT > 0) this.shotT -= dt;
    if (this.copT > 0) this.copT -= dt;
    for (let i = this.police.length - 1; i >= 0; i--) {
      const v = this.police[i];
      if (v.destroyed || v.driver !== 'ai' || !G.vehicles.includes(v)) this.police.splice(i, 1);
    }
    const inside = pl.space !== G.world;
    let nearest = Infinity;
    this.seen = false;
    if (this.stars > 0) {
      for (const v of this.police) {
        const d = Math.hypot(v.x - P.x, v.z - P.z);
        nearest = Math.min(nearest, d);
        if (!inside && (d < 28 || (d < 80 && !G.world.colliders.lineBlocked(v.x, v.z, P.x, P.z, 4)))) this.seen = true;
        if (d > 240) { v.despawnable = true; v.ai.mode = 'traffic'; v.sirenOn = false; }
        // officers step out once the car stops near the suspect
        if (!v.deployed && this.stars >= 2 && !inside && v.speed < 3 && d < 30 && this.footCops.length < FOOT[this.stars]) this.deployOfficers(v);
        if (v.deployAt !== undefined && !v.deployed) { v.deployAt -= dt; if (v.deployAt <= 0) this.deployOfficers(v); }
      }
      for (const n of G.npcs) if (n.isCop && !n.dead && n.space === pl.space && n.canSee(pl.pos) && Math.hypot(n.x - pl.x, n.z - pl.z) < 45) this.seen = true;
      if (inside) this.seen = true; // they know which building you ran into
      if (this.heli && this.heli.state === 'chase' && Math.hypot(this.heli.x - P.x, this.heli.z - P.z) < 45) this.seen = true;
      if (this.seen || this.locked) this.unseenT = 0;
      else this.unseenT += dt;
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
      if (this.police.length < CARS[this.stars] && this.spawnT <= 0) {
        this.spawnPolice();
        this.spawnT = 2.2;
      }
      this.updateRaid(dt);
      // arrest: cuffs from a nearby officer, or a stationary car boxed in by patrols
      const sp = pl.vehicle ? pl.vehicle.speed : Math.hypot(pl.vel.x, pl.vel.z);
      let close = false;
      if (!inside) {
        for (const v of this.police) {
          if (Math.hypot(v.x - P.x, v.z - P.z) < (pl.vehicle ? 7.5 : 6.5) && v.speed < 7 && (!this.lethal || pl.vehicle)) { close = true; break; }
        }
      }
      if (!close && !this.lethal && !pl.vehicle) {
        for (const n of G.npcs) if (n.isCop && !n.dead && n.space === pl.space && Math.hypot(n.x - pl.x, n.z - pl.z) < 2.2) { close = true; break; }
      }
      const aimingAtCops = pl.aiming && G.arsenal.armed;
      if (close && sp < (pl.vehicle ? 2.8 : 2.4) && pl.alive && !aimingAtCops) this.bustT += dt;
      else this.bustT = Math.max(0, this.bustT - dt * 1.5);
      if (this.bustT > 2.3) { this.bustT = 0; G.onBusted(); }
    } else this.bustT = 0;

    G.audio.setSiren(this.stars > 0 && nearest < 200 ? Math.max(0, 1 - nearest / 200) * (inside ? 0.4 : 1) : 0);
    this.updateHeli(dt);
  }

  // hiding inside a shop: officers come through the front door
  updateRaid(dt) {
    const G = this.G, I = G.player.space;
    if (I === G.world || (I.id === 'bank' && G.heist.running)) { this.raidT = 0; this.raidSpawnT = 8; return; }
    this.raidT += dt;
    this.raidSpawnT -= dt;
    if (this.raidSpawnT > 0) return;
    this.raidSpawnT = 6;
    const inside = G.npcs.filter((n) => n.isCop && !n.dead && n.space === I).length;
    if (inside < Math.min(5, this.stars + 1)) {
      const n = new Npc(G, I, this.stars >= 4 ? 'swat' : 'cop', I.entry.x + rand(-1, 1), I.entry.z, Math.PI);
      n.state = 'combat';
      G.notify('Police are coming through the door!', 2);
    }
  }

  heliHit(dmg) {
    const H = this.heli;
    if (!H || H.state === 'crash') return;
    H.hp -= dmg;
    if (H.hp <= 0) {
      H.state = 'crash';
      H.vy = 0;
      this.G.notify('The chopper is going down!', 2);
      this.crime(1.5, H.x, H.z, true);
    }
  }

  updateHeli(dt) {
    const G = this.G, P = G.player.outdoorPos;
    if (this.heliCool > 0) this.heliCool -= dt;
    const want = this.stars >= 4 && this.heliCool <= 0;
    if (want && !this.heli) {
      const m = buildHeli();
      G.scene.add(m.root);
      const a = Math.random() * Math.PI * 2;
      this.heli = { m, x: P.x + Math.cos(a) * 260, z: P.z + Math.sin(a) * 260, y: 60, h: 0, state: 'chase', t: 0, hp: 420, vy: 0, spin: 0 };
    }
    const H = this.heli;
    if (!H) { this.spot.intensity = 0; this.cone.visible = false; G.audio.setRotor(0); return; }
    H.t += dt;
    if (H.state === 'crash') {
      H.vy -= 12 * dt;
      H.y += H.vy * dt;
      H.spin += dt * 3;
      H.h += H.spin * dt;
      G.effects.smoke(H.x, H.y + 1, H.z, 0.15, 1.5);
      G.effects.fire(H.x, H.y + 1.5, H.z);
      H.m.root.position.set(H.x, H.y, H.z);
      H.m.root.rotation.set(0.3, H.h, 0.25);
      H.m.rotor.rotation.y += dt * 10;
      if (H.y <= G.world.groundY(H.x, H.z) + 0.5) {
        G.explosion(H.x, H.y + 1, H.z, null);
        G.scene.remove(H.m.root);
        this.heli = null;
        this.heliCool = 45;
      }
      this.spot.intensity = 0;
      this.cone.visible = false;
      return;
    }
    if (!want) H.state = 'leave';
    let tx, tz, ty;
    if (H.state === 'chase') {
      tx = P.x + Math.cos(H.t * 0.4) * 18; tz = P.z + Math.sin(H.t * 0.4) * 18; ty = 34;
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
    const onTarget = H.state === 'chase' && d < 40 && G.player.space === G.world;
    const pp = G.player.pos;
    this.spot.position.set(H.x, H.y - 1, H.z);
    this.spot.target.position.set(pp.x, pp.y, pp.z);
    this.spot.intensity = onTarget ? 1600 * night : 0;
    this.cone.visible = onTarget && night > 0.2;
    if (this.cone.visible) {
      const L = Math.hypot(pp.x - H.x, pp.y - H.y, pp.z - H.z);
      this.cone.position.set(H.x, H.y - 1, H.z);
      this.cone.scale.set((L / 36) * 0.75, L / 36, (L / 36) * 0.75);
      this.cone.lookAt(pp.x, pp.y, pp.z);
      this.cone.rotateX(-Math.PI / 2);
      this.cone.material.opacity = 0.08 * night;
    }
    if (H.state === 'leave' && Math.hypot(H.x - P.x, H.z - P.z) > 350) {
      G.scene.remove(H.m.root);
      this.heli = null;
    }
    G.audio.setRotor(this.heli ? Math.max(0, 1 - Math.hypot(H.x - P.x, H.y - pp.y, H.z - P.z) / 160) * (G.player.space === G.world ? 1 : 0.3) : 0);
  }
}
