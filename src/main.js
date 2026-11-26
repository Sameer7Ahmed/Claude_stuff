import * as THREE from '../vendor/three.module.min.js';
import { setMaxAnisotropy } from './textures.js';
import { buildWorld, circleVsBoxes } from './world.js';
import { Environment } from './env.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Wanted } from './wanted.js';
import { Pickups, Marker } from './pickups.js';
import { HUD } from './hud.js';
import { Missions } from './missions.js';
import { Ped, updatePeds, respawnPed, carVsHumans } from './peds.js';
import { collideVehicles, Vehicle } from './vehicle.js';
import { initTraffic, manageTraffic, spawnParked } from './traffic.js';
import { repaintCar } from './models.js';
import { CAR_COLORS } from './config.js';
import { pick, rand, seededRandom } from './util.js';

const SAVE_KEY = 'neon-tides-save-v1';
const canvas = document.getElementById('game');
const input = new Input(canvas);
const lowEnd = input.isTouch;
const quality = {
  shadows: true,
  shadowSize: lowEnd ? 1024 : 2048,
  pixelRatio: Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 1.75),
  peds: lowEnd ? 22 : 34,
  traffic: lowEnd ? 18 : 28,
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowEnd, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality.pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1900);

// ------------------------------------------------------------------ game state
const G = {
  scene, camera, renderer, input,
  time: 0, money: 0,
  vehicles: [], peds: [],
  tokens: new Set(), tokenTotal: 0,
  lastCar: null,
  started: false, paused: false,
  sequence: null,
  circleVsBoxes,
};
window.__G = G; // handy for debugging in the console

G.world = buildWorld(scene, quality);
G.env = new Environment(scene, quality);
G.effects = new Effects(scene);
G.audio = new AudioSys();
G.player = new Player(G);
G.cam = new CameraRig(G, camera);
G.wanted = new Wanted(G);
G.pickups = new Pickups(G);
G.hud = new HUD(G);
G.missions = new Missions(G);
G.paintMarker = new Marker(G, '#ff3fa4', 6, 10);
G.paintMarker.show(G.world.specials.paint.x, G.world.specials.paint.z);
G.paintCooldown = 0;
G.audio.onStation = (name) => G.hud.radio(name);

// ------------------------------------------------------------------ helpers
G.notify = (text, dur) => G.hud.notify(text, dur);
G.shake = (a) => G.cam.shake(a);
G.addMoney = (n) => { G.money = Math.max(0, G.money + n); };

G.save = () => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ money: G.money, mission: G.missions.index, tokens: [...G.tokens] }));
  } catch { /* storage unavailable: progress lasts for this session only */ }
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!s) return false;
    G.money = s.money || 0;
    G.hud.shownMoney = G.money;
    G.missions.index = Math.min(s.mission || 0, G.missions.list.length);
    for (const t of s.tokens || []) G.tokens.add(t);
    return true;
  } catch { return false; }
}

G.panic = (x, z, r, byPlayer) => {
  for (const p of G.peds) {
    if (!p.active || p.state === 'down') continue;
    if (Math.hypot(p.x - x, p.z - z) < r) p.flee(x, z);
  }
  void byPlayer;
};

G.onCarCrash = (A, B, imp) => {
  const pv = G.player.vehicle;
  if (!pv || (A !== pv && B !== pv)) return;
  const other = A === pv ? B : A;
  // only count it as the player's fault when the player drove into the other car
  const dx = other.x - pv.x, dz = other.z - pv.z, d = Math.hypot(dx, dz) || 1;
  const closing = (pv.vx * dx + pv.vz * dz) / d;
  if (closing < 4) return;
  other.playerTouched = G.time;
  if (other.isPolice && other.driver === 'ai') G.wanted.crime(0.5, other.x, other.z);
  else if (other.driver === 'ai' && imp > 10) G.wanted.crime(0.12, other.x, other.z);
};

