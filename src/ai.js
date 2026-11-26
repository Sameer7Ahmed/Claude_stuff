import { clamp, rand, wrapAngle, pick } from './util.js';
import { LANE } from './config.js';

// Lane-following driver used by civilian traffic and by police in pursuit.
export class DriverAI {
  constructor(G, vehicle, mode = 'traffic') {
    this.G = G;
    this.v = vehicle;
    this.mode = mode;          // 'traffic' | 'chase' | 'flee'
    this.cruise = rand(10, 14.5);
    this.from = 0; this.to = 1; this.next = 2;
    this.stuckT = 0;
    this.reverseT = 0;
    this.waitT = 0;
    this.impatientT = 0;
    this.direct = false;
    this.honkT = 0;
    this.fleeT = 0;
  }

  // panic: drive away from the player for a while, then rejoin traffic
  flee(t) {
    if (this.mode === 'chase' || this.mode === 'stop') return;
    if (this.mode !== 'flee') { this.mode = 'flee'; this.resync(); }
    this.fleeT = Math.max(this.fleeT, t);
  }

  // Put the vehicle on the lane of a road segment.
  placeOn(from, to, t = Math.random()) {
    const W = this.G.world;
    const A = W.nodes[from], B = W.nodes[to];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / len, dz = (B.z - A.z) / len;
    const rx = -dz, rz = dx;
    const d = 10 + t * (len - 20);
    this.v.x = A.x + dx * d + rx * LANE;
    this.v.z = A.z + dz * d + rz * LANE;
    this.v.h = Math.atan2(dx, dz);
    this.v.vx = dx * this.cruise * 0.7;
    this.v.vz = dz * this.cruise * 0.7;
    this.v.y = 0;
    this.from = from; this.to = to;
    this.next = this.chooseNext(to, from);
  }

  // Re-derive a route from the vehicle's current position and heading.
  resync() {
    const W = this.G.world, v = this.v;
    const n = W.nearestNode(v.x, v.z);
    const node = W.nodes[n];
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    let best = node.nb[0], bestDot = -2;
    for (const m of node.nb) {
      const o = W.nodes[m];
      const dx = o.x - node.x, dz = o.z - node.z, l = Math.hypot(dx, dz);
      const dot = (dx * fx + dz * fz) / l;
      if (dot > bestDot) { bestDot = dot; best = m; }
    }
    // if we're already past this node heading away from it, use it as "from"
    const toNode = (node.x - v.x) * fx + (node.z - v.z) * fz;
    if (toNode < 0) { this.from = n; this.to = best; }
    else {
      // find the node behind us on the same line
      const back = node.nb.find((m) => {
        const o = W.nodes[m];
        return ((o.x - node.x) * fx + (o.z - node.z) * fz) < -1;
      });
      this.from = back ?? best; this.to = n;
      if (this.from === this.to) this.to = best;
    }
    this.next = this.chooseNext(this.to, this.from);
  }

