'use strict';
// ================= GEM CUT SHAPES (unit radius) =================
const CUTS = (() => {
  const C = {};
  const ell = (n, rx, ry, rot = 0) => {
    const p = [];
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU - Math.PI / 2;
      p.push([Math.cos(a) * rx, Math.sin(a) * ry]);
    }
    return p;
  };
  C.round = ell(8, 1, 1, Math.PI / 8);
  C.oval = ell(10, 0.78, 1);
  C.cushion = (() => {
    const p = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + Math.PI / 12;
      const c = Math.cos(a), s = Math.sin(a);
      p.push([Math.sign(c) * Math.pow(Math.abs(c), 0.6) * 0.9, Math.sign(s) * Math.pow(Math.abs(s), 0.6) * 0.9]);
    }
    return p;
  })();
  C.emerald = [[-0.45, -0.95], [0.45, -0.95], [0.72, -0.68], [0.72, 0.68], [0.45, 0.95], [-0.45, 0.95], [-0.72, 0.68], [-0.72, -0.68]];
  C.trillion = (() => {
    const p = [];
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 3;
      const a2 = a + TAU / 6;
      p.push([Math.cos(a) * 1.05, Math.sin(a) * 1.05 + 0.1]);
      p.push([Math.cos(a2) * 0.66, Math.sin(a2) * 0.66 + 0.1]);
    }
    return p;
  })();
  C.pear = (() => {
    const p = [];
    for (let i = 0; i < 14; i++) {
      const t = (i / 14) * TAU;
      p.push([1.15 * Math.sin(t) * Math.sin(t / 2), -Math.cos(t) * 1.0]);
    }
    return p;
  })();
  C.marquise = (() => {
    const p = [];
    for (let i = 0; i < 12; i++) {
      const t = (i / 12) * TAU;
      const s = Math.sin(t);
      p.push([0.66 * Math.sign(s) * Math.pow(Math.abs(s), 1.3), -Math.cos(t)]);
    }
    return p;
  })();
  C.heart = (() => {
    const p = [];
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * TAU;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      p.push([x / 16, y / 16 - 0.15]);
    }
    return p;
  })();
  C.star = (() => {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 10;
      const r = i % 2 ? 0.5 : 1.05;
      p.push([Math.cos(a) * r, Math.sin(a) * r + 0.05]);
    }
    return p;
  })();
  return C;
})();

function gemPath(ctx, pts, k = 1, oy = 0) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0] * k, y = pts[i][1] * k + oy;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function gemColor(gem, t, x) {
  if (gem.rainbow) return hslHex((t * 50 + x * 0.3) % 360, 85, 72);
  return gem.color;
}

// Draws a faceted gemstone. s = radius in pixels.
function drawGem(ctx, x, y, s, gem, t = 0, opts = {}) {
  if (s < 0.5) return;
  const pts = CUTS[gem.cut] || CUTS.round;
  const n = pts.length, TK = 0.5, TY = -0.08;
  const col = opts.flash ? '#ffffff' : opts.still ? gem.color : gemColor(gem, t, x + y);
  ctx.save();
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  ctx.scale(s, s);
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;

  const g = ctx.createLinearGradient(-1, -1, 1, 1);
  g.addColorStop(0, shade(col, 0.6));
  g.addColorStop(0.5, col);
  g.addColorStop(1, shade(col, -0.6));
  gemPath(ctx, pts);
  ctx.fillStyle = g;
  ctx.fill();

  // facets lit from the top-left
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const L = (-mx - my) / (Math.hypot(mx, my) * 1.414 + 1e-6);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(b[0] * TK, b[1] * TK + TY);
    ctx.lineTo(a[0] * TK, a[1] * TK + TY);
    ctx.closePath();
    const k = Math.abs(L) * 0.35 + (i % 2) * 0.07;
    ctx.fillStyle = L > 0 ? `rgba(255,255,255,${k.toFixed(3)})` : `rgba(0,0,0,${k.toFixed(3)})`;
    ctx.fill();
  }
  // table (top face)
  const tg = ctx.createLinearGradient(-0.5, -0.6, 0.5, 0.4);
  tg.addColorStop(0, shade(col, 0.75));
  tg.addColorStop(1, shade(col, 0.1));
  gemPath(ctx, pts, TK, TY);
  ctx.fillStyle = tg;
  ctx.fill();
  if (gem.rainbow && !opts.flash) {
    gemPath(ctx, pts, TK, TY);
    ctx.fillStyle = withAlpha(hslHex((t * 90 + 120) % 360, 90, 75), 0.35);
    ctx.fill();
  }
  // edges
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1 / s;
  gemPath(ctx, pts, TK, TY);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i][0] * TK, pts[i][1] * TK + TY);
  }
  ctx.stroke();
  ctx.strokeStyle = shade(col, -0.7);
  ctx.lineWidth = 1.5 / s;
  gemPath(ctx, pts);
  ctx.stroke();
  // glossy highlight
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(-0.28, -0.42, 0.17, 0.07, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();

  if (opts.twinkle !== false) {
    const ph = (t * 1.3 + x * 0.013 + y * 0.007) % 3;
    if (ph < 0.5) {
      const k = Math.sin((ph / 0.5) * Math.PI);
      drawSparkle(ctx, x + s * 0.35, y - s * 0.45, s * 0.7 * k, '#ffffff', k);
    }
  }
}