G.explosion = (x, y, z, src) => {
  G.effects.explosion(x, y, z);
  const P = G.player.pos;
  const d = Math.hypot(P.x - x, P.z - z);
  if (d < 120) G.audio.explosion();
  G.shake(Math.max(0, 1 - d / 60));
  for (const v of G.vehicles) {
    if (v === src) continue;
    const dv = Math.hypot(v.x - x, v.z - z);
    if (dv < 9) {
      v.damage(70 * (1 - dv / 9));
      const k = (1 - dv / 9) * 10 / (dv || 1);
      v.vx += (v.x - x) * k; v.vz += (v.z - z) * k;
    }
  }
  for (const p of G.peds) {
    const dp = Math.hypot(p.x - x, p.z - z);
    if (dp < 10) p.knock((p.x - x) / (dp || 1) * 8, (p.z - z) / (dp || 1) * 8, 6, false);
    else if (dp < 40) p.flee(x, z);
  }
  if (!G.player.vehicle && d < 8) {
    G.player.damage(75 * (1 - d / 8));
    G.player.downT = 1.8;
    G.player.vy = 5;
  }
  const playerFault = src && (src.driver === 'player' || src === G.lastCar || G.time - (src.playerTouched || -99) < 12);
  if (playerFault) G.wanted.crime(src.isPolice ? 2 : 1, x, z, true);
};

G.onStunt = (air) => {
  const bonus = Math.round((air * 140) / 10) * 10;
  G.addMoney(bonus);
  G.hud.big('STUNT', `${air.toFixed(1)}s airtime  +$${bonus}`, 2.2);
  G.audio.checkpoint();
};

G.ejectDriver = (v) => {
  const P = G.player;
  let far = G.peds[0], fd = -1;
  for (const p of G.peds) {
    const d = Math.hypot(p.x - P.x, p.z - P.z);
    if (d > fd && p.state !== 'down') { fd = d; far = p; }
  }
  if (!far) return;
  const lx = Math.cos(v.h), lz = -Math.sin(v.h);
  const blk = G.world.blockAt(v.x, v.z) || G.world.blocks[24];
  far.spawnAt(blk.i, blk.j);
  far.x = v.x + lx * (v.spec.W / 2 + 0.7);
  far.z = v.z + lz * (v.spec.W / 2 + 0.7);
  far.knock(lx * 3, lz * 3, 2, false);
  far.timer = 1.2;
};

G.releaseVehicleAI = (v) => {
  v.ai = null;
  v.sirenOn = false;
  v.traffic = false;
  v.despawnable = false;
  G.lastCar = v;
};

G.collectToken = (id) => {
  G.tokens.add(id);
  G.addMoney(250);
  if (G.tokens.size >= G.tokenTotal) {
    G.addMoney(5000);
    G.hud.big('ALL NEON SHELLS FOUND', '+$5,250', 4);
  } else G.notify(`Neon shell ${G.tokens.size}/${G.tokenTotal}  +$250`, 2.5);
  G.save();
};

function respawn(kind) {
  const P = G.player;
  if (P.vehicle) P.exitVehicle(true);
  const S = G.world.specials;
  const spot = kind === 'hospital' ? S.hospital : S.police;
  const fee = kind === 'hospital' ? Math.min(G.money, 250) : Math.min(G.money, Math.max(100, Math.round(G.money * 0.1)));
  G.money -= fee;
  G.wanted.clear();
  P.place(spot.x, spot.z, 0);
  P.health = 100;
  P.alive = true;
  P.model.root.visible = true;
  G.cam.first = true;
  G.cam.yaw = 0;
  G.notify(fee ? `Fee: $${fee}` : 'Back on your feet.', 3);
  G.save();
}

function startSequence(kind) {
  if (G.sequence) return;
  G.player.alive = false;
  G.missions.fail(kind === 'hospital' ? 'You were hospitalized.' : 'You were arrested.');
  G.hud.big(kind === 'hospital' ? 'HOSPITALIZED' : 'ARRESTED', '', 3);
  G.sequence = { kind, t: 0, done: false };
}
G.onPlayerDown = () => startSequence('hospital');
G.onBusted = () => {
  const v = G.player.vehicle;
  if (v) { v.vx = v.vz = 0; }
  startSequence('police');
};
G.onWantedLost = () => {};