  chooseNext(node, prev) {
    const W = this.G.world;
    const n = W.nodes[node];
    if (this.mode === 'chase') {
      const P = this.G.player.outdoorPos;
      let best = null, bd = Infinity;
      for (const m of n.nb) {
        const o = W.nodes[m];
        const d = Math.hypot(o.x - P.x, o.z - P.z) + (m === prev ? 25 : 0);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    }
    if (this.mode === 'flee') {
      const P = this.G.player.outdoorPos;
      let best = null, bd = -Infinity;
      for (const m of n.nb) {
        if (m === prev) continue;
        const o = W.nodes[m];
        const d = Math.hypot(o.x - P.x, o.z - P.z) + rand(0, 30);
        if (d > bd) { bd = d; best = m; }
      }
      return best ?? prev;
    }
    const opts = n.nb.filter((m) => m !== prev);
    if (!opts.length) return prev;
    // prefer going straight
    const A = W.nodes[prev], B = n;
    const dx = B.x - A.x, dz = B.z - A.z;
    const straight = opts.find((m) => {
      const o = W.nodes[m];
      return Math.abs((o.x - B.x) * dz - (o.z - B.z) * dx) < 1;
    });
    if (straight !== undefined && Math.random() < 0.55) return straight;
    return pick(opts);
  }

  update(dt) {
    const v = this.v;
    if (v.destroyed || v.health <= 0 || this.mode === 'stop') { v.ctrl.throttle = 0; v.ctrl.steer = 0; v.ctrl.handbrake = true; return; }
    if (this.mode === 'flee') {
      this.fleeT -= dt;
      if (this.fleeT <= 0) { this.mode = 'traffic'; this.resync(); }
    }
    const G = this.G, W = G.world;
    const fx = Math.sin(v.h), fz = Math.cos(v.h);
    const vF = v.fwdSpeed;
    let tx, tz, desired;

    const P = G.player.outdoorPos;
    const pdx = P.x - v.x, pdz = P.z - v.z;
    const pdist = Math.hypot(pdx, pdz);
    const chasing = this.mode === 'chase';
    const wantDirect = chasing && G.player.space === W && pdist < 45 && !W.colliders.lineBlocked(v.x, v.z, P.x, P.z, 4);

    if (wantDirect) {
      this.direct = true;
      const pvel = G.player.vel;
      tx = P.x + pvel.x * 0.6; tz = P.z + pvel.z * 0.6;
      // box in a stopped or walking suspect instead of ramming them
      const pcar = G.player.vehicle;
      const slow = !pcar || pcar.speed < 6;
      desired = slow ? clamp((pdist - 7) * 1.4, 0, v.spec.maxSpeed) : v.spec.maxSpeed;
    } else {
      if (this.direct) { this.direct = false; this.resync(); }
      const A = W.nodes[this.from], B = W.nodes[this.to], C = W.nodes[this.next];
      let l1 = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      const d1x = (B.x - A.x) / l1, d1z = (B.z - A.z) / l1;
      const r1x = -d1z, r1z = d1x;
      let l2 = Math.hypot(C.x - B.x, C.z - B.z) || 1;
      const d2x = (C.x - B.x) / l2, d2z = (C.z - B.z) / l2;
      const r2x = -d2z, r2z = d2x;
      const lane = chasing ? LANE * 0.4 : LANE;
      const dot = d1x * d2x + d1z * d2z;
      let cx, cz;
      if (dot > 0.9) { cx = B.x + r1x * lane; cz = B.z + r1z * lane; }
      else if (dot < -0.9) { cx = B.x; cz = B.z; }
      else { cx = B.x + (r1x + r2x) * lane; cz = B.z + (r1z + r2z) * lane; }
      const remaining = (cx - v.x) * d1x + (cz - v.z) * d1z;
      const L = 5 + Math.abs(vF) * 0.45;
      if (remaining > L) {
        const bx = B.x + r1x * lane, bz = B.z + r1z * lane;
        const t = (v.x - bx) * d1x + (v.z - bz) * d1z;
        tx = bx + d1x * (t + L); tz = bz + d1z * (t + L);
      } else {
        const k = L - Math.max(remaining, 0);
        tx = cx + d2x * k; tz = cz + d2z * k;
      }
      if (remaining < 1.2) {
        this.from = this.to; this.to = this.next;
        this.next = this.chooseNext(this.to, this.from);
      }
      desired = chasing ? v.spec.maxSpeed * 0.92 : this.cruise;
      if (this.mode === 'flee') desired = v.spec.maxSpeed * 0.85;
      if (dot < 0.5 && remaining < 30) desired = Math.min(desired, (chasing ? 10 : 6.5) + Math.max(remaining, 0) * 0.35);
      // drifted far off our line (after a crash)? re-route
      const lineOff = Math.abs((v.x - A.x) * r1x + (v.z - A.z) * r1z);
      if (lineOff > 14 && remaining > 0) this.resync();
    }

    // obstacle avoidance (traffic only brakes; police push through)
    if (this.mode === 'traffic' && this.impatientT <= 0) {
      const lim = this.obstacleLimit(fx, fz);
      if (lim < desired) {
        desired = lim;
        if (lim < 1) this.waitT += dt;
      } else this.waitT = 0;
      if (this.waitT > 5) { this.impatientT = 2.5; this.waitT = 0; }
    }
    if (this.impatientT > 0) this.impatientT -= dt;

    // steering toward target
    const ang = Math.atan2(tx - v.x, tz - v.z);
    const diff = wrapAngle(ang - v.h);
    let steer = clamp(-diff * 2.6, -1, 1);
    let throttle = clamp((desired - vF) * 0.45, -1, 1);
    if (Math.abs(diff) > 1.6 && !this.direct) { throttle = Math.min(throttle, 0.4); }
    if (this.direct && Math.abs(diff) > 2.2 && pdist < 12) { throttle = -1; steer = -steer; }

    // unstick by reversing
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      throttle = -1; steer = -steer;
    } else if (desired > 3 && Math.abs(vF) < 0.8) {
      this.stuckT += dt;
      if (this.stuckT > (chasing ? 1.2 : 2.5)) { this.reverseT = 1.3; this.stuckT = 0; }
    } else this.stuckT = Math.max(0, this.stuckT - dt);

    v.ctrl.throttle = throttle;
    v.ctrl.steer = steer;
    v.ctrl.handbrake = desired < 0.5 && Math.abs(vF) < 2;
  }

  obstacleLimit(fx, fz) {
    const G = this.G, v = this.v;
    const rx = -fz, rz = fx;
    let lim = Infinity;
    for (const o of G.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 24) continue;
      if (Math.abs(dx * rx + dz * rz) > 2.6) continue;
      lim = Math.min(lim, Math.max(0, (ahead - 6) * 0.8));
    }
    const checkHuman = (x, z) => {
      const dx = x - v.x, dz = z - v.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 15) return;
      if (Math.abs(dx * rx + dz * rz) > 2.0) return;
      lim = Math.min(lim, Math.max(0, (ahead - 4) * 0.8));
    };
    for (const p of G.peds) if (p.active && p.state !== 'down') checkHuman(p.x, p.z);
    if (!G.player.vehicle && G.player.space === G.world) checkHuman(G.player.x, G.player.z);
    for (const n of G.npcs) if (n.space === G.world && !n.dead) checkHuman(n.x, n.z);
    return lim;
  }
}
