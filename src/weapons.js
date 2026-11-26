import * as THREE from '../vendor/three.module.min.js';
import { clamp, rand } from './util.js';

// dmg is per pellet. rate is seconds between shots. npcDmg is what an NPC hit does to the player.
export const WEAPONS = {
  fists: { id: 'fists', name: 'Fists', slot: 1, melee: true },
  pistol: {
    id: 'pistol', name: 'Coral P9', slot: 2, dmg: 34, rate: 0.2, auto: false, mag: 12, reload: 1.2, spread: 0.022, aimSpread: 0.004,
    range: 90, pellets: 1, recoil: 0.03, npcDmg: 8, sound: 'pistol', price: 450, ammo: { price: 60, rounds: 48 }, start: 36, driveBy: true,
    stats: { Damage: 0.45, 'Fire rate': 0.35, Range: 0.55, Control: 0.85 },
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', slot: 3, dmg: 21, rate: 0.08, auto: true, mag: 30, reload: 1.6, spread: 0.045, aimSpread: 0.015,
    range: 65, pellets: 1, recoil: 0.018, npcDmg: 6, sound: 'smg', price: 1600, ammo: { price: 90, rounds: 90 }, start: 90, driveBy: true,
    stats: { Damage: 0.3, 'Fire rate': 0.95, Range: 0.4, Control: 0.55 },
  },
  shotgun: {
    id: 'shotgun', name: 'Breaker 12', slot: 4, dmg: 15, rate: 0.85, auto: false, mag: 6, reload: 2.2, spread: 0.085, aimSpread: 0.06,
    range: 34, pellets: 8, recoil: 0.085, npcDmg: 18, sound: 'shotgun', price: 2200, ammo: { price: 80, rounds: 24 }, start: 18, falloff: 9,
    stats: { Damage: 1.0, 'Fire rate': 0.15, Range: 0.2, Control: 0.35 },
  },
  rifle: {
    id: 'rifle', name: 'Longshot AR', slot: 5, dmg: 31, rate: 0.11, auto: true, mag: 30, reload: 1.9, spread: 0.028, aimSpread: 0.005,
    range: 170, pellets: 1, recoil: 0.024, npcDmg: 10, sound: 'rifle', price: 4200, ammo: { price: 120, rounds: 90 }, start: 90,
    stats: { Damage: 0.55, 'Fire rate': 0.8, Range: 1.0, Control: 0.7 },
  },
};
export const ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

export class Arsenal {
  constructor() {
    this.owned = new Set(['fists']);
    this.ammo = {};
    for (const id of ORDER) this.ammo[id] = { mag: 0, res: 0 };
    this.current = 'fists';
    this.suppressor = false;
    this.drills = 0;
    this.reloadT = 0;
    this.fireT = 0;
    this.bloom = 0;
  }
  get w() { return WEAPONS[this.current]; }
  get armed() { return this.current !== 'fists'; }
  has(id) { return this.owned.has(id); }
  total(id) { return this.ammo[id].mag + this.ammo[id].res; }
  give(id, rounds = WEAPONS[id].start) {
    const fresh = !this.owned.has(id);
    this.owned.add(id);
    this.ammo[id].res += rounds;
    if (this.ammo[id].mag === 0) this.fillMag(id);
    if (fresh) this.select(id);
  }
  addAmmo(id, n) {
    this.ammo[id].res += n;
    if (this.ammo[id].mag === 0 && id !== this.current) this.fillMag(id);
  }
  fillMag(id) {
    const a = this.ammo[id], w = WEAPONS[id];
    const n = Math.min(w.mag - a.mag, a.res);
    a.mag += n; a.res -= n;
  }
  select(id) {
    if (!this.owned.has(id) || id === this.current) return false;
    this.current = id;
    this.reloadT = 0;
    this.fireT = Math.max(this.fireT, 0.25);
    return true;
  }
  cycle(dir) {
    const list = ORDER.filter((id) => this.owned.has(id));
    const i = list.indexOf(this.current);
    return this.select(list[(i + dir + list.length) % list.length]);
  }
  startReload() {
    const w = this.w;
    if (w.melee || this.reloadT > 0) return false;
    const a = this.ammo[this.current];
    if (a.mag >= w.mag || a.res <= 0) return false;
    this.reloadT = w.reload;
    return true;
  }
  update(dt) {
    this.fireT -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.15);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; this.fillMag(this.current); }
    }
  }
  save() {
    return { owned: [...this.owned], ammo: this.ammo, current: this.current, suppressor: this.suppressor, drills: this.drills };
  }
  load(s) {
    if (!s) return;
    for (const id of s.owned || []) if (WEAPONS[id]) this.owned.add(id);
    for (const id of ORDER) if (s.ammo?.[id]) this.ammo[id] = { mag: s.ammo[id].mag | 0, res: s.ammo[id].res | 0 };
    if (this.owned.has(s.current)) this.current = s.current;
    this.suppressor = !!s.suppressor;
    this.drills = s.drills | 0;
  }
}

