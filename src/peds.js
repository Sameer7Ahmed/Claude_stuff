import { buildHuman, randomLook, animateHuman, poseCower } from './models.js';
import { NB } from './config.js';
import { clamp, rand, randi, dampAngle, pick } from './util.js';

// Pedestrians walk around sidewalk loops ("rings": rectangles). City-block rings know
// their grid cell and can cross the street to a neighbouring block at corners.
const ringCorner = (r, k) => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]][k];
// crossing options per corner: [di, dj, corner index on the neighbour]
const CROSS = [
  [[-1, 0, 1], [0, -1, 3]],
  [[1, 0, 0], [0, -1, 2]],
  [[1, 0, 3], [0, 1, 1]],
  [[-1, 0, 2], [0, 1, 0]],
];
function ringDist(r, x, z) {
  const cx = clamp(x, r.x0, r.x1), cz = clamp(z, r.z0, r.z1);
  const inside = cx === x && cz === z;
  if (!inside) return Math.hypot(x - cx, z - cz);
  return Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z);
}
export function nearestRing(G, x, z) {
  let best = G.world.pedRings[0], bd = Infinity;
  for (const r of G.world.pedRings) { const d = ringDist(r, x, z); if (d < bd) { bd = d; best = r; } }
  return best;
}

export class Ped {
  constructor(G) {
    this.G = G;
    this.model = buildHuman(randomLook(), rand(0.92, 1.06));
    G.scene.add(this.model.root);
    this.active = true;
    this.state = 'walk';
    this.x = 0; this.z = 0; this.y = 0; this.h = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.phase = Math.random() * 10;
    this.speed = rand(1.2, 1.7);
    this.timer = 0;
    this.lie = 0;
    this.threatX = 0; this.threatZ = 0;
    this.ring = null; this.k = 0; this.dir = 1;
    this.tx = 0; this.tz = 0;
    this.crossing = false;
    this.hp = 100;
    this.out = false;
  }

  get hittable() { return this.model.root.visible; }

  // gunshot: returns true when this hit knocked them out
  shot(dmg, fromX, fromZ, byPlayer) {
    const G = this.G;
    if (this.out) return false;
    this.hp -= dmg;
    const dx = this.x - fromX, dz = this.z - fromZ, l = Math.hypot(dx, dz) || 1;
    if (this.hp <= 0) {
      this.out = true;
      this.knock((dx / l) * 2, (dz / l) * 2, 1.2, false);
      this.timer = 30;
      if (byPlayer) {
        G.wanted.crime(0.6, this.x, this.z);
        if (Math.random() < 0.5) G.pickups.spawnCash(this.x + rand(-0.5, 0.5), this.z + rand(-0.5, 0.5), randi(10, 60));
      }
      return true;
    }
    if (byPlayer) G.wanted.crime(0.3, this.x, this.z);
    if (this.state !== 'down') this.flee(fromX, fromZ);
    return false;
  }

  cower(t) {
    if (this.state === 'down') return;
    this.state = 'cower';
    this.timer = t;
  }

  spawnAt(ring) {
    this.ring = ring;
    this.k = randi(0, 3);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const a = ringCorner(ring, this.k), b = ringCorner(ring, (this.k + this.dir + 4) % 4);
    const t = Math.random();
    this.x = a[0] + (b[0] - a[0]) * t;
    this.z = a[1] + (b[1] - a[1]) * t;
    this.k = (this.k + this.dir + 4) % 4;
    [this.tx, this.tz] = b;
    this.state = 'walk';
    this.lie = 0;
    this.crossing = false;
    this.hp = 100;
    this.out = false;
    this.parked = false;
    this.retryT = 0;
    this.vx = this.vz = this.vy = 0;
    this.y = this.G.world.groundY(this.x, this.z);
    this.model.root.rotation.set(0, 0, 0);
    this.active = true;
    this.model.root.visible = true;
  }

  nextTarget() {
    const r = this.ring;
    if (!this.crossing && r.i !== undefined && Math.random() < 0.3) {
      const opts = CROSS[this.k].filter(([di, dj]) => {
        const ni = r.i + di, nj = r.j + dj;
        return ni >= 0 && nj >= 0 && ni < NB && nj < NB;
      });
      if (opts.length) {
        const [di, dj, nk] = pick(opts);
        this.ring = this.G.world.pedRings[(r.i + di) * NB + (r.j + dj)];
        this.k = nk;
        [this.tx, this.tz] = ringCorner(this.ring, this.k);
        this.crossing = true;
        return;
      }
    }
    this.crossing = false;
    if (Math.random() < 0.15) this.dir = -this.dir;
    this.k = (this.k + this.dir + 4) % 4;
    [this.tx, this.tz] = ringCorner(this.ring, this.k);
  }

