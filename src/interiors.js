import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { ColliderGrid } from './world.js';
import { cbox, colorize, rand, pick } from './util.js';
import { MAT } from './models.js';
import { INTERIOR_Y, PALETTE } from './config.js';
import { signTexture } from './textures.js';
import { Npc } from './npc.js';

const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
const GLASS = new THREE.MeshStandardMaterial({ color: '#cdeeff', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.3, depthWrite: false });

function marbleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    g.fillStyle = (x + y) % 2 ? '#1f3d36' : '#efe7d6';
    g.fillRect(x * 128, y * 128, 128, 128);
  }
  g.strokeStyle = 'rgba(160,140,100,0.35)';
  for (let i = 0; i < 22; i++) {
    g.beginPath();
    let x = Math.random() * 256, y = Math.random() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += rand(-40, 40); y += rand(-40, 40); g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = '#c9a227';
  g.fillRect(0, 126, 256, 4); g.fillRect(126, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ builder
class Builder {
  constructor(I) { this.I = I; this.groups = new Map(); this.colliders = []; this.meshes = []; }
  add(geo, mat) {
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(geo);
  }
  geo(x0, z0, x1, z1, y0, y1, color) {
    const I = this.I;
    return cbox(x1 - x0, y1 - y0, z1 - z0, I.ox + (x0 + x1) / 2, I.oy + (y0 + y1) / 2, I.oz + (z0 + z1) / 2, color);
  }
  collider(x0, z0, x1, z1, y0, y1) {
    const I = this.I;
    const c = { minX: I.ox + x0, maxX: I.ox + x1, minZ: I.oz + z0, maxZ: I.oz + z1, y0: I.oy + y0, y1: I.oy + y1 };
    this.colliders.push(c);
    return c;
  }
  box(x0, z0, x1, z1, y0, y1, color) { this.add(this.geo(x0, z0, x1, z1, y0, y1, color), MAT.vc); return this.collider(x0, z0, x1, z1, y0, y1); }
  deco(x0, z0, x1, z1, y0, y1, color) { this.add(this.geo(x0, z0, x1, z1, y0, y1, color), MAT.vc); }
  glow(x0, z0, x1, z1, y0, y1, color, mat = GLOW) { this.add(this.geo(x0, z0, x1, z1, y0, y1, color), mat); }
  glass(x0, z0, x1, z1, y0, y1) { this.add(this.geo(x0, z0, x1, z1, y0, y1, '#ffffff'), GLASS); }
  // a separately animated mesh, positioned in local coordinates
  mesh(geo, mat, lx, ly, lz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(this.I.ox + lx, this.I.oy + ly, this.I.oz + lz);
    this.meshes.push(m);
    return m;
  }
  sign(text, color, lx, ly, lz, rotY, width) {
    const m = this.mesh(new THREE.PlaneGeometry(width, width / 4), new THREE.MeshBasicMaterial({ map: signTexture(text, color), transparent: true }), lx, ly, lz);
    m.rotation.y = rotY;
    return m;
  }
  // floor, ceiling and four walls with a doorway in the +z wall
  shell(w, d, h, { wall, floor, ceil, trim, floorMat }) {
    const hw = w / 2, hd = d / 2, t = 0.4;
    if (floorMat) this.mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), floorMat, 0, 0.005, 0).receiveShadow = true;
    else this.deco(-hw, -hd, hw, hd, -0.2, 0, floor);
    this.deco(-hw, -hd, hw, hd, h, h + 0.2, ceil);
    this.box(-hw - t, -hd - t, hw + t, -hd, 0, h, wall);
    this.box(-hw - t, -hd, -hw, hd + t, 0, h, wall);
    this.box(hw, -hd, hw + t, hd + t, 0, h, wall);
    this.box(-hw, hd, -1.3, hd + t, 0, h, wall);
    this.box(1.3, hd, hw, hd + t, 0, h, wall);
    this.deco(-1.3, hd, 1.3, hd + t, 2.8, h, wall);
    this.box(-1.3, hd + t, 1.3, hd + t + 0.12, 0, 2.8, '#0c0a12');
    this.glow(-1.1, hd + t - 0.02, 1.1, hd + t, 2.95, 3.1, '#ff4d5e');
    if (trim) {
      this.deco(-hw, -hd, hw, -hd + 0.05, 0, 0.18, trim);
      this.deco(-hw, -hd, -hw + 0.05, hd, 0, 0.18, trim);
      this.deco(hw - 0.05, -hd, hw, hd, 0, 0.18, trim);
    }
  }
  finalize() {
    const group = new THREE.Group();
    for (const [mat, geos] of this.groups) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.receiveShadow = mat === MAT.vc;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
    for (const m of this.meshes) group.add(m);
    return group;
  }
}