// ------------------------------------------------------------------ raycasting
function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
    } else {
      let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const px = ox - cx, py = oy - cy, pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t > 0 ? t : null;
}
// standing: legs, torso, head (index 2 = headshot). lying: one wide sphere.
const BODY = [[0.5, 0.3], [1.15, 0.32], [1.6, 0.17]];

const _q = [];
// Returns the nearest hit along a normalised ray, or null.
export function raycast(G, space, ox, oy, oz, dx, dy, dz, maxT, opt = {}) {
  let best = maxT, hit = null;
  const set = (t, kind, target = null, head = false) => { best = t; hit = { t, kind, target, head }; };
  const outdoors = space === G.world;
  const floor = outdoors ? 0 : space.floorY;
  if (dy < -1e-4) { const t = (floor - oy) / dy; if (t > 0 && t < best) set(t, 'ground'); }
  if (!outdoors && dy > 1e-4) { const t = (space.ceilY - oy) / dy; if (t > 0 && t < best) set(t, 'wall'); }

  const ex = ox + dx * best, ez = oz + dz * best;
  space.colliders.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), _q);
  for (const b of _q) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b.minX, b.y0, b.minZ, b.maxX, b.y1, b.maxZ);
    if (t !== null && t < best) set(t, 'wall');
  }
  for (const tg of space.targets || []) {
    if (!tg.up) continue;
    const b = tg.box;
    const t = rayAABB(ox, oy, oz, dx, dy, dz, b.minX, b.y0, b.minZ, b.maxX, b.y1, b.maxZ);
    if (t !== null && t < best) set(t, 'target', tg);
  }
  const human = (x, y, z, down, kind, target) => {
    // quick reject: distance from ray to the person's axis
    const px = x - ox, pz = z - oz;
    const along = px * dx + pz * dz;
    if (along < -1 || along > best + 1) return;
    if (down) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, x, y + 0.25, z, 0.55);
      if (t !== null && t < best) set(t, kind, target);
      return;
    }
    for (let i = 0; i < 3; i++) {
      const t = raySphere(ox, oy, oz, dx, dy, dz, x, y + BODY[i][0], z, BODY[i][1]);
      if (t !== null && t < best) set(t, kind, target, i === 2);
    }
  };
  if (outdoors) {
    for (const p of G.peds) if (p.active && p.hittable) human(p.x, p.y, p.z, p.state === 'down', 'ped', p);
  }
  for (const n of G.npcs) if (n.space === space && n !== opt.ignore && !n.gone) human(n.x, n.y, n.z, n.dead, 'npc', n);
  if (outdoors) {
    for (const v of G.vehicles) {
      if (v === opt.ignoreVehicle) continue;
      const px = v.x - ox, pz = v.z - oz;
      const along = px * dx + pz * dz;
      if (along < -4 || along > best + 4) continue;
      const perp = Math.abs(px * dz - pz * dx);
      if (perp > v.spec.L) continue;
      const c = Math.cos(v.h), s = Math.sin(v.h);
      const lx = (ox - v.x) * c - (oz - v.z) * s, lz = (ox - v.x) * s + (oz - v.z) * c;
      const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
      const top = v.spec.wheelR * 0.8 + v.spec.bodyH + v.spec.cabH;
      const t = rayAABB(lx, oy - v.y, lz, ldx, dy, ldz, -v.spec.W / 2, 0.15, -v.spec.L / 2, v.spec.W / 2, top, v.spec.L / 2);
      if (t !== null && t < best) set(t, 'vehicle', v);
    }
    const H = G.wanted.heli;
    if (H && H.state !== 'crash') {
      const t = raySphere(ox, oy, oz, dx, dy, dz, H.x, H.y + 1.6, H.z, 3);
      if (t !== null && t < best) set(t, 'heli', H);
    }
  }
  if (!hit) return null;
  hit.x = ox + dx * hit.t; hit.y = oy + dy * hit.t; hit.z = oz + dz * hit.t;
  return hit;
}

