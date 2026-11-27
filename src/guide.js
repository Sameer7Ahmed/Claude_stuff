import * as THREE from '../vendor/three.module.min.js';
import { REGIONS, regionAt, ROADS } from './layout.js';
import { fmtMoney } from './util.js';

const $ = (id) => document.getElementById(id);
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MSG_SHOW = 22; // seconds a message stays in the open panel
const MSG_MAX = 3;   // messages shown in the panel at once (the pause journal keeps the rest)
const PING_KINDS = new Set(['dex', 'job', 'alert']);

const TIPS = {
  route: 'Follow the arrows on the road. Press M for the map and click anywhere on it to set your own route.',
  wanted: 'Break line of sight until the stars stop flashing, or respray the car at Paint & Pay.',
  gun: 'Right mouse aims, left mouse fires, R reloads. Q or 1–5 switch weapons.',
  bridge: 'Bridges link the city to the rest of the coast. Every new area pays a discovery bonus.',
  call: 'Y answers Dex, X sends him to voicemail. While the guide is open you can also call him yourself.',
};

// The mission guide. It's off by default, so free roam stays clean: the objective, route, waypoint
// marker, sky beacons, Dex's calls and texts, briefings and tips wait behind one button (G).
// While it's closed, new items only add to a small badge on that button.
export class Guide {
  constructor(G) {
    this.G = G;
    this.on = false;
    this.target = null;
    this.visited = new Set();
    this.tipsShown = new Set();
    this.region = null;
    this.uiT = 0;
    this.feed = [];       // {from, text, kind, t, seen, quiet}
    this.news = false;    // the objective changed while the guide was closed
    this.alert = false;   // something urgent is waiting
    this.newsKey = null;
    this.introT = 0;
    this.el = {
      guide: $('guide'), btn: $('guide-btn'), badge: $('guide-badge'), toggle: $('guide-toggle'),
      tracker: $('tracker'), kicker: $('tk-kicker'), title: $('tk-title'), obj: $('tk-obj'), dist: $('tk-dist'), dest: $('tk-dest'),
      turn: $('tk-turn'), hint: $('tk-hint'), msgs: $('tk-msgs'), act: $('tk-act'), actLabel: $('tk-act').querySelector('span'),
      wp: $('wp-marker'), wpDist: $('wp-dist'), journal: $('journal'),
    };
    // keep buttons from taking keyboard focus, so Space (jump/handbrake) can't re-press them
    for (const b of [this.el.btn, this.el.act]) b.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.btn.addEventListener('click', () => { this.toggle(); this.el.btn.blur(); });
    this.el.act.addEventListener('click', () => { this.G.phone.dial(); this.el.act.blur(); });
    this._v = new THREE.Vector3();
    this._shown = { obj: null, dist: null };
    this.syncButton();
  }

  save() { return { visited: [...this.visited], tips: [...this.tipsShown], on: this.on }; }
  load(s) {
    if (!s) return;
    for (const v of s.visited || []) this.visited.add(v);
    for (const t of s.tips || []) this.tipsShown.add(t);
    this.on = !!s.on;
    this.syncButton();
  }

  get unread() { let n = 0; for (const m of this.feed) if (m.seen === null) n++; return n; }

  // ------------------------------------------------------------ toggle + messages
  toggle(force) {
    const on = force ?? !this.on;
    if (on === this.on) return;
    const G = this.G;
    this.on = on;
    if (on) {
      for (const m of this.feed) if (m.seen === null) m.seen = G.time;
      this.news = false;
      this.alert = false;
      this.tip('route');
    } else if (G.missions.say) G.missions.endBriefing();
    this.el.btn.classList.remove('ping', 'intro');
    this.introT = 0;
    G.audio.click();
    this.syncButton();
    this.updateTracker();
    this.renderMsgs(true);
    G.save();
  }

