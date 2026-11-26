import { Marker } from './pickups.js';
import { HALF, ROAD, LAND, PIER } from './config.js';

// Step factories. Each returns {text, start?, update(G, M, dt) -> true when done}.
const say = (lines) => ({ type: 'say', lines });
const getCar = (text = 'Get a vehicle.') => ({
  text,
  update: (G) => !!G.player.vehicle,
  target: () => null,
});
const goTo = (where, text, { car = false, radius = 5, onArrive } = {}) => ({
  text,
  car,
  where,
  start(G, M) { const p = where(G); M.marker.radius = radius; M.marker.show(p.x, p.z); },
  update(G, M) {
    if (car && !G.player.vehicle) { M.sub = 'Get back in a vehicle.'; return false; }
    M.sub = '';
    const P = G.player.pos;
    if (M.marker.inside(P.x, P.z, car ? 1.5 : 0)) {
      if (car && G.player.vehicle.speed > 14) { M.sub = 'Slow down to stop in the marker.'; return false; }
      M.marker.hide();
      onArrive?.(G, M);
      return true;
    }
    return false;
  },
  target: (G) => where(G),
});
const timer = (seconds) => ({ type: 'timer', seconds, update: () => true, target: () => null });
const getWanted = (n, text) => ({
  text,
  update: (G) => G.wanted.stars >= n,
  target: () => null,
});
const loseWanted = (text) => ({
  text,
  update: (G) => G.wanted.stars === 0,
  target: () => null,
});
const checkpoints = (points, text) => ({
  text,
  idx: 0,
  start(G, M) { this.idx = 0; const p = points[0]; M.marker.radius = 7; M.marker.show(p[0], p[1]); },
  update(G, M) {
    if (!G.player.vehicle) { M.sub = 'Get back in a vehicle.'; return false; }
    M.sub = `Checkpoint ${this.idx + 1} / ${points.length}`;
    const P = G.player.pos;
    if (M.marker.inside(P.x, P.z, 2)) {
      G.audio.checkpoint();
      this.idx++;
      if (this.idx >= points.length) { M.marker.hide(); return true; }
      const p = points[this.idx];
      M.marker.show(p[0], p[1]);
    }
    return false;
  },
  target: () => { const p = points[Math.min(points.length - 1, 0)]; return { x: p[0], z: p[1] }; },
});

const BEACH_X = HALF + ROAD / 2;

export function missionList(W) {
  const S = W.specials;
  return [
    {
      title: 'Fresh Coat',
      reward: 500,
      contact: () => ({ x: S.motel.x, z: S.motel.z }),
      steps: [
        say([
          'DEX: You must be the new driver. Welcome to Port Solano.',
          'DEX: The cops here memorise license plates and paint jobs.',
          'DEX: Grab a car, any car, and run it through Paint & Pay on the west side.',
        ]),
        getCar('Get a vehicle. Walk up to a car and press F.'),
        goTo(() => S.paint, 'Drive into the Paint & Pay garage.', { car: true, radius: 6 }),
      ],
    },
    {
      title: 'Cold Delivery',
      reward: 900,
      contact: () => ({ x: S.motel.x, z: S.motel.z }),
      steps: [
        say([
          'DEX: Good. Now a delivery job.',
          'DEX: There is a cooler waiting at the Marina Storage lockers.',
          'DEX: Bring it to the hospital. It has to arrive cold, so you have 90 seconds after pickup.',
        ]),
        getCar(),
        goTo(() => S.marina, 'Pick up the cooler at Marina Storage.', { car: true, radius: 5 }),
        timer(90),
        goTo(() => S.hospital, 'Deliver the cooler to the hospital.', { car: true, radius: 5 }),
      ],
    },
    {
      title: 'Coastline Sprint',
      reward: 1400,
      contact: () => ({ x: S.motel.x, z: S.motel.z }),
      steps: [
        say([
          'DEX: A buddy of mine says nobody beats his time on the beach run.',
          'DEX: The route runs along the sand and over the ramps. Find something quick.',
        ]),
        getCar('Get a fast vehicle.'),
        goTo(() => ({ x: BEACH_X + 30, z: -235 }), 'Go to the start line on the south beach.', { car: true, radius: 6 }),
        timer(70),
        checkpoints([
          [BEACH_X + 30, -195], [BEACH_X + 30, -120], [BEACH_X + 70, -82], [BEACH_X + 70, -10],
          [BEACH_X + 60, 38], [BEACH_X + 60, 115], [BEACH_X + 40, 178], [BEACH_X + 40, 255],
          [BEACH_X + 6, 284], [190, 280], [90, 280],
        ], 'Hit every checkpoint before time runs out.'),
      ],
    },
    {
      title: 'Turn Up the Heat',
      reward: 1800,
      contact: () => ({ x: S.motel.x, z: S.motel.z }),
      steps: [
        say([
          'DEX: The precinct thinks it owns these streets.',
          'DEX: Stir them up. Get two stars, then make them lose you.',
          'DEX: Paint & Pay works too, if you can make it there.',
        ]),
        getWanted(2, 'Get a 2-star wanted level.'),
        loseWanted('Lose the police.'),
      ],
    },
    {
      title: 'Last Call at Solano Bank',
      reward: 10000,
      contact: () => ({ x: S.motel.x, z: S.motel.z }),
      steps: [
        say([
          'DEX: Last job, and it is the big one.',
          'DEX: My contact left the side door at Solano Bank unlocked.',
          'DEX: Grab the bag, then get to the boat at the end of the pier. Every cop in town will be on you.',
        ]),
        goTo(() => S.bank, 'Go to Solano Bank downtown.', {
          radius: 4,
          onArrive: (G) => {
            G.wanted.setStars(4);
            G.notify('You have the bag. Run!', 2.5);
          },
        }),
        goTo(() => S.boat, 'Reach the getaway boat at the end of the pier.', {
          radius: 4,
          onArrive: (G) => G.wanted.clear(),
        }),
      ],
    },
  ];
}

