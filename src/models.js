import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { cbox, colorize, pick } from './util.js';
import { beamTexture, radialTexture } from './textures.js';

// ---------------------------------------------------------------- materials
export const MAT = {
  vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }),
  human: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  tire: new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3, metalness: 0.8 }),
  lights: new THREE.MeshBasicMaterial({ vertexColors: true }),
  charred: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 1 }),
  sirenRed: new THREE.MeshBasicMaterial({ color: '#ff1a3a' }),
  sirenBlue: new THREE.MeshBasicMaterial({ color: '#2a6bff' }),
  sirenOff: new THREE.MeshBasicMaterial({ color: '#333' }),
  beam: new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  blob: new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
};

// ---------------------------------------------------------------- vehicles
const base = { maxSpeed: 38, accel: 14, brake: 30, grip: 7, turn: 2.1, mass: 1 };
export const CAR_TYPES = {
  sedan: { ...base, name: 'Coral', L: 4.5, W: 1.9, bodyH: 0.62, cabL: 2.3, cabH: 0.58, cabOff: -0.15, wheelR: 0.36 },
  sports: { ...base, name: 'Vortexa GT', L: 4.4, W: 2.0, bodyH: 0.5, cabL: 1.9, cabH: 0.44, cabOff: -0.3, wheelR: 0.36, maxSpeed: 54, accel: 23, grip: 8.5, turn: 2.3, mass: 0.9 },
  suv: { ...base, name: 'Ridgeback', L: 4.8, W: 2.1, bodyH: 0.85, cabL: 2.9, cabH: 0.72, cabOff: -0.3, wheelR: 0.46, maxSpeed: 35, accel: 12.5, grip: 6.2, turn: 1.85, mass: 1.5 },
  taxi: { ...base, name: 'Solano Cab', L: 4.6, W: 1.9, bodyH: 0.62, cabL: 2.3, cabH: 0.58, cabOff: -0.15, wheelR: 0.36, maxSpeed: 37 },
  police: { ...base, name: 'Patrol', L: 4.7, W: 1.95, bodyH: 0.62, cabL: 2.3, cabH: 0.58, cabOff: -0.2, wheelR: 0.37, maxSpeed: 47, accel: 19, grip: 8.2, turn: 2.2, mass: 1.25 },
  van: { ...base, name: 'Hauler', L: 5.2, W: 2.1, bodyH: 1.0, cabL: 4.1, cabH: 1.0, cabOff: -0.4, wheelR: 0.42, maxSpeed: 31, accel: 10, grip: 6, turn: 1.7, mass: 1.8 },
};

const GLASS = '#18222e';

function taperTop(geo, zScale, xScale) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setZ(i, p.getZ(i) * zScale);
      p.setX(i, p.getX(i) * xScale);
    }
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function carBodyGeometry(type, color) {
  const s = CAR_TYPES[type];
  const lift = s.wheelR * 0.8;
  const top = lift + s.bodyH;
  const parts = [];
  // lower body, slightly tapered at the top for a softer silhouette
  parts.push(taperTop(colorize(new THREE.BoxGeometry(s.W, s.bodyH, s.L), color), 0.97, 0.96).translate(0, lift + s.bodyH / 2, 0));
  // bumpers + skirts
  parts.push(cbox(s.W * 1.0, 0.24, 0.28, 0, lift + 0.12, s.L / 2 + 0.05, '#202226'));
  parts.push(cbox(s.W * 1.0, 0.24, 0.28, 0, lift + 0.12, -s.L / 2 - 0.05, '#202226'));
  parts.push(cbox(s.W * 1.02, 0.14, s.L * 0.6, 0, lift + 0.07, 0, '#202226'));
  if (type === 'van') {
    const cab = colorize(new THREE.BoxGeometry(s.W * 0.96, s.cabH, s.cabL), color);
    taperTop(cab, 0.96, 0.98);
    cab.translate(0, top + s.cabH / 2, s.cabOff);
    parts.push(cab);
    parts.push(cbox(s.W * 0.9, s.cabH * 0.55, 0.06, 0, top + s.cabH * 0.55, s.cabOff + s.cabL / 2 + 0.01, GLASS));
    parts.push(cbox(s.W * 0.98, s.cabH * 0.35, 1.0, 0, top + s.cabH * 0.6, s.cabOff + s.cabL / 2 - 0.6, GLASS));
  } else {
    const cab = colorize(new THREE.BoxGeometry(s.W * 0.86, s.cabH, s.cabL), GLASS);
    taperTop(cab, type === 'sports' ? 0.62 : 0.74, 0.9);
    cab.translate(0, top + s.cabH / 2, s.cabOff);
    parts.push(cab);
    // roof panel in body colour
    parts.push(cbox(s.W * 0.76, 0.05, s.cabL * (type === 'sports' ? 0.55 : 0.68), 0, top + s.cabH + 0.02, s.cabOff, color));
    // pillars between windows
    parts.push(cbox(s.W * 0.87, s.cabH * 0.9, 0.12, 0, top + s.cabH * 0.45, s.cabOff, color));
  }
  if (type === 'sports') {
    parts.push(cbox(s.W * 0.9, 0.06, 0.4, 0, top + 0.32, -s.L / 2 + 0.25, '#111'));
    parts.push(cbox(0.08, 0.28, 0.2, s.W * 0.35, top + 0.15, -s.L / 2 + 0.25, '#111'));
    parts.push(cbox(0.08, 0.28, 0.2, -s.W * 0.35, top + 0.15, -s.L / 2 + 0.25, '#111'));
    parts.push(cbox(0.3, 0.02, s.L * 0.98, 0, top + 0.005, 0, '#111'));
  }
  if (type === 'taxi') {
    parts.push(cbox(0.9, 0.24, 0.35, 0, top + s.cabH + 0.15, s.cabOff, '#fff6c2'));
    parts.push(cbox(s.W * 1.005, 0.12, s.L * 0.8, 0, lift + s.bodyH * 0.55, 0, '#1b1b1b'));
  }
  if (type === 'police') {
    parts.push(cbox(s.W * 1.005, s.bodyH * 0.5, s.L * 0.42, 0, lift + s.bodyH * 0.5, -0.1, '#f2f2f2'));
    parts.push(cbox(1.2, 0.08, 0.3, 0, top + s.cabH + 0.04, s.cabOff, '#222'));
  }
  return mergeGeometries(parts);
}

