import * as THREE from '../vendor/three.module.min.js';
import { seededRandom } from './util.js';

let maxAniso = 4;
export function setMaxAnisotropy(a) { maxAniso = a; }

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  return t;
}

const LIT = ['#ffd28a', '#ffe7b0', '#fff1d6', '#ffc46b', '#9fe7ff', '#ff9de2', '#ffe7b0'];

// Low/mid-rise "deco" facade: 4 windows x 4 floors per tile. Greyscale so vertex
// colours can tint each building a different pastel.
export function decoFacade(seed) {
  const rnd = seededRandom(seed);
  const [c, g] = canvas(256, 256);
  const [e, ge] = canvas(256, 256);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 256, 256);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 256, 256);
  for (let f = 0; f < 4; f++) {
    const y0 = f * 64;
    g.fillStyle = '#dcdcdc';
    g.fillRect(0, y0 + 56, 256, 8);
    g.fillStyle = '#e9e9e9';
    g.fillRect(0, y0 + 52, 256, 4);
    for (let col = 0; col < 4; col++) {
      const x = col * 64 + 12, y = y0 + 10;
      g.fillStyle = '#bdbdbd';
      g.fillRect(x - 3, y - 3, 46, 44);
      const gr = g.createLinearGradient(x, y, x + 40, y + 38);
      gr.addColorStop(0, '#3e5368');
      gr.addColorStop(0.5, '#22303e');
      gr.addColorStop(1, '#4b6a84');
      g.fillStyle = gr;
      g.fillRect(x, y, 40, 38);
      g.fillStyle = '#9a9a9a';
      g.fillRect(x + 19, y, 2, 38);
      if (rnd() < 0.42) {
        const lit = LIT[Math.floor(rnd() * LIT.length)];
        ge.fillStyle = lit;
        ge.globalAlpha = 0.65 + rnd() * 0.35;
        ge.fillRect(x, y, 40, 38);
        ge.globalAlpha = 1;
        ge.fillStyle = 'rgba(0,0,0,0.35)';
        ge.fillRect(x + 19, y, 2, 38);
        if (rnd() < 0.5) ge.fillRect(x, y + 26, 40, 12); // blinds
      }
    }
  }
  return { map: tex(c), emissive: tex(e), tileW: 12, tileH: 14, roofUV: [3 / 256, 1 - 3 / 256] };
}

// Glass curtain-wall towers: 8 x 8 cells per tile.
export function glassFacade(seed) {
  const rnd = seededRandom(seed);
  const [c, g] = canvas(256, 256);
  const [e, ge] = canvas(256, 256);
  const gr = g.createLinearGradient(0, 0, 256, 256);
  gr.addColorStop(0, '#9fb3c4');
  gr.addColorStop(0.45, '#5f7a91');
  gr.addColorStop(1, '#8aa2b6');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const shade = 0.85 + rnd() * 0.3;
      g.fillStyle = `rgba(30,45,60,${0.15 * shade})`;
      g.fillRect(x * 32 + 3, y * 32 + 3, 29, 29);
      if (rnd() < 0.33) {
        ge.fillStyle = rnd() < 0.7 ? '#e6f4ff' : '#ffe2a8';
        ge.globalAlpha = 0.5 + rnd() * 0.5;
        ge.fillRect(x * 32 + 3, y * 32 + 3, 29, 29);
        ge.globalAlpha = 1;
      }
    }
  }
  g.fillStyle = '#dfe5ea';
  for (let i = 0; i < 8; i++) {
    g.fillRect(i * 32, 0, 3, 256);
    g.fillRect(0, i * 32, 256, 3);
  }
  return { map: tex(c), emissive: tex(e), tileW: 20, tileH: 28, roofUV: [1.5 / 256, 1 - 1.5 / 256] };
}

export function sidewalkTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b9b4ad';
  g.fillRect(0, 0, 128, 128);
  const rnd = seededRandom(7);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? 255 : 0},${rnd() < 0.5 ? 255 : 0},${rnd() < 0.5 ? 255 : 0},0.03)`;
    g.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(70,64,58,0.45)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  g.beginPath();
  g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64);
  g.stroke();
  return tex(c);
}

export function noiseTexture(base, spread, seed, size = 256, dots = 6000) {
  const [c, g] = canvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const rnd = seededRandom(seed);
  for (let i = 0; i < dots; i++) {
    const l = (rnd() - 0.5) * spread;
    g.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`;
    const s = 1 + rnd() * 3;
    g.fillRect(rnd() * size, rnd() * size, s, s);
  }
  return tex(c);
}

export function asphaltTexture() {
  return noiseTexture('#3a3b40', 0.18, 3, 256, 9000);
}

export function signTexture(text, color) {
  const [c, g] = canvas(512, 128);
  g.fillStyle = 'rgba(10,8,20,0.88)';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(10, 10, 492, 108);
  g.font = 'bold 74px "Chakra Petch", "Trebuchet MS", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.shadowBlur = 26;
  g.fillText(text, 256, 68);
  g.shadowBlur = 0;
  g.globalAlpha = 0.55;
  g.fillStyle = color;
  g.fillText(text, 256, 68);
  const t = tex(c, true, false);
  return t;
}

// Soft radial blob used for lamp pools, headlight beams and blob shadows.
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return tex(c, true, false);
}

// Headlight cone on the ground: bright near the car, fading forward.
export function beamTexture() {
  const [c, g] = canvas(128, 256);
  const gr = g.createLinearGradient(0, 256, 0, 0);
  gr.addColorStop(0, 'rgba(255,240,200,0.9)');
  gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(44, 256); g.lineTo(84, 256); g.lineTo(128, 0); g.lineTo(0, 0);
  g.closePath();
  g.fill();
  return tex(c, true, false);
}

// Vertical fade for mission marker beams.
export function beamFadeTexture() {
  const [c, g] = canvas(4, 128);
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 128);
  return tex(c, true, false);
}

export function ringTexture() {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = '#fff';
  g.lineWidth = 8;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 54);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)');
  gr.addColorStop(1, 'rgba(255,255,255,0.35)');
  g.fillStyle = gr;
  g.fill();
  return tex(c, true, false);
}

// Green highway-style sign. rows: [{ text, arrow: 'up' | 'left' | 'right' | null, small }]
export function roadSignTexture(rows, bg = '#11643a') {
  const W = 512, rowH = 96, H = rows.length * rowH + 24;
  const [c, g] = canvas(W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#f4f4f4';
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);
  rows.forEach((r, k) => {
    const cy = 12 + rowH * k + rowH / 2;
    g.fillStyle = '#f4f4f4';
    g.font = `700 ${r.small ? 34 : 48}px "Chakra Petch", "Trebuchet MS", sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(r.text, r.arrow ? 108 : 32, cy + 2);
    if (r.arrow) {
      g.save();
      g.translate(60, cy);
      g.rotate({ up: 0, right: Math.PI / 2, left: -Math.PI / 2 }[r.arrow]);
      g.beginPath();
      g.moveTo(0, -30); g.lineTo(22, -4); g.lineTo(8, -4); g.lineTo(8, 28); g.lineTo(-8, 28); g.lineTo(-8, -4); g.lineTo(-22, -4);
      g.closePath();
      g.fill();
      g.restore();
    }
  });
  const t = tex(c, true, false);
  t.userData = { aspect: W / H };
  return t;
}