export class Missions {
  constructor(G) {
    this.G = G;
    this.list = missionList(G.world);
    this.index = 0;
    this.active = null;
    this.marker = new Marker(G, '#ffd23f', 5);
    this.contactMarker = new Marker(G, '#4dd2ff', 2.5, 14);
    this.sub = '';
    this.timeLeft = 0;
    this.cooldown = 0;
    this.say = null;
  }

  get done() { return this.index >= this.list.length; }

  contactPos() {
    if (this.done || this.active) return null;
    return this.list[this.index].contact();
  }

  start() {
    const m = this.list[this.index];
    this.active = { m, step: -1 };
    this.timeLeft = 0;
    this.contactMarker.hide();
    this.G.hud.big(m.title, 'Mission', 2.5);
    this.advance();
  }

  advance() {
    const A = this.active;
    A.step++;
    const s = A.m.steps[A.step];
    if (!s) { this.pass(); return; }
    if (s.type === 'say') {
      this.say = { lines: s.lines, i: 0, t: 0 };
      this.G.hud.objective('');
      return;
    }
    if (s.type === 'timer') {
      this.timeLeft = s.seconds;
      this.advance();
      return;
    }
    this.sub = '';
    this.G.hud.objective(s.text);
    s.start?.(this.G, this);
  }

  pass() {
    const G = this.G, m = this.active.m;
    this.active = null;
    this.timeLeft = 0;
    this.marker.hide();
    G.addMoney(m.reward);
    G.audio.pass();
    G.hud.objective('');
    G.hud.big('MISSION PASSED', `+$${m.reward.toLocaleString('en-US')}`, 4);
    this.index++;
    this.cooldown = 4;
    G.save();
    if (this.done) {
      setTimeout(() => {
        G.hud.big('PORT SOLANO IS YOURS', 'All missions complete. The city is still open: find every neon shell.', 7);
      }, 4500);
    }
  }

  fail(reason) {
    if (!this.active) return;
    const G = this.G;
    this.active = null;
    this.say = null;
    this.timeLeft = 0;
    this.marker.hide();
    G.hud.objective('');
    G.hud.subtitle('');
    G.hud.big('MISSION FAILED', reason, 3.5);
    G.audio.fail();
    this.cooldown = 4;
  }

  update(dt) {
    const G = this.G;
    this.marker.update(dt);
    this.contactMarker.update(dt);
    if (this.cooldown > 0) this.cooldown -= dt;

    if (!this.active) {
      const c = this.contactPos();
      if (c) {
        if (!this.contactMarker.visible) this.contactMarker.show(c.x, c.z);
        const P = G.player.pos;
        if (this.cooldown <= 0 && G.player.alive && this.contactMarker.inside(P.x, P.z, 0.5)) {
          if (G.wanted.stars > 0) {
            if (!this._warned) { G.notify('Lose your wanted level before meeting Dex.', 2.5); this._warned = true; }
          } else { this._warned = false; this.start(); }
        } else this._warned = false;
      } else this.contactMarker.hide();
      G.hud.timer(null);
      return;
    }

    if (this.say) {
      const S = this.say;
      S.t += dt;
      G.hud.subtitle(S.lines[S.i]);
      const skip = G.input.hit('Enter') || G.input.hit('NumpadEnter') || G.input.touch.enter;
      if (S.t > 3.6 || skip) {
        S.i++; S.t = 0;
        if (S.i >= S.lines.length) {
          this.say = null;
          G.hud.subtitle('');
          this.advance();
        }
      }
      return;
    }

    const s = this.active.m.steps[this.active.step];
    if (this.timeLeft > 0) {
      this.timeLeft -= dt;
      G.hud.timer(this.timeLeft);
      if (this.timeLeft <= 0) { G.hud.timer(null); this.fail('You ran out of time.'); return; }
    } else G.hud.timer(null);
    if (s.update(G, this, dt)) this.advance();
    else G.hud.objective(s.text + (this.sub ? `<small>${this.sub}</small>` : ''));
  }

  // where the minimap should point
  targetPos() {
    if (this.active && this.marker.visible) return { x: this.marker.x, z: this.marker.z };
    return null;
  }
}

export { LAND, PIER };
