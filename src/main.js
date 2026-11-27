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
import { Ped, updatePeds, respawnPed, carVsHumans, nearestRing } from './peds.js';
import { collideVehicles, Vehicle } from './vehicle.js';
import { initTraffic, manageTraffic, spawnParked } from './traffic.js';
import { Arsenal, WEAPONS } from './weapons.js';
import { Interiors } from './interiors.js';
import { Economy } from './economy.js';
import { Heist } from './heist.js';
import { UI } from './ui.js';
import { Interactions } from './interact.js';
import { GPS } from './gps.js';
import { Guide } from './guide.js';
import { Phone } from './phone.js';
import { rand, randi, seededRandom } from './util.js';

const SAVE_KEY = 'neon-tides-save-v3';
const V2_SAVE_KEY = 'neon-tides-save-v2';
const OLD_SAVE_KEY = 'neon-tides-save-v1';
// story order in earlier versions, used to migrate saves to mission ids
const V2_ORDER = ['fresh-coat', 'cold-delivery', 'coastline-sprint', 'iron-lesson', 'turn-up-heat', 'solano-job'];
const V1_ORDER = ['fresh-coat', 'cold-delivery', 'coastline-sprint', 'turn-up-heat'];
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

// root holds lights, effects, the player and interiors; `outdoor` holds the city and is
// hidden while you're inside a building (lights stay put so shaders never recompile).
const root = new THREE.Scene();
const outdoor = new THREE.Group();
root.add(outdoor);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1900);

// ------------------------------------------------------------------ game state
const G = {
  root, scene: outdoor, camera, renderer, input,
  time: 0, money: 0,
  vehicles: [], peds: [], npcs: [],
  tokens: new Set(), tokenTotal: 0,
  lastCar: null,
  started: false, paused: false,
  sequence: null, transitioning: false,
  worldInteractables: [],
  circleVsBoxes,
};
window.__G = G; // handy for debugging in the console

G.world = buildWorld(outdoor, quality);
G.env = new Environment(root, quality, G.world);
G.effects = new Effects(root);
G.audio = new AudioSys();
G.arsenal = new Arsenal();
G.player = new Player(G);
G.cam = new CameraRig(G, camera);
G.wanted = new Wanted(G);
G.pickups = new Pickups(G);
G.interiors = new Interiors(G);
G.economy = new Economy(G);
G.heist = new Heist(G);
G.hud = new HUD(G);
G.missions = new Missions(G);
G.ui = new UI(G);
G.interact = new Interactions(G);
G.guide = new Guide(G);
G.gps = new GPS(G);
G.phone = new Phone(G);
G.economy.attach();
G.heist.attach();
G.paintMarker = new Marker(G, '#ff3fa4', 6, 10);
G.paintMarker.show(G.world.specials.paint.x, G.world.specials.paint.z);
G.chopMarker = new Marker(G, '#29e7ff', 5, 10);
G.chopMarker.show(G.world.specials.chop.x, G.world.specials.chop.z);
G.audio.onStation = (name) => G.hud.radio(name);

// ------------------------------------------------------------------ helpers
G.notify = (text, dur) => G.hud.notify(text, dur);
G.shake = (a) => G.cam.shake(a);
G.weaponName = (id) => WEAPONS[id].name;
G.addMoney = (n) => {
  if (!n) return;
  G.money = Math.max(0, G.money + n);
  G.hud.moneyDelta(n);
};
G.spend = (n) => {
  if (n <= 0) return true;
  if (G.money < n) return false;
  G.money -= n;
  G.hud.moneyDelta(-n);
  return true;
};
G.removeVehicle = (v) => {
  v.dispose();
  const i = G.vehicles.indexOf(v);
  if (i >= 0) G.vehicles.splice(i, 1);
  if (G.lastCar === v) G.lastCar = null;
};
// fade to black, run fn while the screen is dark, fade back in
G.transition = (fn, hold = 0.45) => {
  if (G.transitioning) return;
  G.transitioning = { t: 0, fn, hold, done: false };
  G.hud.fade(true);
};
function updateTransition(dt) {
  const T = G.transitioning;
  if (!T) return;
  T.t += dt;
  if (!T.done && T.t >= T.hold) { T.done = true; T.fn(); }
  if (T.t >= T.hold + 0.15) { G.hud.fade(false); G.transitioning = false; }
}