  knock(vx, vz, up = 3, byPlayer = true) {
    if (this.state === 'down') { this.vx += vx * 0.5; this.vz += vz * 0.5; return; }
    this.state = 'down';
    this.vx = vx; this.vz = vz; this.vy = up;
    this.timer = rand(3.5, 5.5);
    this.G.audio.thud();
    this.G.panic(this.x, this.z, 18, byPlayer);
    if (byPlayer) {
      this.G.wanted.crime(0.45, this.x, this.z);
      if (Math.random() < 0.35) this.G.pickups.spawnCash(this.x + rand(-0.5, 0.5), this.z + rand(-0.5, 0.5), randi(5, 40));
    }
  }

  flee(fromX, fromZ, t = rand(5, 8)) {
    if (this.state === 'down') return;
    this.state = 'flee';
    this.threatX = fromX; this.threatZ = fromZ;
    this.timer = t;
  }

  resumeWalk() {
    this.ring = nearestRing(this.G, this.x, this.z);
    let best = 0, bd = Infinity;
    for (let k = 0; k < 4; k++) {
      const c = ringCorner(this.ring, k);
      const d = Math.hypot(c[0] - this.x, c[1] - this.z);
      if (d < bd) { bd = d; best = k; }
    }
    this.k = best;
    [this.tx, this.tz] = ringCorner(this.ring, best);
    this.state = 'walk';
    this.crossing = true; // may need to cross a road to get back
  }

  update(dt) {
    const G = this.G, W = G.world;
    const m = this.model;
    let moving = 0;
    if (this.state === 'walk' || this.state === 'flee') {
      let dx, dz, sp;
      if (this.state === 'walk') {
        dx = this.tx - this.x; dz = this.tz - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) { this.nextTarget(); dx = this.tx - this.x; dz = this.tz - this.z; }
        sp = this.speed;
      } else {
        dx = this.x - this.threatX; dz = this.z - this.threatZ;
        sp = 5.6;
        this.timer -= dt;
        if (this.timer <= 0) this.resumeWalk();
      }
      const l = Math.hypot(dx, dz) || 1;
      this.vx = (dx / l) * sp; this.vz = (dz / l) * sp;
      this.h = dampAngle(this.h, Math.atan2(dx, dz), 8, dt);
      moving = sp > 3 ? 1 : 0.55;
      this.phase += dt * sp * 2.6;
    } else if (this.state === 'down') {
      this.vx *= Math.exp(-3 * dt); this.vz *= Math.exp(-3 * dt);
      this.lie = Math.min(1, this.lie + dt * 5);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.lie = 0;
        m.root.rotation.x = 0;
        if (this.out) { respawnPed(G, this); return; }
        this.flee(G.player.x, G.player.z);
      }
    } else if (this.state === 'cower') {
      this.vx = this.vz = 0;
      this.timer -= dt;
      if (this.timer <= 0) this.flee(G.player.x, G.player.z, rand(3, 6));
    }

    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (W.isLand(nx, nz) && W.groundY(nx, nz) - this.y < 0.6) { this.x = nx; this.z = nz; }
    else { this.vx = -this.vx; this.vz = -this.vz; if (this.state === 'flee') { this.threatX = this.x + this.vx; this.threatZ = this.z + this.vz; } }
    const hit = G.circleVsBoxes(W.colliders, this.x, this.z, 0.35);
    if (hit) {
      this.x += hit.nx * hit.pen; this.z += hit.nz * hit.pen;
      if (this.state === 'flee') { this.threatX = this.x - hit.nz * 10; this.threatZ = this.z + hit.nx * 10; }
    }
    if (W.isLand(this.x, this.z)) { this.landX = this.x; this.landZ = this.z; }
    else if (this.landX !== undefined) { this.x = this.landX; this.z = this.landZ; }
    const g = W.groundY(this.x, this.z);
    if (this.y > g || this.vy > 0) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      if (this.y < g) { this.y = g; this.vy = 0; }
    } else this.y = g;

    // dodge fast cars heading at us
    if (this.state === 'walk') {
      for (const v of G.vehicles) {
        const sp = v.speed;
        if (sp < 8) continue;
        const dx = this.x - v.x, dz = this.z - v.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 140) continue;
        const ahead = (dx * v.vx + dz * v.vz) / sp;
        if (ahead > 0 && Math.abs(dx * v.vz - dz * v.vx) / sp < 2.4) { this.flee(v.x, v.z, 2.5); break; }
      }
    }

    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.h;
    if (this.state === 'down') {
      m.root.rotation.x = -Math.PI / 2 * this.lie;
      m.root.position.y = this.y + 0.15 * this.lie;
      animateHuman(m, 0, 0);
    } else if (this.state === 'cower') {
      animateHuman(m, 0, 0);
      poseCower(m);
    } else animateHuman(m, this.phase, moving);
  }
}

