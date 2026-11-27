import { buildHuman, randomLook, animateHuman, buildGun, poseAim, poseHandsUp, poseCower, TWO_HANDED } from './models.js';
import { WEAPONS, npcShoot } from './weapons.js';
import { clamp, rand, dampAngle, pick } from './util.js';

const ROLE = {
  civ: { hp: 60, speed: 1.4, run: 5.2 },
  clerk: { hp: 70, speed: 1.4, run: 5 },
  teller: { hp: 60, speed: 1.4, run: 5 },
  manager: { hp: 60, speed: 1.4, run: 5 },
  owner: { hp: 70, speed: 1.4, run: 5 },
  gunclerk: { hp: 140, speed: 3.4, run: 3.4, weapon: 'shotgun', acc: 0.45 },
  guard: { hp: 120, speed: 3.8, run: 3.8, weapon: 'pistol', acc: 0.36 },
  cop: { hp: 100, armor: 25, speed: 4.6, run: 4.6, weapon: 'pistol', acc: 0.38 },
  swat: { hp: 120, armor: 90, speed: 4.2, run: 4.2, weapon: 'rifle', acc: 0.46 },
};
const LOOKS = {
  cop: () => ({ ...randomLook(), shirt: '#1f3b7a', pants: '#0f172a', shoes: '#111111', hat: '#0f172a', vest: null, shades: Math.random() < 0.3 }),
  swat: () => ({ ...randomLook(), shirt: '#20242b', pants: '#20242b', shoes: '#111111', hat: '#15181d', vest: '#2c323b', shades: true }),
  guard: () => ({ ...randomLook(), shirt: '#6b7280', pants: '#1f2937', shoes: '#111111', hat: '#111827' }),
  gunclerk: () => ({ ...randomLook(), shirt: '#3f4a2a', pants: '#2b2b2b', vest: '#5a4a32' }),
  teller: () => ({ ...randomLook(), shirt: '#f1f5f9', pants: '#1e293b' }),
  manager: () => ({ ...randomLook(), shirt: '#334155', pants: '#1e293b', shades: false }),
  clerk: () => ({ ...randomLook(), shirt: '#16a34a' }),
  owner: () => ({ ...randomLook(), shirt: '#ff3fa4', shades: true }),
};
const CIVILIAN = { civ: 1, clerk: 1, teller: 1, manager: 1, owner: 1 };

export class Npc {
  constructor(G, space, role, x, z, h = 0, opts = {}) {
    const R = ROLE[role];
    this.G = G;
    this.space = space;
    this.role = role;
    this.model = buildHuman((LOOKS[role] || randomLook)());
    this.parent = space === G.world ? G.scene : space.group;
    this.parent.add(this.model.root);
    this.weapon = opts.weapon !== undefined ? opts.weapon : R.weapon || null;
    if (this.weapon) {
      this.gun = buildGun(this.weapon);
      this.model.armR.add(this.gun);
      this.mag = WEAPONS[this.weapon].mag;
    }
    this.hp = R.hp; this.maxHp = R.hp;
    this.armor = R.armor || 0;
    this.acc = R.acc || 0.4;
    this.speed = R.speed; this.run = R.run;
    this.x = x; this.z = z; this.h = h;
    this.y = space.groundY(x, z);
    this.vx = 0; this.vz = 0;
    this.home = { x, z, h };
    this.state = opts.state || 'idle';
    this.waypoints = opts.waypoints || null;
    this.wpT = rand(1, 4);
    this.tx = x; this.tz = z;
    this.timer = 0;
    this.phase = Math.random() * 6;
    this.fireT = rand(0.6, 1.4);
    this.burst = 2;
    this.strafe = 1; this.strafeT = 0;
    this.stuckT = 0; this.sideT = 0;
    this.hurtT = 0;
    this.hostile = !!opts.hostile;
    this.keycard = !!opts.keycard;
    this.dead = false;
    this.gone = false;
    this.deadT = 0;
    this.lie = 0;
    this.path = null; this.pathT = 0;
    this.lastX = x; this.lastZ = z;
    this.onDeath = opts.onDeath || null;
    this.aggro = opts.aggro || 0;
    G.npcs.push(this);
  }

  get isCop() { return this.role === 'cop' || this.role === 'swat'; }
  get civilian() { return !!CIVILIAN[this.role]; }

  muzzle(out) {
    if (this.gun) return this.gun.localToWorld(out.set(0, 0, this.gun.userData.len));
    return out.set(this.x, this.y + 1.4, this.z);
  }

  remove() {
    if (this.gone) return;
    this.gone = true;
    this.parent.remove(this.model.root);
    const i = this.G.npcs.indexOf(this);
    if (i >= 0) this.G.npcs.splice(i, 1);
  }