G.save = () => {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: G.money, completed: [...G.missions.completed], tokens: [...G.tokens],
      arsenal: G.arsenal.save(), armor: Math.round(G.player.armor),
      economy: G.economy.save(), heist: { successes: G.heist.successes }, guide: G.guide.save(),
    }));
  } catch { /* storage unavailable: progress lasts for this session only */ }
};
function load() {
  try {
    const s3 = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    const s2 = s3 ? null : JSON.parse(localStorage.getItem(V2_SAVE_KEY) || 'null');
    const s = s3 || s2;
    if (s) {
      G.money = s.money || 0;
      const done = s3 ? s3.completed || [] : V2_ORDER.slice(0, s2.mission || 0);
      G.missions.completed = new Set(done.filter((id) => G.missions.list.some((m) => m.id === id)));
      G.guide.load(s.guide);
      for (const t of s.tokens || []) G.tokens.add(t);
      G.arsenal.load(s.arsenal);
      G.player.armor = s.armor || 0;
      G.economy.load(s.economy);
      G.heist.successes = s.heist?.successes || 0;
      G.hud.shownMoney = G.money;
      return true;
    }
    // older saves: keep cash and story progress (the city layout changed, so shells reset)
    const o = JSON.parse(localStorage.getItem(OLD_SAVE_KEY) || 'null');
    if (o) {
      G.money = o.money || 0;
      G.missions.completed = new Set(V1_ORDER.slice(0, o.mission || 0));
      G.hud.shownMoney = G.money;
      return true;
    }
  } catch { /* corrupt or blocked storage: start fresh */ }
  return false;
}

// ------------------------------------------------------------------ world events
G.panic = (x, z, r) => {
  for (const p of G.peds) {
    if (!p.active || p.state === 'down') continue;
    if (Math.hypot(p.x - x, p.z - z) < r) p.flee(x, z);
  }
};

// Every shot fired anywhere: scatter people, spook drivers, alert witnesses.
G.gunfire = (space, x, z, radius, byPlayer) => {
  if (space === G.world) {
    for (const p of G.peds) {
      if (!p.active || p.state === 'down') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) { if (d < 14 && Math.random() < 0.4) p.cower(rand(3, 6)); else p.flee(x, z); }
    }
    for (const v of G.vehicles) {
      if (v.ai && v.traffic && v.driver === 'ai' && Math.hypot(v.x - x, v.z - z) < Math.min(radius, 40)) v.ai.flee(10);
    }
    if (byPlayer) {
      if (G.wanted.policeNear(x, z, radius * 1.2)) { G.wanted.reportShots(x, z, 0.6); if (G.wanted.stars >= 2) G.wanted.lethal = true; }
      else if (radius > 20) G.wanted.reportShots(x, z, 0.35);
    }
  } else if (byPlayer) {
    if (space.id === 'gunshop' && space.rangeZone(x, z)) { /* practice at the range */ }
    else if (space.id === 'bank') {
      G.heist.onPlayerGunfire();
      if (!G.heist.running) G.wanted.reportShots(x, z, 1.6, true);
    } else {
      G.wanted.reportShots(x, z, space.id === 'motel' ? 0.2 : 1.1);
      const c = space.parts.clerk;
      if (space.id === 'gunshop' && c && !c.dead) { c.hostile = true; c.state = 'combat'; }
    }
  }
  for (const n of G.npcs) if (n.space === space && Math.hypot(n.x - x, n.z - z) < radius) n.hearGunfire(x, z, byPlayer);
};