  // a mission prompt: shown in the open panel, or held behind the badge while it's closed.
  // shown=true: already on screen another way (briefing subtitles), so only log it.
  post(text, { from = 'Dex', kind = 'dex', alert = false, shown = false } = {}) {
    const G = this.G;
    const m = { from, text, kind: alert ? 'alert' : kind, t: G.time, seen: this.on || shown ? G.time : null, quiet: shown };
    this.feed.push(m);
    if (this.feed.length > 40) this.feed.shift();
    if (!this.on && !shown) {
      if (alert) this.alert = true;
      if (PING_KINDS.has(m.kind)) this.ping();
    }
    this.syncButton();
    this.renderMsgs(true);
    return m;
  }

  // briefing lines that never reached the screen (the guide was closed mid-briefing) wait as unread
  requeue(msgs) {
    if (!msgs.length) return;
    for (const m of msgs) { m.quiet = false; m.seen = this.on ? this.G.time : null; }
    if (!this.on) this.ping();
    this.syncButton();
    this.renderMsgs(true);
  }

  tip(id) {
    if (this.tipsShown.has(id)) return;
    this.tipsShown.add(id);
    this.post(TIPS[id], { from: 'Tip', kind: 'tip' });
  }

  // one-time label on the button the first time you play
  intro() {
    if (this.tipsShown.has('guide-intro') || this.on) return;
    this.tipsShown.add('guide-intro');
    this.el.btn.classList.add('intro');
    this.introT = 7;
  }

  ping() {
    const b = this.el.btn;
    b.classList.remove('ping');
    void b.offsetWidth;
    b.classList.add('ping');
  }

  syncButton() {
    const el = this.el, n = this.unread, on = this.on;
    el.guide.classList.toggle('open', on);
    el.btn.classList.toggle('on', on);
    el.btn.classList.toggle('news', !on && (this.news || n > 0));
    el.btn.classList.toggle('alert', !on && this.alert);
    el.btn.setAttribute('aria-pressed', String(on));
    el.btn.setAttribute('aria-label', `Mission guide (G): ${on ? 'on' : 'off'}${n ? `, ${n} new` : ''}`);
    el.badge.hidden = on || !n;
    el.badge.textContent = n > 9 ? '9+' : String(n);
    if (el.toggle) {
      el.toggle.setAttribute('aria-pressed', String(on));
      el.toggle.querySelector('span').textContent = on ? 'On' : 'Off';
    }
  }

  renderMsgs(force) {
    const G = this.G;
    // oldest first, so a multi-line briefing reads top to bottom
    const list = this.on ? this.feed.filter((m) => !m.quiet && m.seen !== null && G.time - m.seen < MSG_SHOW).slice(-MSG_MAX) : [];
    const state = (m) => (G.time - m.seen > MSG_SHOW - 0.7 ? 'old' : G.time - m.seen < 0.5 ? 'new' : '');
    const key = list.map((m) => `${m.t}:${state(m) === 'old'}`).join('|');
    if (!force && key === this._msgKey) return;
    this._msgKey = key;
    this.el.msgs.innerHTML = list.map((m) => `<li class="${m.kind} ${state(m)}"><b>${esc(m.from)}</b>${esc(m.text)}</li>`).join('');
  }

  // ------------------------------------------------------------ where to go next
  computeTarget() {
    const G = this.G, M = G.missions, H = G.heist, P = G.player.outdoorPos;
    if (H.phase === 'escape') {
      const b = H.boatMarker, l = H.lockupMarker;
      const useBoat = G.wanted.stars > 0 || Math.hypot(b.x - P.x, b.z - P.z) < Math.hypot(l.x - P.x, l.z - P.z);
      return useBoat ? { x: b.x, z: b.z, label: 'Getaway boat', color: '#ffd23f' } : { x: l.x, z: l.z, label: "Dex's lockup", color: '#29e7ff' };
    }
    if (M.active) {
      if (M.say) return null;
      const step = M.step;
      if (M.marker.visible) return { x: M.marker.x, z: M.marker.z, label: step?.dest || 'Objective', color: '#ffd23f' };
      if (step?.kind === 'car' && !G.player.vehicle) {
        let best = null, bd = 220;
        for (const v of G.vehicles) {
          if (v.destroyed || v.isPolice || v.driver === 'player') continue;
          const d = Math.hypot(v.x - P.x, v.z - P.z);
          if (d < bd) { bd = d; best = v; }
        }
        if (best) return { x: best.x, z: best.z, label: 'Nearest car', color: '#9ef0c0' };
      }
      return null;
    }
    const c = M.contactPos();
    if (c && !G.phone.ringing) return { x: c.x, z: c.z, label: 'Dex · Seabreeze Motel', color: '#4dd2ff' };
    return null;
  }

