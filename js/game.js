'use strict';
const ESC_DIST = 6.5; // tiles: if you are farther than this when a fleeing gem tires out, it escapes
const ARMOR_COLORS = ['#6d8fb3', '#8b5a2b', '#9aa4ad', '#c9d2da', '#7fe3ff', '#ffd86b'];
const PICK_COLORS = ['#8a6d5a', '#d9824a', '#b8bcc4', '#e6edf3', '#7fe8ff', '#ffe066'];
const BOOT_COLORS = ['#4a3b2e', '#8b5a2b', '#3fa66b', '#7ad0ff', '#ff9a3c', '#ffe066'];
const SHOT_COLORS = ['#ffffff', '#ffe9a8', '#ffd27a', '#8af0ff', '#ff9bf0', '#fff6a8'];

// Axis-separated tile collision. Returns the tiles that blocked movement.
function moveEntity(w, e, dx, dy) {
  const res = { hx: null, hy: null };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.25));
  const sx = dx / steps, sy = dy / steps, r = e.r;
  for (let s = 0; s < steps; s++) {
    if (sx) {
      e.x += sx;
      const y0 = Math.floor(e.y - r), y1 = Math.floor(e.y + r - 1e-6);
      const tx = sx > 0 ? Math.floor(e.x + r) : Math.floor(e.x - r);
      let hit = null;
      for (let ty = y0; ty <= y1; ty++)
        if (w.solid(tx, ty) && (!hit || Math.abs(ty + 0.5 - e.y) < Math.abs(hit.y + 0.5 - e.y))) hit = { x: tx, y: ty };
      if (hit) { e.x = sx > 0 ? tx - r - 1e-4 : tx + 1 + r + 1e-4; res.hx = hit; }
    }
    if (sy) {
      e.y += sy;
      const x0 = Math.floor(e.x - r), x1 = Math.floor(e.x + r - 1e-6);
      const ty = sy > 0 ? Math.floor(e.y + r) : Math.floor(e.y - r);
      let hit = null;
      for (let tx = x0; tx <= x1; tx++)
        if (w.solid(tx, ty) && (!hit || Math.abs(tx + 0.5 - e.x) < Math.abs(hit.x + 0.5 - e.x))) hit = { x: tx, y: ty };
      if (hit) { e.y = sy > 0 ? ty - r - 1e-4 : ty + 1 + r + 1e-4; res.hy = hit; }
    }
  }
  return res;
}

// ======================= ENEMY =======================
class Enemy {
  constructor(mine, x, y) {
    const E = mine.F.enemy;
    Object.assign(this, {
      mine, x, y, E, r: 0.33, hp: E.hp, maxHp: E.hp, dirA: rand(0, TAU), wT: 0, flash: 0,
      kbx: 0, kby: 0, anim: rand(0, 10), aggro: false, idle: false, face: 1,
    });
  }
  update(dt) {
    const p = this.mine.player, d = dist(this.x, this.y, p.x, p.y);
    this.flash -= dt; this.wT -= dt; this.anim += dt * 9;
    let vx = 0, vy = 0;
    const spd = this.E.speed;
    if (!this.mine.dead && (d < 6.5 || (this.aggro && d < 11))) {
      this.aggro = true;
      vx = ((p.x - this.x) / d) * spd; vy = ((p.y - this.y) / d) * spd;
    } else {
      this.aggro = false;
      if (this.wT <= 0) { this.dirA = rand(0, TAU); this.wT = rand(1, 2.5); this.idle = Math.random() < 0.35; }
      if (!this.idle) { vx = Math.cos(this.dirA) * spd * 0.4; vy = Math.sin(this.dirA) * spd * 0.4; }
    }
    if (Math.abs(vx) > 0.1) this.face = vx > 0 ? 1 : -1;
    vx += this.kbx; vy += this.kby;
    const f = Math.pow(0.001, dt);
    this.kbx *= f; this.kby *= f;
    const res = moveEntity(this.mine.world, this, vx * dt, vy * dt);
    if (!this.aggro && (res.hx || res.hy)) this.wT = 0;
    if (d < this.r + p.r + 0.08) this.mine.hurtPlayer(this.E.dmg, this.x, this.y);
  }
  draw(ctx, x, y, ts) {
    const s = ts / 32, E = this.E, a = this.anim;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 8 * s, 11 * s, 4 * s, 0, 0, TAU); ctx.fill();
    ctx.scale(this.face, 1);
    // legs
    ctx.strokeStyle = shade(E.color, -0.4);
    ctx.lineWidth = 2 * s;
    for (let i = -1; i <= 1; i++) {
      const o = Math.sin(a + i * 2) * 2 * s;
      ctx.beginPath(); ctx.moveTo(i * 5 * s, 2 * s); ctx.lineTo(i * 6 * s + o, 8 * s); ctx.stroke();
    }
    // body
    const body = this.flash > 0 ? '#ffffff' : E.color;
    const g = ctx.createLinearGradient(0, -10 * s, 0, 6 * s);
    g.addColorStop(0, shade(body, 0.3)); g.addColorStop(1, shade(body, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 11 * s, 8 * s, 0, 0, TAU); ctx.fill();
    // crystal spikes on its back
    for (let i = 0; i < 3; i++) {
      const cx = (-5 + i * 5) * s, h = (7 + (i === 1 ? 4 : 0)) * s;
      ctx.fillStyle = shade(E.crystal, i === 1 ? 0.2 : -0.1);
      ctx.beginPath(); ctx.moveTo(cx - 2.5 * s, -5 * s); ctx.lineTo(cx, -5 * s - h); ctx.lineTo(cx + 2.5 * s, -5 * s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.moveTo(cx - 0.8 * s, -5 * s); ctx.lineTo(cx, -5 * s - h * 0.8); ctx.lineTo(cx + 0.2 * s, -5 * s); ctx.fill();
    }
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(6 * s, -1 * s, 2.6 * s, 0, TAU); ctx.arc(1.5 * s, -1.5 * s, 2.2 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = this.aggro ? '#e0203a' : '#111';
    ctx.beginPath(); ctx.arc(7 * s, -1 * s, 1.3 * s, 0, TAU); ctx.arc(2.4 * s, -1.5 * s, 1.1 * s, 0, TAU); ctx.fill();
    ctx.restore();
    if (this.hp < this.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 12 * s, y - 20 * s, 24 * s, 3.5 * s);
      ctx.fillStyle = '#ff5a6e'; ctx.fillRect(x - 12 * s, y - 20 * s, 24 * s * (this.hp / this.maxHp), 3.5 * s);
    }
  }
}

// ======================= BOSS: a living gemstone =======================
class Boss {
  constructor(mine, fi, x, y) {
    this.mine = mine;
    this.B = BOSSES[FLOORS[fi].boss];
    this.gem = { color: this.B.color, cut: this.B.cut, rainbow: this.B.rainbow };
    this.homeX = x; this.homeY = y;
    this.r = 0.8;
    this.reset();
  }
  reset() {
    this.x = this.homeX; this.y = this.homeY;
    this.hp = this.maxHp = this.B.hp;
    this.state = 'dormant';
    this.thresholds = [0.75, 0.5, 0.25];
    this.escape = 0; this.pending = []; this.trail = [];
    this.fireT = 1.5; this.orbit = rand(0, TAU); this.orbitDir = 1;
    this.slowT = 0; this.flash = 0; this.t = 0; this.stateT = 0;
    this.patIdx = 0; this.trailT = 0; this.backT = 1; this.restT = 0; this.fleeT = 0; this.lostT = 0;
  }
  get active() { return this.state !== 'dormant' && this.state !== 'dead'; }