// ------------------------------------------------------------------ space
export class Interior {
  constructor(G, def, door) {
    this.G = G;
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.w = def.w; this.d = def.d; this.h = def.h;
    this.door = door;
    const ox = Math.sin(door.h), oz = Math.cos(door.h);
    this.ox = door.x - ox * (def.d / 2 + 5);
    this.oz = door.z - oz * (def.d / 2 + 5);
    this.oy = INTERIOR_Y;
    this.floorY = this.oy;
    this.ceilY = this.oy + def.h;
    this.colliders = new ColliderGrid(6);
    this.targets = [];
    this.interactables = [];
    this.parts = {};
    this.alarm = false;
    this.lockdown = false;
    this.t = 0;
    const B = new Builder(this);
    def.build(B, this, G);
    this.group = B.finalize();
    this.group.visible = false;
    G.root.add(this.group);
    for (const c of B.colliders) this.colliders.add(c);
    this.entry = { x: this.wx(0), z: this.wz(def.d / 2 - 2.4), h: Math.PI };
    this.exitPoint = { x: this.wx(0), z: this.wz(def.d / 2 - 0.4) };
    this.interactables.push({ x: this.exitPoint.x, z: this.exitPoint.z, r: 1.5, label: () => `Leave ${this.name}`, onPress: (g) => g.interiors.exit() });
    this.lights = (def.lights || []).map(([x, y, z, color, intensity, dist]) => ({ x: this.wx(x), y: this.oy + y, z: this.wz(z), color, intensity, dist }));
    this.ambient = def.ambient || { color: '#fff4e6', intensity: 0.9 };
    if (def.nav) {
      this.nav = {
        nodes: def.nav.nodes.map(([x, z]) => ({ x: this.wx(x), z: this.wz(z) })),
        edges: def.nav.edges,
      };
    }
  }
  wx(lx) { return this.ox + lx; }
  wz(lz) { return this.oz + lz; }
  groundY() { return this.floorY; }
  isLand(x, z) {
    return x > this.ox - this.w / 2 + 0.1 && x < this.ox + this.w / 2 - 0.1 && z > this.oz - this.d / 2 + 0.1 && z < this.oz + this.d / 2 + 0.35;
  }
  onRoad() { return false; }
  blockAt() { return null; }
  // local point → world point helper for interactables
  at(lx, lz, r, label, onPress, extra = {}) {
    const it = { x: this.wx(lx), z: this.wz(lz), r, label, onPress, ...extra };
    this.interactables.push(it);
    return it;
  }
  findPath(ax, az, bx, bz) {
    const N = this.nav.nodes;
    const vis = (x, z, n) => !this.colliders.lineBlocked(x, z, n.x, n.z, 1, 1.0);
    const nearest = (x, z) => {
      let best = -1, bd = Infinity;
      N.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z); if (d < bd && vis(x, z, n)) { bd = d; best = i; } });
      return best;
    };
    const s = nearest(ax, az), g = nearest(bx, bz);
    if (s < 0 || g < 0) return null;
    const adj = N.map(() => []);
    for (const [a, b, cond] of this.nav.edges) {
      if (cond && !cond(this)) continue;
      adj[a].push(b); adj[b].push(a);
    }
    const prev = new Array(N.length).fill(-2);
    prev[s] = -1;
    const q = [s];
    while (q.length) {
      const c = q.shift();
      if (c === g) break;
      for (const n of adj[c]) if (prev[n] === -2) { prev[n] = c; q.push(n); }
    }
    if (prev[g] === -2) return null;
    const path = [];
    for (let c = g; c !== -1; c = prev[c]) path.unshift(N[c]);
    return path;
  }
  npcs() { return this.G.npcs.filter((n) => n.space === this); }
  populate() { this.def.populate?.(this, this.G); }
  clearNpcs() { for (const n of this.npcs()) n.remove(); }
  update(dt) {
    this.t += dt;
    this.def.update?.(this, this.G, dt);
  }
}

// ------------------------------------------------------------------ layouts
const civ = (I, G, x, z, h, wps) => new Npc(G, I, 'civ', I.wx(x), I.wz(z), h, { waypoints: wps });

