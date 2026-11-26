import { Vehicle } from './vehicle.js';
import { DriverAI } from './ai.js';
import { CAR_COLORS, NB, roadPos, LANE } from './config.js';
import { pick, rand, seededRandom } from './util.js';

const TYPES = [['sedan', 34], ['suv', 18], ['taxi', 14], ['van', 12], ['sports', 10], ['police', 5]];
const total = TYPES.reduce((a, t) => a + t[1], 0);
function randomType() {
  let r = Math.random() * total;
  for (const [t, w] of TYPES) { if ((r -= w) < 0) return t; }
  return 'sedan';
}
export function colorFor(type) {
  if (type === 'taxi') return '#f2c230';
  if (type === 'police') return '#16181d';
  return pick(CAR_COLORS);
}

// Choose a random road segment whose midpoint is between minD and maxD from the player.
function segmentNear(G, minD, maxD, avoidView) {
  const W = G.world, P = G.player.outdoorPos;
  const fx = Math.sin(G.cam.yaw), fz = Math.cos(G.cam.yaw);
  for (let tries = 0; tries < 40; tries++) {
    const a = W.nodes[Math.floor(Math.random() * W.nodes.length)];
    const b = W.nodes[pick(a.nb)];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const dx = mx - P.x, dz = mz - P.z, d = Math.hypot(dx, dz);
    if (d < minD || d > maxD) continue;
    if (avoidView && tries < 30 && (dx * fx + dz * fz) / d > 0.3 && d < 160) continue;
    return [a.id, b.id];
  }
  const a = W.nodes[Math.floor(Math.random() * W.nodes.length)];
  return [a.id, a.nb[0]];
}

export function spawnTrafficCar(G, near = false) {
  const type = randomType();
  const v = new Vehicle(G, type, colorFor(type), 0, 0, 0);
  v.driver = 'ai';
  v.ai = new DriverAI(G, v, 'traffic');
  v.traffic = true;
  const [a, b] = near ? segmentNear(G, 20, 200, false) : segmentNear(G, 110, 210, true);
  v.ai.placeOn(a, b);
  G.vehicles.push(v);
  return v;
}

export function spawnParked(G) {
  const W = G.world, rng = seededRandom(99);
  const spots = W.parkingSpots.filter(() => rng() < 0.55);
  for (const s of spots) {
    const type = rng() < 0.15 ? 'sports' : rng() < 0.3 ? 'suv' : rng() < 0.4 ? 'van' : 'sedan';
    const v = new Vehicle(G, type, CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], s.x, s.z, s.h + (rng() < 0.5 ? 0 : Math.PI));
    G.vehicles.push(v);
  }
  // kerbside parking along random road segments, outside the driving lane
  for (let k = 0; k < 26; k++) {
    const horizontal = rng() < 0.5;
    const line = Math.floor(rng() * (NB + 1));
    const seg = Math.floor(rng() * NB);
    const c = roadPos(line);
    const along = roadPos(seg) + 14 + rng() * 52;
    const side = rng() < 0.5 ? 1 : -1;
    const off = (LANE + 3.0) * side;
    let x, z, h;
    // face the direction of the adjacent lane (traffic keeps right)
    if (horizontal) { x = along; z = c + off; h = side > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { x = c + off; z = along; h = side > 0 ? Math.PI : 0; }
    const type = rng() < 0.12 ? 'sports' : rng() < 0.3 ? 'suv' : rng() < 0.42 ? 'taxi' : 'sedan';
    const v = new Vehicle(G, type, type === 'taxi' ? '#f2c230' : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], x, z, h);
    G.vehicles.push(v);
  }
  for (const s of W.policeLot || []) G.vehicles.push(new Vehicle(G, 'police', '#16181d', s.x, s.z, s.h));
}

export function initTraffic(G, count) {
  for (let i = 0; i < count; i++) spawnTrafficCar(G, true);
}

export function manageTraffic(G, target) {
  const P = G.player.outdoorPos;
  let traffic = 0;
  for (let i = G.vehicles.length - 1; i >= 0; i--) {
    const v = G.vehicles[i];
    const d = Math.hypot(v.x - P.x, v.z - P.z);
    if (v === G.player.vehicle) continue;
    const removable = v.destroyed ? (d > 120 || v.deadT > 45) : (v.despawnable && d > 160);
    if (removable && v !== G.lastCar) {
      v.dispose();
      G.vehicles.splice(i, 1);
      continue;
    }
    if (v.traffic && v.driver === 'ai' && v.ai && v.ai.mode === 'traffic' && !v.despawnable) {
      traffic++;
      if (d > 235 && !v.destroyed) {
        const [a, b] = segmentNear(G, 110, 210, true);
        v.ai.placeOn(a, b);
        v.health = 100;
      }
    }
  }
  if (traffic < target) spawnTrafficCar(G, false);
  // patrol cars that witness the player while wanted join the chase
  const w = G.wanted;
  if (w.stars > 0) {
    for (const v of G.vehicles) {
      if (!v.isPolice || v.driver !== 'ai' || !v.ai || v.ai.mode === 'chase' || v.destroyed) continue;
      if (Math.hypot(v.x - P.x, v.z - P.z) < 90) {
        v.ai.mode = 'chase';
        v.sirenOn = true;
        v.despawnable = false;
        v.ai.resync();
        if (!w.police.includes(v)) w.police.push(v);
      }
    }
  }
  void rand;
}