G.onNpcHurt = (n) => {
  if (n.isCop) G.wanted.attackCop(n.x, n.z);
  else G.wanted.reportShots(n.x, n.z, 0.5);
};
G.onNpcDown = (n, byPlayer) => {
  const space = n.space === G.world ? null : n.space;
  if (n.weapon) {
    const rounds = { pistol: 24, smg: 45, shotgun: 8, rifle: 30 }[n.weapon];
    if (Math.random() < 0.85) G.pickups.add('ammo', n.x + rand(-0.4, 0.4), n.z + rand(-0.4, 0.4), { weapon: n.weapon, rounds }, space);
  } else if (Math.random() < 0.35) G.pickups.add('cash', n.x, n.z, { amount: randi(15, 80) }, space);
  if (byPlayer) {
    if (n.isCop) { G.wanted.lethal = true; G.wanted.crime(0.7, n.x, n.z); }
    else G.wanted.crime(0.8, n.x, n.z, true);
  }
  G.heist.onNpcDown(n, byPlayer);
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
  if (d < 120 && G.player.space === G.world) G.audio.explosion();
  if (G.player.space === G.world) G.shake(Math.max(0, 1 - d / 60));
  const playerFault = !!src && (src.driver === 'player' || src === G.lastCar || G.time - (src.playerTouched || -99) < 12);
  for (const v of G.vehicles) {
    if (v === src) continue;
    const dv = Math.hypot(v.x - x, v.z - z);
    if (dv < 9) {
      v.damage(70 * (1 - dv / 9));
      const k = ((1 - dv / 9) * 10) / (dv || 1);
      v.vx += (v.x - x) * k; v.vz += (v.z - z) * k;
    }
  }
  for (const p of G.peds) {
    const dp = Math.hypot(p.x - x, p.z - z);
    if (dp < 10) p.knock(((p.x - x) / (dp || 1)) * 8, ((p.z - z) / (dp || 1)) * 8, 6, false);
    else if (dp < 40) p.flee(x, z);
  }
  for (const n of [...G.npcs]) {
    if (n.space !== G.world || n.dead) continue;
    const dn = Math.hypot(n.x - x, n.z - z);
    if (dn < 9) n.damage(130 * (1 - dn / 9), x, z, playerFault);
  }
  if (!G.player.vehicle && G.player.space === G.world && d < 8) {
    G.player.damage(75 * (1 - d / 8));
    G.player.downT = 1.8;
    G.player.vy = 5;
  }
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
  far.spawnAt(nearestRing(G, v.x, v.z));
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
  } else G.notify(`Neon shell ${G.tokens.size}/${G.tokenTotal}`, 2.5);
  G.save();
};

G.onEnterInterior = () => {};
G.onLeaveInterior = (I) => {
  if (I.id === 'bank') G.heist.onLeaveBank();
  G.pickups.clearSpace(I);
  G.economy.robbing = null;
  G.hud.hold(null);
};

function respawn(kind) {
  const P = G.player;
  if (P.space !== G.world) G.interiors.exit(true);
  if (P.vehicle) P.exitVehicle(true);
  const S = G.world.specials;
  const spot = kind === 'hospital' ? S.hospital : S.police;
  const fee = kind === 'hospital' ? Math.min(G.money, 250) : Math.min(G.money, Math.max(100, Math.round(G.money * 0.1)));
  if (fee) { G.money -= fee; G.hud.moneyDelta(-fee); }
  G.wanted.clear();
  P.place(spot.x, spot.z, 0);
  P.health = 100;
  if (kind === 'hospital') P.armor = 0;
  P.alive = true;
  P.model.root.visible = true;
  G.cam.snap(0);
  G.notify(fee ? `${kind === 'hospital' ? 'Hospital bill' : 'Bail'}: $${fee}` : 'Back on your feet.', 3);
  G.save();
}