  // ------------------------------------------------------------ reactions
  damage(amount, fromX, fromZ, byPlayer) {
    if (this.dead) return false;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.7); this.armor -= a; amount -= a; }
    this.hp -= amount;
    this.hurtT = 0.18;
    if (this.hp <= 0) { this.die(byPlayer); return true; }
    if (this.civilian) this.panic(fromX, fromZ);
    else if (this.weapon) { this.hostile = true; this.state = 'combat'; }
    if (byPlayer) this.G.onNpcHurt(this);
    return false;
  }

  die(byPlayer) {
    this.dead = true;
    this.state = 'down';
    this.vx = this.vz = 0;
    this.G.onNpcDown(this, byPlayer);
    this.onDeath?.(this);
  }

  panic(fromX, fromZ) {
    if (this.dead) return;
    if (this.space.lockdown || Math.random() < 0.6) { this.state = 'cower'; this.timer = rand(5, 9); }
    else { this.state = 'flee'; this.tx = fromX; this.tz = fromZ; this.timer = rand(6, 9); }
  }

  hearGunfire(x, z, byPlayer) {
    if (this.dead) return;
    if (this.civilian) {
      if (this.state !== 'cower' && this.state !== 'flee' && this.state !== 'handsup') this.panic(x, z);
    } else if (this.role === 'guard' && byPlayer) {
      this.hostile = true; this.state = 'combat';
    }
  }

  handsUp(t = 6) {
    if (this.dead) return;
    this.state = 'handsup';
    this.timer = t;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const G = this.G, m = this.model;
    if (this.dead) {
      this.deadT += dt;
      this.lie = Math.min(1, this.lie + dt * 5);
      m.root.rotation.x = -Math.PI / 2 * this.lie;
      m.root.position.set(this.x, this.y + 0.15 * this.lie, this.z);
      animateHuman(m, 0, 0);
      if (this.space === G.world && this.deadT > 40) this.remove();
      return;
    }
    this.hurtT -= dt;
    const P = G.player;
    const same = P.space === this.space && P.alive;
    const pp = P.pos;
    const dx = pp.x - this.x, dz = pp.z - this.z;
    const d = Math.hypot(dx, dz) || 1;
    let mx = 0, mz = 0, sp = 0, faceX = 0, faceZ = 0, aim = false;

    if (this.aggro && !this.hostile && same && d < this.aggro && this.canSee(pp)) { this.hostile = true; this.state = 'combat'; }
    // armed staff turn hostile when they see a drawn weapon pointed around, or on alarm
    if (this.role === 'guard' && !this.hostile && same) {
      if (this.space.alarm || (G.arsenal.armed && P.aiming && d < 14 && this.canSee(pp))) {
        this.hostile = true;
        this.state = 'combat';
        this.space.onAlert?.(this);
      }
    }
    if (this.isCop) {
      if (G.wanted.stars > 0 && this.state !== 'combat') this.state = 'combat';
      if (G.wanted.stars === 0 && this.state === 'combat') { this.state = 'leave'; this.timer = 25; }
    }

    switch (this.state) {
      case 'idle':
        if (this.waypoints && (this.wpT -= dt) <= 0) {
          const w = pick(this.waypoints);
          this.tx = this.space.wx(w[0]); this.tz = this.space.wz(w[1]);
          this.state = 'wander';
        } else this.h = dampAngle(this.h, this.home.h, 4, dt);
        break;
      case 'wander': {
        const ex = this.tx - this.x, ez = this.tz - this.z, l = Math.hypot(ex, ez);
        if (l < 0.5) { this.state = 'idle'; this.wpT = rand(2, 6); this.home.h = this.h; }
        else { mx = ex / l; mz = ez / l; sp = this.speed; }
        break;
      }
      case 'handsup':
        faceX = dx; faceZ = dz;
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'cower'; this.timer = rand(6, 10); }
        break;
      case 'cower':
        this.timer -= dt;
        if (this.timer <= 0 && !this.space.lockdown) {
          if (this.role === 'civ') { this.state = 'flee'; this.timer = 8; } else { this.state = 'idle'; }
        }
        break;
      case 'flee': {
        this.timer -= dt;
        const ex = this.space.exitPoint;
        if (ex) {
          const fx = ex.x - this.x, fz = ex.z - this.z, l = Math.hypot(fx, fz);
          if (l < 1.2) { this.remove(); return; }
          const t = this.navTarget(ex);
          const ax = t.x - this.x, az = t.z - this.z, al = Math.hypot(ax, az) || 1;
          mx = ax / al; mz = az / al;
        } else {
          const ax = this.x - this.tx, az = this.z - this.tz, al = Math.hypot(ax, az) || 1;
          mx = ax / al; mz = az / al;
          if (this.timer <= 0) { this.state = 'idle'; this.home = { x: this.x, z: this.z, h: this.h }; }
        }
        sp = this.run;
        break;
      }
      case 'leave': {
        this.timer -= dt;
        mx = -dx / d; mz = -dz / d; sp = this.speed * 0.6;
        if (this.timer <= 0 || d > 80) { this.remove(); return; }
        break;
      }
      case 'combat': {
        if (!same) { if (this.space === G.world && d > 120) this.remove(); break; }
        const w = WEAPONS[this.weapon];
        const lethal = !this.isCop || G.wanted.lethal;
        const los = this.canSee(pp);
        faceX = dx; faceZ = dz;
        if (!lethal) {
          // try to cuff an unarmed suspect instead of shooting
          if (d > 1.5) { const t = this.navTarget(pp); const ax = t.x - this.x, az = t.z - this.z, al = Math.hypot(ax, az) || 1; mx = ax / al; mz = az / al; sp = this.run; }
          break;
        }
        aim = true;
        const far = this.role === 'swat' ? 22 : 17;
        if (!los || d > far) {
          const t = this.navTarget(pp);
          const ax = t.x - this.x, az = t.z - this.z, al = Math.hypot(ax, az) || 1;
          mx = ax / al; mz = az / al; sp = this.run;
        } else if (d < 4.5) {
          mx = -dx / d; mz = -dz / d; sp = this.speed * 0.6;
        } else {
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafe = Math.random() < 0.3 ? 0 : Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(1, 2.5); }
          mx = (-dz / d) * this.strafe; mz = (dx / d) * this.strafe; sp = this.speed * 0.45;
        }
        this.fireT -= dt;
        if (los && w && d < w.range && this.fireT <= 0 && this.hurtT <= 0) {
          if (this.mag <= 0) { this.mag = w.mag; this.fireT = w.reload * 1.4; }
          else {
            npcShoot(G, this);
            this.mag--;
            this.burst--;
            if (this.burst <= 0) { this.burst = w.auto ? 3 + ((Math.random() * 3) | 0) : 1 + ((Math.random() * 2) | 0); this.fireT = rand(1.0, 1.9); }
            else this.fireT = w.rate * 2;
          }
        }
        break;
      }
    }

    // sidestep when blocked
    if (this.sideT > 0) { this.sideT -= dt; const t = mx; mx = -mz; mz = t; }
    this.vx = mx * sp; this.vz = mz * sp;
    this.move(dt);
    if (sp > 0.1) {
      const moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
      if (moved < sp * dt * 0.25) { this.stuckT += dt; if (this.stuckT > 0.8) { this.sideT = 0.7; this.stuckT = 0; } }
      else this.stuckT = 0;
    }
    this.lastX = this.x; this.lastZ = this.z;

    // facing + animation
    if (faceX || faceZ) this.h = dampAngle(this.h, Math.atan2(faceX, faceZ), 10, dt);
    else if (sp > 0.1) this.h = dampAngle(this.h, Math.atan2(this.vx, this.vz), 8, dt);
    const spd = Math.hypot(this.vx, this.vz);
    this.phase += dt * spd * 2.4;
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.set(0, this.h, 0);
    animateHuman(m, this.phase, clamp(spd / 5, 0, 1));
    if (this.state === 'cower') poseCower(m);
    else if (this.state === 'handsup') poseHandsUp(m);
    else if (aim) poseAim(m, clamp(-(pp.y - this.y) / Math.max(d, 1), -0.6, 0.6), TWO_HANDED[this.weapon]);
    else if (this.gun) m.armR.rotation.x = -0.3;
  }

  canSee(pp) {
    if (this.G.player.space !== this.space) return false;
    return !this.space.colliders.lineBlocked(this.x, this.z, pp.x, pp.z, 1.5, 1.3);
  }

  move(dt) {
    const S = this.space, G = this.G;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (S.isLand(nx, nz) && S.groundY(nx, nz) - this.y < 0.6) { this.x = nx; this.z = nz; }
    const hit = G.circleVsBoxes(S.colliders, this.x, this.z, 0.35);
    if (hit) { this.x += hit.nx * hit.pen; this.z += hit.nz * hit.pen; }
    // keep personal space from the player and other NPCs
    const P = G.player;
    if (P.space === S && !P.vehicle) {
      const ex = this.x - P.x, ez = this.z - P.z, l = Math.hypot(ex, ez);
      if (l < 0.7 && l > 1e-4) { this.x += (ex / l) * (0.7 - l); this.z += (ez / l) * (0.7 - l); }
    }
    for (const o of G.npcs) {
      if (o === this || o.space !== S || o.dead) continue;
      const ex = this.x - o.x, ez = this.z - o.z, l2 = ex * ex + ez * ez;
      if (l2 < 0.49 && l2 > 1e-6) { const l = Math.sqrt(l2); this.x += (ex / l) * (0.7 - l) * 0.5; this.z += (ez / l) * (0.7 - l) * 0.5; }
    }
    if (S.isLand(this.x, this.z)) { this.landX = this.x; this.landZ = this.z; }
    else if (this.landX !== undefined) { this.x = this.landX; this.z = this.landZ; }
    this.y = S.groundY(this.x, this.z);
  }

  // Walk toward a target, using the space's waypoint graph when the way is blocked.
  navTarget(t) {
    const S = this.space;
    if (!S.nav) return t;
    if (!S.colliders.lineBlocked(this.x, this.z, t.x, t.z, 1, 1.0)) { this.path = null; return t; }
    this.pathT -= 1 / 60;
    if (!this.path || this.pathT <= 0) { this.path = S.findPath(this.x, this.z, t.x, t.z); this.pathT = 0.5; }
    while (this.path && this.path.length) {
      const n = this.path[0];
      if (Math.hypot(n.x - this.x, n.z - this.z) < 0.8) this.path.shift();
      else return n;
    }
    return t;
  }
}