const BANK = {
  id: 'bank', name: 'Solano Bank', w: 40, d: 34, h: 7,
  lights: [[-5, 5.8, 9, '#ffe2b0', 60, 34], [3, 5.5, -6, '#fff1d6', 45, 30]],
  ambient: { color: '#fff1dc', intensity: 0.85 },
  nav: {
    nodes: [[0, 12], [11, 7], [11, 4.6], [11, 1.2], [0, -1], [0, -4.6], [0, -10], [-10, 11], [-15, 11], [-8, 8], [5, -1], [-8, -1]],
    edges: [[0, 1], [0, 9], [1, 2], [2, 3, (I) => I.parts.gateBox.disabled], [3, 10], [10, 4], [4, 11], [4, 5], [5, 6, (I) => I.parts.vaultBox.disabled], [9, 7], [7, 8], [0, 7]],
  },
  build(B, I) {
    const wall = '#e9e1cf';
    const marble = marbleTexture();
    marble.repeat.set(16, 13.6);
    B.shell(40, 34, 7, { wall, ceil: '#f4efe4', trim: '#1f3d36', floorMat: new THREE.MeshStandardMaterial({ map: marble, roughness: 0.25, metalness: 0.1 }) });
    // columns
    for (const [x, z] of [[-10, 8], [10, 8], [-10, 13], [10, 13]]) {
      B.box(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0, 7, '#efe7d6');
      B.deco(x - 0.75, z - 0.75, x + 0.75, z + 0.75, 0, 0.5, '#c9a227');
      B.deco(x - 0.75, z - 0.75, x + 0.75, z + 0.75, 6.4, 7, '#c9a227');
    }
    // teller line: counter, glass, staff gate, walls either side
    B.box(-18, 2.5, 9, 3.5, 0, 1.15, '#5b3a29');
    B.deco(-18.1, 2.4, 9.1, 3.6, 1.15, 1.25, '#efe6d2');
    B.glass(-18, 2.95, 9, 3.05, 1.25, 2.7);
    for (let x = -18; x <= 9; x += 3) B.deco(x - 0.05, 2.9, x + 0.05, 3.1, 1.25, 2.7, '#c9a227');
    B.box(13, 2.5, 20, 3.5, 0, 7, wall);
    B.box(-20, 2.5, -18, 3.5, 0, 7, wall);
    B.deco(-18, 2.5, 13, 3.5, 4.6, 7, wall);
    B.sign('SOLANO BANK', PALETTE.neonGold, -4.5, 5.6, 3.55, 0, 7);
    const gateGeo = mergeGeometries([...Array(9)].map((_, k) => cbox(0.08, 2.5, 0.08, -1.8 + k * 0.45, 1.25, 0, '#b9a05a')).concat([cbox(4, 0.1, 0.1, 0, 2.45, 0, '#b9a05a'), cbox(4, 0.1, 0.1, 0, 0.3, 0, '#b9a05a')]));
    I.parts.gate = B.mesh(gateGeo, MAT.vc, 11, 0, 3);
    I.parts.gateBox = B.collider(9, 2.6, 13, 3.4, 0, 2.6);
    B.glow(9.2, 3.45, 9.5, 3.55, 1.3, 1.6, '#ff3355');
    // teller desks behind the counter
    for (const x of [-14, -8, -2, 4]) {
      B.box(x - 1.2, 0.4, x + 1.2, 1.4, 0, 0.8, '#5b3a29');
      B.glow(x - 0.35, 0.8, x + 0.35, 0.86, 0.85, 1.3, '#9fe7ff');
    }
    // manager's office (west side of the lobby)
    B.box(-12.2, 5.5, -11.8, 10, 0, 7, wall);
    B.box(-12.2, 12.4, -11.8, 17, 0, 7, wall);
    B.box(-20, 5.3, -11.8, 5.7, 0, 7, wall);
    B.box(-16, 8, -15, 12, 0, 0.8, '#3b2a20');
    B.deco(-16.1, 7.9, -14.9, 12.1, 0.8, 0.86, '#6b4a33');
    B.glow(-15.9, 9.4, -15.8, 10.4, 0.9, 1.4, '#9fe7ff');
    B.box(-20, 7, -19.4, 15, 0, 2.6, '#6b4a33');
    for (let k = 0; k < 4; k++) B.deco(-19.35, 7.2, -19.3, 14.8, 0.5 + k * 0.55, 0.56 + k * 0.55, '#3b2a20');
    B.box(-13.4, 15.4, -12.6, 16.2, 0, 1.2, '#2f8f4e');
    B.deco(-19, 8.5, -16.5, 13.5, 0.01, 0.03, '#7a1f2b');
    // lobby furniture: benches, rope posts, rug, chandeliers
    B.box(-6, 15, -2, 15.8, 0, 0.5, '#3b2a20');
    B.box(2, 15, 6, 15.8, 0, 0.5, '#3b2a20');
    for (const x of [-6, -3, 0, 3, 6]) B.deco(x - 0.07, 5.5, x + 0.07, 5.64, 0, 1, '#c9a227');
    B.deco(-6, 5.53, 6, 5.6, 0.85, 0.92, '#7a1f2b');
    B.deco(-3, 6, 3, 16.5, 0.008, 0.02, '#7a1f2b');
    for (const x of [-6, 0, 6]) {
      B.glow(x - 0.8, 9.2, x + 0.8, 10.8, 6.2, 6.4, '#ffe9b8');
      B.deco(x - 0.04, 9.96, x + 0.04, 10.04, 6.4, 7, '#c9a227');
    }
    // vault wall with a round door
    B.box(-20, -6.4, -2.2, -5.6, 0, 7, '#8a8f98');
    B.box(2.2, -6.4, 20, -5.6, 0, 7, '#8a8f98');
    B.deco(-2.2, -6.4, 2.2, -5.6, 4.6, 7, '#8a8f98');
    B.deco(-2.6, -5.6, -2.2, -5.3, 0, 4.8, '#6b7079');
    B.deco(2.2, -5.6, 2.6, -5.3, 0, 4.8, '#6b7079');
    B.deco(-2.6, -5.6, 2.6, -5.3, 4.6, 4.9, '#6b7079');
    I.parts.vaultBox = B.collider(-2.2, -6.4, 2.2, -5.6, 0, 4.6);
    const dg = [];
    dg.push(colorize(new THREE.CylinderGeometry(2.2, 2.2, 0.7, 36).rotateX(Math.PI / 2), '#a7adb5'));
    dg.push(colorize(new THREE.CylinderGeometry(1.5, 1.5, 0.74, 36).rotateX(Math.PI / 2), '#8e949c'));
    for (let k = 0; k < 6; k++) dg.push(cbox(0.12, 1.9, 0.12, 0, 0, 0.42, '#d4d8de').rotateZ((k / 6) * Math.PI));
    dg.push(colorize(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 12).rotateX(Math.PI / 2).translate(0, 0, 0.5), '#d4d8de'));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      dg.push(colorize(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0), '#6b7079'));
    }
    const door = new THREE.Mesh(mergeGeometries(dg).translate(2.2, 0, 0), MAT.vc);
    const pivot = new THREE.Group();
    pivot.position.set(I.wx(-2.2), I.oy + 2.35, I.wz(-6.0));
    pivot.add(door);
    B.meshes.push(pivot);
    I.parts.vaultDoor = pivot;
    // thermal drill (hidden until placed)
    const drill = new THREE.Mesh(mergeGeometries([
      cbox(0.5, 0.5, 0.7, 0, 0, 0.35, '#e8a317'), cbox(0.3, 0.3, 0.4, 0, 0, 0.85, '#333'),
      colorize(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6).rotateX(Math.PI / 2).translate(0, 0, -0.15), '#bbb'),
      cbox(0.12, 0.8, 0.12, 0, -0.6, 0.4, '#222'),
    ]), MAT.vc);
    drill.position.set(I.wx(0.6), I.oy + 2.5, I.wz(-5.1));
    drill.visible = false;
    B.meshes.push(drill);
    I.parts.drill = drill;
    // vault room
    B.box(-9.4, -17, -9, -6.4, 0, 7, '#7c828c');
    B.box(9, -17, 9.4, -6.4, 0, 7, '#7c828c');
    B.deco(-9, -17, 9, -6.4, 0.002, 0.02, '#4a4f57');
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -9 : 8.75, x1 = side < 0 ? -8.75 : 9;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) {
        B.deco(x0, -16 + c * 1.05, x1, -15.1 + c * 1.05, 0.6 + r * 0.95, 1.45 + r * 0.95, c % 3 === 1 ? '#c7ccd3' : '#b3b9c1');
      }
    }
    for (const x of [-4, 0, 4]) B.glow(x - 0.7, -12.5, x + 0.7, -11.5, 6.6, 6.75, '#e6f4ff');
    // cash trolleys + gold
    const cashGeo = mergeGeometries([...Array(12)].map((_, k) => cbox(0.34, 0.16, 0.22, -0.4 + (k % 3) * 0.4, 1.05 + Math.floor(k / 6) * 0.17, -0.15 + (Math.floor(k / 3) % 2) * 0.3, k % 2 ? '#3f9d5b' : '#4cb36a')));
    I.parts.trolleys = [];
    for (const [x, z] of [[-5, -9.5], [5, -9.5], [-5, -13.5], [5, -13.5]]) {
      B.box(x - 0.7, z - 0.45, x + 0.7, z + 0.45, 0, 0.95, '#c0c6ce');
      for (const [a, b] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) B.deco(x + a - 0.06, z + b - 0.06, x + a + 0.06, z + b + 0.06, 0, 0.15, '#222');
      const cash = B.mesh(cashGeo, MAT.vc, x, 0, z);
      I.parts.trolleys.push({ x: I.wx(x), z: I.wz(z), cash, taken: false });
    }
    B.box(-1.3, -16.3, 1.3, -14.7, 0, 0.25, '#8b6a47');
    const goldGeo = mergeGeometries([...Array(18)].map((_, k) => cbox(0.5, 0.18, 0.24, -0.6 + (k % 3) * 0.6, 0.34 + Math.floor(k / 6) * 0.19, -0.3 + (Math.floor(k / 3) % 2) * 0.6, '#ffcc33')));
    I.parts.gold = B.mesh(goldGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.25 }), 0, 0, -15.5);
    I.parts.goldPos = { x: I.wx(0), z: I.wz(-14.2) };
    // alarm beacons
    I.parts.alarmMat = new THREE.MeshBasicMaterial({ color: '#3a1010' });
    for (const [x, y, z] of [[-19.6, 5.5, 10], [19.6, 5.5, 10], [-19.6, 5.5, -2], [19.6, 5.5, -2], [-8.7, 5.5, -12], [8.7, 5.5, -12], [5, 6.2, 16.5]]) {
      B.add(B.geo(x - 0.25, z - 0.25, x + 0.25, z + 0.25, y - 0.2, y + 0.2, '#ffffff'), I.parts.alarmMat);
    }
    I.parts.managerSpot = { x: -17.5, z: 10 };
  },
  populate(I, G) {
    const lobby = [[-6, 9], [4, 12], [0, 7], [6, 7], [-7, 13], [7, 11], [-2, 14]];
    I.parts.guards = [
      new Npc(G, I, 'guard', I.wx(-4), I.wz(14.8), Math.PI, { keycard: true }),
      new Npc(G, I, 'guard', I.wx(15.5), I.wz(6), -Math.PI / 2),
    ];
    I.parts.tellers = [-14, -8, -2, 4].map((x) => new Npc(G, I, 'teller', I.wx(x), I.wz(2.0), 0));
    I.parts.manager = new Npc(G, I, 'manager', I.wx(-17.5), I.wz(10), Math.PI / 2);
    for (let k = 0; k < 4; k++) { const p = pick(lobby); civ(I, G, p[0], p[1], rand(0, 6), lobby); }
  },
  update(I, G, dt) {
    const on = I.alarm && Math.floor(I.t * 3) % 2 === 0;
    I.parts.alarmMat.color.set(on ? '#ff2a2a' : '#3a1010');
    // staff gate slides open
    const gx = I.parts.gateBox.disabled ? 4 : 0;
    I.parts.gate.position.x += (I.wx(11) + gx - I.parts.gate.position.x) * Math.min(1, dt * 2);
    const vt = I.parts.vaultOpenT ?? 0;
    I.parts.vaultDoor.rotation.y = -1.75 * Math.min(1, vt);
  },
};