  wake() {
    if (this.state !== 'dormant') return;
    this.state = 'fight'; this.stateT = 0; this.fireT = 1.2;
    Sfx.play('roar');
    this.mine.shake = Math.max(this.mine.shake, 0.6);
    UI.toast(`💢 ${this.B.name} awakens!`, 'boss');
    this.mine.ring(this.x, this.y, this.B.color, 4);
  }

  damage(d) {
    if (this.state === 'dead') return;
    if (this.state === 'dormant') this.wake();
    let crit = false;
    if (this.state === 'rest') { d *= 1.5; crit = true; }
    d = Math.round(d);
    this.hp -= d; this.flash = 0.1; this.slowT = 0.2;
    this.mine.floatText(this.x + rand(-0.4, 0.4), this.y - 0.9, (crit ? '✦' : '') + d, crit ? '#ffd25e' : '#ffffff', crit ? 1.3 : 1);
    this.mine.sparks(this.x, this.y, this.B.color, 6);
    Sfx.play('hit');
    if (this.hp <= 0) { this.die(); return; }
    if (this.thresholds.length && this.hp / this.maxHp <= this.thresholds[0] && this.state !== 'flee') {
      while (this.thresholds.length && this.hp / this.maxHp <= this.thresholds[0]) this.thresholds.shift();
      this.startFlee();
    }
  }

  pickFleeTarget() {
    const p = this.mine.player, w = this.mine.world;
    let best = null, bs = -1e9;
    const pd = dist(this.x, this.y, p.x, p.y) + 0.01;
    for (let i = 0; i < 40; i++) {
      const tx = rand(4, w.W - 4), ty = rand(4, w.H - 4);
      const dS = dist(tx, ty, this.x, this.y) + 0.01, dP = dist(tx, ty, p.x, p.y);
      const away = ((tx - this.x) * (this.x - p.x) + (ty - this.y) * (this.y - p.y)) / (dS * pd);
      const score = dP + away * 8 - (dS < 14 ? 60 : 0);
      if (score > bs) { bs = score; best = { x: tx, y: ty }; }
    }
    this.tx = best.x; this.ty = best.y;
  }

  startFlee() {
    const w = this.mine.world;
    this.state = 'flee'; this.stateT = 0; this.fleeT = this.B.fleeTime; this.backT = 1.2; this.lostT = 0;
    this.pickFleeTarget();
    // shockwave burst, then a short blink away
    for (let i = 0; i < 8; i++) this.bullet((i / 8) * TAU + this.t, this.B.bulletSpeed * 0.8);
    const a = Math.atan2(this.ty - this.y, this.tx - this.x);
    for (let k = 0; k < 10; k++) {
      this.x = clamp(this.x + Math.cos(a) * 0.25, 2 + this.r, w.W - 2 - this.r);
      this.y = clamp(this.y + Math.sin(a) * 0.25, 2 + this.r, w.H - 2 - this.r);
      this.carve();
    }
    Sfx.play('flee');
    this.mine.ring(this.x, this.y, '#ffffff', 3);
    UI.toast(`💨 ${this.B.name} is fleeing! Stay within range until it tires out.`, 'boss');
  }

  rest(t, msg) {
    this.state = 'rest'; this.restT = t; this.stateT = 0;
    if (msg) this.mine.floatText(this.x, this.y - 1.3, msg, '#ffd25e', 1.2);
  }

  escaped() {
    Sfx.play('escape');
    UI.toast(`😤 ${this.B.name} got away and healed in its lair! You were too far behind when it tired. Faster boots, dashing and ranged hits (they slow it) help you keep up.`, 'warn', 7);
    for (const q of this.mine.proj) if (q.own === 'e') q.life = 0;
    this.mine.ring(this.x, this.y, this.B.color, 3);
    this.reset();
  }

  die() {
    this.state = 'dead';
    this.pending = [];
    this.mine.bossDefeated(this);
  }

  bullet(a, spd, mul = 1) {
    this.mine.proj.push({
      x: this.x + Math.cos(a) * 0.6, y: this.y + Math.sin(a) * 0.6,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      dmg: this.B.dmg * mul, own: 'e', r: 0.2, life: 5, color: this.B.color, shard: true,
    });
  }
  aimAngle() { const p = this.mine.player; return Math.atan2(p.y - this.y, p.x - this.x); }

  fire() {
    const S0 = this.B.bulletSpeed;
    let pat = this.B.pattern;
    if (pat === 'all') pat = ['aimed', 'spread', 'ring', 'spiral'][this.patIdx++ % 4];
    const enraged = this.hp / this.maxHp < 0.5;
    const a = this.aimAngle();
    switch (pat) {
      case 'aimed':
        for (let i = 0; i < (enraged ? 4 : 3); i++) this.pending.push({ d: i * 0.15, f: () => this.bullet(this.aimAngle(), S0 * 1.1) });
        break;
      case 'spread': {
        const n = enraged ? 7 : 5;
        for (let i = 0; i < n; i++) this.bullet(a + (i - (n - 1) / 2) * 0.22, S0);
        break;
      }
      case 'ring': {
        const n = enraged ? 16 : 12, off = Math.random() * TAU;
        for (let i = 0; i < n; i++) this.bullet(off + (i / n) * TAU, S0 * 0.85);
        this.pending.push({ d: 0.35, f: () => this.bullet(this.aimAngle(), S0 * 1.2) });
        break;
      }
      case 'spiral': {
        const n = enraged ? 20 : 14, base = Math.random() * TAU;
        for (let i = 0; i < n; i++)
          this.pending.push({ d: i * 0.08, f: () => { const aa = base + i * 0.45; this.bullet(aa, S0 * 0.9); this.bullet(aa + Math.PI, S0 * 0.9); } });
        break;
      }
    }
    Sfx.play('shoot');
  }

  moveToward(tx, ty, spd, dt) {
    const dx = tx - this.x, dy = ty - this.y, l = Math.hypot(dx, dy);
    if (l < 1e-3) return true;
    const step = Math.min(l, spd * dt);
    const w = this.mine.world;
    this.x = clamp(this.x + (dx / l) * step, 2 + this.r, w.W - 2 - this.r);
    this.y = clamp(this.y + (dy / l) * step, 2 + this.r, w.H - 2 - this.r);
    this.carve();
    return l - step < 0.4;
  }

  // Living gems burrow straight through rock, spilling any gems inside.
  carve() {
    const w = this.mine.world, rr = this.r + 0.15;
    for (let y = Math.floor(this.y - rr); y <= Math.floor(this.y + rr); y++)
      for (let x = Math.floor(this.x - rr); x <= Math.floor(this.x + rr); x++) {
        const t = w.get(x, y);
        if (t === 0 || t === BEDROCK) continue;
        const nx = clamp(this.x, x, x + 1), ny = clamp(this.y, y, y + 1);
        if ((nx - this.x) ** 2 + (ny - this.y) ** 2 > rr * rr) continue;
        const color = ROCKS[t - 1].color;
        const gem = w.clear(x, y);
        this.mine.debris(x + 0.5, y + 0.5, color, 4);
        if (gem) this.mine.dropGem(gem, x + 0.5, y + 0.5);
        if (Math.random() < 0.25) Sfx.play('mine');
      }
  }