// Pool management: keep a population of pedestrians around the player.
export function updatePeds(G, dt) {
  const P = G.player.outdoorPos;
  for (const p of G.peds) {
    if (p.retryT > 0) { p.retryT -= dt; continue; }
    if (p.parked) { p.parked = false; respawnPed(G, p); continue; }
    const d = Math.hypot(p.x - P.x, p.z - P.z);
    if (d > 150) { respawnPed(G, p); continue; }
    p.model.root.visible = d < 130;
    if (d < 130 || p.state !== 'walk') p.update(dt);
  }
}

const ringCap = (r) => Math.max(2, Math.round((2 * (r.x1 - r.x0 + r.z1 - r.z0)) / 22));
export function respawnPed(G, p, near = false) {
  const P = G.player.outdoorPos;
  const fx = Math.sin(G.cam.yaw), fz = Math.cos(G.cam.yaw);
  const rings = G.world.pedRings;
  if (p.retryT > 0) return;
  for (let tries = 0; tries < 16; tries++) {
    const r = rings[Math.floor(Math.random() * rings.length)];
    if (r !== p.ring && G.peds.filter((o) => o.ring === r).length >= ringCap(r)) continue;
    if (ringDist(r, P.x, P.z) > 125) continue;
    p.spawnAt(r);
    const dx = p.x - P.x, dz = p.z - P.z, d = Math.hypot(dx, dz) || 0.1;
    if (d > 125 || (!near && d < 35)) continue;
    if (!near && (dx * fx + dz * fz) / d > 0.4 && d < 90) continue; // avoid popping in right in front
    return;
  }
  // nowhere suitable nearby (open country, or every loop is full): wait out of sight
  p.retryT = 2 + Math.random() * 2;
  p.parked = true;
  p.model.root.visible = false;
}

// Knock pedestrians (and the player on foot) aside when a car hits them.
export function carVsHumans(G) {
  for (const v of G.vehicles) {
    const sp = v.speed;
    if (sp < 0.5 && !v.destroyed) continue;
    const cs = v.circles();
    for (const p of G.peds) {
      if (!p.active) continue;
      const dx0 = p.x - v.x, dz0 = p.z - v.z;
      if (dx0 * dx0 + dz0 * dz0 > 16) continue;
      if (Math.abs(p.y - v.y) > 1.5) continue;
      for (const c of cs) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const rr = v.r + 0.35;
        if (d >= rr) continue;
        const nx = dx / (d || 1), nz = dz / (d || 1);
        p.x += nx * (rr - d); p.z += nz * (rr - d);
        if (sp > 4) {
          const byPlayer = v.driver === 'player';
          p.knock(v.vx * 0.7 + nx * 3, v.vz * 0.7 + nz * 3, Math.min(9, 2 + sp * 0.25), byPlayer);
          if (byPlayer) G.shake(0.15);
        }
        break;
      }
    }
    // cops and other armed NPCs on the street can be run down too
    for (const n of G.npcs) {
      if (n.space !== G.world || n.dead || sp < 4) continue;
      const dx0 = n.x - v.x, dz0 = n.z - v.z;
      if (dx0 * dx0 + dz0 * dz0 > 16) continue;
      for (const c of cs) {
        const dx = n.x - c.x, dz = n.z - c.z, d = Math.hypot(dx, dz), rr = v.r + 0.35;
        if (d >= rr) continue;
        n.x += (dx / (d || 1)) * (rr - d); n.z += (dz / (d || 1)) * (rr - d);
        n.damage(sp * 3.2, v.x, v.z, v.driver === 'player');
        break;
      }
    }
    const pl = G.player;
    if (!pl.vehicle && pl.alive && sp > 0.5 && pl.space === G.world) {
      const dx0 = pl.x - v.x, dz0 = pl.z - v.z;
      if (dx0 * dx0 + dz0 * dz0 < 16 && Math.abs(pl.y - v.y) < 1.5) {
        for (const c of cs) {
          const dx = pl.x - c.x, dz = pl.z - c.z;
          const d = Math.hypot(dx, dz);
          const rr = v.r + 0.35;
          if (d >= rr) continue;
          const nx = dx / (d || 1), nz = dz / (d || 1);
          pl.x += nx * (rr - d); pl.z += nz * (rr - d);
          if (sp > 6) pl.hitByCar(v, nx, nz);
          break;
        }
      }
    }
  }
}
