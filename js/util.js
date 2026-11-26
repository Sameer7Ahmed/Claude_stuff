'use strict';
// ---------- Math helpers ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const angDiff = (a, b) => ((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(weights, r) {
  let total = 0;
  for (const w of weights) total += w;
  let x = r * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

function fmt(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString('en-US');
  if (n < 1e6) return (n / 1000).toFixed(n < 1e5 ? 1 : 0) + 'k';
  return (n / 1e6).toFixed(2) + 'M';
}

// ---------- Color helpers ----------
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}
function withAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// ---------- Safe storage ----------
const Store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } },
};

// ---------- Tiny synth sound effects ----------
const Sfx = {
  ctx: null,
  master: null,
  noiseBuf: null,
  muted: Store.get('gemdelver_muted') === '1',
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  },
  toggle() {
    this.muted = !this.muted;
    Store.set('gemdelver_muted', this.muted ? '1' : '0');
    return this.muted;
  },
  tone(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  noise(dur, vol = 0.2, freq = 1000, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.02);
  },
  play(name, arg = 0) {
    if (!this.ctx || this.muted) return;
    try { this._play(name, arg); } catch (e) { /* audio must never break gameplay */ }
  },
  _play(name, arg) {
    switch (name) {
      case 'mine': this.noise(0.05, 0.07, 2200 + Math.random() * 800); break;
      case 'break': this.noise(0.18, 0.22, 600); this.tone(150, 0.12, 'triangle', 0.12, 70); break;
      case 'gem': {
        const base = [523, 587, 659, 740, 784, 880][arg] || 523;
        const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4];
        const n = Math.min(steps.length, 2 + arg);
        for (let i = 0; i < n; i++) this.tone(base * steps[i], 0.22, 'triangle', 0.12, null, i * 0.07);
        break;
      }
      case 'coin': this.tone(988, 0.06, 'square', 0.06); this.tone(1319, 0.1, 'square', 0.06, null, 0.05); break;
      case 'swing': this.noise(0.08, 0.1, 3200); break;
      case 'hit': this.tone(240, 0.08, 'square', 0.1, 110); break;
      case 'shoot': this.tone(700, 0.08, 'triangle', 0.08, 350); break;
      case 'hurt': this.tone(200, 0.22, 'sawtooth', 0.14, 60); break;
      case 'dash': this.noise(0.16, 0.12, 700); break;
      case 'roar': this.tone(110, 0.9, 'sawtooth', 0.18, 40); this.noise(0.7, 0.14, 260); break;
      case 'flee': this.tone(380, 0.35, 'square', 0.09, 1400); break;
      case 'escape': this.tone(600, 0.5, 'triangle', 0.1, 150); break;
      case 'bossDie':
        for (let i = 0; i < 9; i++) this.tone(330 * Math.pow(1.12, i), 0.3, 'triangle', 0.11, null, i * 0.08);
        this.noise(0.8, 0.15, 400);
        break;
      case 'buy': this.tone(660, 0.08, 'square', 0.08); this.tone(880, 0.08, 'square', 0.08, null, 0.07); this.tone(1320, 0.15, 'square', 0.08, null, 0.14); break;
      case 'sell': this.tone(1200, 0.06, 'square', 0.06); this.tone(1600, 0.1, 'square', 0.06, null, 0.05); break;
      case 'deny': this.tone(140, 0.16, 'square', 0.09); break;
      case 'potion': this.tone(500, 0.3, 'sine', 0.14, 1000); break;
      case 'death': this.tone(300, 1.0, 'sawtooth', 0.14, 50); break;
      case 'click': this.tone(900, 0.03, 'square', 0.05); break;
      case 'socket': this.tone(784, 0.15, 'triangle', 0.12); this.tone(1175, 0.25, 'triangle', 0.12, null, 0.1); break;
    }
  },
};