  update(dt) {
    const m = this.mine, p = m.player;
    const d = dist(this.x, this.y, p.x, p.y);
    this.t += dt; this.stateT += dt; this.flash -= dt; this.slowT -= dt;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const q = this.pending[i];
      q.d -= dt;
      if (q.d <= 0) { this.pending.splice(i, 1); if (this.active) q.f(); }
    }
    if (this.state === 'dormant') {
      if (d < 5.5 && !m.dead) this.wake();
      return;
    }
    if (this.state === 'dead') return;

    if (this.state === 'fight') {
      this.orbit += dt * 0.7 * this.orbitDir;
      if (Math.random() < dt * 0.3) this.orbitDir *= -1;
      const tx = p.x + Math.cos(this.orbit) * 3.8, ty = p.y + Math.sin(this.orbit) * 3.8;
      this.moveToward(tx, ty, this.B.speed * (this.slowT > 0 ? 0.6 : 1), dt);
      this.fireT -= dt;
      if (this.fireT <= 0 && d < 13 && !m.dead) {
        this.fire();
        this.fireT = this.B.fireCd * rand(0.85, 1.15);
      }
    } else if (this.state === 'flee') {
      const spd = this.B.fleeSpeed * (this.slowT > 0 ? 0.85 : 1);
      const reached = this.moveToward(this.tx, this.ty, spd, dt);
      this.fleeT -= dt;
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.05;
        this.trail.push({ x: this.x, y: this.y, life: 0.35 });
        if (this.B.fireTrail && Math.random() < 0.35) m.hazards.push({ x: this.x, y: this.y, r: 0.55, life: 3.5, max: 3.5, dmg: this.B.dmg * 0.6 });
      }
      this.backT -= dt;
      if (this.backT <= 0 && d < 12) { this.backT = 1.1; this.bullet(this.aimAngle(), this.B.bulletSpeed); }
      if (reached) this.pickFleeTarget();
      this.escape = d / ESC_DIST;
      if (d < 1.7 && this.stateT > 1.2) this.rest(1.4, 'Cornered!');
      else if (this.fleeT <= 0) {
        if (d <= ESC_DIST) this.rest(1.8, 'Exhausted!');
        else { this.escaped(); return; }
      } else if (d > ESC_DIST + 5) {
        // lost sight of it entirely
        this.lostT += dt;
        if (this.lostT > 1.2) { this.escaped(); return; }
      } else this.lostT = 0;
    } else if (this.state === 'rest') {
      this.restT -= dt;
      if (this.restT <= 0) { this.state = 'fight'; this.stateT = 0; this.fireT = 0.5; }
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
    if (this.active && d < this.r + p.r) m.hurtPlayer(this.B.contact, this.x, this.y);
  }