const GUNSHOP = {
  id: 'gunshop', name: 'Iron Palm Arms', w: 16, d: 26, h: 4.5,
  lights: [[0, 4, 8, '#ffd9a8', 48, 22], [0, 4, -6, '#d6ecff', 44, 22]],
  ambient: { color: '#ffe8cc', intensity: 1.0 },
  build(B, I) {
    const wall = '#3b3a36';
    B.shell(16, 26, 4.5, { wall, floor: '#55524c', ceil: '#2a2926', trim: '#1a1918' });
    // shop front
    B.box(-8, 1.6, 3.5, 2.0, 0, 4.5, wall);
    B.box(6.5, 1.6, 8, 2.0, 0, 4.5, wall);
    B.box(-5, 4, -4, 11.5, 0, 1.1, '#2b2723');
    B.deco(-5.02, 4, -3.98, 11.5, 1.1, 1.13, '#1d2a30');
    B.glow(-4.06, 4, -3.98, 11.5, 1.08, 1.13, '#58c8e0');
    for (let z = 4.6; z < 11; z += 1.6) B.deco(-4.9, z, -4.1, z + 0.9, 0.85, 0.9, '#3a3d42');
    B.deco(-8, 3.8, -7.75, 12.2, 1.2, 3.4, '#6b5b45');
    const guns = [[0.9, '#23262b'], [1.4, '#2a2d33'], [1.2, '#3b3026'], [0.6, '#25272c'], [1.5, '#1d1f23']];
    for (let k = 0; k < 10; k++) {
      const [len, c] = guns[k % guns.length];
      const z = 4.4 + (k % 5) * 1.6, y = k < 5 ? 2.7 : 1.7;
      B.deco(-7.74, z, -7.6, z + len, y, y + 0.16, c);
      B.deco(-7.74, z + len * 0.3, -7.6, z + len * 0.3 + 0.12, y - 0.22, y, c);
    }
    B.box(7.2, 4, 8, 12, 0, 2.4, '#4b3f33');
    const crate = ['#a16207', '#166534', '#7f1d1d', '#1e3a8a', '#525252'];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) B.deco(7.0, 4.2 + k * 0.85, 7.2, 4.85 + k * 0.85, 0.3 + r * 0.75, 0.75 + r * 0.75, crate[(k + r) % crate.length]);
    B.sign('IRON PALM ARMS', PALETTE.neonOrange, 0, 3.4, 12.95, Math.PI, 6);
    B.sign('RANGE', PALETTE.neonCyan, -2.5, 3.5, 2.05, 0, 3);
    B.glow(-6, 6, 6, 6.6, 4.4, 4.45, '#ffe8c4');
    B.glow(-6, 9, 6, 9.6, 4.4, 4.45, '#ffe8c4');
    // range: shooting table, lane dividers, baffles, targets
    B.box(-8, -1.4, 8, -0.9, 0, 1.05, '#4a3f33');
    for (const x of [-4, 0, 4]) B.box(x - 0.08, -1.4, x + 0.08, 0.4, 0, 2.2, '#2f2f2f');
    B.deco(-8, -13, 8, -1.4, 0.003, 0.02, '#3d3a35');
    for (let z = -11; z < -2; z += 3) B.deco(-8, z, 8, z + 0.3, 3.6, 4.4, '#2a2926');
    B.deco(-8, -13, 8, -12.6, 0, 4.5, '#5b4a3a');
    for (let z = -11; z < -1; z += 2.5) B.glow(-6, z, 6, z + 0.4, 4.4, 4.45, '#d6ecff');
    const tg = mergeGeometries([
      cbox(1.0, 1.5, 0.05, 0, 0.75, 0, '#f2f2f2'),
      cbox(0.7, 0.7, 0.06, 0, 0.95, 0, '#cc2b2b'),
      cbox(0.46, 0.46, 0.07, 0, 0.95, 0, '#f2f2f2'),
      cbox(0.22, 0.22, 0.08, 0, 0.95, 0, '#cc2b2b'),
      cbox(0.08, 0.8, 0.08, 0, -0.4, 0, '#333'),
    ]);
    for (const x of [-6, -2, 2, 6]) {
      const m = B.mesh(tg, MAT.vc, x, 0.8, -12);
      const T = {
        mesh: m, up: false, downT: 0,
        box: { minX: I.wx(x) - 0.5, maxX: I.wx(x) + 0.5, minZ: I.wz(-12) - 0.06, maxZ: I.wz(-12) + 0.06, y0: I.oy + 0.8, y1: I.oy + 2.3 },
        hit() { if (!this.up) return; this.up = false; this.downT = 0.9; I.onTargetHit?.(this); },
      };
      I.targets.push(T);
    }
    I.rangeZone = (x, z) => z < I.wz(1.8);
  },
  populate(I, G) {
    I.parts.clerk = new Npc(G, I, 'gunclerk', I.wx(-6.5), I.wz(7.6), Math.PI / 2);
  },
  update(I, G, dt) {
    for (const T of I.targets) {
      const want = T.up ? 0 : -Math.PI / 2;
      T.mesh.rotation.x += (want - T.mesh.rotation.x) * Math.min(1, dt * 12);
    }
  },
};