function drawSparkle(ctx, x, y, size, color, alpha = 1) {
  if (size <= 0.2) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x, y, x + size, y);
  ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y);
  ctx.quadraticCurveTo(x, y, x, y - size);
  ctx.fill();
  ctx.restore();
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Gem icon images for the HTML UI
const _iconCache = {};
function gemIcon(id, size = 56) {
  const key = id + '@' + size;
  if (_iconCache[key]) return _iconCache[key];
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const gem = GEMS[id];
  const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rg.addColorStop(0, withAlpha(RARITY[gem.r].color, 0.35));
  rg.addColorStop(1, withAlpha(RARITY[gem.r].color, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
  drawGem(g, size / 2, size / 2, size * 0.36, gem, 1.7, { twinkle: false, still: true });
  drawSparkle(g, size * 0.7, size * 0.26, size * 0.09, '#fff', 0.9);
  _iconCache[key] = c.toDataURL();
  return _iconCache[key];
}

// ================= TILE TEXTURES =================
const Tex = {
  px: 32,
  rock: [],
  bedrock: [],
  floor: [],
  ore: {},
  build(ts, dpr, fi) {
    const px = Math.round(ts * dpr);
    this.px = px;
    this.rock = ROCKS.map((r, ri) => [0, 1, 2, 3].map((v) => makeRockTex(px, r.color, ri * 10 + v, false)));
    this.bedrock = [0, 1, 2, 3].map((v) => makeRockTex(px, '#16121c', 900 + v, true));
    this.floor = [0, 1, 2, 3].map((v) => makeFloorTex(px, FLOORS[fi].ground, 500 + v + fi * 10));
    this.ore = {};
  },
  oreFor(id) {
    if (!this.ore[id]) this.ore[id] = makeOreTex(this.px, id);
    return this.ore[id];
  },
};

function makeRockTex(px, color, seed, bed) {
  const c = makeCanvas(px, px), g = c.getContext('2d'), R = makeRng(seed * 7919 + 13);
  g.fillStyle = color;
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = shade(color, (R() - 0.5) * 0.3);
    g.beginPath();
    g.arc(R() * px, R() * px, px * (0.12 + R() * 0.18), 0, TAU);
    g.fill();
  }
  for (let i = 0; i < px * 0.9; i++) {
    g.fillStyle = shade(color, (R() - 0.5) * 0.5);
    const sz = Math.max(1, (px / 16) * R());
    g.fillRect((R() * px) | 0, (R() * px) | 0, sz, sz);
  }
  g.strokeStyle = shade(color, -0.45);
  g.lineWidth = Math.max(1, px / 26);
  for (let i = 0; i < 2; i++) {
    g.beginPath();
    let x = R() * px, y = R() * px;
    g.moveTo(x, y);
    for (let j = 0; j < 3; j++) {
      x += (R() - 0.5) * px * 0.4;
      y += (R() - 0.5) * px * 0.4;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  if (bed) {
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = Math.max(1, px / 14);
    for (let i = -px; i < px * 2; i += px / 3) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + px, px); g.stroke();
    }
  }
  const b = Math.max(2, (px * 0.09) | 0);
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.fillRect(0, 0, px, b);
  g.fillRect(0, 0, b, px);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, px - b, px, b);
  g.fillRect(px - b, 0, b, px);
  return c;
}

function makeFloorTex(px, color, seed) {
  const c = makeCanvas(px, px), g = c.getContext('2d'), R = makeRng(seed * 104729 + 7);
  g.fillStyle = color;
  g.fillRect(0, 0, px, px);
  for (let i = 0; i < px * 0.7; i++) {
    g.fillStyle = shade(color, (R() - 0.5) * 0.35);
    const sz = Math.max(1, (px / 14) * R());
    g.fillRect((R() * px) | 0, (R() * px) | 0, sz, sz);
  }
  for (let i = 0; i < 2; i++) {
    g.fillStyle = shade(color, 0.12 + R() * 0.1);
    g.beginPath();
    g.ellipse(R() * px, R() * px, px * 0.06, px * 0.04, R() * 3, 0, TAU);
    g.fill();
  }
  return c;
}

function makeOreTex(px, id) {
  const c = makeCanvas(px, px), g = c.getContext('2d');
  const gem = GEMS[id];
  const rg = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px * 0.55);
  rg.addColorStop(0, withAlpha(gem.color, 0.35));
  rg.addColorStop(1, withAlpha(gem.color, 0));
  g.fillStyle = rg;
  g.fillRect(0, 0, px, px);
  const spots = [[0.32, 0.34, 0.17, -0.3], [0.66, 0.58, 0.2, 0.4], [0.38, 0.72, 0.12, 0.1]];
  for (const [x, y, s, rot] of spots) drawGem(g, x * px, y * px, s * px, gem, 0.7, { twinkle: false, rot, still: true });
  return c;
}

function drawCracks(ctx, x, y, ts, k) {
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = Math.max(1.5, ts / 16);
  ctx.lineCap = 'round';
  const n = 1 + Math.floor(k * 5);
  const cx = x + ts / 2, cy = y + ts / 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996;
    ctx.moveTo(cx, cy);
    for (let j = 1; j <= 3; j++) {
      const r = ts * 0.15 * j * (0.6 + k * 0.5);
      const aa = a + j * 0.35 * (i % 2 ? 1 : -1);
      ctx.lineTo(cx + Math.cos(aa) * r, cy + Math.sin(aa) * r);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