  draw(ctx, x, y, ts, t, mine) {
    const r = this.r * ts;
    const bob = Math.sin(t * (this.state === 'dormant' ? 1.5 : 4)) * r * 0.08;
    // after-images while fleeing
    for (const tr of this.trail)
      drawGem(ctx, mine.sx(tr.x), mine.sy(tr.y), r * 1.15, this.gem, t, { alpha: tr.life * 0.9, twinkle: false });
    const gy = y + bob;
    // aura
    const ag = ctx.createRadialGradient(x, gy, r * 0.3, x, gy, r * 2.4);
    ag.addColorStop(0, withAlpha(gemColor(this.gem, t, 0), this.state === 'dormant' ? 0.25 : 0.45));
    ag.addColorStop(1, withAlpha(this.gem.color, 0));
    ctx.fillStyle = ag;
    ctx.fillRect(x - r * 2.5, gy - r * 2.5, r * 5, r * 5);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 1.1, r * 0.9, r * 0.3, 0, 0, TAU); ctx.fill();
    // orbiting shards
    const nShard = 4;
    for (let i = 0; i < nShard; i++) {
      const a = t * (this.state === 'flee' ? 5 : 1.6) + (i / nShard) * TAU;
      drawGem(ctx, x + Math.cos(a) * r * 1.6, gy + Math.sin(a) * r * 0.8, r * 0.22, this.gem, t + i, { rot: a, twinkle: false });
    }
    drawGem(ctx, x, gy, r * 1.25, this.gem, t, { flash: this.flash > 0 });
    // face
    const ex = r * 0.3, ey = gy - r * 0.08, p = mine.player;
    const la = Math.atan2(p.y - this.y, p.x - this.x);
    const lx = Math.cos(la) * r * 0.06, ly = Math.sin(la) * r * 0.06;
    ctx.lineCap = 'round';
    if (this.state === 'dormant') {
      ctx.strokeStyle = 'rgba(20,10,30,0.85)'; ctx.lineWidth = r * 0.07;
      ctx.beginPath();
      ctx.arc(-ex + x, ey, r * 0.12, 0.2, Math.PI - 0.2); ctx.moveTo(ex + x + r * 0.12, ey);
      ctx.arc(ex + x, ey, r * 0.12, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(r * 0.45)}px system-ui, sans-serif`;
      const zt = (t * 0.8) % 1;
      ctx.globalAlpha = 1 - zt;
      ctx.fillText('z', x + r * 0.8 + zt * r * 0.5, gy - r * 0.9 - zt * r * 0.8);
      ctx.globalAlpha = 1;
    } else if (this.state === 'rest') {
      ctx.strokeStyle = 'rgba(20,10,30,0.9)'; ctx.lineWidth = r * 0.07;
      for (const sx of [-1, 1]) {
        const cx = x + sx * ex, k = r * 0.1;
        ctx.beginPath(); ctx.moveTo(cx - k, ey - k); ctx.lineTo(cx + k, ey + k); ctx.moveTo(cx + k, ey - k); ctx.lineTo(cx - k, ey + k); ctx.stroke();
      }
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i / 3) * TAU;
        drawSparkle(ctx, x + Math.cos(a) * r * 0.7, gy - r * 1.3 + Math.sin(a) * r * 0.2, r * 0.18, '#ffd25e', 1);
      }
    } else {
      const scared = this.state === 'flee';
      for (const sx of [-1, 1]) {
        const cx = x + sx * ex;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx, ey, r * 0.13, r * (scared ? 0.17 : 0.12), 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#1a0f24';
        ctx.beginPath(); ctx.arc(cx + lx, ey + ly, r * (scared ? 0.05 : 0.07), 0, TAU); ctx.fill();
        if (!scared) {
          ctx.strokeStyle = '#1a0f24'; ctx.lineWidth = r * 0.06;
          ctx.beginPath(); ctx.moveTo(cx - sx * r * 0.16, ey - r * 0.22); ctx.lineTo(cx + sx * r * 0.12, ey - r * 0.12); ctx.stroke();
        }
      }
      if (scared) {
        ctx.fillStyle = '#9fe6ff';
        ctx.beginPath(); ctx.ellipse(x + r * 0.62, gy - r * 0.35, r * 0.07, r * 0.11, 0.3, 0, TAU); ctx.fill();
      }
    }
  }
}

// ======================= MINE (one floor run) =======================
class Mine {
  constructor(fi) {
    this.fi = fi;
    this.F = FLOORS[fi];
    this.st = getStats();
    this.world = new World(fi, this.st.luck);
    const sp = this.world.spawn;
    this.player = {
      x: sp.x, y: sp.y, r: 0.3, hp: this.st.maxHp, fx: 1, fy: 0, flip: 1, walk: 0, moving: false,
      dashT: 0, dashCd: 0, ddx: 0, ddy: 0, swingCd: 0, swingAnim: 0, swingA: 0, shootCd: 0, inv: 0,
      kbx: 0, kby: 0, recall: 0,
    };
    this.enemies = this.world.enemySpawns.map((s) => new Enemy(this, s.x, s.y));
    this.boss = S.bosses[fi] ? null : new Boss(this, fi, this.world.lairPos.x, this.world.lairPos.y);
    this.proj = []; this.items = []; this.parts = []; this.texts = []; this.hazards = [];
    this.cam = { x: sp.x, y: sp.y };
    this.shake = 0; this.time = 0; this.notes = {};
    this.dead = false; this.deadT = 0; this.mineSfxT = 0; this.mmT = 0;
    this.ox = 0; this.oy = 0;
    this.startBag = S.bag.length;
    this.revealAround(sp.x, sp.y, this.st.lamp + 1);
  }

  // ---- coordinate helpers ----
  sx(x) { return this.ox + x * Game.ts; }
  sy(y) { return this.oy + y * Game.ts; }
  screenToWorld(px, py) { return { x: (px - this.ox) / Game.ts, y: (py - this.oy) / Game.ts }; }

  notify(key, text, cd = 3, kind) {
    if ((this.notes[key] || 0) > this.time) return;
    this.notes[key] = this.time + cd;
    UI.toast(text, kind);
  }

  bossNear(range = 16) {
    const b = this.boss;
    return b && b.active && dist(b.x, b.y, this.player.x, this.player.y) < range;
  }
  onElevator() { const s = this.world.spawn; return dist(this.player.x, this.player.y, s.x, s.y) < 0.9; }

  revealAround(cx, cy, r) {
    const w = this.world, R = Math.ceil(r);
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (w.inb(x, y)) w.seen[w.idx(x, y)] = 1;
      }
  }

  // ---- effects ----
  debris(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(1, 4);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.6), max: 0.6, color: shade(color, rand(-0.2, 0.2)), size: rand(0.06, 0.13), sq: true });
    }
  }
  sparks(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(2, 6);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.45), max: 0.45, color, size: rand(0.05, 0.1), spark: true });
    }
  }
  ring(x, y, color, maxR) { this.parts.push({ x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, color, ring: true, maxR }); }
  floatText(x, y, text, color, scale = 1) {
    this.texts.push({ x, y, text, color, life: 1.1, max: 1.1, scale });
  }

  dropGem(id, x, y, burst = 2) {
    const a = rand(0, TAU), s = rand(0.5, burst);
    this.items.push({ kind: 'gem', id, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0, 5), age: 0 });
  }
  dropCoins(x, y, total) {
    const n = clamp(Math.ceil(total / 10), 1, 8);
    const each = Math.ceil(total / n);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(1, 3);
      this.items.push({ kind: 'coin', val: each, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rand(0, 5), age: 0 });
    }
  }

  // ---- combat ----
  hurtPlayer(dmg, fromX, fromY) {
    const p = this.player;
    if (p.inv > 0 || this.dead) return;
    const d = Math.max(1, Math.round(dmg * (1 - this.st.def)));
    p.hp -= d;
    p.inv = 0.7;
    if (fromX != null) {
      const a = Math.atan2(p.y - fromY, p.x - fromX);
      p.kbx = Math.cos(a) * 6; p.kby = Math.sin(a) * 6;
    }
    if (p.recall > 0) { p.recall = 0; UI.toast('Recall interrupted!', 'warn'); }
    this.shake = Math.max(this.shake, 0.35);
    this.floatText(p.x, p.y - 0.7, '-' + d, '#ff5a6e');
    Sfx.play('hurt');
    if (p.hp <= 0) this.die();
  }

  die() {
    const p = this.player;
    p.hp = 0;
    this.dead = true; this.deadT = 2.6;
    const lost = S.bag.filter((id) => !GEMS[id].boss).length;
    S.bag = S.bag.filter((id) => GEMS[id].boss); // boss hearts are never lost
    S.deaths++;
    save();
    Sfx.play('death');
    this.debris(p.x, p.y, '#f5c542', 20);
    UI.toast(`💀 You fainted! ${lost} gem${lost === 1 ? '' : 's'} were lost in the dark.`, 'warn', 5);
  }

  hitEnemy(e, dmg, fromX, fromY) {
    dmg = Math.round(dmg);
    e.hp -= dmg; e.flash = 0.1; e.aggro = true;
    const a = Math.atan2(e.y - fromY, e.x - fromX);
    e.kbx = Math.cos(a) * 7; e.kby = Math.sin(a) * 7;
    this.floatText(e.x, e.y - 0.6, String(dmg), '#ffffff');
    this.sparks(e.x, e.y, e.E.crystal, 4);
    Sfx.play('hit');
    if (e.hp <= 0) {
      this.enemies.splice(this.enemies.indexOf(e), 1);
      this.debris(e.x, e.y, e.E.color, 12);
      this.debris(e.x, e.y, e.E.crystal, 6);
      this.dropCoins(e.x, e.y, randi(e.E.coins[0], e.E.coins[1]));
      if (Math.random() < 0.3) this.dropGem(rollGem(this.fi, this.st.luck, Math.random), e.x, e.y);
    }
  }

  swing() {
    const p = this.player, st = this.st;
    p.swingCd = 0.38; p.swingAnim = 0.22;
    let best = null, bd = 2.2;
    for (const e of this.enemies) { const d = dist(p.x, p.y, e.x, e.y) - e.r; if (d < bd) { bd = d; best = e; } }
    const b = this.boss;
    if (b && b.state !== 'dead') { const d = dist(p.x, p.y, b.x, b.y) - b.r; if (d < bd) { bd = d; best = b; } }
    if (best) { const a = Math.atan2(best.y - p.y, best.x - p.x); p.fx = Math.cos(a); p.fy = Math.sin(a); }
    const fa = Math.atan2(p.fy, p.fx);
    p.swingA = fa;
    if (Math.abs(p.fx) > 0.1) p.flip = p.fx > 0 ? 1 : -1;
    const inArc = (e) => {
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > 1.25 + e.r) return false;
      return d < e.r + 0.35 || Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), fa)) < 1.2;
    };
    let hit = false;
    for (const e of this.enemies.slice()) if (inArc(e)) { this.hitEnemy(e, st.meleeDmg, p.x, p.y); hit = true; }
    if (b && b.state !== 'dead' && inArc(b)) { b.damage(st.meleeDmg); hit = true; }
    if (!hit) {
      const tx = Math.floor(p.x + p.fx * (p.r + 0.4)), ty = Math.floor(p.y + p.fy * (p.r + 0.4));
      if (this.world.solid(tx, ty)) this.mineTile(tx, ty, st.power * 0.45, true);
    }
    Sfx.play('swing');
  }

  shoot() {
    const p = this.player, st = this.st;
    let a;
    if (Input.mouse.down && !Input.isTouch) {
      const w = this.screenToWorld(Input.mouse.x, Input.mouse.y);
      a = Math.atan2(w.y - p.y, w.x - p.x);
    } else {
      let best = null, bd = 11;
      const b = this.boss;
      if (b && b.active && dist(p.x, p.y, b.x, b.y) < 14) best = b;
      else for (const e of this.enemies) { const d = dist(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      a = best ? Math.atan2(best.y - p.y, best.x - p.x) : Math.atan2(p.fy, p.fx);
    }
    p.fx = Math.cos(a); p.fy = Math.sin(a);
    if (Math.abs(p.fx) > 0.1) p.flip = p.fx > 0 ? 1 : -1;
    this.proj.push({
      x: p.x + p.fx * 0.3, y: p.y + p.fy * 0.3, vx: p.fx * 12, vy: p.fy * 12,
      dmg: st.slingDmg, own: 'p', r: 0.14, life: 1.1, color: SHOT_COLORS[S.gear.sling],
    });
    p.shootCd = st.slingCd;
    Sfx.play('shoot');
  }

  mineTile(tx, ty, amount, fromSwing) {
    const w = this.world, t = w.get(tx, ty);
    if (t === 0) return;
    if (t === BEDROCK) { this.notify('bed', 'That is unbreakable bedrock.'); return; }
    const rock = ROCKS[t - 1];
    if (rock.tier > this.st.tier) {
      this.notify('tier', `🪨 ${rock.name} is too hard! You need a ${pickNameForTier(rock.tier)}.`, 3, 'warn');
      if (fromSwing) this.sparks(tx + 0.5, ty + 0.5, '#ffffff', 3);
      return;
    }
    const i = w.idx(tx, ty);
    const maxHp = rock.hp * (w.gem[i] ? 1.25 : 1);
    w.dmg[i] += amount;
    this.mineSfxT -= fromSwing ? 1 : amount;
    if (this.mineSfxT <= 0) {
      this.mineSfxT = 0.12;
      Sfx.play('mine');
      this.debris(tx + 0.5, ty + 0.5, rock.color, 2);
    }
    if (w.dmg[i] >= maxHp) {
      const gem = w.clear(tx, ty);
      this.debris(tx + 0.5, ty + 0.5, rock.color, 10);
      Sfx.play('break');
      if (gem) {
        this.dropGem(gem, tx + 0.5, ty + 0.5, 1);
        this.sparks(tx + 0.5, ty + 0.5, GEMS[gem].color, 8);
      }
    }
  }

  pickupGem(it) {
    const id = it.id, g = GEMS[id];
    S.bag.push(id);
    const isNew = !S.found[id];
    S.found[id] = (S.found[id] || 0) + 1;
    Sfx.play('gem', g.r);
    this.sparks(it.x, it.y, g.color, 6 + g.r * 3);
    this.floatText(it.x, it.y - 0.5, `+${g.name}${isNew ? ' (NEW!)' : ''}`, RARITY[g.r].color, g.r >= 3 ? 1.15 : 0.9);
    if (g.r >= 3 || isNew) UI.bigFind(id, isNew);
  }

  bossDefeated(b) {
    const fi = this.fi;
    S.bosses[fi] = true;
    if (fi + 1 < FLOORS.length) S.unlocked = Math.max(S.unlocked, fi + 2);
    for (const q of this.proj) if (q.own === 'e') q.life = 0;
    this.items.push({ kind: 'gem', id: b.B.heart, x: b.x, y: b.y, vx: 0, vy: 0, t: 0, age: 0 });
    this.dropCoins(b.x, b.y, b.B.reward);
    for (let i = 0; i < 5; i++) this.ring(b.x, b.y, i % 2 ? '#ffffff' : b.B.color, 2 + i * 1.5);
    this.sparks(b.x, b.y, b.B.color, 60);
    this.sparks(b.x, b.y, '#ffffff', 30);
    this.shake = 1;
    Sfx.play('bossDie');
    const next = fi + 1 < FLOORS.length ? ` Floor ${fi + 2}: ${FLOORS[fi + 1].name} is now open!` : '';
    UI.toast(`🏆 You defeated ${b.B.name}!${next}`, 'boss', 6);
    if (fi === FLOORS.length - 1 && !S.won) { S.won = true; this.showVictory = 2.5; }
    save();
  }

  exit(reason) {
    const n = S.bag.length - this.startBag;
    Game.goTown(reason === 'death' ? null : `⛺ Back at camp. You found ${Math.max(0, n)} gem${n === 1 ? '' : 's'} this trip.`);
  }

  // ======================= UPDATE =======================
  update(dt) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const p = this.player, st = this.st, w = this.world;

    if (this.dead) {
      this.deadT -= dt;
      if (this.deadT <= 0) { this.exit('death'); return; }
    } else {
      this.updatePlayer(dt);
    }
    if (this.showVictory) {
      this.showVictory -= dt;
      if (this.showVictory <= 0) { this.showVictory = 0; UI.victory(); }
    }

    for (const e of this.enemies.slice()) e.update(dt);
    if (this.boss) this.boss.update(dt);

    // projectiles
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const q = this.proj[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      let dead = q.life <= 0;
      if (!dead && w.solid(Math.floor(q.x), Math.floor(q.y))) { dead = true; this.sparks(q.x, q.y, q.color, 3); }
      if (!dead && q.own === 'p') {
        for (const e of this.enemies) if (dist(q.x, q.y, e.x, e.y) < e.r + q.r) { this.hitEnemy(e, q.dmg, q.x - q.vx, q.y - q.vy); dead = true; break; }
        const b = this.boss;
        if (!dead && b && b.state !== 'dead' && dist(q.x, q.y, b.x, b.y) < b.r + q.r) { b.damage(q.dmg); dead = true; }
      } else if (!dead && q.own === 'e' && !this.dead) {
        if (dist(q.x, q.y, p.x, p.y) < p.r + q.r) {
          if (p.inv <= 0) { this.hurtPlayer(q.dmg, q.x - q.vx, q.y - q.vy); dead = true; }
        }
      }
      if (dead) this.proj.splice(i, 1);
    }

    // hazards (fire trails)
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      if (h.life <= 0) { this.hazards.splice(i, 1); continue; }
      if (!this.dead && h.life < h.max - 0.4 && dist(h.x, h.y, p.x, p.y) < h.r + p.r * 0.5) this.hurtPlayer(h.dmg, null, null);
    }

    // items
    const full = S.bag.length >= st.cap;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt; it.t += dt;
      const f = Math.pow(0.02, dt);
      const nx = it.x + it.vx * dt, ny = it.y + it.vy * dt;
      if (!w.solid(Math.floor(nx), Math.floor(it.y))) it.x = nx; else it.vx = 0;
      if (!w.solid(Math.floor(it.x), Math.floor(ny))) it.y = ny; else it.vy = 0;
      it.vx *= f; it.vy *= f;
      if (this.dead || it.age < 0.35) continue;
      const d = dist(it.x, it.y, p.x, p.y);
      const isHeart = it.kind === 'gem' && GEMS[it.id].boss;
      const canTake = it.kind === 'coin' || isHeart || !full;
      if (canTake && d < 2) {
        const pull = (2.2 - d) * 6 * dt;
        it.x += ((p.x - it.x) / d) * Math.min(d, pull);
        it.y += ((p.y - it.y) / d) * Math.min(d, pull);
      }
      if (d < 0.55) {
        if (it.kind === 'coin') {
          this.items.splice(i, 1);
          S.coins += it.val; S.totalEarned += it.val;
          Sfx.play('coin');
          this.floatText(it.x, it.y - 0.4, '+' + it.val + '¢', '#ffd25e', 0.8);
        } else if (canTake) {
          this.items.splice(i, 1);
          this.pickupGem(it);
        } else {
          this.notify('full', '🎒 Backpack full! Recall (R) to sell, or buy a bigger bag.', 4, 'warn');
        }
      }
    }

    // particles & texts
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= dt;
      if (q.life <= 0) { this.parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      const f = Math.pow(0.05, dt);
      q.vx *= f; q.vy *= f;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const q = this.texts[i];
      q.life -= dt; q.y -= dt * 0.9;
      if (q.life <= 0) this.texts.splice(i, 1);
    }

    // camera
    const k = Math.min(1, dt * 8);
    this.cam.x += (p.x - this.cam.x) * k;
    this.cam.y += (p.y - this.cam.y) * k;
    this.revealAround(p.x, p.y, st.lamp);
  }

  updatePlayer(dt) {
    const p = this.player, st = this.st, w = this.world;
    const ax = Input.axis();
    const mx = ax.x, my = ax.y;
    const mag = Math.min(1, Math.hypot(mx, my));
    p.moving = mag > 0.1;
    if (p.moving) {
      const l = Math.hypot(mx, my);
      if (p.swingAnim <= 0) { p.fx = mx / l; p.fy = my / l; if (Math.abs(p.fx) > 0.1) p.flip = p.fx > 0 ? 1 : -1; }
      p.walk += dt * 12 * mag;
    }
    p.dashCd -= dt; p.swingCd -= dt; p.shootCd -= dt; p.inv -= dt; p.swingAnim -= dt;
    p.hp = Math.min(st.maxHp, p.hp + st.regen * dt);

    // ---- actions ----
    if (Input.pressed('dash') && p.dashCd <= 0) {
      const l = Math.hypot(mx, my);
      p.ddx = p.moving ? mx / l : p.fx; p.ddy = p.moving ? my / l : p.fy;
      p.dashT = 0.17; p.dashCd = st.dashCd; p.inv = Math.max(p.inv, 0.25);
      Sfx.play('dash');
    }
    if ((Input.pressed('swing') || Input.held('swing')) && p.swingCd <= 0) this.swing();
    const wantShoot = Input.held('shoot') || Input.pressed('shoot') || Input.mouse.down;
    if (wantShoot && p.shootCd <= 0) {
      if (st.slingDmg > 0) this.shoot();
      else if (Input.pressed('shoot') || Input.mouse.down) this.notify('nosling', '🏹 No ranged weapon yet — buy a Slingshot at camp.');
    }
    if (Input.pressed('potion')) {
      if (S.potions <= 0) this.notify('nopot', '🧪 No potions left. Buy some at camp.');
      else if (p.hp >= st.maxHp) this.notify('fullhp', 'Already at full health.');
      else {
        S.potions--;
        p.hp = Math.min(st.maxHp, p.hp + st.maxHp * 0.45);
        Sfx.play('potion');
        this.sparks(p.x, p.y, '#5ee26b', 14);
        this.floatText(p.x, p.y - 0.7, '+HP', '#5ee26b');
      }
    }
    if (Input.pressed('recall')) {
      if (this.bossNear()) this.notify('norecall', "⚠️ You can't recall while a living gem is hunting you!", 2.5, 'warn');
      else if (this.onElevator()) { this.exit('elevator'); return; }
      else if (p.recall <= 0) { p.recall = 0.001; UI.toast('⤴ Recalling to camp… (hold still-ish)'); }
    }
    if (p.recall > 0) {
      p.recall += dt;
      if (Math.random() < dt * 30) this.sparks(p.x + rand(-0.4, 0.4), p.y + rand(-0.4, 0.4), '#7fe8ff', 1);
      if (p.recall >= 1.6) { this.exit('recall'); return; }
    }

    // ---- movement ----
    let vx = mx * st.speed, vy = my * st.speed;
    if (p.dashT > 0) {
      p.dashT -= dt;
      const dv = Math.max(10, st.speed * 1.9);
      vx = p.ddx * dv; vy = p.ddy * dv;
      if (Math.random() < 0.8) this.parts.push({ x: p.x, y: p.y + 0.1, vx: 0, vy: 0, life: 0.25, max: 0.25, color: '#cfe8ff', size: 0.18 });
    }
    vx += p.kbx; vy += p.kby;
    const f = Math.pow(0.0005, dt);
    p.kbx *= f; p.kby *= f;
    const res = moveEntity(w, p, vx * dt, vy * dt);

    // ---- walk-into-rock mining (+ corner sliding) ----
    if (p.dashT <= 0 && mag > 0.3) {
      const row = Math.floor(p.y), col = Math.floor(p.x);
      const domX = Math.abs(mx) >= Math.abs(my);
      let target = null;
      if (res.hx) {
        if (res.hx.y === row) { if (domX) target = res.hx; }
        else if (Math.abs(mx) > 0.3) { const d = row + 0.5 - p.y; p.y += Math.sign(d) * Math.min(Math.abs(d), st.speed * dt * 0.8); }
      }
      if (res.hy) {
        if (res.hy.x === col) { if (!domX) target = res.hy; }
        else if (Math.abs(my) > 0.3) { const d = col + 0.5 - p.x; p.x += Math.sign(d) * Math.min(Math.abs(d), st.speed * dt * 0.8); }
      }
      if (!target) target = res.hx && res.hx.y === row ? res.hx : res.hy && res.hy.x === col ? res.hy : null;
      if (target) this.mineTile(target.x, target.y, st.power * dt, false);
    }
  }

  // ======================= RENDER =======================
  render(ctx, vw, vh, dpr) {
    const ts = Game.ts, w = this.world, t = this.time, p = this.player;
    const shx = (Math.random() - 0.5) * this.shake * ts * 0.5, shy = (Math.random() - 0.5) * this.shake * ts * 0.5;
    this.ox = Math.round(vw / 2 - this.cam.x * ts + shx);
    this.oy = Math.round(vh / 2 - this.cam.y * ts + shy);
    const ox = this.ox, oy = this.oy;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);

    const x0 = Math.max(0, Math.floor(-ox / ts)), x1 = Math.min(w.W - 1, Math.floor((vw - ox) / ts));
    const y0 = Math.max(0, Math.floor(-oy / ts)), y1 = Math.min(w.H - 1, Math.floor((vh - oy) / ts));
    const bossCol = this.boss ? this.boss.B.color : '#ffffff';
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w.W + x;
        if (!w.seen[i]) continue;
        const px = ox + x * ts, py = oy + y * ts;
        const tt = w.t[i], v = (((x * 73856093) ^ (y * 19349663)) >>> 0) & 3;
        if (tt === 0) {
          ctx.drawImage(Tex.floor[v], px, py, ts, ts);
          if (w.lair[i]) { ctx.fillStyle = withAlpha(bossCol, 0.1); ctx.fillRect(px, py, ts, ts); }
          if (w.solid(x, y - 1)) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px, py, ts, ts * 0.22); }
        } else if (tt === BEDROCK) {
          ctx.drawImage(Tex.bedrock[v], px, py, ts, ts);
        } else {
          ctx.drawImage(Tex.rock[tt - 1][v], px, py, ts, ts);
          if (w.gem[i]) ctx.drawImage(Tex.oreFor(w.gem[i]), px, py, ts, ts);
          if (w.dmg[i] > 0) {
            const rock = ROCKS[tt - 1];
            drawCracks(ctx, px, py, ts, clamp(w.dmg[i] / (rock.hp * (w.gem[i] ? 1.25 : 1)), 0, 1));
          }
        }
      }

    // elevator
    const sp = w.spawn, ex = this.sx(sp.x), ey = this.sy(sp.y);
    ctx.fillStyle = '#4b4f5c';
    ctx.fillRect(ex - ts * 0.6, ey - ts * 0.6, ts * 1.2, ts * 1.2);
    ctx.strokeStyle = '#f5c542'; ctx.lineWidth = Math.max(2, ts * 0.08);
    ctx.setLineDash([ts * 0.15, ts * 0.12]);
    ctx.strokeRect(ex - ts * 0.55, ey - ts * 0.55, ts * 1.1, ts * 1.1);
    ctx.setLineDash([]);
    ctx.fillStyle = '#f5c542';
    ctx.beginPath(); ctx.moveTo(ex, ey - ts * 0.32); ctx.lineTo(ex + ts * 0.25, ey); ctx.lineTo(ex - ts * 0.25, ey); ctx.closePath(); ctx.fill();
    ctx.fillRect(ex - ts * 0.08, ey, ts * 0.16, ts * 0.28);

    // hazards
    for (const h of this.hazards) {
      const hx = this.sx(h.x), hy = this.sy(h.y), a = clamp(h.life / h.max, 0, 1);
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, h.r * ts * 1.2);
      g.addColorStop(0, `rgba(255,220,120,${0.8 * a})`);
      g.addColorStop(0.5, `rgba(255,80,40,${0.6 * a})`);
      g.addColorStop(1, 'rgba(255,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(hx, hy, h.r * ts * 1.2, 0, TAU); ctx.fill();
    }

    // items
    for (const it of this.items) {
      const ix = this.sx(it.x), iy = this.sy(it.y);
      if (ix < -ts || iy < -ts || ix > vw + ts || iy > vh + ts) continue;
      const bob = Math.sin(it.t * 3) * ts * 0.06;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(ix, iy + ts * 0.2, ts * 0.18, ts * 0.06, 0, 0, TAU); ctx.fill();
      if (it.kind === 'coin') {
        ctx.fillStyle = '#c99a1e';
        ctx.beginPath(); ctx.arc(ix, iy + bob, ts * 0.13, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd95e';
        ctx.beginPath(); ctx.arc(ix - ts * 0.02, iy + bob - ts * 0.02, ts * 0.1, 0, TAU); ctx.fill();
      } else {
        const g = GEMS[it.id], big = g.boss ? 0.42 : 0.24;
        if (g.r >= 2) {
          const rg = ctx.createRadialGradient(ix, iy + bob, 0, ix, iy + bob, ts * (0.5 + g.r * 0.1));
          rg.addColorStop(0, withAlpha(RARITY[g.r].color, 0.45));
          rg.addColorStop(1, withAlpha(RARITY[g.r].color, 0));
          ctx.fillStyle = rg;
          ctx.fillRect(ix - ts, iy + bob - ts, ts * 2, ts * 2);
        }
        if (g.r >= 4) {
          const bg = ctx.createLinearGradient(0, iy - ts * 2.5, 0, iy);
          bg.addColorStop(0, withAlpha(RARITY[g.r].color, 0));
          bg.addColorStop(1, withAlpha(RARITY[g.r].color, 0.35));
          ctx.fillStyle = bg;
          ctx.fillRect(ix - ts * 0.12, iy - ts * 2.5, ts * 0.24, ts * 2.5);
        }
        drawGem(ctx, ix, iy + bob, ts * big, g, it.t);
      }
    }

    // enemies, boss, player
    for (const e of this.enemies) {
      const exx = this.sx(e.x), eyy = this.sy(e.y);
      if (exx < -ts * 2 || eyy < -ts * 2 || exx > vw + ts * 2 || eyy > vh + ts * 2) continue;
      if (!w.seen[w.idx(Math.floor(e.x), Math.floor(e.y))]) continue;
      e.draw(ctx, exx, eyy, ts);
    }
    const b = this.boss;
    if (b && b.state !== 'dead') {
      const bx = this.sx(b.x), by = this.sy(b.y);
      if (b.active || w.seen[w.idx(Math.floor(b.x), Math.floor(b.y))]) b.draw(ctx, bx, by, ts, t, this);
    }
    if (!this.dead) this.drawPlayer(ctx, ts, t);

    // projectiles
    for (const q of this.proj) {
      const qx = this.sx(q.x), qy = this.sy(q.y);
      if (q.shard) {
        drawGem(ctx, qx, qy, ts * 0.17, this.boss ? this.boss.gem : { color: q.color, cut: 'marquise' }, t, { rot: Math.atan2(q.vy, q.vx) + Math.PI / 2, twinkle: false });
      } else {
        ctx.fillStyle = withAlpha(q.color, 0.35);
        ctx.beginPath(); ctx.arc(qx, qy, ts * 0.2, 0, TAU); ctx.fill();
        ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(qx, qy, ts * 0.1, 0, TAU); ctx.fill();
      }
    }

    // particles
    for (const q of this.parts) {
      const qx = this.sx(q.x), qy = this.sy(q.y), a = clamp(q.life / q.max, 0, 1);
      if (q.ring) {
        ctx.strokeStyle = withAlpha(q.color, a);
        ctx.lineWidth = Math.max(2, ts * 0.1 * a);
        ctx.beginPath(); ctx.arc(qx, qy, (1 - a) * q.maxR * ts, 0, TAU); ctx.stroke();
      } else if (q.spark) {
        drawSparkle(ctx, qx, qy, q.size * ts * 1.6, q.color, a);
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = q.color;
        const s = q.size * ts;
        ctx.fillRect(qx - s / 2, qy - s / 2, s, s);
        ctx.globalAlpha = 1;
      }
    }

    // ---- lighting ----
    const f = Game.fogCtx;
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, vw, vh);
    f.fillStyle = 'rgba(3,2,8,0.88)';
    f.fillRect(0, 0, vw, vh);
    f.globalCompositeOperation = 'destination-out';
    const light = (lx, ly, r, s) => {
      if (lx < -r || ly < -r || lx > vw + r || ly > vh + r) return;
      const g = f.createRadialGradient(lx, ly, 0, lx, ly, r);
      g.addColorStop(0, `rgba(0,0,0,${s})`);
      g.addColorStop(0.6, `rgba(0,0,0,${s * 0.8})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.fillRect(lx - r, ly - r, r * 2, r * 2);
    };
    const flicker = 1 + Math.sin(t * 9) * 0.015 + Math.sin(t * 23) * 0.01;
    light(this.sx(p.x), this.sy(p.y), this.st.lamp * ts * flicker, 1);
    light(ex, ey, ts * 2.2, 0.7);
    if (b && b.state !== 'dead') light(this.sx(b.x), this.sy(b.y), ts * (b.active ? 4 : 2.5), 0.8);
    for (const q of this.proj) light(this.sx(q.x), this.sy(q.y), ts * 0.9, 0.6);
    for (const h of this.hazards) light(this.sx(h.x), this.sy(h.y), ts * 1.4, 0.7);
    for (const it of this.items) if (it.kind === 'gem' && GEMS[it.id].r >= 2) light(this.sx(it.x), this.sy(it.y), ts * 1.3, 0.6);
    ctx.drawImage(Game.fog, 0, 0, vw, vh);