const STORE = {
  id: 'store', name: 'Late Mart', w: 14, d: 18, h: 3.8,
  lights: [[0, 3.4, 2, '#eef6ff', 34, 18], [0, 3.4, -5, '#e0f2ff', 26, 16]],
  ambient: { color: '#f1f7ff', intensity: 1.0 },
  build(B) {
    B.shell(14, 18, 3.8, { wall: '#eef0f3', floor: '#c9ced6', ceil: '#e5e7eb', trim: '#22c55e' });
    for (let z = -8; z < 9; z += 2) B.deco(-7, z, 7, z + 0.03, 0.002, 0.008, '#b8bec8');
    B.box(1.5, 3.5, 6.5, 4.5, 0, 1.05, '#16a34a');
    B.deco(1.4, 3.4, 6.6, 4.6, 1.05, 1.12, '#e5e7eb');
    B.glow(4.6, 3.7, 5.4, 4.1, 1.12, 1.4, '#7dff7a');
    B.deco(1.6, 2.0, 6.5, 2.4, 0, 2.2, '#d1d5db');
    const prod = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#f97316', '#eab308'];
    for (const x of [-5, -2]) {
      B.box(x - 0.45, -6, x + 0.45, 1.2, 0, 1.7, '#d1d5db');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) {
        const c = prod[(k * 3 + r + (x > -4 ? 2 : 0)) % prod.length];
        B.deco(x - 0.55, -5.8 + k * 0.78, x - 0.45, -5.2 + k * 0.78, 0.25 + r * 0.5, 0.6 + r * 0.5, c);
        B.deco(x + 0.45, -5.8 + k * 0.78, x + 0.55, -5.2 + k * 0.78, 0.25 + r * 0.5, 0.6 + r * 0.5, prod[(k + r) % prod.length]);
      }
    }
    B.box(-6.8, -9, 6.8, -8.2, 0, 2.6, '#cbd5e1');
    for (let k = 0; k < 8; k++) B.glow(-6.5 + k * 1.65, -8.24, -5.05 + k * 1.65, -8.18, 0.2, 2.4, k % 2 ? '#cfefff' : '#bfe6ff');
    B.box(6.2, -7, 7, 2, 0, 2.0, '#cbd5e1');
    for (let k = 0; k < 5; k++) B.glow(6.14, -6.6 + k * 1.7, 6.2, -5.1 + k * 1.7, 0.2, 1.8, '#dff6ff');
    B.box(-6.8, 4, -5.4, 7, 0, 1.2, '#f59e0b');
    for (let z = -6; z < 7; z += 3) B.glow(-3, z, 3, z + 0.5, 3.7, 3.75, '#ffffff');
    B.sign('LATE MART', '#7dff7a', 4, 2.9, 2.45, 0, 4);
  },
  populate(I, G) {
    I.parts.clerk = new Npc(G, I, 'clerk', I.wx(4), I.wz(2.9), 0);
    const aisle = [[-3.5, -4], [-3.5, 0], [-0.5, -3], [-0.5, 1], [-6, -6], [3, -6]];
    civ(I, G, -3.5, -2, rand(0, 6), aisle);
    if (Math.random() < 0.6) civ(I, G, -0.5, -5, rand(0, 6), aisle);
  },
};

