import { LAND, PIER, HALF, ROAD, NB, PITCH, blockBounds } from './config.js';
import { fmtMoney } from './util.js';
import { WEAPONS, ORDER } from './weapons.js';

// Neighbourhood names shown when you cross into a new part of the island.
function districtAt(x, z) {
  if (x > PIER.minX - 2 && Math.abs(z) < 8) return 'Old Pier';
  if (x > HALF + ROAD / 2) return 'Solano Beach';
  if (x < -HALF - ROAD / 2 || z < -HALF - ROAD / 2 || z > HALF + ROAD / 2) return 'Greenbelt';
  const i = Math.floor((x + HALF) / PITCH), j = Math.floor((z + HALF) / PITCH);
  if (Math.max(Math.abs(i - 3), Math.abs(j - 3)) <= 1) return 'Downtown';
  if (i >= NB - 1) return 'Ocean Boulevard';
  if (j <= 0) return 'North Shore';
  if (j >= NB - 1) return 'South End';
  if (i <= 0) return 'Westside';
  return 'Midtown';
}

const MX0 = LAND.minX - 40, MZ0 = LAND.minZ - 40, MX1 = PIER.maxX + 30, MZ1 = LAND.maxZ + 40;

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(G) {
    this.G = G;
    this.el = {
      hud: $('hud'), clock: $('clock'), money: $('money'), stars: $('stars'), objective: $('objective'),
      timer: $('timer'), notify: $('notify'), radio: $('radio'), subtitle: $('subtitle'), big: $('big'),
      bigTitle: $('big-title'), bigSub: $('big-sub'), hp: $('hp').firstElementChild, bust: $('bust'),
      bustFill: $('bust').firstElementChild, veh: $('vehicle-panel'), vehName: $('veh-name'), speed: $('speed').firstElementChild,
      vehHp: $('veh-hp').firstElementChild, prompt: $('prompt'), fade: $('fade'), damage: $('damage'), tokens: $('tokens'),
      weapon: $('weapon'), wName: $('w-name'), wAmmo: $('w-ammo'), wSlots: $('w-slots'), crosshair: $('crosshair'), hitmark: $('hitmark'),
      armor: $('armor'), armorFill: $('armor').firstElementChild, pops: $('money-pops'), bag: $('bag'), bagVal: $('bag-val'),
      hold: $('holdbar'), holdFill: $('holdbar').querySelector('i'), holdLabel: $('holdbar').querySelector('span'),
      place: $('place'), nitro: $('nitro'), nitroFill: $('nitro').firstElementChild, dmgDir: $('dmg-dir'),
    };
    this.el.wSlots.innerHTML = ORDER.map((id) => `<span data-id="${id}">${WEAPONS[id].slot}</span>`).join('');
    this.slotEls = [...this.el.wSlots.children];
    this.hitT = 0;
    this.placeT = 0;
    this.district = '';
    this.dmgT = 0;
    this.el.stars.innerHTML = '<span>★</span>'.repeat(5);
    this.starEls = [...this.el.stars.children];
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.bigmap = $('bigmap');
    this.bctx = this.bigmap.getContext('2d');
    this.shownMoney = 0;
    this.notifyT = 0;
    this.bigT = 0;
    this.radioT = 0;
    this.lastStars = -1;
    this.mapOpen = false;
    this.buildMap();
  }

  // Pre-render the island to an offscreen canvas at 1px per metre.
  buildMap() {
    const W = this.G.world;
    const c = document.createElement('canvas');
    c.width = MX1 - MX0; c.height = MZ1 - MZ0;
    const g = c.getContext('2d');
    const R = (x0, z0, x1, z1, col) => { g.fillStyle = col; g.fillRect(x0 - MX0, z0 - MZ0, x1 - x0, z1 - z0); };
    R(MX0, MZ0, MX1, MZ1, '#0b1f3a');
    R(LAND.minX, LAND.minZ, LAND.maxX, LAND.maxZ, '#e5cf94');
    R(LAND.minX, LAND.minZ, HALF + ROAD / 2, LAND.maxZ, '#2f6b3a');
    R(PIER.minX, PIER.minZ, PIER.maxX, PIER.maxZ, '#9a7a52');
    const E = HALF + ROAD / 2;
    R(-E, -E, E, E, '#1c1f29');
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
      const b = blockBounds(i, j);
      const blk = W.blocks[i * NB + j];
      R(b.x0, b.z0, b.x1, b.z1, '#3c4152');
      if (blk.type === 'park') R(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, '#2f8a4a');
      if (blk.type === 'parking') R(b.x0 + 4, b.z0 + 4, b.x1 - 4, b.z1 - 4, '#2a2e3a');
    }
    for (const b of W.colliders.list) R(b.minX, b.minZ, b.maxX, b.maxZ, b.h > 40 ? '#7a82a3' : '#5c637d');
    g.fillStyle = '#ff8a3d';
    for (const r of W.ramps) R(r.x - 3, Math.min(r.z, r.z + r.dz * r.len), r.x + 3, Math.max(r.z, r.z + r.dz * r.len), '#ff8a3d');
    this.map = c;
  }

  objective(html) {
    if (this._obj === html) return;
    this._obj = html;
    this.el.objective.innerHTML = html;
    this.el.objective.hidden = !html;
  }
  subtitle(text) {
    if (this._sub === text) return;
    this._sub = text;
    this.el.subtitle.textContent = text;
    this.el.subtitle.hidden = !text;
  }
  big(title, sub = '', dur = 3) {
    this.el.bigTitle.textContent = title;
    this.el.bigSub.textContent = sub;
    this.el.big.classList.add('show');
    this.bigT = dur;
  }
  notify(text, dur = 2.5) {
    this.el.notify.textContent = text;
    this.el.notify.classList.add('show');
    this.notifyT = dur;
  }
  timer(sec) {
    if (sec === null) { if (!this.el.timer.hidden) this.el.timer.hidden = true; return; }
    this.el.timer.hidden = false;
    const s = Math.max(0, Math.ceil(sec));
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('low', sec < 10);
  }
  vehicleName(name) {
    this.el.veh.hidden = !name;
    if (name) {
      this.el.vehName.textContent = name;
      this.radio(this.G.audio.stationName);
    }
  }
  radio(name) {
    this.el.radio.textContent = '♪ ' + name;
    this.el.radio.classList.add('show');
    this.radioT = 2.5;
  }
  starsChanged(up) {
    if (up) {
      this.el.stars.classList.remove('pulse');
      void this.el.stars.offsetWidth;
      this.el.stars.classList.add('pulse');
    }
  }
  // angle: world direction the damage came from (null for unknown)
  flashDamage(angle = null) {
    this.el.damage.classList.remove('hit');
    void this.el.damage.offsetWidth;
    this.el.damage.classList.add('hit');
    if (angle !== null) {
      const rel = angle - this.G.cam.yaw;
      this.el.dmgDir.style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
      this.el.dmgDir.classList.remove('show');
      void this.el.dmgDir.offsetWidth;
      this.el.dmgDir.classList.add('show');
    }
  }
  hitMarker(kill) {
    this.el.hitmark.classList.toggle('kill', !!kill);
    this.el.hitmark.classList.remove('show');
    void this.el.hitmark.offsetWidth;
    this.el.hitmark.classList.add('show');
  }
  hold(p, label = '') {
    if (p === null) { if (!this.el.hold.hidden) this.el.hold.hidden = true; return; }
    this.el.hold.hidden = false;
    this.el.holdFill.style.width = `${Math.min(100, p * 100)}%`;
    this.el.holdLabel.textContent = label;
  }
  bag(v) {
    if (v === null) { if (!this.el.bag.hidden) this.el.bag.hidden = true; return; }
    this.el.bag.hidden = false;
    this.el.bagVal.textContent = fmtMoney(v);
  }
  moneyDelta(n) {
    if (!n) return;
    const s = document.createElement('div');
    s.className = n > 0 ? 'pop up' : 'pop down';
    s.textContent = `${n > 0 ? '+' : '-'}${fmtMoney(Math.abs(n))}`;
    s.addEventListener('animationend', () => s.remove());
    this.el.pops.prepend(s);
    while (this.el.pops.children.length > 4) this.el.pops.lastChild.remove();
  }
  location(name) {
    this.inside = name;
    if (name) this.showPlace(name);
    else this.district = '';
  }
  showPlace(name) {
    this.el.place.textContent = name;
    this.el.place.classList.add('show');
    this.placeT = 3;
  }
  prompt(text) {
    if (this._prompt === text) return;
    this._prompt = text;
    this.el.prompt.innerHTML = text || '';
    this.el.prompt.hidden = !text;
  }
  fade(on) { this.el.fade.classList.toggle('on', on); }

  update(dt) {
    const G = this.G, el = this.el;
    el.clock.textContent = G.env.clock;
    const diff = G.money - this.shownMoney;
    this.shownMoney += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 6);
    el.money.textContent = fmtMoney(Math.round(this.shownMoney));
    el.tokens.textContent = `◆ ${G.tokens.size}/${G.tokenTotal}`;
    const w = G.wanted;
    if (w.stars !== this.lastStars) {
      this.starEls.forEach((s, i) => s.classList.toggle('on', i < w.stars));
      this.lastStars = w.stars;
    }
    el.stars.classList.toggle('evading', w.evading);
    el.hp.style.width = `${Math.max(0, G.player.health)}%`;
    el.bust.hidden = w.bustT <= 0;
    el.bustFill.style.width = `${Math.min(100, (w.bustT / 2.3) * 100)}%`;
    const v = G.player.vehicle;
    if (v) {
      el.speed.textContent = Math.round(v.speed * 3.6);
      el.vehHp.style.width = `${Math.max(0, v.health)}%`;
      el.vehHp.classList.toggle('low', v.health < 35);
      el.nitro.hidden = !v.mods.nitro;
      if (v.mods.nitro) el.nitroFill.style.width = `${v.nitro * 100}%`;
    }
    el.armor.hidden = G.player.armor <= 0;
    el.armorFill.style.width = `${Math.max(0, G.player.armor)}%`;
    this.updateWeapon();
    if (this.placeT > 0) { this.placeT -= dt; if (this.placeT <= 0) el.place.classList.remove('show'); }
    if (!this.inside) {
      const P = G.player.pos;
      const d = districtAt(P.x, P.z);
      if (d !== this.district) { if (this.district) this.showPlace(d); this.district = d; }
    }
    if (this.notifyT > 0) { this.notifyT -= dt; if (this.notifyT <= 0) el.notify.classList.remove('show'); }
    if (this.bigT > 0) { this.bigT -= dt; if (this.bigT <= 0) el.big.classList.remove('show'); }
    if (this.radioT > 0) { this.radioT -= dt; if (this.radioT <= 0) el.radio.classList.remove('show'); }
    this.drawMinimap();
    if (this.mapOpen) this.drawBigMap();
  }

  updateWeapon() {
    const G = this.G, A = G.arsenal, el = this.el, P = G.player;
    const w = A.w;
    el.wName.textContent = w.name;
    if (w.melee) el.wAmmo.textContent = '';
    else {
      const a = A.ammo[w.id];
      el.wAmmo.innerHTML = A.reloadT > 0 ? '<b>RELOADING</b>' : `<b class="${a.mag === 0 ? 'low' : ''}">${a.mag}</b> / ${a.res}`;
    }
    for (const s of this.slotEls) {
      s.classList.toggle('own', A.has(s.dataset.id));
      s.classList.toggle('cur', s.dataset.id === A.current);
    }
    const show = A.armed && P.alive && (P.vehicle ? P.aiming : true) && !G.ui.open;
    el.crosshair.hidden = !show;
    if (show) {
      const spread = (P.aiming ? w.aimSpread : w.spread) + A.bloom;
      el.crosshair.style.setProperty('--gap', `${Math.round(6 + spread * 500)}px`);
      el.crosshair.classList.toggle('hot', !!P.aimTarget && !P.aimTarget.dead && P.aimTarget.state !== 'down');
    }
  }

  blips() {
    const G = this.G, out = [];
    const t = G.time;
    for (const v of G.wanted.police) out.push({ x: v.x, z: v.z, kind: 'police', color: Math.floor(t * 4) % 2 ? '#ff3355' : '#3a7bff' });
    for (const n of G.npcs) if (n.isCop && !n.dead && n.space === G.world) out.push({ x: n.x, z: n.z, kind: 'cop', color: '#ff6677' });
    if (G.wanted.heli) out.push({ x: G.wanted.heli.x, z: G.wanted.heli.z, kind: 'heli', color: '#ff3355' });
    const mt = G.missions.targetPos();
    if (mt) out.push({ x: mt.x, z: mt.z, kind: 'target', color: '#ffd23f', edge: true });
    const H = G.heist;
    if (H.phase === 'escape') {
      out.push({ x: H.boatMarker.x, z: H.boatMarker.z, kind: 'target', color: '#ffd23f', edge: true });
      out.push({ x: H.lockupMarker.x, z: H.lockupMarker.z, kind: 'target', color: '#29e7ff', edge: true });
    }
    const c = G.missions.contactPos();
    if (c) out.push({ x: c.x, z: c.z, kind: 'contact', color: '#4dd2ff', edge: true, label: 'D' });
    const S = G.world.specials, D = G.world.doors;
    const owned = G.economy.owned;
    out.push({ x: S.paint.x, z: S.paint.z, kind: 'shop', color: '#ff3fa4', label: 'P' });
    out.push({ x: S.hospital.x, z: S.hospital.z, kind: 'shop', color: '#ff4d5e', label: '+' });
    out.push({ x: S.police.x, z: S.police.z, kind: 'shop', color: '#4d8dff', label: '★' });
    out.push({ x: D.gunshop.x, z: D.gunshop.z, kind: 'shop', color: '#ff8a3d', label: 'G' });
    out.push({ x: D.store.x, z: D.store.z, kind: 'shop', color: '#7dff7a', label: 'M' });
    out.push({ x: D.arcade.x, z: D.arcade.z, kind: 'shop', color: owned.has('arcade') ? '#ffffff' : '#ff3fa4', label: 'A' });
    out.push({ x: D.motel.x, z: D.motel.z, kind: 'shop', color: owned.has('motel') ? '#ffffff' : '#ffb3c7', label: 'H' });
    out.push({ x: D.bank.x, z: D.bank.z, kind: 'shop', color: '#ffd166', label: 'B' });
    out.push({ x: S.chop.x, z: S.chop.z, kind: 'shop', color: '#29e7ff', label: 'L' });
    const pc = G.vehicles.find((v) => v.personal && !v.destroyed);
    if (pc && G.player.vehicle !== pc) out.push({ x: pc.x, z: pc.z, kind: 'car', color: '#ffd166' });
    else if (G.player.vehicle === null && G.lastCar && !G.lastCar.destroyed && G.vehicles.includes(G.lastCar)) out.push({ x: G.lastCar.x, z: G.lastCar.z, kind: 'car', color: '#9ef0c0' });
    return out;
  }

  drawMinimap() {
    const G = this.G, g = this.mctx, cv = this.mini;
    const size = cv.width, c = size / 2;
    const P = G.player.outdoorPos;
    const yaw = G.cam.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    const v = G.player.vehicle;
    const zoom = (v ? 1.45 - Math.min(0.6, v.speed / 70) : 1.9) * (size / 220);
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.roundRect(4, 4, size - 8, size - 8, 22);
    g.clip();
    g.fillStyle = '#0b1f3a';
    g.fillRect(0, 0, size, size);
    g.translate(c, c);
    g.rotate(rot);
    g.scale(zoom, zoom);
    g.drawImage(this.map, -(P.x - MX0), -(P.z - MZ0));
    g.restore();

    const cr = Math.cos(rot), sr = Math.sin(rot);
    const toMini = (x, z) => {
      const dx = (x - P.x) * zoom, dz = (z - P.z) * zoom;
      return [c + dx * cr - dz * sr, c + dx * sr + dz * cr];
    };
    const lim = c - 16;
    for (const b of this.blips()) {
      let [x, y] = toMini(b.x, b.z);
      const ox = x - c, oy = y - c;
      const m = Math.max(Math.abs(ox), Math.abs(oy));
      if (m > lim) {
        if (!b.edge) continue;
        x = c + (ox / m) * lim; y = c + (oy / m) * lim;
      }
      this.blip(g, x, y, b);
    }
    // north marker
    let [nx, ny] = toMini(P.x, P.z - 5000);
    const nm = Math.max(Math.abs(nx - c), Math.abs(ny - c));
    nx = c + ((nx - c) / nm) * (c - 12); ny = c + ((ny - c) / nm) * (c - 12);
    g.fillStyle = '#ffffff';
    g.font = `bold ${Math.round(size / 18)}px "Chakra Petch", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', nx, ny);
    // player arrow
    const ph = v ? v.h : G.player.h;
    const ang = Math.atan2(Math.cos(ph), Math.sin(ph)) + rot;
    g.save();
    g.translate(c, c);
    g.rotate(ang + Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#0b1f3a';
    g.lineWidth = 2;
    g.beginPath();
    const a = size / 26;
    g.moveTo(0, -a * 1.3); g.lineTo(a, a); g.lineTo(0, a * 0.45); g.lineTo(-a, a);
    g.closePath(); g.fill(); g.stroke();
    g.restore();
    // frame
    g.strokeStyle = G.wanted.stars > 0 ? (Math.floor(G.time * 4) % 2 ? '#ff3355' : '#3a7bff') : 'rgba(255,255,255,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(4, 4, size - 8, size - 8, 22);
    g.stroke();
  }

  blip(g, x, y, b) {
    const s = this.mini.width / 220;
    g.save();
    g.translate(x, y);
    if (b.kind === 'police' || b.kind === 'heli' || b.kind === 'cop') {
      g.fillStyle = b.color;
      g.beginPath(); g.arc(0, 0, (b.kind === 'heli' ? 6 : b.kind === 'cop' ? 2.6 : 4.5) * s, 0, Math.PI * 2); g.fill();
    } else if (b.kind === 'car') {
      g.fillStyle = b.color;
      g.fillRect(-4 * s, -3 * s, 8 * s, 6 * s);
    } else {
      g.fillStyle = '#0b1f3a';
      g.beginPath(); g.arc(0, 0, 8 * s, 0, Math.PI * 2); g.fill();
      g.strokeStyle = b.color; g.lineWidth = 2.5 * s;
      g.stroke();
      g.fillStyle = b.color;
      if (b.label) {
        g.font = `bold ${Math.round(10 * s)}px "Chakra Petch", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(b.label, 0, 0.5 * s);
      } else { g.beginPath(); g.arc(0, 0, 3.5 * s, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  toggleMap(force) {
    this.mapOpen = force ?? !this.mapOpen;
    this.bigmap.hidden = !this.mapOpen;
    if (this.mapOpen) this.drawBigMap();
  }

  drawBigMap() {
    const cv = this.bigmap, g = this.bctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    g.fillStyle = '#071427';
    g.fillRect(0, 0, w, h);
    const s = Math.min(w / this.map.width, (h * 0.86) / this.map.height);
    const ox = (w - this.map.width * s) / 2, oy = (h - this.map.height * s) / 2 + h * 0.03;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.map, ox, oy, this.map.width * s, this.map.height * s);
    const toMap = (x, z) => [ox + (x - MX0) * s, oy + (z - MZ0) * s];
    for (const b of this.blips()) { const [x, y] = toMap(b.x, b.z); this.blip(g, x, y, b); }
    const G = this.G, P = G.player.outdoorPos;
    const [px, py] = toMap(P.x, P.z);
    const ph = G.player.vehicle ? G.player.vehicle.h : G.player.h;
    g.save();
    g.translate(px, py);
    g.rotate(Math.atan2(Math.cos(ph), Math.sin(ph)) + Math.PI / 2);
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12 * dpr); g.lineTo(9 * dpr, 9 * dpr); g.lineTo(0, 4 * dpr); g.lineTo(-9 * dpr, 9 * dpr); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#ffffff';
    g.font = `700 ${Math.round(22 * dpr)}px "Chakra Petch", sans-serif`;
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('PORT SOLANO', 24 * dpr, 20 * dpr);
    g.font = `500 ${Math.round(13 * dpr)}px "Chakra Petch", sans-serif`;
    g.fillStyle = '#a9b4d0';
    g.fillText('D Dex   B Solano Bank   G Iron Palm Arms   M Late Mart   A Neon Arcade   H Safehouse   P Customs   L Lockup   + Hospital   ★ Police   ■ Car', 24 * dpr, 50 * dpr);
  }
}