function carLightsGeometry(type) {
  const s = CAR_TYPES[type];
  const lift = s.wheelR * 0.8;
  const y = lift + s.bodyH * 0.62;
  return mergeGeometries([
    cbox(0.42, 0.16, 0.06, s.W * 0.33, y, s.L / 2 + 0.01, '#fff6d6'),
    cbox(0.42, 0.16, 0.06, -s.W * 0.33, y, s.L / 2 + 0.01, '#fff6d6'),
    cbox(0.46, 0.14, 0.06, s.W * 0.34, y, -s.L / 2 - 0.01, '#ff1830'),
    cbox(0.46, 0.14, 0.06, -s.W * 0.34, y, -s.L / 2 - 0.01, '#ff1830'),
  ]);
}

// One merged mesh per wheel: dark tyre plus a six-sided silver hub so spin is visible.
const wheelGeoCache = new Map();
function wheelGeo(r) {
  if (!wheelGeoCache.has(r)) {
    const tire = colorize(new THREE.CylinderGeometry(r, r, 0.3, 14), '#16171a');
    const hub = colorize(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 6), '#c9ccd1');
    const g = mergeGeometries([tire, hub]);
    g.rotateZ(Math.PI / 2);
    wheelGeoCache.set(r, g);
  }
  return wheelGeoCache.get(r);
}

const bodyGeoCache = new Map();
const lightGeoCache = new Map();

export function repaintCar(model, type, color) {
  const key = type + color;
  if (!bodyGeoCache.has(key)) bodyGeoCache.set(key, carBodyGeometry(type, color));
  model.body.geometry = bodyGeoCache.get(key);
  model.body.material = MAT.vc;
  model.lights.visible = true;
}
const beamGeo = new THREE.PlaneGeometry(5, 11).rotateX(-Math.PI / 2);
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export function buildCar(type, color) {
  const s = CAR_TYPES[type];
  const key = type + color;
  if (!bodyGeoCache.has(key)) bodyGeoCache.set(key, carBodyGeometry(type, color));
  if (!lightGeoCache.has(type)) lightGeoCache.set(type, carLightsGeometry(type));
  const root = new THREE.Group();
  const tilt = new THREE.Group(); // receives pitch/roll
  root.add(tilt);
  const body = new THREE.Mesh(bodyGeoCache.get(key), MAT.vc);
  body.castShadow = true;
  tilt.add(body);
  const lights = new THREE.Mesh(lightGeoCache.get(type), MAT.lights);
  tilt.add(lights);
  const wg = wheelGeo(s.wheelR);
  const wheels = [];
  const wx = s.W / 2 - 0.12, wz = s.L / 2 - s.wheelR - 0.35;
  for (const [x, z, front] of [[wx, wz, 1], [-wx, wz, 1], [wx, -wz, 0], [-wx, -wz, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, s.wheelR, z);
    const spin = new THREE.Mesh(wg, MAT.vc);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin, front: !!front });
  }
  const beam = new THREE.Mesh(beamGeo, MAT.beam);
  beam.position.set(0, 0.05, s.L / 2 + 5.4);
  beam.renderOrder = 2;
  root.add(beam);
  const blob = new THREE.Mesh(blobGeo, MAT.blob);
  blob.scale.set(s.W * 1.5, 1, s.L * 1.25);
  blob.position.y = 0.04;
  root.add(blob);
  let siren = null;
  if (type === 'police') {
    const top = s.wheelR * 0.8 + s.bodyH + s.cabH + 0.13;
    const sg = new THREE.BoxGeometry(0.5, 0.14, 0.24);
    const red = new THREE.Mesh(sg, MAT.sirenOff);
    const blue = new THREE.Mesh(sg, MAT.sirenOff);
    red.position.set(-0.3, top, s.cabOff);
    blue.position.set(0.3, top, s.cabOff);
    tilt.add(red, blue);
    siren = { red, blue };
  }
  return { root, tilt, body, lights, wheels, beam, siren };
}