const MOTEL = {
  id: 'motel', name: 'Seabreeze Room 6', w: 8, d: 10, h: 3,
  lights: [[-1, 2.5, -1, '#ffcf9e', 18, 12], [2, 2.4, 3, '#ffb3c7', 10, 10]],
  ambient: { color: '#ffe3d1', intensity: 0.8 },
  build(B, I) {
    B.shell(8, 10, 3, { wall: '#ffd1dc', floor: '#6e5246', ceil: '#fff5f8', trim: '#7c3f58' });
    B.box(-3.9, -4.9, -0.9, -1.4, 0, 0.55, '#7c3f58');
    B.deco(-3.8, -4.8, -1.0, -1.5, 0.55, 0.7, '#f8fafc');
    B.deco(-3.8, -3.6, -1.0, -1.5, 0.7, 0.78, '#2ad4e0');
    B.deco(-3.5, -4.7, -1.3, -4.1, 0.7, 0.88, '#ffffff');
    B.deco(-3.95, -4.95, -0.85, -4.8, 0, 1.4, '#7c3f58');
    B.box(-0.8, -4.9, -0.1, -4.2, 0, 0.6, '#6b4a33');
    B.glow(-0.6, -4.7, -0.3, -4.4, 0.6, 1.0, '#ffd9a0');
    B.box(2.6, -1.5, 3.9, 1.5, 0, 0.7, '#3b2a20');
    B.deco(3.4, -1.2, 3.6, 1.2, 0.75, 2.0, '#111111');
    const screen = B.mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ color: '#6fd3ff' }), 3.39, 1.38, 0);
    screen.rotation.y = -Math.PI / 2;
    I.parts.tv = screen;
    B.box(2.4, -4.9, 3.9, -2.6, 0, 2.2, '#7c5c4a');
    B.deco(2.38, -3.8, 2.42, -3.7, 0.9, 1.3, '#c9a227');
    B.deco(-2.5, 0.5, 1.5, 3.5, 0.005, 0.02, '#2ad4e0');
    B.box(-3.9, 2.5, -2.9, 3.5, 0, 0.9, '#6b4a33');
    B.sign('HOME', PALETTE.neonPink, -3.95, 2.0, 0, Math.PI / 2, 2.4);
  },
  update(I) {
    const k = 0.75 + 0.25 * Math.sin(I.t * 7) * Math.sin(I.t * 2.3);
    I.parts.tv.material.color.setRGB(0.45 * k, 0.8 * k, 1.0 * k);
  },
};

