'use strict';
const SAVE_KEY = 'gemdelver_save_v1';

function newState() {
  return {
    coins: 0,
    gear: { pick: 0, armor: 0, boots: 0, sling: 0, lamp: 0, bag: 0, amulet: 0 },
    bag: [], sockets: [null], potions: 1, unlocked: 1,
    bosses: FLOORS.map(() => false), found: {}, totalEarned: 0, won: false, deaths: 0,
  };
}
function loadState() {
  const raw = Store.get(SAVE_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw), base = newState();
    const s = Object.assign(base, o, { gear: Object.assign(base.gear, o.gear || {}) });
    for (const k of GEAR_ORDER) s.gear[k] = clamp(s.gear[k] | 0, 0, GEAR[k].tiers.length - 1);
    s.bag = (s.bag || []).filter((id) => GEMS[id]);
    const slots = GEAR.amulet.tiers[s.gear.amulet].slots;
    s.sockets = (s.sockets || []).map((id) => (GEMS[id] ? id : null)).slice(0, slots);
    while (s.sockets.length < slots) s.sockets.push(null);
    return s;
  } catch (e) { return null; }
}
function save() { Store.set(SAVE_KEY, JSON.stringify(S)); }

let S = loadState() || newState();
const hadSave = !!Store.get(SAVE_KEY);

function getStats() {
  const G = S.gear;
  const pk = GEAR.pick.tiers[G.pick], ar = GEAR.armor.tiers[G.armor], bt = GEAR.boots.tiers[G.boots];
  const sl = GEAR.sling.tiers[G.sling], lp = GEAR.lamp.tiers[G.lamp], bg = GEAR.bag.tiers[G.bag];
  const b = { mine: 0, luck: 0, speed: 0, hp: 0, dmg: 0, regen: 0, def: 0, value: 0 };
  for (const id of S.sockets) if (id) { const s = gemStats(id); for (const k in s) b[k] += s[k]; }
  return {
    b,
    power: pk.power * (1 + b.mine / 100),
    tier: pk.tier,
    meleeDmg: Math.round(pk.dmg * (1 + b.dmg / 100)),
    slingDmg: Math.round(sl.dmg * (1 + b.dmg / 100)),
    slingCd: sl.cd,
    maxHp: Math.round(ar.hp * (1 + b.hp / 100)),
    def: Math.min(0.75, ar.def + b.def / 100),
    speed: bt.speed * (1 + b.speed / 100),
    dashCd: bt.dash,
    lamp: lp.radius,
    cap: bg.cap,
    luck: b.luck,
    regen: b.regen,
    valueMult: 1 + b.value / 100,
  };
}

const Game = {
  mode: 'title',
  mine: null,
  paused: false,
  ts: 36,
  t: 0,
  init() {
    this.canvas = $('game');
    this.ctx = this.canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
    Input.init(this.canvas);
    UI.init();
    HUD.init();
    this.bg = Array.from({ length: 26 }, () => this.newBgGem(true));

    $('btn-continue').classList.toggle('hidden', !hadSave);
    $('btn-new').textContent = hadSave ? 'New game' : 'Start mining';
    $('title').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      Sfx.init();
      Sfx.play('click');
      if (b.id === 'btn-continue') this.start();
      else if (b.id === 'btn-new') {
        if (hadSave && !confirm('Start a new game? Your current progress will be erased.')) return;
        S = newState(); save(); this.start(true);
      } else if (b.id === 'btn-help') UI.help();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { save(); if (this.mode === 'mine' && !this.paused) this.togglePause(); }
    });
    requestAnimationFrame((t) => this.loop(t));
  },
  start(fresh) {
    $('title').classList.add('hidden');
    this.goTown();
    if (fresh) UI.help();
  },
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = innerWidth; this.vh = innerHeight;
    for (const c of [this.canvas, this.fog]) {
      c.width = Math.round(this.vw * this.dpr);
      c.height = Math.round(this.vh * this.dpr);
    }
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    const ts = clamp(Math.round(Math.min(this.vw, this.vh) / 12), 30, 48);
    if (ts !== this.ts || !Tex.rock.length) { this.ts = ts; if (this.mine) Tex.build(ts, this.dpr, this.mine.fi); }
    else if (this.mine && Tex.px !== Math.round(ts * this.dpr)) Tex.build(ts, this.dpr, this.mine.fi);
    const mm = $('minimap');
    const size = this.vw < 600 ? 96 : 150;
    mm.width = size; mm.height = size;
  },
  togglePause() {
    if (this.mode !== 'mine') { if (UI.modalOpen) UI.closeModal(); return; }
    if (UI.modalOpen) { UI.closeModal(); this.paused = false; return; }
    this.paused = true;
    UI.pauseMenu();
  },
  enterMine(fi) {
    Tex.build(this.ts, this.dpr, fi);
    this.mine = new Mine(fi);
    this.mode = 'mine';
    this.paused = false;
    UI.hideTown();
    HUD.last = {};
    HUD.show();
    const F = FLOORS[fi];
    UI.toast('');
    UI.toast(`⛏️ Floor ${fi + 1}: ${F.name}`, 'boss');
    if (this.mine.boss) UI.toast(`💎 A living gem sleeps somewhere on this floor. Follow the arrow…`, '', 4.5);
  },
  goTown(msg) {
    this.mine = null;
    this.mode = 'town';
    this.paused = false;
    HUD.hide();
    UI.showTown();
    save();
    if (msg) UI.toast(msg);
  },
  newBgGem(anyY) {
    const ids = GEM_IDS.filter((id) => !GEMS[id].boss);
    return {
      id: ids[Math.floor(Math.random() * ids.length)], x: Math.random(), y: anyY ? Math.random() : 1.1,
      s: rand(8, 22), v: rand(0.01, 0.035), rot: rand(-0.5, 0.5), ph: rand(0, 10),
    };
  },
  drawBackdrop(dt) {
    const c = this.ctx, w = this.vw, h = this.vh;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#120d1e'); g.addColorStop(1, '#050409');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < this.bg.length; i++) {
      const b = this.bg[i];
      b.y -= b.v * dt; b.ph += dt;
      if (b.y < -0.1) { this.bg[i] = this.newBgGem(false); continue; }
      const gem = GEMS[b.id];
      const x = b.x * w + Math.sin(b.ph * 0.5) * 12, y = b.y * h;
      const rg = c.createRadialGradient(x, y, 0, x, y, b.s * 2.5);
      rg.addColorStop(0, withAlpha(gem.color, 0.18)); rg.addColorStop(1, withAlpha(gem.color, 0));
      c.fillStyle = rg;
      c.fillRect(x - b.s * 2.5, y - b.s * 2.5, b.s * 5, b.s * 5);
      drawGem(c, x, y, b.s, gem, b.ph, { rot: b.rot + Math.sin(b.ph) * 0.2, alpha: 0.75 });
    }
  },
  loop(now) {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.t += dt;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    try {
      if (this.mode === 'mine' && this.mine) {
        const m = this.mine;
        if (!this.paused && !UI.modalOpen) m.update(dt);
        if (this.mine === m) {
          m.render(c, this.vw, this.vh, this.dpr);
          HUD.update(m, dt);
        }
      } else {
        this.drawBackdrop(dt);
      }
    } catch (err) {
      console.error(err);
    }
    Input.endFrame();
    requestAnimationFrame((t) => this.loop(t));
  },
};

addEventListener('load', () => Game.init());