// ---------------------------------------------------------------- humans
const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#9c6644', '#7a4b2e', '#5a3622'];
const SHIRT = ['#ff5ea8', '#2ad4e0', '#f9d649', '#ffffff', '#ff7a45', '#7c5cff', '#34d399', '#f43f5e', '#60a5fa', '#fca5a5', '#1f2937', '#fb923c'];
const PANTS = ['#1e293b', '#334155', '#e5e7eb', '#a16207', '#1d4ed8', '#111827', '#d6c7a1', '#4b5563'];
const HAIR = ['#1a1310', '#3b2618', '#6b4423', '#c9a36b', '#e8d4a8', '#2b2b2b', '#7c2d12'];

export function randomLook() {
  return { skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS), hair: pick(HAIR), shoes: pick(['#111', '#f5f5f5', '#7f1d1d', '#1f2937']), shades: Math.random() < 0.25, bald: Math.random() < 0.1 };
}

export function buildHuman(look, scale = 1) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);
  const torsoParts = [
    cbox(0.5, 0.6, 0.28, 0, 0.3, 0, look.shirt),
    cbox(0.46, 0.12, 0.26, 0, 0.02, 0, look.pants),
    cbox(0.14, 0.08, 0.14, 0, 0.64, 0, look.skin),
    cbox(0.26, 0.3, 0.27, 0, 0.82, 0, look.skin),
  ];
  if (!look.bald) {
    torsoParts.push(cbox(0.28, 0.09, 0.29, 0, 0.99, -0.005, look.hair));
    torsoParts.push(cbox(0.28, 0.2, 0.06, 0, 0.88, -0.13, look.hair));
  }
  if (look.shades) torsoParts.push(cbox(0.24, 0.06, 0.03, 0, 0.86, 0.14, '#0b0b0b'));
  else {
    torsoParts.push(cbox(0.04, 0.04, 0.02, 0.06, 0.86, 0.135, '#1b1b1b'));
    torsoParts.push(cbox(0.04, 0.04, 0.02, -0.06, 0.86, 0.135, '#1b1b1b'));
  }
  const torso = new THREE.Mesh(mergeGeometries(torsoParts), MAT.human);
  hips.add(torso);
  const legGeo = mergeGeometries([cbox(0.19, 0.84, 0.21, 0, -0.42, 0, look.pants), cbox(0.2, 0.1, 0.3, 0, -0.87, 0.04, look.shoes)]);
  const armGeo = mergeGeometries([cbox(0.13, 0.3, 0.15, 0, -0.14, 0, look.shirt), cbox(0.11, 0.34, 0.12, 0, -0.44, 0, look.skin)]);
  const mk = (geo, x, y) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    p.add(new THREE.Mesh(geo, MAT.human));
    hips.add(p);
    return p;
  };
  const legL = mk(legGeo, 0.12, 0);
  const legR = mk(legGeo, -0.12, 0);
  const armL = mk(armGeo, 0.32, 0.56);
  const armR = mk(armGeo, -0.32, 0.56);
  const blob = new THREE.Mesh(blobGeo, MAT.blob);
  blob.scale.set(0.9, 1, 0.9);
  blob.position.y = 0.03;
  root.add(blob);
  root.scale.setScalar(scale);
  return { root, hips, torso, legL, legR, armL, armR, blob };
}

// Walk/run cycle. amount 0..1 blends idle → full stride.
export function animateHuman(m, phase, amount, punch = 0) {
  const sw = Math.sin(phase) * 0.75 * amount;
  m.legL.rotation.x = sw;
  m.legR.rotation.x = -sw;
  m.armL.rotation.x = -sw * 0.9;
  m.armR.rotation.x = sw * 0.9;
  m.armL.rotation.z = 0.08;
  m.armR.rotation.z = -0.08;
  m.hips.position.y = 0.92 + Math.abs(Math.cos(phase)) * 0.05 * amount;
  m.torso.rotation.x = amount * 0.08;
  if (punch > 0) {
    const k = Math.sin(punch * Math.PI);
    m.armR.rotation.x = -1.6 * k;
    m.armR.rotation.z = -0.1;
    m.torso.rotation.y = -0.35 * k;
  } else m.torso.rotation.y = 0;
}

