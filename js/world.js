'use strict';
const BEDROCK = 99;

// A procedurally generated cave floor. Tile 0 = open ground, 1..6 = rock (ROCKS index + 1), 99 = bedrock.
class World {
  constructor(fi, luck) {
    this.fi = fi;
    this.floor = FLOORS[fi];
    this.W = 60 + fi * 5;
    this.H = 60 + fi * 5;
    const N = this.W * this.H;
    this.t = new Uint8Array(N);
    this.dmg = new Float32Array(N);
    this.gem = new Array(N).fill(null);
    this.seen = new Uint8Array(N);
    this.lair = new Uint8Array(N);
    this.rng = makeRng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    this.generate(luck);
  }
  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  get(x, y) { return this.inb(x, y) ? this.t[y * this.W + x] : BEDROCK; }
  solid(x, y) { return this.get(x, y) !== 0; }
  isBorder(x, y) { return x < 2 || y < 2 || x >= this.W - 2 || y >= this.H - 2; }

  carveCircle(cx, cy, r) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (this.inb(x, y) && !this.isBorder(x, y) && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this._m[this.idx(x, y)] = 0;
  }

  generate(luck) {
    const { W, H } = this, R = this.rng;
    let m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) m[y * W + x] = this.isBorder(x, y) || R() < 0.48 ? 1 : 0;
    // cellular automata smoothing -> natural caves
    for (let it = 0; it < 5; it++) {
      const m2 = new Uint8Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              n += xx < 0 || yy < 0 || xx >= W || yy >= H ? 1 : m[yy * W + xx];
            }
          m2[y * W + x] = n >= 5 ? 1 : 0;
        }
      m = m2;
    }
    this._m = m;

    // Spawn in one corner, boss lair in the opposite corner
    const corner = Math.floor(R() * 4);
    const sx = corner & 1 ? W - 9 : 8, sy = corner & 2 ? H - 9 : 8;
    const lx = corner & 1 ? 10 + R() * 4 : W - 11 - R() * 4;
    const ly = corner & 2 ? 10 + R() * 4 : H - 11 - R() * 4;
    this.spawn = { x: sx + 0.5, y: sy + 0.5 };
    this.lairPos = { x: Math.floor(lx) + 0.5, y: Math.floor(ly) + 0.5 };
    this.carveCircle(this.spawn.x, this.spawn.y, 3.2);
    this.carveCircle(this.lairPos.x, this.lairPos.y, 5.5);

    // Guaranteed winding tunnel spawn -> lair (soft rock is diggable anyway, but this keeps the boss findable)
    let px = this.spawn.x, py = this.spawn.y;
    for (let step = 0; step < 4000; step++) {
      const dx = this.lairPos.x - px, dy = this.lairPos.y - py;
      if (Math.abs(dx) + Math.abs(dy) < 2) break;
      if (R() < 0.55) {
        if (Math.abs(dx) > Math.abs(dy)) px += Math.sign(dx); else py += Math.sign(dy);
      } else {
        const d = Math.floor(R() * 4);
        px += [1, -1, 0, 0][d]; py += [0, 0, 1, -1][d];
      }
      px = clamp(px, 3, W - 4); py = clamp(py, 3, H - 4);
      this.carveCircle(px, py, 1.1);
    }

    // Rock type from smooth value noise
    const [soft, hard] = this.floor.rocks;
    const cell = 7, gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
    const grid = new Float32Array(gw * gh);
    for (let i = 0; i < grid.length; i++) grid[i] = R();
    const noise = (x, y) => {
      const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const sx2 = fx * fx * (3 - 2 * fx), sy2 = fy * fy * (3 - 2 * fy);
      const v = (ix, iy) => grid[iy * gw + ix];
      return lerp(lerp(v(x0, y0), v(x0 + 1, y0), sx2), lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), sx2), sy2);
    };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (this.isBorder(x, y)) { this.t[i] = BEDROCK; continue; }
        if (!m[i]) { this.t[i] = 0; continue; }
        const nearLair = dist(x, y, this.lairPos.x, this.lairPos.y) < 11;
        const nearSpawn = dist(x, y, this.spawn.x, this.spawn.y) < 6;
        const isHard = !nearSpawn && (nearLair || noise(x, y) > 0.55);
        this.t[i] = (isHard ? hard : soft) + 1;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (dist(x + 0.5, y + 0.5, this.lairPos.x, this.lairPos.y) < 5.5) this.lair[y * W + x] = 1;

    // Gems: denser along cave walls and in harder rock
    for (let y = 2; y < H - 2; y++)
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x, t = this.t[i];
        if (!t || t === BEDROCK) continue;
        const open = (this.t[i - 1] === 0) + (this.t[i + 1] === 0) + (this.t[i - W] === 0) + (this.t[i + W] === 0);
        const isHard = t === hard + 1;
        const p = this.floor.density * (open ? 1.9 : 0.6) * (isHard ? 1.35 : 1);
        if (R() < p) {
          const id = rollGem(this.fi, luck + (isHard ? 20 : 0), R);
          this.gem[i] = id;
          // small veins of the same gem
          if (R() < 0.25) {
            for (let k = 0; k < 2; k++) {
              const d = Math.floor(R() * 4);
              const j = i + [1, -1, W, -W][d];
              if (this.t[j] && this.t[j] !== BEDROCK && !this.gem[j]) this.gem[j] = id;
            }
          }
        }
      }

    // enemy spawn points
    this.enemySpawns = [];
    let tries = 0;
    while (this.enemySpawns.length < this.floor.enemies && tries++ < 3000) {
      const x = 3 + Math.floor(R() * (W - 6)), y = 3 + Math.floor(R() * (H - 6));
      if (this.t[y * W + x] === 0 && dist(x, y, this.spawn.x, this.spawn.y) > 12 && !this.lair[y * W + x])
        this.enemySpawns.push({ x: x + 0.5, y: y + 0.5 });
    }
    this._m = null;
  }

  // Remove a tile entirely; returns the gem id inside (if any)
  clear(x, y) {
    const i = this.idx(x, y);
    const gem = this.gem[i];
    this.t[i] = 0;
    this.dmg[i] = 0;
    this.gem[i] = null;
    return gem;
  }
}