function startSequence(kind) {
  if (G.sequence) return;
  G.player.alive = false;
  if (G.heist.running) G.heist.fail(kind === 'hospital' ? 'You went down. The bag is gone.' : 'Arrested with the bag. It\'s evidence now.');
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
  G.world.regionTokens.forEach(([x, z], k) => { if (!G.tokens.has(100 + k)) G.pickups.add('token', x, z, { id: 100 + k }); });
  G.tokenTotal = chosen.length + G.world.regionTokens.length;
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
  if (input.hit('KeyG')) G.guide.toggle();
  if (G.hud.mapOpen) return;

  G.interact.update(dt);
  if (G.ui.open) return;
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
  for (const npc of [...G.npcs]) npc.update(dt);
  G.interiors.update(dt);
  G.wanted.update(dt);
  G.economy.update(dt);
  G.heist.update(dt);
  G.missions.update(dt);
  G.phone.update(dt);
  G.guide.update(dt);
  G.gps.update(dt);
  G.pickups.update(dt);
  G.paintMarker.update(dt);
  G.chopMarker.update(dt);
  trafficT -= dt;
  if (trafficT <= 0) { trafficT = 0.5; manageTraffic(G, quality.traffic); }
  updateSequence(dt);
  G.effects.update(dt);
  G.cam.update(dt);
  G.effects.setScale(window.innerHeight * renderer.getPixelRatio(), camera.fov);
  G.env.update(dt, P.pos, camera, G.world);
  renderer.toneMappingExposure = G.env.indoor ? 1.0 : 1.05 + G.env.night * 0.5;
  const cp = camera.position;
  for (const v of G.vehicles) {
    v.model.root.visible = Math.abs(v.x - cp.x) + Math.abs(v.z - cp.z) < 420;
    v.sync(dt, G.env.night, G.time);
  }
  const pv = P.vehicle;
  G.audio.update(dt, pv, pv ? Math.min(1, Math.abs(pv.fwdSpeed) / pv.spec.maxSpeed) : 0, pv ? pv.ctrl.throttle : 0, pv && pv.onGround ? pv.slip : 0);
  G.hud.update(dt);
}

// Advance the simulation without rendering (used by automated tests).
G.debugStep = (seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) { step(dt); updateTransition(dt); input.endFrame(); }
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
  updateTransition(dt);
  input.endFrame();
  renderer.render(root, camera);
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
  G.cam.snap(Math.PI / 2);
  input.wantLock = true;
  input.requestLock();
  if (!G.missions.done) G.guide.post(G.missions.index === 0 ? 'Meet me at the blue marker outside the Seabreeze Motel.' : 'Welcome back. Call me when you want work.', { from: 'Dex', kind: 'dex' });
  G.guide.intro();
}
function pause(on) {
  if (!G.started) return;
  G.paused = on;
  pauseEl.hidden = !on;
  if (on) G.guide.renderJournal();
  if (!on) { input.requestLock(); last = performance.now(); }
}

document.getElementById('play').addEventListener('click', startGame);
document.getElementById('resume').addEventListener('click', () => pause(false));
const guideSwitch = document.getElementById('guide-toggle');
guideSwitch.addEventListener('mousedown', (e) => e.preventDefault());
guideSwitch.addEventListener('click', () => G.guide.toggle());
document.getElementById('reset').addEventListener('click', () => {
  try { for (const k of [SAVE_KEY, V2_SAVE_KEY, OLD_SAVE_KEY]) localStorage.removeItem(k); } catch { /* ignore */ }
  location.reload();
});
let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) hadLock = true;
  else if (hadLock && G.started && !G.paused && !G.hud.mapOpen && !G.ui.open) pause(true);
});
canvas.addEventListener('click', () => { if (G.started && !G.paused && !input.locked && !G.ui.open) input.requestLock(); });
window.addEventListener('keydown', (e) => {
  if (!G.started) { if (e.code === 'Enter') startGame(); return; }
  if (G.ui.open) return;
  if (G.hud.mapOpen && e.code === 'Escape') { G.hud.toggleMap(false); return; }
  if (G.paused && e.code === 'KeyG') { G.guide.toggle(); return; }
  if (e.code === 'KeyP' || (e.code === 'Escape' && !input.locked)) pause(!G.paused);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && G.started && !G.ui.open) pause(true); });
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  G.effects.setScale(window.innerHeight * renderer.getPixelRatio(), camera.fov);
  if (G.hud.mapOpen) G.hud.drawBigMap();
}
window.addEventListener('resize', onResize);

const hasSave = load();
if (hasSave) document.getElementById('play').textContent = 'CONTINUE';
populate();
onResize();
requestAnimationFrame(frame);
document.body.classList.add('ready');