  update(dt) {
    this.target = this.computeTarget();
    this.updateRegion();
    this.updateTips();
    this.updateBeacons();
    this.updateMarker();
    this.trackNews();
    this.uiT -= dt;
    if (this.uiT <= 0) { this.uiT = 0.15; this.updateTracker(); this.renderMsgs(); }
    if (this.introT > 0) { this.introT -= dt; if (this.introT <= 0) this.el.btn.classList.remove('intro'); }
  }

  // the objective changing while the guide is closed lights the button (without a count)
  trackNews() {
    const G = this.G, M = G.missions;
    const obj = (G.hud.objText || '').split('<small>')[0].replace(/[\d%]+/g, '#');
    const key = `${M.active ? `${M.active.m.id}:${M.active.step}` : M.done ? 'done' : `next:${M.current.id}`}|${G.heist.phase}|${obj}`;
    if (key === this.newsKey) return;
    const first = this.newsKey === null;
    this.newsKey = key;
    if (this.on || first) return;
    this.news = true;
    this.ping();
    this.syncButton();
  }

  updateRegion() {
    const G = this.G;
    if (G.player.space !== G.world) return;
    const P = G.player.pos;
    if (G.world.bridgeAt(P.x, P.z)) this.tip('bridge');
    const r = regionAt(P.x, P.z);
    const id = r ? r.id : null;
    if (id === this.region) return;
    this.region = id;
    if (!r) return;
    const fresh = !this.visited.has(r.id);
    if (fresh) {
      this.visited.add(r.id);
      G.addMoney(250);
      G.audio.token();
      G.save();
    }
    G.hud.regionCard(r, fresh);
  }

  updateTips() {
    const G = this.G;
    if (G.wanted.stars > 0) this.tip('wanted');
    if (G.arsenal.armed) this.tip('gun');
  }

  // sky-high beacons only while the guide is open; otherwise a short beam marks the spot
  updateBeacons() {
    const G = this.G, M = G.missions, H = G.heist;
    M.marker.tall = M.contactMarker.tall = H.boatMarker.tall = H.lockupMarker.tall = this.on;
  }

  // small diamond over the target (an arrow pinned to the screen edge when it's off-view) + distance
  updateMarker() {
    const G = this.G, el = this.el;
    const goal = G.gps.goal;
    const P = G.player.pos;
    if (!goal || G.player.space !== G.world || G.ui.open || !G.player.alive) { el.wp.classList.remove('show'); return; }
    const d = Math.hypot(goal.x - P.x, goal.z - P.z);
    if (d < 10) { el.wp.classList.remove('show'); return; }
    el.wp.classList.add('show');
    const cam = G.camera;
    const v = this._v.set(goal.x, G.world.groundY(goal.x, goal.z) + 3.5, goal.z).project(cam);
    let x = v.x, y = v.y;
    const behind = v.z > 1;
    if (behind) { x = -x; y = -y; }
    const ex = 0.86, ey = 0.82;
    const off = behind || Math.abs(x) > ex || Math.abs(y) > ey;
    if (off) {
      const m = Math.max(Math.abs(x) / ex, Math.abs(y) / ey);
      x /= m; y /= m;
      if (behind && Math.abs(y) < ey && Math.abs(x) < ex) y = -ey;
    }
    const w = window.innerWidth, h = window.innerHeight;
    el.wp.style.transform = `translate(${((x + 1) / 2) * w}px, ${((1 - y) / 2) * h}px)`;
    el.wp.style.setProperty('--c', goal.color || '#ffd23f');
    el.wp.classList.toggle('edge', off);
    if (off) el.wp.style.setProperty('--ang', `${Math.atan2(-y, x)}rad`);
    const txt = fmtDist(d);
    if (txt !== this._shown.dist) { this._shown.dist = txt; el.wpDist.textContent = txt; }
  }

