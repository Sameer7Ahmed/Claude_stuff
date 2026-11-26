import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import {
  NB, PITCH, ROAD, SIDEWALK, LANE, BLOCK, HALF, CURB, LAND, PIER, WATER_Y,
  roadPos, blockBounds, isSpecial, SPECIAL, PALETTE,
} from './config.js';
import { seededRandom, colorize, cbox, clamp } from './util.js';
import {
  decoFacade, glassFacade, sidewalkTexture, noiseTexture, asphaltTexture, signTexture, radialTexture,
} from './textures.js';
import { palmGeometries, buildBoat, MAT } from './models.js';

// --------------------------------------------------------------- colliders
class ColliderGrid {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.list = [];
    this.stamp = 0;
  }
  key(cx, cz) { return (cx + 512) * 4096 + (cz + 512); }
  add(b) {
    this.list.push(b);
    b._s = 0;
    const c = this.cell;
    for (let cx = Math.floor(b.minX / c); cx <= Math.floor(b.maxX / c); cx++) {
      for (let cz = Math.floor(b.minZ / c); cz <= Math.floor(b.maxZ / c); cz++) {
        const k = this.key(cx, cz);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(b);
      }
    }
  }
  query(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const s = ++this.stamp;
    const c = this.cell;
    for (let cx = Math.floor(minX / c); cx <= Math.floor(maxX / c); cx++) {
      for (let cz = Math.floor(minZ / c); cz <= Math.floor(maxZ / c); cz++) {
        const arr = this.map.get(this.key(cx, cz));
        if (!arr) continue;
        for (const b of arr) {
          if (b._s === s) continue;
          b._s = s;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }
  pointBlocked(x, z, pad = 0) {
    const arr = this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!arr) return false;
    for (const b of arr) if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad) return true;
    return false;
  }
  // Line of sight test sampled every `step` units.
  lineBlocked(ax, az, bx, bz, step = 3) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / step);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.pointBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return true;
    }
    return false;
  }
}

// Resolve a circle against nearby boxes. Returns {nx, nz, pen} of the deepest hit or null.
const _tmp = [];
export function circleVsBoxes(grid, x, z, r) {
  grid.query(x - r, z - r, x + r, z + r, _tmp);
  let best = null;
  for (const b of _tmp) {
    const qx = clamp(x, b.minX, b.maxX), qz = clamp(z, b.minZ, b.maxZ);
    let dx = x - qx, dz = z - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    let nx, nz, pen;
    if (d2 < 1e-8) {
      // centre inside box: push out along the shallowest axis
      const l = x - b.minX, rr = b.maxX - x, t = z - b.minZ, bt = b.maxZ - z;
      const m = Math.min(l, rr, t, bt);
      if (m === l) { nx = -1; nz = 0; pen = l + r; }
      else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
      else if (m === t) { nx = 0; nz = -1; pen = t + r; }
      else { nx = 0; nz = 1; pen = bt + r; }
    } else {
      const d = Math.sqrt(d2);
      nx = dx / d; nz = dz / d; pen = r - d;
    }
    if (!best || pen > best.pen) best = { nx, nz, pen };
  }
  return best;
}