// Resolve damage for a hit. Returns 'kill', 'hit' or null (scenery).
export function applyHit(G, hit, dmg, fromX, fromZ, byPlayer) {
  const fx = G.effects;
  switch (hit.kind) {
    case 'ped': {
      fx.puff(hit.x, hit.y, hit.z);
      return hit.target.shot(dmg * (hit.head ? 2 : 1), fromX, fromZ, byPlayer) ? 'kill' : 'hit';
    }
    case 'npc': {
      fx.puff(hit.x, hit.y, hit.z);
      return hit.target.damage(dmg * (hit.head ? 2.2 : 1), fromX, fromZ, byPlayer) ? 'kill' : 'hit';
    }
    case 'vehicle':
      hit.target.bulletHit(dmg, byPlayer);
      fx.impact(hit.x, hit.y, hit.z, 'metal');
      return 'hit';
    case 'heli':
      G.wanted.heliHit(dmg);
      fx.impact(hit.x, hit.y, hit.z, 'metal');
      return 'hit';
    case 'target':
      hit.target.hit();
      fx.impact(hit.x, hit.y, hit.z, 'wall');
      return 'hit';
    default:
      fx.impact(hit.x, hit.y + 0.02, hit.z, hit.kind === 'ground' ? 'dust' : 'wall');
      return null;
  }
}