  updateTracker() {
    if (!this.on) return;
    const G = this.G, el = this.el, M = G.missions, gps = G.gps, ph = G.phone, H = G.heist;
    let kicker = '', title = '', hint = '', act = '';
    let obj = G.hud.objText || '', pitch = false;
    if (H.phase === 'escape') { kicker = 'Getaway'; title = 'Get the bag to safety'; }
    else if (M.active) {
      kicker = `Mission ${M.index + 1}/${M.list.length}`;
      title = M.active.m.title;
      if (M.say) hint = G.input.isTouch ? 'Briefing · tap Enter to skip' : 'Briefing · Enter skips';
    } else if (H.running) { kicker = 'Heist'; title = 'The Solano Job'; }
    else if (!M.done) {
      kicker = 'Next job';
      title = M.current.title;
      obj = M.current.pitch || '';
      pitch = true;
      if (ph.ringing) hint = 'Dex is calling';
      else if (M.current.phone === false) hint = 'Meet Dex at the blue marker by the motel';
      else if (ph.canDial()) { act = ph.voicemail ? 'Call Dex back' : 'Call Dex'; hint = 'Or meet him at the motel'; }
      else if (G.wanted.stars > 0) hint = 'Lose the cops before you call Dex';
      else hint = 'Meet Dex at the motel';
    } else {
      kicker = 'Free roam';
      title = gps.waypoint ? gps.waypoint.label : 'Port Solano is yours';
      obj = '';
      if (!gps.waypoint) hint = 'Click the map (M) to set a route';
    }
    const goal = gps.goal;
    let route = false;
    if (goal && gps.route && G.player.space === G.world) {
      route = true;
      el.dist.textContent = fmtDist(gps.distLeft);
      const t = gps.turn;
      let dir = 'ahead', what = goal.label;
      if (gps.distLeft < 40) { dir = 'arrive'; what = `${goal.label} · ahead`; }
      else if (t && t.dist < 220) { dir = t.dir; what = t.dir === 'uturn' ? `Turn around in ${fmtDist(t.dist)}` : `Turn ${t.dir} in ${fmtDist(t.dist)}`; }
      el.dest.textContent = what;
      el.turn.dataset.dir = dir;
    } else if (goal && G.player.space !== G.world) {
      route = true;
      el.dist.textContent = '';
      el.dest.textContent = `Head outside · ${goal.label}`;
      el.turn.dataset.dir = 'exit';
    }
    el.kicker.textContent = kicker;
    el.title.textContent = title;
    const objKey = `${pitch}|${obj}`;
    if (objKey !== this._shown.obj) {
      this._shown.obj = objKey;
      if (pitch) el.obj.textContent = obj;
      else el.obj.innerHTML = obj;
      el.obj.classList.toggle('pitch', pitch);
    }
    el.tracker.classList.toggle('noroute', !route);
    el.hint.textContent = hint;
    el.hint.hidden = !hint;
    el.act.hidden = !act;
    if (act) el.actLabel.textContent = act;
  }