// --------------------------------------------------------------- world
export function buildWorld(scene, quality) {
  const rng = seededRandom(20261126);
  const colliders = new ColliderGrid(16);
  const W = {
    colliders, blocks: [], ramps: [], lampsHead: null, signs: [], buildingMats: [],
    specials: {}, tokenSpots: [], parkingSpots: [], palms: [], neonMats: [],
  };

  const deco = [decoFacade(11), decoFacade(12)];
  const glass = [glassFacade(21), glassFacade(22)];
  const mkFacadeMat = (f) => new THREE.MeshStandardMaterial({
    map: f.map, emissiveMap: f.emissive, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    vertexColors: true, roughness: 0.62, metalness: 0.15,
  });
  const facadeSets = [...deco, ...glass].map((f) => ({ f, mat: mkFacadeMat(f), geos: [] }));
  facadeSets.forEach((s, i) => { if (i >= 2) { s.mat.roughness = 0.25; s.mat.metalness = 0.55; } });
  W.buildingMats = facadeSets.map((s) => s.mat);
  const propGeos = [];          // vertex coloured, standard material
  const neonGeos = { pink: [], cyan: [], purple: [], orange: [], gold: [] };
  const markGeos = [];          // road markings
  const sidewalkGeos = [];
  const grassGeos = [];
  const lotGeos = [];
  const palmSpots = [];
  const lampSpots = [];         // {x, z, rot}

  function addBuilding(x0, z0, x1, z1, h, setIdx, tint, opts = {}) {
    const set = facadeSets[setIdx];
    const f = set.f;
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    for (let face = 0; face < 6; face++) {
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        if (face === 2 || face === 3) { uv.setXY(i, f.roofUV[0], f.roofUV[1]); continue; }
        const faceW = face < 2 ? d : w;
        uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(faceW / f.tileW * 4) / 4), uv.getY(i) * (h / f.tileH));
      }
    }
    g.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    colorize(g, tint);
    set.geos.push(g);
    if (!opts.noCollide) colliders.add({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, h });
    return { x0, z0, x1, z1, h };
  }

  function neonBand(b, y, color) {
    neonGeos[color].push(cbox(b.x1 - b.x0 + 0.35, 0.45, b.z1 - b.z0 + 0.35, (b.x0 + b.x1) / 2, y, (b.z0 + b.z1) / 2, '#ffffff'));
  }

  const signWords = ['MOTEL', 'DINER', 'CLUB', 'TACOS', 'SURF', 'CAFE', 'HOTEL', 'ARCADE', 'PIZZA', 'DISCO', 'GYM', 'BURGERS', 'VINYL', 'NOODLES', 'TATTOO', 'LAUNDRY'];
  const signColors = [PALETTE.neonPink, PALETTE.neonCyan, PALETTE.neonPurple, PALETTE.neonOrange, PALETTE.neonGold];
  const signMatCache = new Map();
  function signMat(word, color) {
    const k = word + color;
    if (!signMatCache.has(k)) {
      const m = new THREE.MeshBasicMaterial({ map: signTexture(word, color), transparent: true, color: '#bbbbbb' });
      signMatCache.set(k, m);
      W.neonMats.push(m);
    }
    return signMatCache.get(k);
  }
  const signGeo = new THREE.PlaneGeometry(1, 0.25);
  function addSign(b, word, color, side, y, width = 6) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    let x = cx, z = cz, rot = 0;
    if (side === 'n') { z = b.z0 - 0.12; rot = Math.PI; }
    if (side === 's') { z = b.z1 + 0.12; rot = 0; }
    if (side === 'w') { x = b.x0 - 0.12; rot = -Math.PI / 2; }
    if (side === 'e') { x = b.x1 + 0.12; rot = Math.PI / 2; }
    const m = new THREE.Mesh(signGeo, signMat(word, color));
    m.scale.set(width, width, 1);
    m.position.set(x, y, z);
    m.rotation.y = rot;
    scene.add(m);
    W.signs.push(m);
  }
  // side of building b closest to the block edge
  function streetSide(b, blk) {
    const opts = [['n', b.z0 - blk.z0], ['s', blk.z1 - b.z1], ['w', b.x0 - blk.x0], ['e', blk.x1 - b.x1]];
    opts.sort((a, c) => a[1] - c[1]);
    return opts[0][0];
  }

  const pastel = ['#ffd1dc', '#b8f2e6', '#ffe5b4', '#d8c8ff', '#c6f1ff', '#fff1a8', '#ffc9a8', '#e6f7c1', '#f8f8f8', '#ffb3c7'];
  const towerTints = ['#cfe6ff', '#bfefff', '#e0e7ef', '#c9d6ff', '#d7fff4', '#f0e2ff'];

  for (let i = 0; i < NB; i++) {
    for (let j = 0; j < NB; j++) {
      const blk = blockBounds(i, j);
      const ring = Math.max(Math.abs(i - 3), Math.abs(j - 3));
      const info = { i, j, ...blk, type: 'city', ring };
      W.blocks.push(info);
      sidewalkGeos.push(new THREE.BoxGeometry(BLOCK, CURB, BLOCK).translate(blk.cx, CURB / 2, blk.cz));
      // street lamps: two per side
      for (const t of [0.25, 0.75]) {
        lampSpots.push({ x: blk.x0 + BLOCK * t, z: blk.z0 + 0.7, rot: Math.PI });
        lampSpots.push({ x: blk.x0 + BLOCK * t, z: blk.z1 - 0.7, rot: 0 });
        lampSpots.push({ x: blk.x0 + 0.7, z: blk.z0 + BLOCK * t, rot: -Math.PI / 2 });
        lampSpots.push({ x: blk.x1 - 0.7, z: blk.z0 + BLOCK * t, rot: Math.PI / 2 });
      }
      const ix0 = blk.x0 + SIDEWALK, iz0 = blk.z0 + SIDEWALK, ix1 = blk.x1 - SIDEWALK, iz1 = blk.z1 - SIDEWALK;
      const S = ix1 - ix0; // 56

      if (isSpecial(i, j, 'parks')) {
        info.type = 'park';
        grassGeos.push(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2).translate(blk.cx, CURB + 0.01, blk.cz));
        propGeos.push(cbox(S, 0.02, 3, blk.cx, CURB + 0.02, blk.cz, '#c9b99a'));
        propGeos.push(cbox(3, 0.02, S, blk.cx, CURB + 0.02, blk.cz, '#c9b99a'));
        // fountain
        propGeos.push(colorize(new THREE.CylinderGeometry(4, 4.3, 0.6, 20).translate(blk.cx, CURB + 0.3, blk.cz), '#d9d4cc'));
        propGeos.push(colorize(new THREE.CylinderGeometry(3.5, 3.5, 0.62, 20).translate(blk.cx, CURB + 0.32, blk.cz), '#3fb6c9'));
        propGeos.push(colorize(new THREE.CylinderGeometry(0.4, 0.6, 2.2, 8).translate(blk.cx, CURB + 1.1, blk.cz), '#d9d4cc'));
        colliders.add({ minX: blk.cx - 4, maxX: blk.cx + 4, minZ: blk.cz - 4, maxZ: blk.cz + 4, h: 1 });
        for (let k = 0; k < 14; k++) {
          const px = ix0 + 3 + rng() * (S - 6), pz = iz0 + 3 + rng() * (S - 6);
          if (Math.abs(px - blk.cx) < 6 && Math.abs(pz - blk.cz) < 6) continue;
          if (Math.abs(px - blk.cx) < 2.5 || Math.abs(pz - blk.cz) < 2.5) continue;
          palmSpots.push([px, CURB, pz, rng()]);
        }
        W.tokenSpots.push([blk.cx + 10, blk.cz + 10]);
        continue;
      }

      if (isSpecial(i, j, 'parking')) {
        info.type = 'parking';
        lotGeos.push(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2).translate(blk.cx, CURB + 0.01, blk.cz));
        for (let row = 0; row < 3; row++) {
          const z = iz0 + 8 + row * 20;
          for (let k = 0; k <= 9; k++) {
            const x = ix0 + 3 + k * 5.5;
            markGeos.push(cbox(0.15, 0.02, 5.5, x, CURB + 0.03, z, '#f0f0f0'));
            if (k < 9) W.parkingSpots.push({ x: x + 2.75, z, h: row % 2 ? 0 : Math.PI });
          }
        }
        W.tokenSpots.push([ix1 - 2, iz1 - 2]);
        continue;
      }

      // ---- building blocks
      let lots;
      if (isSpecial(i, j, 'paint')) {
        info.type = 'paint';
        const b = addBuilding(ix0, iz0, ix1 - 13, iz1, 11, 0, '#ffc2e2');
        propGeos.push(cbox(0.3, 6, 12, b.x1 + 0.1, 3, blk.cz, '#2a2230'));
        neonBand(b, 10.6, 'pink');
        addSign(b, 'PAINT & PAY', PALETTE.neonPink, 'e', 8, 9);
        addBuilding(ix1 - 12, iz0, ix1, iz0 + 12, 7, 1, '#f8f8f8');
        addBuilding(ix1 - 12, iz1 - 12, ix1, iz1, 7, 1, '#f8f8f8');
        W.specials.paint = { x: ix1 - 6, z: blk.cz, r: 6 };
        continue;
      }
      if (isSpecial(i, j, 'police')) {
        info.type = 'police';
        const b = addBuilding(ix0 + 4, iz0, ix1 - 4, iz0 + 30, 15, 0, '#a9bde0');
        neonBand(b, 14.6, 'cyan');
        addSign(b, 'POLICE', '#4d8dff', 's', 10, 8);
        addBuilding(ix0, iz0 + 40, ix0 + 20, iz1, 9, 1, '#d6e0f0');
        W.specials.police = { x: blk.cx, z: iz0 + 36, carX: blk.cx, carZ: blk.z1 + 0.0 };
        W.policeLot = [{ x: ix1 - 10, z: iz0 + 40, h: 0 }, { x: ix1 - 4, z: iz0 + 40, h: 0 }, { x: ix1 - 16, z: iz0 + 40, h: 0 }];
        continue;
      }
      if (isSpecial(i, j, 'hospital')) {
        info.type = 'hospital';
        const b = addBuilding(ix0, iz0, ix1, iz0 + 34, 24, 1, '#f9f9f9');
        neonBand(b, 23.6, 'cyan');
        addSign(b, 'HOSPITAL', '#ff4d5e', 's', 12, 9);
        addBuilding(ix0, iz0 + 44, ix0 + 18, iz1, 10, 0, '#e8f4ff');
        W.specials.hospital = { x: blk.cx, z: iz0 + 39 };
        continue;
      }
      if (isSpecial(i, j, 'bank')) {
        info.type = 'bank';
        const b = addBuilding(ix0 + 6, iz0 + 4, ix1 - 6, iz1 - 10, 120, 2, '#ffe1a0');
        const t2 = { x0: b.x0 + 6, z0: b.z0 + 6, x1: b.x1 - 6, z1: b.z1 - 6 };
        addBuilding(t2.x0, t2.z0, t2.x1, t2.z1, 150, 2, '#ffe9b8', { noCollide: true });
        neonBand(b, 119.6, 'gold');
        neonBand({ ...t2 }, 149.6, 'gold');
        propGeos.push(cbox(1.2, 22, 1.2, blk.cx, 161, (t2.z0 + t2.z1) / 2, '#d9d9d9'));
        addSign(b, 'SOLANO BANK', PALETTE.neonGold, 's', 9, 12);
        W.specials.bank = { x: blk.cx, z: iz1 - 4 };
        W.tokenSpots.push([ix0 + 2, iz1 - 2]);
        continue;
      }
      if (isSpecial(i, j, 'motel')) {
        info.type = 'motel';
        const b = addBuilding(ix0, iz0, ix1, iz0 + 16, 8, 0, '#ffb3c7');
        neonBand(b, 7.7, 'pink');
        addSign(b, 'SEABREEZE MOTEL', PALETTE.neonPink, 's', 9.5, 13);
        const b2 = addBuilding(ix0, iz0 + 16, ix0 + 14, iz1, 8, 0, '#ffb3c7');
        neonBand(b2, 7.7, 'pink');
        propGeos.push(cbox(16, 0.3, 12, ix1 - 14, CURB + 0.1, iz1 - 14, '#2fb7d6'));
        W.specials.motel = { x: ix1 - 20, z: iz0 + 24 };
        continue;
      }
      if (isSpecial(i, j, 'marina')) {
        info.type = 'marina';
        const b = addBuilding(ix0, iz0, ix0 + 26, iz1, 12, 1, '#cfd8dc');
        addSign(b, 'MARINA STORAGE', PALETTE.neonCyan, 'e', 9, 12);
        addBuilding(ix0 + 30, iz0, ix1, iz0 + 20, 10, 1, '#b0bec5');
        W.specials.marina = { x: ix1 - 10, z: iz1 - 12 };
        continue;
      }

      const r = rng();
      const G = 2; // alley width
      const H = (S - G) / 2;
      if (ring <= 1) lots = r < 0.45 ? [[0, 0, S, S]] : r < 0.75 ? [[0, 0, H, S], [H + G, 0, H, S]] : [[0, 0, S, H], [0, H + G, S, H]];
      else lots = r < 0.25 ? [[0, 0, H, S], [H + G, 0, H, S]] : [[0, 0, H, H], [H + G, 0, H, H], [0, H + G, H, H], [H + G, H + G, H, H]];
      if (lots.length === 4) W.tokenSpots.push([ix0 + H + G / 2, iz0 + H + G / 2]);

      for (const [lx, lz, lw, ld] of lots) {
        const tower = ring <= 1 || (ring === 2 && rng() < 0.4);
        let inset = tower ? 2 + rng() * 3 : rng() * 1.5;
        if (lots.length === 1) inset = 5 + rng() * 4;
        const bx0 = ix0 + lx + inset, bz0 = iz0 + lz + inset, bx1 = ix0 + lx + lw - inset, bz1 = iz0 + lz + ld - inset;
        let h;
        if (ring <= 1) h = 50 + rng() * 70;
        else if (ring === 2) h = tower ? 28 + rng() * 30 : 14 + rng() * 16;
        else h = 7 + rng() * 11;
        const setIdx = tower ? 2 + Math.floor(rng() * 2) : Math.floor(rng() * 2);
        const tint = tower ? towerTints[Math.floor(rng() * towerTints.length)] : pastel[Math.floor(rng() * pastel.length)];
        const b = addBuilding(bx0, bz0, bx1, bz1, h, setIdx, tint);
        if (tower) {
          const nc = ['pink', 'cyan', 'purple', 'orange'][Math.floor(rng() * 4)];
          neonBand(b, h - 0.6, nc);
          if (h > 70 && rng() < 0.7) {
            const sx = (bx1 - bx0) * 0.18, sz = (bz1 - bz0) * 0.18;
            const h2 = h * (0.2 + rng() * 0.2);
            const top = { x0: bx0 + sx, z0: bz0 + sz, x1: bx1 - sx, z1: bz1 - sz };
            const g = new THREE.BoxGeometry(top.x1 - top.x0, h2, top.z1 - top.z0);
            const uv = g.attributes.uv;
            const f = facadeSets[setIdx].f;
            for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) {
              const ii = face * 4 + k;
              if (face === 2 || face === 3) uv.setXY(ii, f.roofUV[0], f.roofUV[1]);
              else uv.setXY(ii, uv.getX(ii) * 2, uv.getY(ii) * (h2 / f.tileH));
            }
            g.translate((top.x0 + top.x1) / 2, h + h2 / 2, (top.z0 + top.z1) / 2);
            facadeSets[setIdx].geos.push(colorize(g, tint));
            neonBand(top, h + h2 - 0.6, nc);
          } else if (rng() < 0.5) {
            propGeos.push(cbox(0.5, 10, 0.5, (bx0 + bx1) / 2, h + 5, (bz0 + bz1) / 2, '#cfcfcf'));
          }
        } else {
          // parapet, awning, rooftop clutter, maybe a neon sign
          const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
          propGeos.push(cbox(bx1 - bx0 + 0.3, 0.8, bz1 - bz0 + 0.3, cx, h + 0.4, cz, tint === '#f8f8f8' ? '#7fd3c8' : '#ffffff'));
          if (rng() < 0.6) propGeos.push(cbox(2.2, 1.4, 2.2, bx0 + 2 + rng() * (bx1 - bx0 - 4), h + 0.7, bz0 + 2 + rng() * (bz1 - bz0 - 4), '#9ca3af'));
          const side = streetSide(b, { x0: ix0, z0: iz0, x1: ix1, z1: iz1 });
          const awnC = ['#ff5ea8', '#2ad4e0', '#ffffff', '#7c5cff', '#f97316'][Math.floor(rng() * 5)];
          const aw = 0.12;
          if (side === 'n') propGeos.push(cbox(bx1 - bx0 - 2, aw, 1.6, cx, 3.3, bz0 - 0.8, awnC));
          if (side === 's') propGeos.push(cbox(bx1 - bx0 - 2, aw, 1.6, cx, 3.3, bz1 + 0.8, awnC));
          if (side === 'w') propGeos.push(cbox(1.6, aw, bz1 - bz0 - 2, bx0 - 0.8, 3.3, cz, awnC));
          if (side === 'e') propGeos.push(cbox(1.6, aw, bz1 - bz0 - 2, bx1 + 0.8, 3.3, cz, awnC));
          if (rng() < 0.45) {
            addSign(b, signWords[Math.floor(rng() * signWords.length)], signColors[Math.floor(rng() * signColors.length)], side, Math.min(h - 1.2, 5.2), 5);
          }
        }
      }
    }
  }

  // ------------------------------------------------ merged static meshes
  const addMerged = (geos, mat, { cast = true, receive = true } = {}) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    scene.add(m);
    return m;
  };
  for (const s of facadeSets) addMerged(s.geos, s.mat);
  addMerged(propGeos, MAT.vc);
  const neonHex = { pink: PALETTE.neonPink, cyan: PALETTE.neonCyan, purple: PALETTE.neonPurple, orange: PALETTE.neonOrange, gold: PALETTE.neonGold };
  for (const k of Object.keys(neonGeos)) {
    const mat = new THREE.MeshBasicMaterial({ color: neonHex[k] });
    mat.userData.base = new THREE.Color(neonHex[k]);
    W.neonMats.push(mat);
    addMerged(neonGeos[k], mat, { cast: false, receive: false });
  }

  const swTex = sidewalkTexture();
  swTex.repeat.set(16, 16);
  addMerged(sidewalkGeos, new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.9 }), { cast: false });
  const grassTex = noiseTexture('#4f9a45', 0.25, 5, 256, 7000);
  grassTex.repeat.set(8, 8);
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 });
  addMerged(grassGeos, grassMat, { cast: false });
  const asph = asphaltTexture();
  asph.repeat.set(10, 10);
  addMerged(lotGeos, new THREE.MeshStandardMaterial({ map: asph, roughness: 0.95 }), { cast: false });

  // ------------------------------------------------ roads
  const roadSpan = HALF * 2 + ROAD;
  const roadTex = asphaltTexture();
  roadTex.repeat.set(roadSpan / 8, roadSpan / 8);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadSpan, roadSpan).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92 }));
  road.position.y = 0.005;
  road.receiveShadow = true;
  scene.add(road);

  const Y = 0.03;
  for (let k = 0; k <= NB; k++) {
    const c = roadPos(k);
    for (let s = 0; s < NB; s++) {
      const a = roadPos(s) + ROAD / 2, b = roadPos(s + 1) - ROAD / 2, mid = (a + b) / 2, len = b - a - 6;
      // horizontal road (along x at z=c) and vertical road (along z at x=c)
      markGeos.push(cbox(len, 0.01, 0.14, mid, Y, c - 0.16, '#f5c518'), cbox(len, 0.01, 0.14, mid, Y, c + 0.16, '#f5c518'));
      markGeos.push(cbox(0.14, 0.01, len, c - 0.16, Y, mid, '#f5c518'), cbox(0.14, 0.01, len, c + 0.16, Y, mid, '#f5c518'));
      for (let e = 0; e < 2; e++) {
        const xEdge = e === 0 ? a + 1.8 : b - 1.8;
        for (let st = -3; st <= 3; st++) {
          markGeos.push(cbox(2.6, 0.01, 0.9, xEdge, Y, c + st * 2.1, '#eeeeee'));
          markGeos.push(cbox(0.9, 0.01, 2.6, c + st * 2.1, Y, xEdge, '#eeeeee'));
        }
      }
    }
  }
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  addMerged(markGeos, markMat, { cast: false });

  // ------------------------------------------------ island ground
  const sandTex = noiseTexture('#e6d3a3', 0.2, 9, 256, 8000);
  const lw = LAND.maxX - LAND.minX, ld = LAND.maxZ - LAND.minZ;
  sandTex.repeat.set(lw / 10, ld / 10);
  const sand = new THREE.Mesh(new THREE.BoxGeometry(lw, 3, ld), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
  sand.position.set((LAND.minX + LAND.maxX) / 2, -1.52, (LAND.minZ + LAND.maxZ) / 2);
  sand.receiveShadow = true;
  scene.add(sand);
  // grassy verge around the west/north/south edges
  const verge = [];
  const E = HALF + ROAD / 2;
  verge.push(new THREE.PlaneGeometry(LAND.maxX - LAND.minX - 120, -LAND.minZ - E - 6).rotateX(-Math.PI / 2).translate((LAND.minX + LAND.maxX - 120) / 2, -0.01, (LAND.minZ - E) / 2 - 3));
  verge.push(new THREE.PlaneGeometry(LAND.maxX - LAND.minX - 120, LAND.maxZ - E - 6).rotateX(-Math.PI / 2).translate((LAND.minX + LAND.maxX - 120) / 2, -0.01, (LAND.maxZ + E) / 2 + 3));
  verge.push(new THREE.PlaneGeometry(-LAND.minX - E - 6, 2 * E).rotateX(-Math.PI / 2).translate((LAND.minX - E) / 2 - 3, -0.01, 0));
  const vergeTex = noiseTexture('#5fa64f', 0.25, 6, 256, 7000);
  vergeTex.repeat.set(30, 6);
  addMerged(verge, new THREE.MeshStandardMaterial({ map: vergeTex, roughness: 1 }), { cast: false });

  // palms along the verge and the beach
  for (let x = LAND.minX + 12; x < HALF; x += 22) {
    palmSpots.push([x + rng() * 6, 0, LAND.minZ + 12 + rng() * 10, rng()]);
    palmSpots.push([x + rng() * 6, 0, LAND.maxZ - 12 - rng() * 10, rng()]);
  }
  for (let z = LAND.minZ + 20; z < LAND.maxZ - 10; z += 22) palmSpots.push([LAND.minX + 14 + rng() * 10, 0, z + rng() * 6, rng()]);
  for (let z = LAND.minZ + 10; z < LAND.maxZ - 5; z += 17) {
    palmSpots.push([HALF + ROAD / 2 + 5 + rng() * 2, 0, z + rng() * 4, rng()]);
    if (Math.abs(z) > 14) palmSpots.push([LAND.maxX - 20 - rng() * 14, 0, z + rng() * 8, rng()]);
  }
  // east boulevard sidewalk palms (block column 6, east side)
  for (let j = 0; j < NB; j++) {
    const blk = blockBounds(NB - 1, j);
    for (const t of [0.12, 0.5, 0.88]) palmSpots.push([blk.x1 - 2, CURB, blk.z0 + BLOCK * t, rng()]);
  }

  // ------------------------------------------------ beach props
  const beachX0 = HALF + ROAD / 2, beachX1 = LAND.maxX;
  const rampDefs = [
    { x: beachX0 + 30, z: -170, dx: 0, dz: 1 },
    { x: beachX0 + 70, z: -60, dx: 0, dz: 1 },
    { x: beachX0 + 60, z: 60, dx: 0, dz: 1 },
    { x: beachX0 + 40, z: 200, dx: 0, dz: 1 },
    { x: -HALF - 30, z: 120, dx: 0, dz: -1 },
  ];
  const umbrellaColors = ['#ff5ea8', '#2ad4e0', '#f9d649', '#ffffff', '#ff7a45', '#7c5cff'];
  const umbrellaGeos = [];
  for (let k = 0; k < 30; k++) {
    const x = beachX0 + 40 + rng() * (beachX1 - beachX0 - 60), z = LAND.minZ + 20 + rng() * (LAND.maxZ - LAND.minZ - 40);
    if (Math.abs(z) < 16) continue;
    // keep the run-ups and landing zones of ramps clear
    if (rampDefs.some((r) => Math.abs(x - r.x) < 10 && Math.abs(z - r.z) < 70)) continue;
    const col = umbrellaColors[k % umbrellaColors.length];
    umbrellaGeos.push(
      colorize(new THREE.ConeGeometry(1.6, 0.7, 10).translate(x, 2.4, z), col),
      colorize(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5).translate(x, 1.2, z), '#eeeeee'),
      cbox(0.9, 0.03, 1.9, x + 1.2, 0.02, z + 0.3, umbrellaColors[(k + 2) % 6]),
    );
  }
  addMerged(umbrellaGeos, MAT.vc);
  // lifeguard towers
  const towerGeos = [];
  for (const z of [-200, -20, 160]) {
    const x = beachX1 - 30;
    towerGeos.push(cbox(3, 2.2, 3, x, 3.2, z, '#ffd1dc'), cbox(3.4, 0.25, 3.4, x, 4.4, z, '#ff5ea8'));
    for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) towerGeos.push(cbox(0.2, 2.2, 0.2, x + dx, 1.1, z + dz, '#f5f5f5'));
    towerGeos.push(cbox(1.2, 0.1, 3, x - 2.2, 1.2, z, '#f5f5f5', 0));
    colliders.add({ minX: x - 1.6, maxX: x + 1.6, minZ: z - 1.6, maxZ: z + 1.6, h: 4 });
  }
  addMerged(towerGeos, MAT.vc);

  // ramps on the beach for stunt jumps
  const rampGeos = [];
  for (const r of rampDefs) {
    const len = 14, wid = 6, h = 3.2;
    const g = new THREE.BoxGeometry(wid, h, len);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) < 0) p.setY(i, -h / 2 + 0.02);
    g.computeVertexNormals();
    g.rotateY(Math.atan2(r.dx, r.dz));
    g.translate(r.x + r.dx * len / 2, h / 2, r.z + r.dz * len / 2);
    colorize(g, '#ff8a3d');
    rampGeos.push(g);
    W.ramps.push({ x: r.x, z: r.z, dx: r.dx, dz: r.dz, len, wid, h });
  }
  addMerged(rampGeos, MAT.vc);

  // pier + boat
  const pierLen = PIER.maxX - PIER.minX, pierW = PIER.maxZ - PIER.minZ;
  const woodTex = noiseTexture('#8b6a47', 0.25, 13, 128, 1500);
  woodTex.repeat.set(pierLen / 4, 2);
  const pier = new THREE.Mesh(new THREE.BoxGeometry(pierLen, 0.3, pierW), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.95 }));
  pier.position.set((PIER.minX + PIER.maxX) / 2, PIER.y - 0.15, 0);
  pier.receiveShadow = true;
  pier.castShadow = true;
  scene.add(pier);
  const posts = [];
  for (let x = PIER.minX + 6; x < PIER.maxX; x += 6) for (const z of [PIER.minZ + 0.3, PIER.maxZ - 0.3]) posts.push(cbox(0.35, 2.4, 0.35, x, PIER.y - 1.2, z, '#5b4630'));
  for (let x = PIER.minX + 6; x < PIER.maxX; x += 3) for (const z of [PIER.minZ + 0.2, PIER.maxZ - 0.2]) posts.push(cbox(0.12, 1.1, 0.12, x, PIER.y + 0.55, z, '#e8e8e8'));
  posts.push(cbox(pierLen - 6, 0.1, 0.12, (PIER.minX + PIER.maxX) / 2 + 3, PIER.y + 1.05, PIER.minZ + 0.2, '#e8e8e8'));
  posts.push(cbox(pierLen - 6, 0.1, 0.12, (PIER.minX + PIER.maxX) / 2 + 3, PIER.y + 1.05, PIER.maxZ - 0.2, '#e8e8e8'));
  addMerged(posts, MAT.vc);
  const boat = buildBoat();
  boat.position.set(PIER.maxX - 8, WATER_Y + 0.1, PIER.maxZ + 3.2);
  boat.rotation.y = Math.PI / 2;
  scene.add(boat);
  W.boat = boat;
  W.specials.boat = { x: PIER.maxX - 8, z: PIER.maxZ - 1.5 };
  W.tokenSpots.push([PIER.maxX - 2, 0]);

  // ------------------------------------------------ palms (instanced)
  const pg = palmGeometries();
  const trunkMesh = new THREE.InstancedMesh(pg.trunk, MAT.vc, palmSpots.length);
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const crownMesh = new THREE.InstancedMesh(pg.crown, leafMat, palmSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  palmSpots.forEach(([x, y, z, r], idx) => {
    q.setFromAxisAngle(up, r * Math.PI * 2);
    const s = 0.8 + r * 0.6;
    sc.set(s, s, s);
    pos.set(x, y, z);
    m4.compose(pos, q, sc);
    trunkMesh.setMatrixAt(idx, m4);
    crownMesh.setMatrixAt(idx, m4);
    W.palms.push({ x, z });
  });
  trunkMesh.castShadow = crownMesh.castShadow = true;
  scene.add(trunkMesh, crownMesh);

  // ------------------------------------------------ street lamps (instanced)
  const poleGeo = mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.09, 0.13, 6, 6).translate(0, 3, 0), '#3d4148'),
    cbox(0.1, 0.1, 1.8, 0, 5.95, 0.9, '#3d4148'),
  ]);
  const headGeo = new THREE.BoxGeometry(0.5, 0.16, 0.8).translate(0, 5.85, 1.75);
  const poolGeo = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2).translate(0, 0.06, 2.6);
  const poles = new THREE.InstancedMesh(poleGeo, MAT.vc, lampSpots.length);
  const headMat = new THREE.MeshBasicMaterial({ color: '#555555' });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,200,130,0.85)', 'rgba(255,170,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampSpots.length);
  sc.set(1, 1, 1);
  lampSpots.forEach((l, idx) => {
    q.setFromAxisAngle(up, l.rot);
    pos.set(l.x, CURB, l.z);
    m4.compose(pos, q, sc);
    poles.setMatrixAt(idx, m4);
    heads.setMatrixAt(idx, m4);
    pos.y = 0;
    m4.compose(pos, q, sc);
    pools.setMatrixAt(idx, m4);
  });
  pools.renderOrder = 1;
  poles.castShadow = true;
  scene.add(poles, heads, pools);
  W.lampHeadMat = headMat;
  W.lampPoolMat = poolMat;
  W.lampSpots = lampSpots;

  // ------------------------------------------------ road graph
  const nodes = [];
  for (let i = 0; i <= NB; i++) for (let j = 0; j <= NB; j++) nodes.push({ i, j, x: roadPos(i), z: roadPos(j), id: i * (NB + 1) + j });
  for (const n of nodes) {
    n.nb = [];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = n.i + di, b = n.j + dj;
      if (a >= 0 && a <= NB && b >= 0 && b <= NB) n.nb.push(a * (NB + 1) + b);
    }
  }
  W.nodes = nodes;
  W.nearestNode = (x, z) => {
    const i = clamp(Math.round((x + HALF) / PITCH), 0, NB), j = clamp(Math.round((z + HALF) / PITCH), 0, NB);
    return i * (NB + 1) + j;
  };

  // ------------------------------------------------ queries
  W.groundY = (x, z) => {
    for (const r of W.ramps) {
      const rx = x - r.x, rz = z - r.z;
      const along = rx * r.dx + rz * r.dz;
      if (along < 0 || along > r.len) continue;
      const side = Math.abs(rx * -r.dz + rz * r.dx);
      if (side > r.wid / 2) continue;
      return (r.h * along) / r.len;
    }
    if (x >= PIER.minX && x <= PIER.maxX && z >= PIER.minZ && z <= PIER.maxZ) return PIER.y;
    const lx = x + HALF, lz = z + HALF;
    const i = Math.floor(lx / PITCH), j = Math.floor(lz / PITCH);
    if (i >= 0 && i < NB && j >= 0 && j < NB) {
      const ox = lx - i * PITCH, oz = lz - j * PITCH;
      if (ox > ROAD / 2 && ox < PITCH - ROAD / 2 && oz > ROAD / 2 && oz < PITCH - ROAD / 2) return CURB;
    }
    return 0;
  };
  W.isLand = (x, z) =>
    (x >= LAND.minX + 1 && x <= LAND.maxX - 1 && z >= LAND.minZ + 1 && z <= LAND.maxZ - 1) ||
    (x >= PIER.minX && x <= PIER.maxX - 0.5 && z >= PIER.minZ + 0.6 && z <= PIER.maxZ - 0.6);
  W.onRoad = (x, z) => {
    const lx = x + HALF, lz = z + HALF;
    const ox = ((lx % PITCH) + PITCH) % PITCH, oz = ((lz % PITCH) + PITCH) % PITCH;
    const inside = lx > -ROAD / 2 && lx < HALF * 2 + ROAD / 2 && lz > -ROAD / 2 && lz < HALF * 2 + ROAD / 2;
    return inside && (ox < ROAD / 2 || ox > PITCH - ROAD / 2 || oz < ROAD / 2 || oz > PITCH - ROAD / 2);
  };
  W.blockAt = (x, z) => {
    const i = Math.floor((x + HALF) / PITCH), j = Math.floor((z + HALF) / PITCH);
    if (i < 0 || j < 0 || i >= NB || j >= NB) return null;
    return W.blocks[i * NB + j];
  };
  W.LANE = LANE;
  W.SPECIAL = SPECIAL;
  return W;
}