const ARCADE = {
  id: 'arcade', name: 'Neon Arcade', w: 16, d: 20, h: 4.5,
  lights: [[-4, 3.8, 0, '#ff3fa4', 34, 18], [4, 3.8, 2, '#29e7ff', 34, 18]],
  ambient: { color: '#b9a6ff', intensity: 0.55 },
  nav: {
    nodes: [[0, 6], [0, -3], [5.7, -4.5], [5.7, -7.5], [0, -5]],
    edges: [[0, 1], [1, 4], [1, 2], [2, 3]],
  },
  build(B, I) {
    const wall = '#1a1030';
    B.shell(16, 20, 4.5, { wall, floor: '#120a22', ceil: '#0d0818', trim: '#ff3fa4' });
    for (let x = -7; x <= 7; x += 2) B.glow(x - 0.03, -10, x + 0.03, 10, 0.004, 0.01, x % 4 ? '#5a1d5a' : '#1d4f5a');
    for (let z = -9; z <= 9; z += 2) B.glow(-8, z - 0.03, 8, z + 0.03, 0.004, 0.01, z % 4 ? '#1d4f5a' : '#5a1d5a');
    I.parts.screenMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const scr = ['#ff3fa4', '#29e7ff', '#a65bff', '#7dff7a', '#ffd166', '#ff8a3d'];
    let k = 0;
    const cab = (x, z, face) => {
      const sx = face === 'e' ? 1 : face === 'w' ? -1 : 0, sz = face === 's' ? 1 : face === 'n' ? -1 : 0;
      B.box(x - 0.45, z - 0.45, x + 0.45, z + 0.45, 0, 1.9, '#2a1a4a');
      const c = scr[k++ % scr.length];
      B.glow(x + sx * 0.46 - (sz ? 0.32 : 0.01), z + sz * 0.46 - (sx ? 0.32 : 0.01), x + sx * 0.46 + (sz ? 0.32 : 0.01), z + sz * 0.46 + (sx ? 0.32 : 0.01), 1.05, 1.6, c, I.parts.screenMat);
      B.glow(x - 0.46, z - 0.46, x + 0.46, z + 0.46, 1.9, 2.05, c);
      B.deco(x + sx * 0.5 - (sz ? 0.4 : 0.1), z + sz * 0.5 - (sx ? 0.4 : 0.1), x + sx * 0.5 + (sz ? 0.4 : 0.1), z + sz * 0.5 + (sx ? 0.4 : 0.1), 0.85, 0.95, '#111');
    };
    for (const z of [-4.5, -2, 0.5, 3]) cab(-7.4, z, 'e');
    for (const z of [-3.5, -1, 1.5, 4]) cab(7.4, z, 'w');
    for (const x of [-2, 0, 2]) { cab(x, 0.5, 's'); cab(x, -0.4, 'n'); }
    // Lucky Tides machine
    B.box(-7.9, 6, -6.9, 7.2, 0, 2.1, '#5a3a00');
    B.glow(-6.88, 6.15, -6.84, 7.05, 1.0, 1.7, '#ffd166', I.parts.screenMat);
    B.glow(-7.9, 6, -6.9, 7.2, 2.1, 2.3, '#ffd166');
    // prize counter + shelves
    B.box(-3, -7, 3, -6, 0, 1.1, '#ff3fa4');
    B.glow(-3.02, -6.05, 3.02, -5.98, 0.9, 1.0, '#29e7ff');
    B.deco(-4, -9.9, 3, -9.4, 0, 2.6, '#2a1a4a');
    const toys = ['#ff5ea8', '#29e7ff', '#ffd166', '#7dff7a', '#a65bff'];
    for (let r = 0; r < 3; r++) for (let j = 0; j < 8; j++) B.deco(-3.8 + j * 0.85, -9.4, -3.3 + j * 0.85, -9.1, 0.5 + r * 0.75, 0.95 + r * 0.75, toys[(j + r) % 5]);
    // back office with the safe
    B.box(3.8, -10, 4.2, -6, 0, 4.5, wall);
    B.box(4.2, -6.2, 5, -5.8, 0, 4.5, wall);
    B.box(6.4, -6.2, 8, -5.8, 0, 4.5, wall);
    B.box(6.6, -9.8, 7.8, -8.6, 0, 1.2, '#4b5563');
    B.glow(6.55, -9.3, 6.58, -9.0, 0.5, 0.8, '#7dff7a');
    B.sign('NEON ARCADE', PALETTE.neonPink, 0, 3.5, -9.85, 0, 6);
  },
  populate(I, G) {
    I.parts.owner = new Npc(G, I, 'owner', I.wx(0), I.wz(-8), 0);
    const spots = [[-6.4, -2, Math.PI / 2], [6.4, 1.5, -Math.PI / 2], [0, 1.4, 0], [-6.4, 3, Math.PI / 2], [6.4, -3.5, -Math.PI / 2]];
    for (let j = 0; j < 3; j++) { const [x, z, h] = spots[(j * 2 + ((Math.random() * 5) | 0)) % spots.length]; new Npc(G, I, 'civ', I.wx(x), I.wz(z), h); }
  },
  update(I, G) {
    I.parts.screenMat.color.setScalar(0.8 + 0.2 * Math.sin(I.t * 11) * Math.sin(I.t * 3.1));
    if (G.player.space === I && Math.random() < 0.08) G.audio.bleep();
  },
};

