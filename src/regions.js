import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { LANDS, BRIDGES, ROADS, WORLD, pointInPoly, polyBounds, offsetPoly } from './layout.js';
import { Terrain } from './terrain.js';
import { LAND, PIER, PALETTE } from './config.js';
import { cbox, colorize, seededRandom, smoothstep } from './util.js';
import { MAT } from './models.js';
import { noiseTexture, asphaltTexture, signTexture, roadSignTexture } from './textures.js';

const ease = (t) => t * t * (3 - 2 * t);

// ------------------------------------------------------------------ bridges
class Bridge {
  constructor(def, groundAt) {
    Object.assign(this, def);
    this.hw = def.width / 2;
    this.segs = [];
    let s = 0;
    const P = def.points;
    for (let k = 0; k + 1 < P.length; k++) {
      const [ax, az] = P[k], [bx, bz] = P[k + 1];
      const len = Math.hypot(bx - ax, bz - az);
      this.segs.push({ ax, az, bx, bz, len, s0: s, dx: (bx - ax) / len, dz: (bz - az) / len });
      s += len;
    }
    this.L = s;
    this.hA = groundAt(P[0][0], P[0][1]);
    this.hB = groundAt(P[P.length - 1][0], P[P.length - 1][1]);
    const xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
    this.bx0 = Math.min(...xs) - this.hw; this.bx1 = Math.max(...xs) + this.hw;
    this.bz0 = Math.min(...zs) - this.hw; this.bz1 = Math.max(...zs) + this.hw;
  }
  heightAt(s) {
    const H = this.height, r = this.ramp;
    if (s < r) return this.hA + (H - this.hA) * ease(Math.max(0, s) / r);
    if (s > this.L - r) return this.hB + (H - this.hB) * ease(Math.max(0, this.L - s) / r);
    return H;
  }
  // deck height under (x, z), or null when off the deck
  query(x, z) {
    if (x < this.bx0 || x > this.bx1 || z < this.bz0 || z > this.bz1) return null;
    let bestS = -1, bestD = Infinity;
    for (const g of this.segs) {
      const t = (x - g.ax) * g.dx + (z - g.az) * g.dz;
      if (t < 0 || t > g.len) continue;
      const d = Math.abs((x - g.ax) * g.dz - (z - g.az) * g.dx);
      if (d <= this.hw && d < bestD) { bestD = d; bestS = g.s0 + t; }
    }
    for (let k = 1; k < this.segs.length; k++) {
      const g = this.segs[k];
      const d = Math.hypot(x - g.ax, z - g.az);
      if (d <= this.hw && d < bestD) { bestD = d; bestS = g.s0; }
    }
    return bestS < 0 ? null : this.heightAt(bestS);
  }
  pointAt(s) {
    s = Math.max(0, Math.min(this.L, s));
    for (const g of this.segs) {
      if (s <= g.s0 + g.len + 1e-6) {
        const t = s - g.s0;
        return { x: g.ax + g.dx * t, z: g.az + g.dz * t, dx: g.dx, dz: g.dz };
      }
    }
    const g = this.segs[this.segs.length - 1];
    return { x: g.bx, z: g.bz, dx: g.dx, dz: g.dz };
  }
}