function updateSequence(dt) {
  const S = G.sequence;
  if (!S) return;
  S.t += dt;
  if (S.t > 2.2 && !S.faded) { S.faded = true; G.hud.fade(true); }
  if (S.t > 3.0 && !S.done) { S.done = true; respawn(S.kind); }
  if (S.t > 3.4) { G.hud.fade(false); G.sequence = null; }
}

// Paint & Pay: repaint, repair and lose the heat.
function updatePaintShop(dt) {
  G.paintMarker.update(dt);
  G.paintCooldown -= dt;
  const v = G.player.vehicle;
  const S = G.world.specials.paint;
  const inside = v && Math.hypot(v.x - S.x, v.z - S.z) < 7;
  if (!inside) { G.paintInside = false; return; }
  if (G.paintInside || G.paintCooldown > 0) return;
  const cost = G.missions.active && G.missions.index === 0 ? 0 : 150;
  if (v.speed > 6) { G.hud.prompt('Slow down to use <b>Paint &amp; Pay</b>'); return; }
  G.paintInside = true;
  if (G.money < cost) { G.notify(`Paint & Pay costs $${cost}. Come back with cash.`, 2.5); return; }
  G.money -= cost;
  let color = pick(CAR_COLORS);
  while (color === v.color) color = pick(CAR_COLORS);
  if (v.type !== 'taxi' && v.type !== 'police') { v.color = color; repaintCar(v.model, v.type, color); }
  v.health = 100;
  v.fireT = 0;
  const hadHeat = G.wanted.stars > 0;
  G.wanted.clear();
  G.audio.spray();
  G.effects.sparkle(v.x, v.y + 1.5, v.z, '#ff3fa4', 30);
  G.hud.big('PAINT & PAY', `${cost ? `-$${cost}  ` : ''}${hadHeat ? 'Heat cleared' : 'Fresh paint, fully repaired'}`, 2.5);
  G.paintCooldown = 3;
}

function contextPrompt() {
  const P = G.player;
  if (!P.alive || G.sequence) return '';
  if (P.vehicle) return '';
  const v = P.nearestVehicle();
  if (!v) return '';
  const key = input.isTouch ? 'ENTER' : 'F';
  return `<kbd>${key}</kbd> ${v.driver === 'ai' ? 'Steal' : 'Enter'} ${v.spec.name}`;
}

// ------------------------------------------------------------------ population
function populate() {
  const rng = seededRandom(4242);
  // start next to Dex's motel with a fast car at the kerb
  G.player.place(271.2, 170.5, Math.PI / 2);
  const starter = new Vehicle(G, 'sports', '#ff3fa4', 273.4, 168, 0);
  G.vehicles.push(starter);
  G.lastCar = starter;
  spawnParked(G);
  initTraffic(G, quality.traffic);
  for (let i = 0; i < quality.peds; i++) {
    const p = new Ped(G);
    G.peds.push(p);
    respawnPed(G, p, true);
  }
  // neon shells (hidden collectibles)
  const spots = [...G.world.tokenSpots];
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const chosen = spots.filter(([x, z]) => !G.world.colliders.pointBlocked(x, z, 0.6)).slice(0, 12);
  G.tokenTotal = chosen.length;
  chosen.forEach(([x, z], id) => { if (!G.tokens.has(id)) G.pickups.add('token', x, z, { id }); });
  const S = G.world.specials;
  G.pickups.add('health', S.hospital.x + 4, S.hospital.z);
  for (const b of G.world.blocks) if (b.type === 'park') G.pickups.add('health', b.cx + 6, b.cz - 6);
}