    // gem glints visible through the dark (your lantern catches distant sparkles)
    const glintR = this.st.lamp * 1.9, lamp2 = (this.st.lamp * 0.85) ** 2;
    const gx0 = Math.max(x0, Math.floor(p.x - glintR)), gx1 = Math.min(x1, Math.ceil(p.x + glintR));
    const gy0 = Math.max(y0, Math.floor(p.y - glintR)), gy1 = Math.min(y1, Math.ceil(p.y + glintR));
    for (let y = gy0; y <= gy1; y++)
      for (let x = gx0; x <= gx1; x++) {
        const i = y * w.W + x, id = w.gem[i];
        if (!id || !w.seen[i]) continue;
        const d2 = (x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2;
        if (d2 < lamp2 || d2 > glintR * glintR) continue;
        const ph = (t * 1.5 + x * 0.37 + y * 0.71) % 2.2;
        if (ph < 0.7) {
          const k = Math.sin((ph / 0.7) * Math.PI);
          drawSparkle(ctx, ox + x * ts + ts * 0.5, oy + y * ts + ts * 0.45, ts * 0.22 * k, RARITY[GEMS[id].r].color, k);
        }
      }

    // swing arc (drawn above fog so it reads clearly)
    if (p.swingAnim > 0 && !this.dead) {
      const k = 1 - p.swingAnim / 0.22;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - k)})`;
      ctx.lineWidth = ts * 0.12;
      ctx.beginPath();
      ctx.arc(this.sx(p.x), this.sy(p.y), ts * 1.05, p.swingA - 1.1, p.swingA - 1.1 + 2.2 * k);
      ctx.stroke();
    }

    // floating texts
    ctx.textAlign = 'center';
    for (const q of this.texts) {
      const a = clamp(q.life / q.max * 1.5, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `800 ${Math.round(ts * 0.42 * q.scale)}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(q.text, this.sx(q.x), this.sy(q.y));
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, this.sx(q.x), this.sy(q.y));
    }
    ctx.globalAlpha = 1;

    // elevator hint
    if (!this.dead && this.onElevator()) {
      ctx.font = `700 ${Math.round(ts * 0.36)}px system-ui, sans-serif`;
      ctx.fillStyle = '#f5c542';
      ctx.fillText(Input.isTouch ? 'Tap ⤴ to return to camp' : 'Press R to return to camp', ex, ey - ts * 0.9);
    }

    // compass toward the living gem
    if (b && b.state !== 'dead') {
      const bx = this.sx(b.x), by = this.sy(b.y);
      const m = ts * 1.2;
      if (bx < m || by < m || bx > vw - m || by > vh - m) {
        const a = Math.atan2(by - vh / 2, bx - vw / 2);
        const R0 = Math.min(vw, vh) / 2 - ts * 1.3;
        const cx = vw / 2 + Math.cos(a) * R0, cy = vh / 2 + Math.sin(a) * R0;
        const pulse = 0.75 + Math.sin(t * 5) * 0.25;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = b.active ? '#ff5a6e' : b.B.color;
        ctx.beginPath(); ctx.moveTo(ts * 0.45, 0); ctx.lineTo(-ts * 0.25, -ts * 0.28); ctx.lineTo(-ts * 0.1, 0); ctx.lineTo(-ts * 0.25, ts * 0.28); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = pulse;
        drawGem(ctx, cx - Math.cos(a) * ts * 0.55, cy - Math.sin(a) * ts * 0.55, ts * 0.2, b.gem, t, { twinkle: false });
        ctx.globalAlpha = 1;
      }
    }

    // death overlay
    if (this.dead) {
      ctx.fillStyle = `rgba(20,0,10,${0.6 * (1 - this.deadT / 2.6)})`;
      ctx.fillRect(0, 0, vw, vh);
      ctx.font = `900 ${Math.round(ts * 1.1)}px system-ui, sans-serif`;
      ctx.fillStyle = '#ff5a6e';
      ctx.fillText('You fainted…', vw / 2, vh / 2);
    }
    ctx.textAlign = 'start';
  }

  drawPlayer(ctx, ts, t) {
    const p = this.player, x = this.sx(p.x), y = this.sy(p.y), s = ts / 32;
    ctx.save();
    if (p.inv > 0 && p.dashT <= 0 && Math.floor(t * 20) % 2) ctx.globalAlpha = 0.45;
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(0, 11 * s, 10 * s, 4 * s, 0, 0, TAU); ctx.fill();
    const bob = p.moving ? Math.abs(Math.sin(p.walk)) * -1.5 * s : 0;
    const lg = p.moving ? Math.sin(p.walk) * 2.5 * s : 0;
    const fl = p.flip;
    // pickaxe behind body when idle
    const drawPick = () => {
      ctx.save();
      let ang;
      if (p.swingAnim > 0) {
        const k = 1 - p.swingAnim / 0.22;
        ang = p.swingA - 1.3 + k * 2.6;
        ctx.translate(0, -2 * s + bob);
      } else {
        ang = fl > 0 ? -0.9 : Math.PI + 0.9;
        ctx.translate(fl * 7 * s, -1 * s + bob);
      }
      ctx.rotate(ang);
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2.5 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14 * s, 0); ctx.stroke();
      ctx.strokeStyle = PICK_COLORS[S.gear.pick]; ctx.lineWidth = 3.2 * s;
      ctx.beginPath(); ctx.moveTo(13 * s, -6 * s); ctx.quadraticCurveTo(16.5 * s, 0, 13 * s, 6 * s); ctx.stroke();
      ctx.restore();
    };
    if (p.swingAnim <= 0) drawPick();
    // legs & boots
    ctx.fillStyle = '#3b3046';
    ctx.fillRect(-5 * s, 3 * s, 4 * s, 6 * s + lg);
    ctx.fillRect(1 * s, 3 * s, 4 * s, 6 * s - lg);
    ctx.fillStyle = BOOT_COLORS[S.gear.boots];
    ctx.fillRect(-5.5 * s, 7.5 * s + lg, 5 * s, 3 * s);
    ctx.fillRect(0.5 * s, 7.5 * s - lg, 5 * s, 3 * s);
    // body / armor
    const ac = ARMOR_COLORS[S.gear.armor];
    const g = ctx.createLinearGradient(0, -7 * s, 0, 6 * s);
    g.addColorStop(0, shade(ac, 0.25)); g.addColorStop(1, shade(ac, -0.3));
    ctx.fillStyle = g;
    roundRect(ctx, -7 * s, -6 * s + bob, 14 * s, 11 * s, 4 * s);
    ctx.fill();
    ctx.fillStyle = '#5a3d22';
    ctx.fillRect(-7 * s, 1 * s + bob, 14 * s, 2 * s);
    // socketed amulet gem glows on the chest
    const sock = S.sockets.find((id) => id);
    if (sock) drawGem(ctx, 0, -2.5 * s + bob, 2.2 * s, GEMS[sock], t, { twinkle: false });
    // head
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath(); ctx.arc(0, -10 * s + bob, 6 * s, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1420';
    ctx.beginPath(); ctx.arc(fl * 2.5 * s, -9.5 * s + bob, 1 * s, 0, TAU); ctx.arc(fl * -0.8 * s, -9.5 * s + bob, 1 * s, 0, TAU); ctx.fill();
    // helmet + lamp
    ctx.fillStyle = '#f5c542';
    ctx.beginPath(); ctx.arc(0, -11.5 * s + bob, 6.6 * s, Math.PI, 0); ctx.fill();
    ctx.fillRect(-7.5 * s, -12 * s + bob, 15 * s, 2 * s);
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath(); ctx.arc(fl * 3 * s, -14.5 * s + bob, 2 * s, 0, TAU); ctx.fill();
    if (p.swingAnim > 0) drawPick();
    ctx.restore();
    // recall channel ring
    if (p.recall > 0) {
      ctx.strokeStyle = '#7fe8ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, ts * 0.75, -Math.PI / 2, -Math.PI / 2 + TAU * (p.recall / 1.6)); ctx.stroke();
    }
  }
}