// ------------------------------------------------------------------ player fire
const _d = new THREE.Vector3(), _m = new THREE.Vector3();
export function playerShoot(G) {
  const A = G.arsenal, w = A.w, P = G.player, cam = G.camera;
  if (w.melee || A.reloadT > 0 || A.fireT > 0) return false;
  const a = A.ammo[w.id];
  if (a.mag <= 0) {
    if (A.startReload()) G.audio.reload();
    else { G.audio.empty(); A.fireT = 0.3; G.notify(`Out of ammo for the ${w.name}.`, 1.5); }
    return false;
  }
  a.mag--;
  A.fireT = w.rate;
  cam.getWorldDirection(_d);
  const o = cam.position;
  const pp = P.pos;
  // start the ray at the player's depth so nothing between camera and player is hit
  const along = (pp.x - o.x) * _d.x + (pp.y + 1.3 - o.y) * _d.y + (pp.z - o.z) * _d.z;
  const start = Math.max(0, along + (P.vehicle ? 1.6 : 0.25));
  P.muzzle(_m);
  const moving = Math.hypot(P.vel.x, P.vel.z) > 1.5;
  const spread = (P.aiming ? w.aimSpread : w.spread) * (moving ? 1.6 : 1) + A.bloom;
  let hitAny = false, killed = false;
  for (let k = 0; k < w.pellets; k++) {
    let dx = _d.x + rand(-spread, spread), dy = _d.y + rand(-spread, spread), dz = _d.z + rand(-spread, spread);
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    const ox = o.x + _d.x * start, oy = o.y + _d.y * start, oz = o.z + _d.z * start;
    const hit = raycast(G, P.space, ox, oy, oz, dx, dy, dz, w.range, { ignoreVehicle: P.vehicle });
    const ex = hit ? hit.x : ox + dx * w.range, ey = hit ? hit.y : oy + dy * w.range, ez = hit ? hit.z : oz + dz * w.range;
    if (k < 3) G.effects.tracer(_m.x, _m.y, _m.z, ex, ey, ez);
    if (hit) {
      const fall = w.falloff ? clamp(1 - (hit.t - w.falloff) / (w.range - w.falloff), 0.25, 1) : 1;
      const r = applyHit(G, hit, w.dmg * fall, pp.x, pp.z, true);
      if (r) { hitAny = true; if (r === 'kill') killed = true; }
    }
  }
  if (hitAny) { G.hud.hitMarker(killed); G.audio.hitmark(killed); }
  A.bloom = Math.min(0.05, A.bloom + w.recoil * 0.35);
  G.cam.kick(w.recoil);
  const supp = A.suppressor && (w.id === 'pistol' || w.id === 'smg');
  G.effects.muzzle(_m.x, _m.y, _m.z, supp);
  G.effects.shell(_m.x, _m.y, _m.z);
  G.audio.gun(w.sound, 0, supp);
  G.gunfire(P.space, pp.x, pp.z, supp ? 9 : 55, true);
  if (a.mag === 0 && a.res > 0 && A.startReload()) G.audio.reload();
  return true;
}

// ------------------------------------------------------------------ NPC fire
// NPC shots use an accuracy roll instead of a physical ray: fair, cheap and readable.
const _n = new THREE.Vector3();
export function npcShoot(G, npc) {
  const w = WEAPONS[npc.weapon];
  const P = G.player;
  const tp = P.pos;
  const ty = tp.y + (P.vehicle ? 1.1 : 1.25);
  npc.muzzle(_n);
  const dist = Math.hypot(tp.x - npc.x, tp.z - npc.z);
  const moving = P.vehicle ? P.vehicle.speed / 22 : Math.hypot(P.vel.x, P.vel.z) / 9;
  let acc = npc.acc * clamp(1.2 - dist / (w.range * 0.85), 0.1, 1) * (1 - clamp(moving, 0, 1) * 0.55);
  if (P.downT > 0) acc *= 0.5;
  const hit = Math.random() < acc;
  let ex = tp.x, ey = ty, ez = tp.z;
  if (!hit) { ex += rand(-1.8, 1.8); ey += rand(-0.7, 1.3); ez += rand(-1.8, 1.8); }
  G.effects.tracer(_n.x, _n.y, _n.z, ex, ey, ez, npc.role === 'swat' ? 0xffb070 : 0xfff0b0);
  G.effects.muzzle(_n.x, _n.y, _n.z, false, false);
  G.audio.gun(w.sound, G.camera.position.distanceTo(_n), false);
  if (hit) {
    const dmg = w.npcDmg * (w.pellets > 1 ? clamp(1.5 - dist / 18, 0.3, 1.3) : 1);
    if (P.vehicle) {
      P.vehicle.damage(dmg * 0.7);
      if (Math.random() < 0.3) P.damage(dmg * 0.5, npc.x, npc.z);
    } else P.damage(dmg, npc.x, npc.z);
  } else {
    const floor = P.space === G.world ? G.world.groundY(ex, ez) : P.space.floorY;
    G.effects.impact(ex, Math.max(ey, floor + 0.05), ez, 'dust');
    if (Math.hypot(ex - tp.x, ez - tp.z) < 2.2 && Math.random() < 0.5) G.audio.whiz();
  }
  G.gunfire(npc.space, npc.x, npc.z, 40, false);
}