// ------------------------------------------------------------------ regions
export function buildRegions(scene, W) {
  const rng = seededRandom(9071);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const terrain = new Terrain();
  const lands = Object.entries(LANDS).map(([id, L]) => ({ id, ...L, bb: polyBounds(L.outer) }));
  const landAt = (x, z) => {
    for (const L of lands) {
      if (x < L.bb.x0 || x > L.bb.x1 || z < L.bb.z0 || z > L.bb.z1) continue;
      if (!pointInPoly(x, z, L.outer)) continue;
      if (L.holes.some((h) => pointInPoly(x, z, h))) return null;
      return L;
    }
    return null;
  };
  const groundAt = (x, z) => (terrain.inBounds(x, z) ? terrain.height(x, z) : 0);
  const bridges = BRIDGES.map((d) => new Bridge(d, groundAt));
  const bridgeObj = (x, z) => { for (const b of bridges) if (b.query(x, z) !== null) return b; return null; };
  const bridgeH = (x, z) => { for (const b of bridges) { const h = b.query(x, z); if (h !== null) return h; } return null; };
  const coastEdges = W.edges.filter((e) => !e.city);
  const onCoastRoad = (x, z) => {
    for (const e of coastEdges) {
      if (x < e.minX || x > e.maxX || z < e.minZ || z > e.maxZ) continue;
      const dx = e.bx - e.ax, dz = e.bz - e.az;
      let t = ((x - e.ax) * dx + (z - e.az) * dz) / (e.len * e.len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (Math.hypot(e.ax + dx * t - x, e.az + dz * t - z) <= e.w / 2) return true;
    }
    return false;
  };
  // solid ground anywhere except bridges (used for the shoreline and for bridge piers)
  const solidLand = (x, z) => W.baseIsLand(x, z) || !!landAt(x, z) || (terrain.inBounds(x, z) && terrain.height(x, z) > -0.25);

  // ---- the extended world queries
  W.groundY = (x, z) => {
    const hb = bridgeH(x, z);
    if (hb !== null) return hb;
    if (terrain.inBounds(x, z)) return terrain.height(x, z);
    return W.baseGroundY(x, z);
  };
  W.isLand = (x, z) => solidLand(x, z) || bridgeH(x, z) !== null;
  W.onRoad = (x, z) => W.baseOnRoad(x, z) || onCoastRoad(x, z) || bridgeH(x, z) !== null;
  W.surface = (x, z) => {
    if (bridgeH(x, z) !== null || onCoastRoad(x, z)) return 'road';
    if (terrain.inBounds(x, z)) return 'grass';
    const L = landAt(x, z);
    if (L) return L.top === 'concrete' ? 'paved' : L.top;
    return W.baseSurface(x, z);
  };
  W.bridgeAt = bridgeObj;
  W.landAt = landAt;
  W.terrain = terrain;
  W.bridges = bridges;
  W.lands = lands;
  W.regionParked = [];
  W.regionTokens = [];
  W.regionUpdate = [];

  // ---- shared geometry buckets
  const solid = [], glow = [], windows = [], neonPink = [], neonCyan = [], neonGold = [], neonOrange = [];
  const palms = [], lamps = [], blinkGeos = [];
  const addCollider = (minX, minZ, maxX, maxZ, h, y0 = 0) => W.colliders.add({ minX, maxX, minZ, maxZ, y0, y1: y0 + h, h });
  const winMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  winMat.userData.day = new THREE.Color('#243040');
  winMat.userData.night = new THREE.Color('#ffd9a0');
  W.windowMats.push(winMat);
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const blinkMat = new THREE.MeshBasicMaterial({ color: '#ff2020' });
  const add = (geos, mat, { cast = true, receive = true } = {}) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast; m.receiveShadow = receive;
    m.matrixAutoUpdate = false; m.updateMatrix();
    scene.add(m);
    return m;
  };
  // oriented box from p0 to p1 (deck pieces, rails, cables): top-centre line, given width/height
  const _e = new THREE.Euler(), _m = new THREE.Matrix4();
  function beam(x0, y0, z0, x1, y1, z1, w, h, color, hang = true) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const horiz = Math.hypot(dx, dz), len = Math.hypot(horiz, dy);
    const g = new THREE.BoxGeometry(w, h, len);
    if (hang) g.translate(0, -h / 2, 0);
    _e.set(-Math.atan2(dy, horiz), Math.atan2(dx, dz), 0, 'YXZ');
    g.applyMatrix4(_m.makeRotationFromEuler(_e));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return colorize(g, color);
  }
  function sign(text, color, x, y, z, rotY, width) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true, color: '#bbbbbb' }));
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
    W.neonMats.push(m.material);
    return m;
  }

  // ------------------------------------------------ land masses
  const tops = {
    grass: (() => { const t = noiseTexture('#5aa24e', 0.22, 31, 256, 7000); t.repeat.set(0.08, 0.08); return new THREE.MeshStandardMaterial({ map: t, roughness: 1 }); })(),
    concrete: (() => { const t = noiseTexture('#9c9a94', 0.18, 32, 256, 7000); t.repeat.set(0.06, 0.06); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }); })(),
    sand: (() => { const t = noiseTexture('#e6d3a3', 0.2, 33, 256, 7000); t.repeat.set(0.08, 0.08); return new THREE.MeshStandardMaterial({ map: t, roughness: 1 }); })(),
  };
  const toShape = (poly) => new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const L of lands) {
    const shape = toShape(L.outer);
    for (const h of L.holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false });
    g.rotateX(Math.PI / 2);
    g.translate(0, -0.02, 0);
    const m = new THREE.Mesh(g, tops[L.top]);
    m.receiveShadow = true;
    scene.add(m);
    const rim = new THREE.ExtrudeGeometry(toShape(offsetPoly(L.outer, 9)), { depth: 2.4, bevelEnabled: false });
    rim.rotateX(Math.PI / 2);
    rim.translate(0, -0.3, 0);
    const rm = new THREE.Mesh(rim, L.id === 'harbor' ? tops.concrete : tops.sand);
    rm.receiveShadow = true;
    scene.add(rm);
    // stone sea walls around canals
    for (const h of L.holes) {
      for (let k = 0; k < h.length; k++) {
        const [ax, az] = h[k], [bx, bz] = h[(k + 1) % h.length];
        solid.push(beam(ax, 0.25, az, bx, 0.25, bz, 0.8, 1.6, '#cbbfa8'));
      }
    }
  }

  // ------------------------------------------------ Sundown Bluffs terrain
  {
    const T = terrain, st = 2;
    const cols = Math.floor((T.nx - 1) / st) + 1, rows = Math.floor((T.nz - 1) / st) + 1;
    const pos = new Float32Array(cols * rows * 3), col = new Float32Array(cols * rows * 3);
    const cSand = new THREE.Color('#d6c08a'), cRock = new THREE.Color('#8b7d6b'), cLow = new THREE.Color('#6aa84f');
    const cHigh = new THREE.Color('#3e7a3a'), cDry = new THREE.Color('#a8a85c'), c = new THREE.Color();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const gi = Math.min(T.nx - 1, i * st), gj = Math.min(T.nz - 1, j * st);
        const x = -846 + gi * 2, z = -344 + gj * 2;
        const h = T.grid[gj * T.nx + gi];
        const k = (j * cols + i) * 3;
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
        const sl = T.slope(x, z);
        if (h < 0.7) c.copy(cSand);
        else if (sl > 0.62) c.copy(cRock);
        else {
          c.copy(cLow).lerp(cHigh, smoothstep(4, 26, h));
          const n = 0.5 + 0.5 * Math.sin(x * 0.09 + z * 0.05) * Math.cos(z * 0.07 - x * 0.03);
          if (n > 0.72) c.lerp(cDry, (n - 0.72) * 2.5);
          if (sl > 0.4) c.lerp(cRock, (sl - 0.4) * 3);
        }
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
    }
    const idx = [];
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, cc = a + cols, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    m.receiveShadow = true;
    scene.add(m);
  }

  // ------------------------------------------------ coast roads: ribbons, junction discs, markings, sidewalks
  {
    const asph = asphaltTexture();
    asph.wrapS = asph.wrapT = THREE.RepeatWrapping;
    const P = [], N = [], UV = [], I = [];
    const marks = [];
    const discs = [];
    const isCity = (id) => W.nodes[id].city;
    for (const e of coastEdges) {
      const hw = e.w / 2;
      const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len, px = -dz, pz = dx;
      const s0 = isCity(e.a) ? 8.5 : 0, s1 = e.len - (isCity(e.b) ? 8.5 : 0);
      const n = Math.max(1, Math.ceil((s1 - s0) / 3));
      const base = P.length / 3;
      for (let k = 0; k <= n; k++) {
        const s = s0 + ((s1 - s0) * k) / n;
        const x = e.ax + dx * s, z = e.az + dz * s, y = W.groundY(x, z) + 0.05;
        P.push(x + px * hw, y, z + pz * hw, x - px * hw, y, z - pz * hw);
        N.push(0, 1, 0, 0, 1, 0);
        UV.push(0, s / 8, e.w / 8, s / 8);
        if (k < n) { const a = base + k * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      // dashed centre line
      if (e.w >= 10) {
        for (let s = s0 + 6; s < s1 - 6; s += 7) {
          const x = e.ax + dx * (s + 1.75), z = e.az + dz * (s + 1.75);
          const y = W.groundY(x, z) + 0.065;
          marks.push(beam(e.ax + dx * s, y, e.az + dz * s, e.ax + dx * (s + 3.5), W.groundY(e.ax + dx * (s + 3.5), e.az + dz * (s + 3.5)) + 0.065, e.az + dz * (s + 3.5), 0.16, 0.02, '#f5c518', false));
          void x; void z;
        }
      }
      // sidewalks in the neighbourhoods
      const L = landAt((e.ax + e.bx) / 2, (e.az + e.bz) / 2);
      const onBridge = bridgeH((e.ax + e.bx) / 2, (e.az + e.bz) / 2) !== null;
      if (L && (L.id === 'heights' || L.id === 'lantern') && !onBridge) {
        for (const side of [1, -1]) {
          const o = (hw + 1.5) * side;
          const a0 = s0 + 7, a1 = s1 - 7;
          if (a1 <= a0) continue;
          marks.push(beam(e.ax + dx * a0 + px * o, 0.1, e.az + dz * a0 + pz * o, e.ax + dx * a1 + px * o, 0.1, e.az + dz * a1 + pz * o, 2.6, 0.1, '#d8d3c8', false));
        }
      }
    }
    // junction discs where coast roads meet
    for (const n of W.nodes) {
      if (n.city) continue;
      let r = 0;
      for (const m of n.nb) r = Math.max(r, W.edgeWidth(n.id, m) / 2);
      const g = new THREE.CircleGeometry(r + 0.4, 20).rotateX(-Math.PI / 2);
      g.translate(n.x, W.groundY(n.x, n.z) + 0.055, n.z);
      g.deleteAttribute('uv');
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      discs.push(g);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    rg.setIndex(I);
    const roadMat = new THREE.MeshStandardMaterial({ map: asph, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1 });
    const roads = new THREE.Mesh(mergeGeometries([rg, ...discs]), roadMat);
    roads.receiveShadow = true;
    scene.add(roads);
    add(marks, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }), { cast: false });
  }

  // ------------------------------------------------ bridges
  for (const b of bridges) {
    const col = { girder: '#ff8fc8', arch: '#ff6b3d', lift: '#2c9a9b', cable: '#e8eef5', canal: '#d8c8b0' }[b.style];
    const deckT = b.style === 'girder' ? 2.2 : 1.2;
    const step = 4;
    const n = Math.ceil(b.L / step);
    for (let k = 0; k < n; k++) {
      const sA = (b.L * k) / n, sB = (b.L * (k + 1)) / n;
      const A = b.pointAt(sA), B = b.pointAt(sB);
      const hA = b.heightAt(sA), hB = b.heightAt(sB);
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      const under = solidLand(mx, mz) ? groundAt(mx, mz) : -3;
      const depth = Math.max(deckT, (hA + hB) / 2 - under + 0.3);
      solid.push(beam(A.x, hA, A.z, B.x, hB, B.z, b.width, depth, '#a3a7ad'));
      const px = -A.dz, pz = A.dx;
      for (const side of [1, -1]) {
        const ox = px * (b.hw - 0.3) * side, oz = pz * (b.hw - 0.3) * side;
        if (b.style === 'canal') {
          solid.push(beam(A.x + ox, hA + 0.95, A.z + oz, B.x + ox, hB + 0.95, B.z + oz, 0.5, 0.95, col));
        } else {
          solid.push(beam(A.x + ox, hA + 1.1, A.z + oz, B.x + ox, hB + 1.1, B.z + oz, 0.14, 0.14, col));
          solid.push(cbox(0.16, 1.1, 0.16, A.x + ox, hA + 0.55, A.z + oz, col));
        }
      }
      // piers down to the water
      if (b.style !== 'canal' && k % 6 === 3 && !solidLand(mx, mz)) {
        for (const side of [1, -1]) {
          const x = mx + px * b.hw * 0.5 * side, z = mz + pz * b.hw * 0.5 * side;
          const top = (hA + hB) / 2 - deckT;
          solid.push(cbox(1.6, top + 4, 1.6, x, (top - 4) / 2, z, '#b8bcc2'));
        }
      }
      if (k % 8 === 4 && b.style !== 'canal') {
        const side = k % 16 === 4 ? 1 : -1;
        lamps.push({ x: mx + px * (b.hw - 0.5) * side, y: (hA + hB) / 2, z: mz + pz * (b.hw - 0.5) * side, rot: Math.atan2(-px * side, -pz * side) });
      }
    }
    const span = (u0, u1, fn) => { for (let k = 0; k < 24; k++) fn(u0 + ((u1 - u0) * k) / 24, u0 + ((u1 - u0) * (k + 1)) / 24); };
    const mid = b.pointAt(b.L / 2);
    const px = -mid.dz, pz = mid.dx;
    if (b.style === 'arch') {
      const u0 = b.ramp * 0.9, u1 = b.L - b.ramp * 0.9, H = b.height;
      const archY = (u) => H + 16 * (1 - ((2 * (u - u0)) / (u1 - u0) - 1) ** 2);
      for (const side of [1, -1]) {
        span(u0, u1, (a, c) => {
          const A = b.pointAt(a), C = b.pointAt(c);
          solid.push(beam(A.x + px * b.hw * side, archY(a) + 0.6, A.z + pz * b.hw * side, C.x + px * b.hw * side, archY(c) + 0.6, C.z + pz * b.hw * side, 0.9, 1.2, col));
        });
        for (let u = u0 + 6; u < u1 - 4; u += 6) {
          const A = b.pointAt(u);
          solid.push(cbox(0.2, archY(u) - b.heightAt(u), 0.2, A.x + px * b.hw * side, (archY(u) + b.heightAt(u)) / 2, A.z + pz * b.hw * side, '#f2e6da'));
        }
      }
    } else if (b.style === 'cable') {
      for (const f of [0.32, 0.68]) {
        const s = b.L * f, C = b.pointAt(s), cpx = -C.dz, cpz = C.dx, H = b.heightAt(s);
        for (const side of [1, -1]) {
          const lx = C.x + cpx * (b.hw + 0.9) * side, lz = C.z + cpz * (b.hw + 0.9) * side;
          solid.push(cbox(1.4, H + 36, 1.4, lx, (H + 36) / 2 - 2, lz, col));
          for (const o of [-34, -24, -14, 14, 24, 34]) {
            const D = b.pointAt(s + o);
            solid.push(beam(lx, H + 32, lz, D.x + -D.dz * b.hw * side, b.heightAt(s + o) + 1.2, D.z + D.dx * b.hw * side, 0.09, 0.09, '#cfd8e3', false));
          }
        }
        solid.push(beam(C.x + cpx * (b.hw + 0.9), H + 33, C.z + cpz * (b.hw + 0.9), C.x - cpx * (b.hw + 0.9), H + 33, C.z - cpz * (b.hw + 0.9), 1.2, 1.6, col));
        blinkGeos.push(cbox(0.6, 0.6, 0.6, C.x, H + 34.6, C.z, '#ffffff'));
      }
    } else if (b.style === 'lift') {
      for (const f of [0.38, 0.62]) {
        const s = b.L * f, C = b.pointAt(s), H = b.heightAt(s);
        for (const side of [1, -1]) {
          const lx = C.x + px * (b.hw + 0.8) * side, lz = C.z + pz * (b.hw + 0.8) * side;
          solid.push(cbox(2.2, H + 26, 2.2, lx, (H + 26) / 2 - 3, lz, col));
          blinkGeos.push(cbox(0.5, 0.5, 0.5, lx, H + 23.3, lz, '#ffffff'));
        }
        solid.push(beam(C.x + px * (b.hw + 0.8), H + 21, C.z + pz * (b.hw + 0.8), C.x - px * (b.hw + 0.8), H + 21, C.z - pz * (b.hw + 0.8), 2, 2.4, col));
        solid.push(cbox(6, 4, 3, C.x, H + 17, C.z, '#3a3f47'));
      }
    } else if (b.style === 'girder') {
      for (let s = b.ramp; s < b.L - b.ramp; s += 12) {
        const A = b.pointAt(s);
        for (const side of [1, -1]) solid.push(cbox(0.8, 1.2, 0.8, A.x + px * (b.hw - 0.4) * side, b.heightAt(s) + 1.7, A.z + pz * (b.hw - 0.4) * side, '#6fc3a3'));
      }
    }
  }

  // ------------------------------------------------ Palm Heights
  const S = W.specials;
  {
    const WALLS = ['#ffd1dc', '#b8f2e6', '#ffe5b4', '#d8c8ff', '#c6f1ff', '#fff1a8', '#ffc9a8', '#f8f8f8', '#e6f7c1', '#ffb3c7'];
    const ROOFS = ['#c0573e', '#2f6f7a', '#4a5568', '#a0522d', '#d9d1c0', '#6b4f8a'];
    const DOORS = ['#2a6f97', '#c81e3a', '#1f2937', '#2aa876', '#f2c230'];
    const rows = [
      { sz: -500, side: 1, canal: null },
      { sz: -500, side: -1, canal: -563 },
      { sz: -660, side: 1, canal: -597 },
      { sz: -660, side: -1, canal: null },
    ];
    let number = 2;
    for (const row of rows) {
      for (let cx = -244; cx <= 318; cx += 26) {
        if (Math.abs(cx + 220) < 17 || Math.abs(cx - 40) < 19 || Math.abs(cx - 300) < 17) continue;
        const side = row.side;
        const frontZ = row.sz + side * 14;
        const corners = [[cx - 12, frontZ - side * 9], [cx + 12, frontZ - side * 9], [cx - 12, frontZ + side * 24], [cx + 12, frontZ + side * 24]];
        if (!corners.every(([x, z]) => landAt(x, z)?.id === 'heights')) continue;
        house(cx, frontZ, side, row.canal);
        if (row.sz === -500 && side === -1 && cx === 94) S.heightsHouse = { x: cx, z: frontZ - side * 4.5, number };
        number += 2;
      }
    }
    function house(cx, frontZ, side, canalZ) {
      const w = 11 + rng() * 4, d = 9 + rng() * 3;
      const floors = rng() < 0.32 ? 2 : 1;
      const H = floors * 3.1;
      const wall = pick(WALLS), trim = '#fbfaf5';
      const zc = frontZ + (side * d) / 2;
      solid.push(cbox(w, H, d, cx, H / 2, zc, wall));
      addCollider(cx - w / 2, Math.min(frontZ, frontZ + side * d), cx + w / 2, Math.max(frontZ, frontZ + side * d), H + 2.5);
      solid.push(cbox(w + 0.2, 0.22, d + 0.2, cx, H, zc, trim));
      const style = rng();
      const roofC = pick(ROOFS);
      if (style < 0.8) {
        const rh = style < 0.55 ? 2.3 : 1.8;
        const g = new THREE.BoxGeometry(w + 0.9, rh, d + 0.9);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setZ(i, 0); if (style >= 0.55) p.setX(i, p.getX(i) * 0.45); }
        g.computeVertexNormals();
        g.translate(cx, H + rh / 2 + 0.1, zc);
        solid.push(colorize(g, roofC));
      } else {
        solid.push(cbox(w + 0.4, 0.4, d + 0.4, cx, H + 0.3, zc, '#f4f4f0'));
        solid.push(cbox(w * 0.45, 2.4, d * 0.5, cx - w * 0.2, H + 1.6, zc, wall));
        windows.push(cbox(w * 0.45 + 0.04, 1.0, 0.08, cx - w * 0.2, H + 1.8, zc - side * (d * 0.25 + 0.03), '#ffffff'));
      }
      const fz = frontZ - side * 0.06;
      const gx = cx + (rng() < 0.5 ? -1 : 1) * (w / 2 - 2.3);
      const dx = cx - (gx - cx) * 0.35;
      solid.push(cbox(3.2, 2.4, 0.12, gx, 1.2, fz, '#f1f1ee'));
      for (let k = 0; k < 4; k++) solid.push(cbox(3.0, 0.05, 0.14, gx, 0.45 + k * 0.55, fz - side * 0.02, '#d6d6d0'));
      solid.push(cbox(1.0, 2.1, 0.12, dx, 1.05, fz, pick(DOORS)));
      for (let f = 0; f < floors; f++) {
        for (const wx of [cx - w / 2 + 1.4, cx + w / 2 - 1.4, cx]) {
          if (f === 0 && (Math.abs(wx - gx) < 2.4 || Math.abs(wx - dx) < 1.2)) continue;
          windows.push(cbox(1.3, 1.1, 0.1, wx, 1.6 + f * 3.1, fz, rng() < 0.55 ? '#ffffff' : '#3a3a48'));
        }
        for (const sx of [-1, 1]) windows.push(cbox(0.1, 1.1, 1.3, cx + sx * (w / 2 + 0.04), 1.6 + f * 3.1, zc, rng() < 0.5 ? '#ffffff' : '#3a3a48'));
      }
      solid.push(cbox(3.4, 0.05, 9, gx, 0.03, frontZ - side * 4.5, '#d6d1c4'));
      solid.push(cbox(1.1, 0.05, 9, dx, 0.03, frontZ - side * 4.5, '#e6e1d4'));
      for (const sx of [-1, 1]) solid.push(cbox(0.7, 1.0, d + 8, cx + sx * 12.4, 0.5, zc + side * 3, '#3f7f3f'));
      solid.push(cbox(0.3, 1.1, 0.3, dx + 1.6, 0.55, frontZ - side * 8.3, '#333333'));
      if (rng() < 0.45) {
        const pz = frontZ + side * (d + 6);
        solid.push(cbox(8, 0.04, 5.6, cx, 0.03, pz, '#efe9dc'));
        glow.push(cbox(6, 0.06, 3.6, cx, 0.06, pz, '#3fc7e3'));
      }
      if (rng() < 0.6) palms.push([cx + (rng() < 0.5 ? -8 : 8), 0, frontZ - side * 6, rng()]);
      if (rng() < 0.28) W.regionParked.push({ type: pick(['sedan', 'suv', 'sports', 'van', 'sedan']), x: gx, z: frontZ - side * 4.6, h: side > 0 ? 0 : Math.PI });
      if (canalZ !== null) {
        const dz = canalZ - side * 2.5;
        solid.push(cbox(3.2, 0.25, 5, cx + 4, 0.1, dz, '#8b6a47'));
        if (rng() < 0.6) {
          const bz = canalZ + side * 3.2;
          solid.push(cbox(2.4, 0.9, 6, cx + 4, -0.3, bz, '#f5f5f5'), cbox(2.0, 0.7, 2.2, cx + 4, 0.45, bz + 0.6, '#1e3a8a'));
        }
      }
    }
    // welcome monument and street lamps
    solid.push(cbox(10, 1.6, 1.2, 58, 0.8, -486, '#f6efe3'));
    sign('PALM HEIGHTS', PALETTE.neonPink, 58, 2.6, -485.3, 0, 9);
    palms.push([50, 0, -490, 0.3], [66, 0, -490, 0.7]);
    W.pedRings.push({ x0: -214, x1: 294, z0: -507.5, z1: -492.5 }, { x0: -214, x1: 294, z0: -667.5, z1: -652.5 });
    W.regionTokens.push([-212, -580]);
  }

  // ------------------------------------------------ Harbor District
  {
    const CONT = ['#b5452f', '#2a5ea8', '#2f8a4a', '#e07b28', '#1f8a8a', '#e8e4dc', '#7a2f5b', '#c9a227'];
    const yards = [[495, [498, 517, 536]], [570, [574, 593, 612]]];
    for (const [, rowsZ] of yards) {
      for (const z0 of rowsZ) {
        for (let x0 = -176; x0 + 12.2 <= 42; x0 += 14.5) {
          const tiers = 1 + Math.floor(rng() * 4);
          for (let r = 0; r < 4; r++) {
            const zc = z0 + r * 2.55 + 1.25;
            const t = r === 0 || r === 3 ? Math.max(1, tiers - 1) : tiers;
            for (let k = 0; k < t; k++) {
              const c = pick(CONT);
              solid.push(cbox(12.2, 2.55, 2.45, x0 + 6.1, k * 2.6 + 1.3, zc, c));
              solid.push(cbox(12.25, 0.12, 2.5, x0 + 6.1, k * 2.6 + 2.5, zc, '#3a3a3a'));
            }
          }
          addCollider(x0, z0, x0 + 12.2, z0 + 10.2, tiers * 2.6);
        }
      }
    }
    // gantry cranes along the quay
    for (const cx of [-160, -82, -4]) {
      for (const lx of [-8, 8]) for (const lz of [630, 646]) {
        solid.push(cbox(1.2, 32, 1.2, cx + lx, 16, lz, '#d94f2a'));
        addCollider(cx + lx - 0.6, lz - 0.6, cx + lx + 0.6, lz + 0.6, 32);
      }
      solid.push(cbox(18, 2.2, 1.6, cx, 31, 630, '#d94f2a'), cbox(18, 2.2, 1.6, cx, 31, 646, '#d94f2a'));
      solid.push(cbox(3, 2.6, 64, cx, 34, 664, '#e8e4dc'));
      solid.push(cbox(4, 3.5, 5, cx, 31, 640, '#2a2d33'));
      blinkGeos.push(cbox(0.7, 0.7, 0.7, cx, 35.8, 695, '#ffffff'));
    }
    // warehouses
    const WH = [[75, 160, '#9aa4ad'], [168, 253, '#7d8a94'], [261, 345, '#b9a37a']];
    for (const [x0, x1, c] of WH) {
      const cx = (x0 + x1) / 2, w = x1 - x0;
      solid.push(cbox(w, 11, 52, cx, 5.5, 520, c));
      for (let x = x0 + 2; x < x1; x += 3) solid.push(cbox(0.4, 10.6, 52.2, x, 5.3, 520, '#6b747c'));
      const g = new THREE.BoxGeometry(w + 1, 3, 53);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, 0);
      g.computeVertexNormals();
      g.translate(cx, 12.5, 520);
      solid.push(colorize(g, '#5d6670'));
      for (let k = 0; k < 3; k++) solid.push(cbox(6, 5.5, 0.2, x0 + 14 + k * ((w - 28) / 2), 2.75, 546.1, '#d6d6d0'));
      addCollider(x0, 494, x1, 546, 12);
    }
    sign('PORT OF SOLANO', PALETTE.neonCyan, 117, 8, 493.8, Math.PI, 12);
    // fuel tanks and the port office
    for (const [x, z] of [[290, 598], [326, 621], [290, 632]]) {
      solid.push(colorize(new THREE.CylinderGeometry(8.5, 8.5, 14, 20).translate(x, 7, z), '#eef0f2'));
      solid.push(colorize(new THREE.CylinderGeometry(8.6, 8.6, 1.2, 20).translate(x, 9, z), '#d94f2a'));
      addCollider(x - 8.5, z - 8.5, x + 8.5, z + 8.5, 14);
    }
    solid.push(cbox(18, 8, 10, 95, 4, 612, '#e8e2d0'));
    windows.push(cbox(16, 1.2, 0.1, 95, 5.5, 606.95, '#ffffff'));
    addCollider(86, 607, 104, 617, 8);
    // the moored freighter "Coral Tide"
    {
      const hull = new THREE.BoxGeometry(24, 11, 116);
      const p = hull.attributes.position;
      for (let i = 0; i < p.count; i++) { if (p.getZ(i) > 0) p.setX(i, p.getX(i) * 0.35); if (p.getY(i) < 0) p.setX(i, p.getX(i) * 0.85); }
      hull.computeVertexNormals();
      hull.translate(185, -0.5, 660);
      solid.push(colorize(hull, '#1f3a5f'));
      solid.push(cbox(24.2, 1.2, 100, 185, -3.2, 652, '#b03a2e'));
      solid.push(cbox(20, 12, 14, 185, 10, 611, '#f2f2f2'));
      windows.push(cbox(18, 1.4, 0.1, 185, 13.5, 618.05, '#ffffff'));
      solid.push(cbox(4, 8, 4, 185, 19, 606, '#b03a2e'));
      for (let k = 0; k < 14; k++) {
        const z = 626 + k * 6.6;
        for (let t = 0; t < 2 + (k % 3); t++) for (const x of [-8, -2.6, 2.6, 8]) {
          if (z > 700 && Math.abs(x) > 4) continue;
          solid.push(cbox(5, 2.55, 6.2, 185 + x, 6.3 + t * 2.6, z, CONT[(k + t + Math.round(x)) & 7]));
        }
      }
      sign('CORAL TIDE', PALETTE.neonCyan, 185, 13, 603.9, Math.PI, 9);
    }
    // floodlights
    for (const [x, z] of [[-201, 520], [-60, 569], [69, 520], [200, 569], [330, 569], [-120, 626], [44, 628]]) lamps.push({ x, z, y: 0, rot: 0, tall: true });
    W.regionTokens.push([-122, 642]);
    W.pedRings.push({ x0: -180, x1: 46, z0: 490, z1: 552 }, { x0: 70, x1: 350, z0: 489, z1: 552 });
    S.harborYard = { x: -150, z: 566 };
    S.crate = { x: -70, z: 588.5 };
  }

  // ------------------------------------------------ Lantern Key
  {
    const cx = 690, cz = -150;
    const f = W.facades[2];
    const towerGeos = [W.facadeGeometry(32, 34, 22, cx, cz, '#ffd1dc', f), W.facadeGeometry(20, 10, 14, cx, cz, '#ffe1e8', f, 34)];
    const tower = new THREE.Mesh(mergeGeometries(towerGeos), W.buildingMats[2]);
    tower.castShadow = tower.receiveShadow = true;
    scene.add(tower);
    addCollider(cx - 16, cz - 11, cx + 16, cz + 11, 44);
    for (let k = 1; k < 10; k++) solid.push(cbox(32.6, 0.25, 22.6, cx, k * 3.4, cz, '#ffffff'));
    neonPink.push(cbox(32.5, 0.5, 22.5, cx, 33.7, cz, '#ffffff'), cbox(20.5, 0.5, 14.5, cx, 43.7, cz, '#ffffff'));
    sign('LANTERN KEY RESORT', PALETTE.neonPink, cx - 16.15, 14, cz, -Math.PI / 2, 14);
    solid.push(cbox(16, 0.06, 8, cx, 0.03, cz + 22, '#efe9dc'));
    glow.push(cbox(13, 0.08, 5.5, cx, 0.06, cz + 22, '#3fc7e3'));
    for (const [x, z] of [[cx - 10, cz + 28], [cx, cz + 29], [cx + 10, cz + 28]]) {
      solid.push(colorize(new THREE.ConeGeometry(1.6, 0.7, 10).translate(x, 2.4, z), pick(['#ff5ea8', '#2ad4e0', '#f9d649'])));
      solid.push(colorize(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5).translate(x, 1.2, z), '#eeeeee'));
    }
    // lighthouse
    const lx = 787, lz = -150;
    const tg = new THREE.CylinderGeometry(2.8, 4.5, 26, 12, 13);
    const cols = [];
    const p = tg.attributes.position;
    const red = new THREE.Color('#c81e3a'), white = new THREE.Color('#f5f5f5');
    for (let i = 0; i < p.count; i++) { const c = Math.floor((p.getY(i) + 13) / 4.4) % 2 ? red : white; cols.push(c.r, c.g, c.b); }
    tg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    tg.translate(lx, 13, lz);
    solid.push(tg);
    solid.push(colorize(new THREE.CylinderGeometry(3.8, 3.8, 0.5, 14).translate(lx, 26.2, lz), '#2a2d33'));
    glow.push(colorize(new THREE.CylinderGeometry(2.2, 2.2, 3, 12).translate(lx, 28, lz), '#fff2c4'));
    solid.push(colorize(new THREE.ConeGeometry(2.6, 2.2, 12).translate(lx, 30.6, lz), '#c81e3a'));
    addCollider(lx - 4.6, lz - 4.6, lx + 4.6, lz + 4.6, 30);
    solid.push(cbox(8, 4, 6, lx - 12, 2, lz + 18, '#f6efe3'));
    solid.push(colorize((() => { const g = new THREE.BoxGeometry(8.8, 2, 6.8); const q = g.attributes.position; for (let i = 0; i < q.count; i++) if (q.getY(i) > 0) q.setZ(i, 0); g.computeVertexNormals(); return g; })().translate(lx - 12, 5, lz + 18), '#c81e3a'));
    addCollider(lx - 16, lz + 15, lx - 8, lz + 21, 5);
    // rotating beam, visible at night
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff3c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const beamGeo = new THREE.ConeGeometry(9, 140, 20, 1, true).translate(0, -70, 0).rotateZ(Math.PI / 2);
    const rotor = new THREE.Group();
    rotor.position.set(lx, 28, lz);
    const b1 = new THREE.Mesh(beamGeo, beamMat), b2 = new THREE.Mesh(beamGeo, beamMat);
    b2.rotation.y = Math.PI;
    rotor.add(b1, b2);
    scene.add(rotor);
    W.regionUpdate.push((dt, env) => { rotor.rotation.y += dt * 0.6; beamMat.opacity = env.night * 0.16; });
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const r = 82 + (k % 3) * 6;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.abs(z - cz) < 12 && x < cx) continue;
      if (Math.hypot(x - lx, z - lz) < 14) continue;
      palms.push([x, 0, z, rng()]);
    }
    for (const [x, z] of [[650, -168], [650, -132]]) W.regionParked.push({ type: pick(['sports', 'suv', 'sedan']), x, z, h: Math.PI / 2 });
    W.pedRings.push({ x0: cx - 22, x1: cx + 22, z0: cz - 17, z1: cz + 34 }, { x0: cx - 50, x1: cx + 48, z0: cz - 50, z1: cz + 50 });
    W.regionTokens.push([lx - 6, lz - 10]);
    S.lighthouse = { x: 771, z: -150 };
    S.resort = { x: cx - 24, z: cz };
  }

  // ------------------------------------------------ Sundown Bluffs props
  {
    const T = terrain;
    const pine = mergeGeometries([
      colorize(new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6).translate(0, 1.1, 0), '#6b4a33'),
      colorize(new THREE.ConeGeometry(1.8, 4.2, 8).translate(0, 3.6, 0), '#2f6b3a'),
      colorize(new THREE.ConeGeometry(1.3, 3.2, 8).translate(0, 5.4, 0), '#3a7a44'),
    ]);
    const bush = colorize(new THREE.IcosahedronGeometry(1.1, 0), '#4f8a3f');
    const rock = colorize(new THREE.DodecahedronGeometry(1, 0), '#8f8578');
    const trees = [], bushes = [], rocks = [];
    for (let k = 0; k < 2600 && trees.length < 340; k++) {
      const x = -830 + rng() * 450, z = -330 + rng() * 660;
      const h = T.height(x, z);
      if (h < 1.5 || T.slope(x, z) > 0.55 || T.nearRoad(x, z, 6)) continue;
      if (T.pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 6)) continue;
      const r = rng();
      if (r < 0.6) trees.push([x, h, z, 0.8 + rng() * 0.7]);
      else if (r < 0.92) bushes.push([x, h + 0.3, z, 0.6 + rng() * 0.8]);
      else {
        const s = 1 + rng() * 2.2;
        rocks.push([x, h + s * 0.3, z, s]);
        if (s > 1.8) addCollider(x - s * 0.8, z - s * 0.8, x + s * 0.8, z + s * 0.8, s * 1.3, h);
      }
    }
    const inst = (geo, list, mat) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      list.forEach(([x, y, z, sc], i) => { q.setFromAxisAngle(up, (x * 13.7 + z) % 6.28); m4.compose(v.set(x, y, z), q, s.set(sc, sc, sc)); m.setMatrixAt(i, m4); });
      m.castShadow = true;
      scene.add(m);
    };
    inst(pine, trees, MAT.vc);
    inst(bush, bushes, MAT.vc);
    inst(rock, rocks, MAT.vc);
    // observatory on its pad
    const op = T.pads[0];
    solid.push(colorize(new THREE.CylinderGeometry(9, 9.5, 6, 24).translate(op.x, op.h + 3, op.z), '#eef0f2'));
    solid.push(colorize(new THREE.SphereGeometry(8.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(op.x, op.h + 6, op.z), '#c9ced6'));
    solid.push(cbox(1.6, 7, 0.3, op.x, op.h + 9.4, op.z + 8.2, '#1c2230'));
    solid.push(cbox(10, 4, 8, op.x + 12, op.h + 2, op.z, '#e6e1d4'));
    addCollider(op.x - 9.5, op.z - 9.5, op.x + 17, op.z + 9.5, 14, op.h);
    sign('SUNDOWN OBSERVATORY', PALETTE.neonOrange, op.x, op.h + 4.5, op.z + 9.6, 0, 11);
    // lookout at the summit: railings, coin telescopes, neon sign
    const lp = T.pads[1];
    for (let a = -1.2; a <= 1.2; a += 0.3) {
      const x = lp.x - Math.cos(a) * 13, z = lp.z + Math.sin(a) * 13;
      solid.push(cbox(0.15, 1.1, 0.15, x, lp.h + 0.55, z, '#e8e8e8'));
    }
    solid.push(beam(lp.x - 13 * Math.cos(-1.2), lp.h + 1.1, lp.z + 13 * Math.sin(-1.2), lp.x - 13, lp.h + 1.1, lp.z, 0.12, 0.12, '#e8e8e8'));
    solid.push(beam(lp.x - 13, lp.h + 1.1, lp.z, lp.x - 13 * Math.cos(1.2), lp.h + 1.1, lp.z + 13 * Math.sin(1.2), 0.12, 0.12, '#e8e8e8'));
    for (const o of [-4, 4]) solid.push(cbox(0.3, 1.2, 0.3, lp.x - 11, lp.h + 0.6, lp.z + o, '#3a3f47'), cbox(0.4, 0.4, 1, lp.x - 11, lp.h + 1.4, lp.z + o, '#c9a227'));
    sign('SUNDOWN LOOKOUT', PALETTE.neonOrange, lp.x + 6, lp.h + 3.2, lp.z - 10, Math.PI, 8);
    solid.push(cbox(0.3, 3, 0.3, lp.x + 2, lp.h + 1.5, lp.z - 10.2, '#2a2d33'), cbox(0.3, 3, 0.3, lp.x + 10, lp.h + 1.5, lp.z - 10.2, '#2a2d33'));
    W.regionParked.push({ type: 'suv', x: lp.x + 4, z: lp.z + 5, h: 0 });
    // radio mast with a blinking light
    const mp = T.pads[2];
    solid.push(beam(mp.x, mp.h + 42, mp.z, mp.x, mp.h, mp.z, 0.8, 0.8, '#d0d4da', false));
    for (let y = 4; y < 42; y += 8) solid.push(cbox(2.2, 0.15, 0.15, mp.x, mp.h + y, mp.z, '#c81e3a'));
    blinkGeos.push(cbox(0.8, 0.8, 0.8, mp.x, mp.h + 42.6, mp.z, '#ffffff'));
    addCollider(mp.x - 1, mp.z - 1, mp.x + 1, mp.z + 1, 42, mp.h);
    W.regionTokens.push([lp.x - 6, lp.z + 8]);
    W.pedRings.push({ x0: op.x - 13, x1: op.x + 22, z0: op.z - 13, z1: op.z + 14 });
    S.summit = { x: lp.x, z: lp.z };
    S.observatory = { x: op.x, z: op.z + 14 };
    S.bluffStart = { x: -452, z: -40 };
  }

  // ------------------------------------------------ road signs pointing at the new regions
  {
    const signs = [
      [50.8, -263, 0, [{ text: 'PALM HEIGHTS', arrow: 'up' }, { text: 'Coral Channel Bridge', small: true }]],
      [-263, -50.8, Math.PI / 2, [{ text: 'SUNDOWN BLUFFS', arrow: 'up' }, { text: 'Sunset Span', small: true }]],
      [-130.8, 263, Math.PI, [{ text: 'HARBOR DISTRICT', arrow: 'up' }, { text: 'Harbor Bridge', small: true }]],
      [263, -109.5, -Math.PI / 2, [{ text: 'LANTERN KEY', arrow: 'up' }, { text: 'Long Causeway', small: true }]],
      [50.8, 58, 0, [{ text: 'PALM HEIGHTS', arrow: 'up' }, { text: 'LANTERN KEY', arrow: 'right' }, { text: 'SUNDOWN BLUFFS', arrow: 'left' }]],
      [-50.8, -58, Math.PI, [{ text: 'HARBOR DISTRICT', arrow: 'up' }, { text: 'SUNDOWN BLUFFS', arrow: 'right' }, { text: 'LANTERN KEY', arrow: 'left' }]],
    ];
    for (const [x, z, rot, rows] of signs) {
      const t = roadSignTexture(rows);
      const w = 5.2, h = w / t.userData.aspect;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: '#7a8088' }));
      const y = 3.3 + h / 2;
      panel.position.set(x, y, z);
      panel.rotation.y = rot;
      back.position.set(x - Math.sin(rot) * 0.03, y, z - Math.cos(rot) * 0.03);
      back.rotation.y = rot + Math.PI;
      scene.add(panel, back);
      const ox = Math.cos(rot) * (w / 2 - 0.4), oz = -Math.sin(rot) * (w / 2 - 0.4);
      solid.push(cbox(0.16, y + h / 2, 0.16, x + ox - Math.sin(rot) * 0.1, (y + h / 2) / 2, z + oz - Math.cos(rot) * 0.1, '#6b7079'));
      solid.push(cbox(0.16, y + h / 2, 0.16, x - ox - Math.sin(rot) * 0.1, (y + h / 2) / 2, z - oz - Math.cos(rot) * 0.1, '#6b7079'));
    }
  }

  // ------------------------------------------------ street lamps along coast roads
  for (const e of coastEdges) {
    const dx = (e.bx - e.ax) / e.len, dz = (e.bz - e.az) / e.len, px = -dz, pz = dx;
    let side = 1;
    for (let s = 14; s < e.len - 10; s += 34) {
      const x = e.ax + dx * s, z = e.az + dz * s;
      if (bridgeH(x, z) !== null) continue;
      const o = e.w / 2 + 1.1;
      const lx = x + px * o * side, lz = z + pz * o * side;
      if (!solidLand(lx, lz) || W.colliders.pointBlocked(lx, lz, 0.5)) { side = -side; continue; }
      lamps.push({ x: lx, z: lz, y: W.groundY(lx, lz), rot: Math.atan2(-px * side, -pz * side) });
      side = -side;
    }
  }
  {
    const L = W.lampGeo;
    const n = lamps.length;
    const poles = new THREE.InstancedMesh(L.poleGeo, MAT.vc, n);
    const heads = new THREE.InstancedMesh(L.headGeo, W.lampHeadMat, n);
    const pools = new THREE.InstancedMesh(L.poolGeo, W.lampPoolMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    lamps.forEach((l, i) => {
      q.setFromAxisAngle(up, l.rot);
      const k = l.tall ? 2.6 : 1;
      m4.compose(v.set(l.x, l.y, l.z), q, s.set(k, k, k));
      poles.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
      m4.compose(v.set(l.x, l.y + 0.02, l.z), q, s.set(k, 1, k));
      pools.setMatrixAt(i, m4);
    });
    poles.castShadow = true;
    pools.renderOrder = 1;
    scene.add(poles, heads, pools);
  }

  // ------------------------------------------------ palms, merged meshes, blinking lights
  {
    const pg = W.palmGeo;
    const tr = new THREE.InstancedMesh(pg.trunk, MAT.vc, palms.length), cr = new THREE.InstancedMesh(pg.crown, W.leafMat, palms.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    palms.forEach(([x, y, z, r], i) => { q.setFromAxisAngle(up, r * 6.28); const k = 0.8 + r * 0.6; m4.compose(v.set(x, y, z), q, s.set(k, k, k)); tr.setMatrixAt(i, m4); cr.setMatrixAt(i, m4); });
    tr.castShadow = cr.castShadow = true;
    scene.add(tr, cr);
  }
  add(solid, MAT.vc);
  add(windows, winMat, { cast: false });
  add(glow, glowMat, { cast: false });
  const neon = (geos, hex) => {
    if (!geos.length) return;
    const mat = new THREE.MeshBasicMaterial({ color: hex });
    mat.userData.base = new THREE.Color(hex);
    W.neonMats.push(mat);
    add(geos, mat, { cast: false, receive: false });
  };
  neon(neonPink, PALETTE.neonPink); neon(neonCyan, PALETTE.neonCyan); neon(neonGold, PALETTE.neonGold); neon(neonOrange, PALETTE.neonOrange);
  add(blinkGeos, blinkMat, { cast: false, receive: false });
  let blinkT = 0;
  W.regionUpdate.push((dt) => { blinkT += dt; blinkMat.color.set(Math.floor(blinkT * 1.3) % 2 ? '#ff2020' : '#3a0808'); });

  // ------------------------------------------------ shoreline mask for the ocean shader
  W.oceanMask = buildOceanMask((x, z) => solidLand(x, z) || (x >= PIER.minX && x <= PIER.maxX && Math.abs(z) < 6));
  void LAND; void ROADS;
}

// Distance-to-land field (2 m cells) packed into a texture: 1 on land, fading to 0
// about 55 m offshore. The ocean shader uses it for shallows and surf.
function buildOceanMask(isLand) {
  const res = 2, B = WORLD;
  const nx = Math.ceil((B.maxX - B.minX) / res), nz = Math.ceil((B.maxZ - B.minZ) / res);
  const d = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = B.minZ + (j + 0.5) * res;
    for (let i = 0; i < nx; i++) d[j * nx + i] = isLand(B.minX + (i + 0.5) * res, z) ? 0 : 1e6;
  }
  const D = Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let v = d[k];
    if (v === 0) continue;
    if (i > 0) v = Math.min(v, d[k - 1] + 1);
    if (j > 0) {
      v = Math.min(v, d[k - nx] + 1);
      if (i > 0) v = Math.min(v, d[k - nx - 1] + D);
      if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + D);
    }
    d[k] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    let v = d[k];
    if (v === 0) continue;
    if (i < nx - 1) v = Math.min(v, d[k + 1] + 1);
    if (j < nz - 1) {
      v = Math.min(v, d[k + nx] + 1);
      if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + D);
      if (i > 0) v = Math.min(v, d[k + nx - 1] + D);
    }
    d[k] = v;
  }
  const data = new Uint8Array(nx * nz);
  for (let k = 0; k < data.length; k++) data[k] = Math.round(255 * (1 - smoothstep(0, 28, d[k])));
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
  tex.unpackAlignment = 1;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, bounds: [B.minX, B.minZ, B.minX + nx * res, B.minZ + nz * res] };
}
