import * as THREE from '../vendor/three.module.min.js';
import { REGIONS, regionAt, ROADS } from './layout.js';
import { fmtMoney } from './util.js';

const $ = (id) => document.getElementById(id);
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`);

const TIPS = {
  route: 'Follow the glowing arrows on the road. Press M for the map, and click anywhere on it to set your own route.',
  wanted: 'Wanted! Break line of sight until the stars stop flashing, or respray the car at Paint & Pay.',
  gun: 'Right mouse aims, left mouse fires, R reloads. Q or 1–5 switch weapons.',
  bridge: 'Bridges link the city to the rest of the coast. Every new area pays a discovery bonus.',
  call: 'Dex calls when he has work. Press Y to answer, X to send him to voicemail.',
};

// Direction and pacing: what to do next, where it is, and how to get there.
export class Guide {
  constructor(G) {
    this.G = G;
    this.target = null;
    this.visited = new Set();
    this.tipsShown = new Set();
    this.region = null;
    this.uiT = 0;
    this.tipQ = [];
    this.tipT = 6;
    this.el = {
      tracker: $('tracker'), kicker: $('tk-kicker'), title: $('tk-title'), dist: $('tk-dist'), dest: $('tk-dest'),
      turn: $('tk-turn'), hint: $('tk-hint'), wp: $('wp-marker'), wpDist: $('wp-dist'), wpLabel: $('wp-label'), journal: $('journal'),
    };
    this._v = new THREE.Vector3();
  }

  save() { return { visited: [...this.visited], tips: [...this.tipsShown] }; }
  load(s) {
    if (!s) return;
    for (const v of s.visited || []) this.visited.add(v);
    for (const t of s.tips || []) this.tipsShown.add(t);
  }

  tip(id) {
    if (this.tipsShown.has(id) || this.tipQ.includes(id)) return;
    this.tipQ.push(id);
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
    const G = this.G;
    this.target = this.computeTarget();
    this.updateRegion();
    this.updateTips(dt);
    this.updateMarker();
    this.uiT -= dt;
    if (this.uiT <= 0) { this.uiT = 0.15; this.updateTracker(); }
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

  updateTips(dt) {
    const G = this.G;
    this.tip('route');
    if (G.wanted.stars > 0) this.tip('wanted');
    if (G.arsenal.armed) this.tip('gun');
    this.tipT -= dt;
    if (this.tipT > 0 || !this.tipQ.length || G.ui.open) return;
    const id = this.tipQ.shift();
    this.tipsShown.add(id);
    G.notify(TIPS[id], 7);
    this.tipT = 9;
  }

  // floating diamond over the target, pinned to the screen edge when it's off-view
  updateMarker() {
    const G = this.G, el = this.el;
    const goal = G.gps.goal;
    const P = G.player.pos;
    if (!goal || G.player.space !== G.world || G.ui.open || !G.player.alive) { el.wp.hidden = true; return; }
    const d = Math.hypot(goal.x - P.x, goal.z - P.z);
    if (d < 10) { el.wp.hidden = true; return; }
    el.wp.hidden = false;
    const cam = G.camera;
    const v = this._v.set(goal.x, G.world.groundY(goal.x, goal.z) + 3.5, goal.z).project(cam);
    let x = v.x, y = v.y;
    const behind = v.z > 1;
    if (behind) { x = -x; y = -y; }
    const ex = 0.8, ey = 0.78;
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
    el.wp.style.setProperty('--ang', `${Math.atan2(-y, x)}rad`);
    el.wpDist.textContent = fmtDist(d);
    el.wpLabel.textContent = goal.label;
  }

  updateTracker() {
    const G = this.G, el = this.el, M = G.missions, gps = G.gps;
    let kicker = '', title = '', hint = '';
    if (G.heist.phase === 'escape') { kicker = 'Getaway'; title = 'Get the bag to safety'; }
    else if (M.active) { kicker = `Mission ${M.index + 1}/${M.list.length}`; title = M.active.m.title; }
    else if (G.heist.running) { kicker = 'Heist'; title = 'The Solano Job'; }
    else if (!M.done) {
      kicker = 'Next job';
      title = M.current.title;
      hint = G.phone.ringing ? 'Dex is calling: press Y to answer' : M.current.phone === false ? 'Meet Dex at the blue marker' : 'Dex will call soon, or meet him at the motel';
    } else { kicker = 'Free roam'; title = gps.waypoint ? gps.waypoint.label : 'Port Solano is yours'; }
    const goal = gps.goal;
    let route = false;
    if (goal && gps.route && G.player.space === G.world) {
      route = true;
      el.dist.textContent = fmtDist(gps.distLeft);
      el.dest.textContent = goal.label;
      const t = gps.turn;
      let dir = 'ahead';
      if (gps.distLeft < 40) { dir = 'arrive'; hint = hint || 'Destination ahead'; }
      else if (t && t.dist < 220) { dir = t.dir; hint = hint || (t.dir === 'uturn' ? `Turn around in ${fmtDist(t.dist)}` : `Turn ${t.dir} in ${fmtDist(t.dist)}`); }
      else hint = hint || (G.player.vehicle ? 'Follow the road' : 'Follow the arrows');
      el.turn.dataset.dir = dir;
    } else if (goal && G.player.space !== G.world) {
      route = true;
      el.dist.textContent = '';
      el.dest.textContent = goal.label;
      el.turn.dataset.dir = 'exit';
      hint = hint || 'Head outside';
    }
    el.tracker.hidden = !title;
    el.kicker.textContent = kicker;
    el.title.textContent = title;
    el.tracker.classList.toggle('noroute', !route);
    el.hint.textContent = hint;
    el.hint.hidden = !hint;
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

  // pause-screen journal: story progress, places, assets
  renderJournal() {
    const G = this.G, M = G.missions;
    const rows = M.list.map((m, i) => {
      const done = M.completed.has(m.id);
      const cur = !done && i === M.index;
      return `<li class="${done ? 'done' : cur ? 'cur' : 'locked'}"><span>${done ? '✓' : cur ? '▶' : '·'}</span>${cur || done ? m.title : 'Locked'}${cur ? `<small>${M.active ? 'In progress' : m.phone === false ? 'Meet Dex at the motel' : 'Dex will call'}</small>` : ''}</li>`;
    }).join('');
    const regions = REGIONS.map((r) => `<span class="${this.visited.has(r.id) ? 'on' : ''}" style="--c:${r.color}">${r.name}</span>`).join('');
    const owned = [...G.economy.owned].map((id) => ({ motel: 'Safehouse', arcade: 'Neon Arcade' }[id])).join(', ') || 'None yet';
    this.el.journal.innerHTML = `
      <section><h3>Story</h3><ol>${rows}</ol></section>
      <section><h3>Coast</h3><div class="regions">${regions}</div></section>
      <section><h3>Ledger</h3><dl>
        <dt>Cash</dt><dd>${fmtMoney(G.money)}</dd>
        <dt>Property</dt><dd>${owned}</dd>
        <dt>Neon shells</dt><dd>${G.tokens.size}/${G.tokenTotal}</dd>
        <dt>Bank jobs</dt><dd>${G.heist.successes}</dd>
      </dl></section>`;
  }
}