  // places you can route to from the map legend
  destinations() {
    const G = this.G, S = G.world.specials, D = G.world.doors, N = ROADS.nodes;
    const out = [];
    const c = G.missions.contactPos();
    if (c) out.push({ label: 'Dex (next job)', glyph: 'D', color: '#4dd2ff', x: c.x, z: c.z });
    out.push(
      { label: 'Solano Bank', glyph: 'B', color: '#ffd166', x: D.bank.x, z: D.bank.z },
      { label: 'Iron Palm Arms', glyph: 'G', color: '#ff8a3d', x: D.gunshop.x, z: D.gunshop.z },
      { label: 'Late Mart', glyph: 'M', color: '#7dff7a', x: D.store.x, z: D.store.z },
      { label: 'Neon Arcade', glyph: 'A', color: '#ff3fa4', x: D.arcade.x, z: D.arcade.z },
      { label: 'Safehouse', glyph: 'H', color: '#ffb3c7', x: D.motel.x, z: D.motel.z },
      { label: 'Paint & Pay', glyph: 'P', color: '#ff3fa4', x: S.paint.x, z: S.paint.z },
      { label: "Dex's Lockup", glyph: 'L', color: '#29e7ff', x: S.chop.x, z: S.chop.z },
      { label: 'Hospital', glyph: '+', color: '#ff4d5e', x: S.hospital.x, z: S.hospital.z },
      { label: 'Palm Heights', glyph: '◆', color: REGIONS[0].color, x: N.A2[0], z: N.A2[1] },
      { label: 'Sundown Lookout', glyph: '◆', color: REGIONS[1].color, x: S.summit.x, z: S.summit.z },
      { label: 'Harbor District', glyph: '◆', color: REGIONS[2].color, x: N.H2[0], z: N.H2[1] },
      { label: 'Lantern Key', glyph: '◆', color: REGIONS[3].color, x: S.lighthouse.x, z: S.lighthouse.z },
    );
    return out;
  }

  regionsInfo() { return REGIONS.map((r) => ({ ...r, visited: this.visited.has(r.id) })); }

  // pause-screen journal: story progress, places, assets and every mission message.
  // Opening it counts as reading what was waiting.
  renderJournal() {
    const G = this.G, M = G.missions;
    for (const m of this.feed) if (m.seen === null) m.seen = G.time - MSG_SHOW;
    this.news = false;
    this.alert = false;
    this.syncButton();
    const rows = M.list.map((m, i) => {
      const done = M.completed.has(m.id);
      const cur = !done && i === M.index;
      return `<li class="${done ? 'done' : cur ? 'cur' : 'locked'}"><span>${done ? '✓' : cur ? '▶' : '·'}</span>${cur || done ? m.title : 'Locked'}${cur ? `<small>${M.active ? 'In progress' : m.phone === false ? 'Meet Dex at the motel' : 'Call Dex from the guide, or meet him at the motel'}</small>` : ''}</li>`;
    }).join('');
    const regions = REGIONS.map((r) => `<span class="${this.visited.has(r.id) ? 'on' : ''}" style="--c:${r.color}">${r.name}</span>`).join('');
    const owned = [...G.economy.owned].map((id) => ({ motel: 'Safehouse', arcade: 'Neon Arcade' }[id])).join(', ') || 'None yet';
    const msgs = this.feed.slice(-12).map((m) => `<li class="${m.kind}"><b>${esc(m.from)}</b>${esc(m.text)}</li>`).join('') || '<li class="empty">No messages yet.</li>';
    this.el.journal.innerHTML = `
      <section><h3>Story</h3><ol>${rows}</ol></section>
      <section><h3>Coast</h3><div class="regions">${regions}</div></section>
      <section><h3>Ledger</h3><dl>
        <dt>Cash</dt><dd>${fmtMoney(G.money)}</dd>
        <dt>Property</dt><dd>${owned}</dd>
        <dt>Neon shells</dt><dd>${G.tokens.size}/${G.tokenTotal}</dd>
        <dt>Bank jobs</dt><dd>${G.heist.successes}</dd>
      </dl></section>
      <section class="msgs"><h3>Messages</h3><ul>${msgs}</ul></section>`;
    const ul = this.el.journal.querySelector('.msgs ul');
    ul.scrollTop = ul.scrollHeight;
  }
}