export const DEFS = [BANK, GUNSHOP, STORE, MOTEL, ARCADE];

// ------------------------------------------------------------------ manager
export class Interiors {
  constructor(G) {
    this.G = G;
    this.list = {};
    this.lights = [0, 1].map(() => { const l = new THREE.PointLight('#ffffff', 0, 30, 1.5); G.root.add(l); return l; });
    for (const def of DEFS) this.list[def.id] = new Interior(G, def, G.world.doors[def.id]);
    this.current = null;
  }
  get all() { return Object.values(this.list); }

  enter(I) {
    const G = this.G;
    if (this.current || G.transitioning) return;
    G.transition(() => {
      const P = G.player;
      this.current = I;
      I.group.visible = true;
      G.scene.visible = false;
      I.lights.forEach((L, i) => {
        const l = this.lights[i];
        if (!l) return;
        l.position.set(L.x, L.y, L.z); l.color.set(L.color); l.intensity = L.intensity; l.distance = L.dist;
      });
      G.env.indoor = I.ambient;
      I.populate();
      P.space = I;
      P.place(I.entry.x, I.entry.z, I.entry.h);
      G.cam.snap(I.entry.h);
      G.hud.location(I.name);
      I.def.onEnter?.(I, G);
      G.onEnterInterior(I);
    });
  }

  exit(instant = false) {
    const G = this.G;
    const I = this.current;
    if (!I) return;
    const go = () => {
      this.current = null;
      G.onLeaveInterior(I);
      I.group.visible = false;
      G.scene.visible = true;
      for (const l of this.lights) l.intensity = 0;
      G.env.indoor = null;
      I.clearNpcs();
      const P = G.player;
      P.space = G.world;
      P.place(I.door.x, I.door.z, I.door.h);
      G.cam.snap(I.door.h);
      G.hud.location(null);
    };
    if (instant) go(); else G.transition(go);
  }

  update(dt) {
    const I = this.current;
    if (I) I.update(dt);
  }
}
