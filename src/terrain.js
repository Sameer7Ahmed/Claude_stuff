import { ROADS, segDist } from './layout.js';
import { smoothstep } from './util.js';

// Sundown Bluffs heightfield. The coastline is wherever the surface drops below the
// sea, so the island shape and the hills come from one function. Roads and building
// pads are carved in afterwards and the result is cached on a 2 m grid.
export const BLUFFS = { x0: -846, x1: -370, z0: -344, z1: 344, step: 2 };
const inB = (x, z) => x >= BLUFFS.x0 && x <= BLUFFS.x1 && z >= BLUFFS.z0 && z <= BLUFFS.z1;

export function baseHeight(x, z) {
  const e = ((x + 600) / 205) ** 2 + (z / 300) ** 2;
  const land = smoothstep(1.06, 0.84, e);
  const e2 = ((x + 640) / 150) ** 2 + ((z + 10) / 200) ** 2;
  const n1 = 0.5 + 0.5 * (Math.sin(x * 0.021 + 0.7) * Math.cos(z * 0.017 - 0.4) * 0.6 + Math.sin(x * 0.047 - 1.1) * Math.sin(z * 0.043 + 0.9) * 0.4);
  const n2 = 0.5 + 0.5 * Math.sin(x * 0.06 + z * 0.035) * Math.cos(z * 0.05 - x * 0.02);
  const hills = 30 * smoothstep(0.95, 0.12, e2) * (0.55 + 0.45 * n1) + 7 * smoothstep(0.92, 0.3, e) * n2;
  return -3 + land * (3.6 + hills);
}

export class Terrain {
  constructor() {
    const N = ROADS.nodes;
    const avg = (x, z) => {
      let s = 0;
      for (const [dx, dz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) s += baseHeight(x + dx, z + dz);
      return s / 5 + 0.2;
    };
    const nodeH = {};
    for (const [k, [x, z]] of Object.entries(N)) if (inB(x, z)) nodeH[k] = avg(x, z);
    // road segments to carve, each with end heights and half width
    this.segs = [];
    for (const [a, b, w] of ROADS.edges) {
      if (!(a in nodeH) || !(b in nodeH)) continue;
      const [ax, az] = N[a], [bx, bz] = N[b];
      this.segs.push({ ax, az, bx, bz, ha: nodeH[a], hb: nodeH[b], hw: w / 2 });
    }
    // the stretch between the Sunset Span landing and the first junction
    this.landing = { x: -428, z: -40, h: nodeH.Q0 };
    this.segs.push({ ax: -418, az: -40, bx: N.Q0[0], bz: N.Q0[1], ha: nodeH.Q0, hb: nodeH.Q0, hw: 7.5 });
    // flat pads for buildings
    this.pads = [
      { x: -612, z: -48, r: 16, h: avg(-612, -48) },
      { x: N.S2[0], z: N.S2[1], r: 14, h: nodeH.S2 },
      { x: -690, z: 150, r: 9, h: avg(-690, 150) },
    ];
    this.nodeH = nodeH;
    // cache the carved surface
    const B = BLUFFS;
    this.nx = Math.round((B.x1 - B.x0) / B.step) + 1;
    this.nz = Math.round((B.z1 - B.z0) / B.step) + 1;
    this.grid = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) this.grid[j * this.nx + i] = this.carved(B.x0 + i * B.step, B.z0 + j * B.step);
    }
  }

  // road / pad influence: returns {h, w} where w is how strongly to flatten
  carved(x, z) {
    const h0 = baseHeight(x, z);
    let h = h0;
    let best = Infinity, roadH = 0, hw = 5;
    for (const s of this.segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = s.ax + dx * t - x, ez = s.az + dz * t - z;
      const d = Math.sqrt(ex * ex + ez * ez);
      if (d < best) { best = d; roadH = s.ha + (s.hb - s.ha) * t; hw = s.hw; }
    }
    const w = 1 - smoothstep(hw + 4, hw + 14, best);
    h = h0 + (roadH - h0) * w;
    for (const p of this.pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      const wp = 1 - smoothstep(p.r, p.r + 10, d);
      if (wp > 0) h = h + (p.h - h) * wp;
    }
    return h;
  }

  inBounds(x, z) { return inB(x, z); }

  // bilinear lookup in the cached grid
  height(x, z) {
    const B = BLUFFS;
    const fx = (x - B.x0) / B.step, fz = (z - B.z0) / B.step;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
    const g = this.grid, n = this.nx;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // steepness for colouring and tree placement
  slope(x, z) {
    const e = 2;
    return Math.hypot(this.height(x + e, z) - this.height(x - e, z), this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
  }

  nearRoad(x, z, pad) {
    for (const s of this.segs) if (segDist(x, z, s.ax, s.az, s.bx, s.bz).d < s.hw + pad) return true;
    return false;
  }
}