// ---------------------------------------------------------------- helicopter
export function buildHeli() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(mergeGeometries([
    taperTop(colorize(new THREE.BoxGeometry(2.2, 1.9, 4.2), '#15171c'), 0.8, 0.9).translate(0, 1.6, 0),
    cbox(2.0, 1.0, 1.4, 0, 1.9, 1.7, '#1b2a3a'),
    cbox(2.25, 0.5, 2.6, 0, 1.05, -0.2, '#f2f2f2'),
    cbox(0.4, 0.45, 4.6, 0, 2.0, -4.0, '#15171c'),
    cbox(0.12, 1.3, 0.8, 0, 2.5, -6.0, '#15171c'),
    cbox(0.12, 0.12, 3.4, 0.9, 0.3, 0, '#333'),
    cbox(0.12, 0.12, 3.4, -0.9, 0.3, 0, '#333'),
    cbox(0.1, 0.5, 0.1, 0.9, 0.55, 1.0, '#333'),
    cbox(0.1, 0.5, 0.1, -0.9, 0.55, 1.0, '#333'),
    cbox(0.1, 0.5, 0.1, 0.9, 0.55, -1.0, '#333'),
    cbox(0.1, 0.5, 0.1, -0.9, 0.55, -1.0, '#333'),
  ]), MAT.vc);
  body.castShadow = true;
  root.add(body);
  const rotor = new THREE.Mesh(mergeGeometries([cbox(11, 0.06, 0.4, 0, 0, 0, '#222'), cbox(0.4, 0.06, 11, 0, 0, 0, '#222')]), MAT.vc);
  rotor.position.y = 2.75;
  root.add(rotor);
  const tail = new THREE.Mesh(cbox(0.06, 2.0, 0.25, 0, 0, 0, '#222'), MAT.vc);
  tail.position.set(0.15, 2.6, -6.0);
  root.add(tail);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), MAT.sirenRed);
  red.position.set(0, 0.8, 1.2);
  root.add(red);
  return { root, rotor, tail, red };
}

// ---------------------------------------------------------------- boat
export function buildBoat() {
  const hull = colorize(new THREE.BoxGeometry(3.2, 1.2, 9), '#f5f5f5');
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > 0) p.setX(i, p.getX(i) * (p.getY(i) > 0 ? 0.55 : 0.15));
    if (p.getY(i) < 0) p.setX(i, p.getX(i) * 0.7);
  }
  hull.computeVertexNormals();
  hull.translate(0, 0.4, 0);
  const g = mergeGeometries([
    hull,
    cbox(2.4, 0.9, 3, 0, 1.45, -1.2, '#e2e8f0'),
    cbox(2.3, 0.5, 0.1, 0, 1.6, 0.31, GLASS),
    cbox(3.25, 0.18, 9, 0, 0.55, 0, '#ff3fa4'),
  ]);
  const m = new THREE.Mesh(g, MAT.vc);
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------- palms
export function palmGeometries() {
  const h = 7.5, bend = 1.1;
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, h, 7, 8);
  trunk.translate(0, h / 2, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i) / h;
    tp.setX(i, tp.getX(i) + y * y * bend);
  }
  trunk.computeVertexNormals();
  colorize(trunk, '#8a6a48');
  const leaves = [];
  for (let k = 0; k < 9; k++) {
    const leaf = new THREE.PlaneGeometry(3.6, 0.9, 6, 1);
    const lp = leaf.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i) + 1.8; // 0..3.6 along the leaf
      const w = Math.sin((x / 3.6) * Math.PI) * 0.5 + 0.1;
      lp.setY(i, lp.getY(i) * w * 1.6);
      lp.setX(i, x);
      lp.setZ(i, -(x / 3.6) * (x / 3.6) * 1.6);
    }
    leaf.rotateX(-Math.PI / 2 + 0.15);
    leaf.rotateY((k / 9) * Math.PI * 2 + (k % 2) * 0.2);
    leaf.computeVertexNormals();
    colorize(leaf, k % 2 ? '#2f8f4e' : '#3ba55c');
    leaves.push(leaf);
  }
  leaves.push(colorize(new THREE.SphereGeometry(0.35, 6, 4), '#5b4630'));
  const crown = mergeGeometries(leaves);
  crown.translate(bend, h, 0);
  return { trunk, crown };
}
