import * as THREE from '../vendor/three.module.min.js';

const MAX_CHEVRONS = 48;

// Road routing to the current goal: a map waypoint if you set one, otherwise whatever
// the guide says comes next (mission objective, getaway, or Dex for the next job).
export class GPS {
  constructor(G) {
    this.G = G;
    this.waypoint = null;
    this.route = null;
    this.remaining = [];
    this.distLeft = 0;
    this.turn = null;
    this.color = '#ffd23f';
    this.recalcT = 0;
    this.goalKey = '';
    const shape = new THREE.Shape([[0, 1.1], [1.1, -0.05], [1.1, -0.55], [0, 0.5], [-1.1, -0.55], [-1.1, -0.05]].map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, MAX_CHEVRONS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    G.scene.add(this.mesh);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1.25, 1, 1.25); this._c = new THREE.Color(); this._base = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setWaypoint(x, z, label = 'Waypoint') {
    this.waypoint = { x, z, label, color: '#ff3fa4' };
    this.recalcT = 0;
    this.G.notify(`Route set: ${label}`, 2);
  }
  clearWaypoint() {
    this.waypoint = null;
    this.recalcT = 0;
    this.G.notify('Waypoint cleared', 1.5);
  }

  get goal() { return this.waypoint || this.G.guide.target; }

  update(dt) {
    const G = this.G, W = G.world;
    // arrive at a map waypoint and it clears itself
    const P = G.player.outdoorPos;
    if (this.waypoint && G.player.space === W && Math.hypot(P.x - this.waypoint.x, P.z - this.waypoint.z) < 14) {
      this.waypoint = null;
      G.notify('You have arrived.', 1.8);
      G.audio.checkpoint();
    }
    const goal = this.goal;
    if (!goal) { this.route = null; this.remaining = []; this.turn = null; this.mesh.count = 0; this.goalKey = ''; return; }
    this.color = goal.color || '#ffd23f';
    const key = `${Math.round(goal.x / 4)},${Math.round(goal.z / 4)}`;
    this.recalcT -= dt;
    if (this.recalcT <= 0 || key !== this.goalKey) {
      this.route = W.pathBetween(P.x, P.z, goal.x, goal.z);
      this.recalcT = 1.2;
      this.goalKey = key;
    }
    if (!this.route) { this.remaining = []; this.mesh.count = 0; return; }
    this.progress(P);
    this.placeChevrons(dt);
  }

  // cut the route at the player's projection and find the next real turn
  progress(P) {
    const pts = this.route.points;
    let bestK = 0, bestD = Infinity, bx = pts[0].x, bz = pts[0].z;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.z - a.z) * dz) / l2));
      const x = a.x + dx * t, z = a.z + dz * t, d = Math.hypot(P.x - x, P.z - z);
      if (d < bestD) { bestD = d; bestK = k; bx = x; bz = z; }
    }
    if (bestD > 28) this.recalcT = 0; // wandered off: re-route next frame
    const rem = [{ x: P.x, z: P.z }, { x: bx, z: bz }, ...pts.slice(bestK + 1)];
    this.remaining = rem;
    let len = 0;
    for (let k = 1; k < rem.length; k++) len += Math.hypot(rem[k].x - rem[k - 1].x, rem[k].z - rem[k - 1].z);
    this.distLeft = len;
    this.turn = null;
    let acc = Math.hypot(rem[1].x - rem[0].x, rem[1].z - rem[0].z);
    for (let k = 2; k + 1 < rem.length; k++) {
      const a = rem[k - 1], b = rem[k], c = rem[k + 1];
      const l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z);
      acc += l1;
      if (l1 < 0.5 || l2 < 0.5) continue;
      const d1x = (b.x - a.x) / l1, d1z = (b.z - a.z) / l1, d2x = (c.x - b.x) / l2, d2z = (c.z - b.z) / l2;
      const cross = d1x * d2z - d1z * d2x, dot = d1x * d2x + d1z * d2z;
      const ang = Math.atan2(cross, dot);
      if (Math.abs(ang) > 0.5 && acc > 6) {
        this.turn = { dir: Math.abs(ang) > 2.6 ? 'uturn' : ang < 0 ? 'left' : 'right', dist: acc };
        break;
      }
    }
  }

  // animated arrows on the road surface for the next ~280 m
  placeChevrons() {
    const G = this.G, W = G.world;
    const R = this.remaining;
    if (G.player.space !== W || R.length < 2 || !G.player.alive) { this.mesh.count = 0; return; }
    const inCar = !!G.player.vehicle;
    const spacing = inCar ? 7 : 4;
    const lane = inCar ? 2.4 : 0;
    this._base.set(this.color);
    let n = 0, s = 0, k = 1;
    let segStart = 0;
    const end = Math.min(this.distLeft - 3, inCar ? 300 : 120);
    for (let target = inCar ? 9 : 4; target < end && n < MAX_CHEVRONS; target += spacing) {
      while (k < R.length && segStart + Math.hypot(R[k].x - R[k - 1].x, R[k].z - R[k - 1].z) < target) {
        segStart += Math.hypot(R[k].x - R[k - 1].x, R[k].z - R[k - 1].z);
        k++;
      }
      if (k >= R.length) break;
      const a = R[k - 1], b = R[k];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const dx = (b.x - a.x) / l, dz = (b.z - a.z) / l;
      const t = target - segStart;
      const x = a.x + dx * t - dz * lane, z = a.z + dz * t + dx * lane;
      const y = W.groundY(x, z) + 0.09;
      this._q.setFromAxisAngle(this._up, Math.atan2(dx, dz));
      this._m.compose(this._p.set(x, y, z), this._q, this._s);
      this.mesh.setMatrixAt(n, this._m);
      const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(target * 0.18 - G.time * 7));
      const fade = 1 - Math.max(0, (target - end * 0.6) / (end * 0.4 + 1));
      this.mesh.setColorAt(n, this._c.copy(this._base).multiplyScalar(pulse * 0.85 * Math.max(0.15, fade)));
      n++;
      s = target;
    }
    void s;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