// ------------------------------------------------------------------ main loop
let trafficT = 0;
function step(dt) {
  G.time += dt;
  const P = G.player;
  if (input.hit('KeyM') || input.touch.map) G.hud.toggleMap();
  if (input.hit('KeyN')) G.notify(G.audio.toggleMute() ? 'Sound off' : 'Sound on', 1.2);
  if (G.hud.mapOpen) return;

  P.update(dt);
  for (const v of G.vehicles) if (v.ai && v.driver === 'ai') v.ai.update(dt);
  const n = Math.max(1, Math.ceil(dt / (1 / 60)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    for (const v of G.vehicles) v.update(h);
    collideVehicles(G);
  }
  carVsHumans(G);
  updatePeds(G, dt);
  G.wanted.update(dt);
  updatePaintShop(dt); // before missions so the free first-mission respray still sees the mission as active
  G.missions.update(dt);
  G.pickups.update(dt);
  trafficT -= dt;
  if (trafficT <= 0) { trafficT = 0.5; manageTraffic(G, quality.traffic); }
  updateSequence(dt);
  G.effects.update(dt);
  G.cam.update(dt);
  G.effects.setScale(window.innerHeight * renderer.getPixelRatio(), camera.fov);
  G.env.update(dt, P.pos, camera, G.world);
  renderer.toneMappingExposure = 1.05 + G.env.night * 0.5;
  const cp = camera.position;
  for (const v of G.vehicles) {
    v.model.root.visible = Math.abs(v.x - cp.x) + Math.abs(v.z - cp.z) < 420;
    v.sync(dt, G.env.night, G.time);
  }
  const pv = P.vehicle;
  G.audio.update(dt, pv, pv ? Math.min(1, Math.abs(pv.fwdSpeed) / pv.spec.maxSpeed) : 0, pv ? pv.ctrl.throttle : 0, pv && pv.onGround ? pv.slip : 0);
  G.hud.prompt(contextPrompt());
  G.hud.update(dt);
}

// Advance the simulation without rendering (used by automated tests).
G.debugStep = (seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) { step(dt); input.endFrame(); }
};

let menuT = 0;
function menuStep(dt) {
  menuT += dt;
  G.time += dt;
  for (const v of G.vehicles) if (v.ai && v.driver === 'ai') v.ai.update(dt);
  for (const v of G.vehicles) v.update(dt);
  collideVehicles(G);
  updatePeds(G, dt);
  G.effects.update(dt);
  G.cam.orbit(menuT);
  G.env.update(dt, { x: 0, z: 0 }, camera, G.world);
  for (const v of G.vehicles) v.sync(dt, G.env.night, G.time);
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.max(0.0001, (now - last) / 1000);
  const dt = Math.min(0.05, real);
  last = now;
  if (!G.started) menuStep(dt);
  else if (!G.paused) step(dt);
  input.endFrame();
  renderer.render(scene, camera);
  fpsAcc += Math.min(real, 1); fpsN++;
  if (fpsAcc > 1) { G.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}

// ------------------------------------------------------------------ UI wiring
const menu = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const hudEl = document.getElementById('hud');

function startGame() {
  G.audio.init();
  menu.hidden = true;
  hudEl.hidden = false;
  if (input.isTouch) {
    document.body.classList.add('touch');
    input.setupTouch(document.getElementById('touch'));
  }
  G.started = true;
  G.paused = false;
  G.cam.first = true;
  G.cam.yaw = Math.PI / 2;
  input.requestLock();
  if (!G.missions.done) G.notify(G.missions.index === 0 ? 'Meet Dex at the blue marker by the Seabreeze Motel.' : 'Welcome back. Dex has more work for you.', 4);
}
function pause(on) {
  if (!G.started) return;
  G.paused = on;
  pauseEl.hidden = !on;
  if (!on) { input.requestLock(); last = performance.now(); }
}

document.getElementById('play').addEventListener('click', startGame);
document.getElementById('resume').addEventListener('click', () => pause(false));
document.getElementById('reset').addEventListener('click', () => {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  location.reload();
});
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) hadLock = true;
  else if (hadLock && G.started && !G.paused && !G.hud.mapOpen) pause(true);
});
canvas.addEventListener('click', () => { if (G.started && !G.paused && !input.locked) input.requestLock(); });
window.addEventListener('keydown', (e) => {
  if (!G.started) { if (e.code === 'Enter') startGame(); return; }
  if (e.code === 'KeyP' || (e.code === 'Escape' && !input.locked)) pause(!G.paused);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G.started) pause(true); });
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  G.effects.setScale(window.innerHeight * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', onResize);

const hasSave = load();
if (hasSave) document.getElementById('play').textContent = 'CONTINUE';
populate();
onResize();
requestAnimationFrame(frame);
document.body.classList.add('ready');
void rand;
