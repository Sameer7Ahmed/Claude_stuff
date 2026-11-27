import * as THREE from '../vendor/three.module.min.js';
import { Marker } from './pickups.js';
import { HALF, ROAD } from './config.js';
import { ROADS } from './layout.js';
import { Npc } from './npc.js';
import { cbox } from './util.js';
import { MAT } from './models.js';

// Step factories. Each returns {text, dest?, kind?, start?, update(G, M) -> true when done}.
const say = (lines) => ({ type: 'say', lines });
const act = (fn) => ({ type: 'act', fn });
const timer = (seconds) => ({ type: 'timer', seconds, update: () => true });
const getCar = (text = 'Get a vehicle.') => ({ text, kind: 'car', update: (G) => !!G.player.vehicle });
const goTo = (where, text, { car = false, radius = 5, dest = 'Objective', onArrive } = {}) => ({
  text,
  dest,
  start(G, M) { const p = where(G); M.marker.radius = radius; M.marker.show(p.x, p.z); },
  update(G, M) {
    if (car && !G.player.vehicle) { M.sub = 'Get back in a vehicle.'; return false; }
    M.sub = '';
    const P = G.player.pos;
    if (G.player.space === G.world && M.marker.inside(P.x, P.z, car ? 1.5 : 0)) {
      if (car && G.player.vehicle.speed > 14) { M.sub = 'Slow down to stop in the marker.'; return false; }
      M.marker.hide();
      onArrive?.(G, M);
      return true;
    }
    return false;
  },
});
// walk through a building's door
const enter = (id, text, dest) => ({
  text,
  dest,
  start(G, M) { const d = G.world.doors[id]; M.marker.radius = 2.2; M.marker.show(d.x, d.z); },
  update(G, M) {
    if (G.player.space.id === id) { M.marker.hide(); return true; }
    if (!M.marker.visible && G.player.space === G.world) { const d = G.world.doors[id]; M.marker.show(d.x, d.z); }
    return false;
  },
});
const check = (fn, text, sub) => ({ text, update: (G, M) => { M.sub = sub ? sub(G) : ''; return fn(G); } });
const getWanted = (n, text) => check((G) => G.wanted.stars >= n, text);
const loseWanted = (text) => check((G) => G.wanted.stars === 0, text);
const checkpoints = (points, text, dest = 'Checkpoint') => ({
  text,
  dest,
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
});
const range = (n, text) => ({
  text,
  update(G, M) {
    const R = G.interiors.list.gunshop.range;
    if (R.active) { M.sub = `Hits: ${R.hits} / ${n}`; return R.hits >= n; }
    M.sub = R.runs ? `Last run: ${R.last} hits. Press F at the booth to try again.` : 'Press F at the shooting booth behind the counter.';
    return R.last >= n && R.runs > 0;
  },
});
const heistStep = () => ({
  text: '',
  start(G) { this.base = G.heist.successes; },
  update(G, M) {
    const H = G.heist;
    if (H.successes > this.base) return true;
    if (H.phase === 'cooldown') M.sub = H.statusLine();
    else M.sub = '';
    this.text = H.running ? H.objective : G.player.space.id === 'bank' ? 'Draw a weapon (right mouse) and take control of the bank.' : 'Go inside Solano Bank.';
    return false;
  },
});

const BEACH_X = HALF + ROAD / 2;
const N = ROADS.nodes;

export function missionList(W) {
  const S = W.specials;
  const motel = () => ({ x: S.motel.x, z: S.motel.z });
  return [
    {
      id: 'fresh-coat', title: 'Fresh Coat', reward: 500, contact: motel, phone: false,
      steps: [
        say([
          'DEX: You must be the new driver. Welcome to Port Solano.',
          'DEX: The cops here memorise license plates and paint jobs.',
          'DEX: Grab a car, any car, and run it through Paint & Pay on the west side.',
        ]),
        getCar('Get a vehicle. Walk up to a car and press F.'),
        goTo(() => S.paint, 'Drive into the Paint & Pay garage.', { car: true, radius: 6, dest: 'Paint & Pay' }),
      ],
    },
    {
      id: 'cold-delivery', title: 'Cold Delivery', reward: 900, contact: motel,
      pitch: '"Got a cooler that needs to stay cold. Marina, then the hospital."',
      steps: [
        say([
          'DEX: Good. Now a delivery job.',
          'DEX: There is a cooler waiting at the Marina Storage lockers.',
          'DEX: Bring it to the hospital. It has to arrive cold, so you have 90 seconds after pickup.',
        ]),
        getCar(),
        goTo(() => S.marina, 'Pick up the cooler at Marina Storage.', { car: true, radius: 5, dest: 'Marina Storage' }),
        timer(90),
        goTo(() => S.hospital, 'Deliver the cooler to the hospital.', { car: true, radius: 5, dest: 'Hospital' }),
      ],
    },
    {
      id: 'heights-delivery', title: 'Welcome to the Heights', reward: 1000, contact: motel,
      pitch: '"Client across the Coral Channel wants a car. Something nice pays extra."',
      steps: [
        say([
          'DEX: A client up in Palm Heights ordered a car. No questions, cash on delivery.',
          'DEX: Take the Coral Channel Bridge north. Follow the arrows, the GPS knows the way.',
          `DEX: Drop it in the driveway at ${S.heightsHouse?.number || 14} Seagrape Lane. Bring a Vortexa GT and they tip big.`,
        ]),
        getCar('Get a car to deliver (a Vortexa GT pays a $600 tip).'),
        goTo(() => S.heightsHouse, `Deliver the car to ${S.heightsHouse?.number || 14} Seagrape Lane, Palm Heights.`, {
          car: true, radius: 5, dest: 'Seagrape Lane',
          onArrive: (G) => {
            const v = G.player.vehicle;
            if (v && v.type === 'sports') { G.addMoney(600); G.notify('The client loves the Vortexa. +$600 tip', 3); }
          },
        }),
      ],
    },
    {
      id: 'coastline-sprint', title: 'Coastline Sprint', reward: 1400, contact: motel,
      pitch: '"Somebody thinks he owns the beach run. Want to prove him wrong?"',
      steps: [
        say([
          'DEX: A buddy of mine says nobody beats his time on the beach run.',
          'DEX: The route runs along the sand and over the ramps. Find something quick.',
        ]),
        getCar('Get a fast vehicle.'),
        goTo(() => ({ x: BEACH_X + 30, z: -235 }), 'Go to the start line on the south beach.', { car: true, radius: 6, dest: 'Beach start line' }),
        timer(70),
        checkpoints([
          [BEACH_X + 30, -195], [BEACH_X + 30, -120], [BEACH_X + 70, -82], [BEACH_X + 70, -10],
          [BEACH_X + 60, 38], [BEACH_X + 60, 115], [BEACH_X + 40, 178], [BEACH_X + 40, 255],
          [BEACH_X + 6, 284], [190, 280], [90, 280],
        ], 'Hit every checkpoint before time runs out.'),
      ],
    },
    {
      id: 'iron-lesson', title: 'Iron Lesson', reward: 1500, contact: motel,
      pitch: '"Jobs get heavier from here. Time you learned to shoot."',
      steps: [
        say([
          'DEX: The jobs get heavier from here. You need to handle a piece.',
          'DEX: Here is five hundred. Iron Palm Arms on the west side sells pistols.',
          'DEX: They have a range out back. Show me you can hit something.',
        ]),
        act((G) => G.addMoney(500)),
        enter('gunshop', 'Go to Iron Palm Arms.', 'Iron Palm Arms'),
        check((G) => G.arsenal.owned.size > 1, 'Buy a gun at the counter (F), then press 2 to draw it.'),
        range(8, 'Hit 8 targets in one range run (right mouse aims, left mouse fires).'),
      ],
    },
    {
      id: 'bluff-run', title: 'Bluff Run', reward: 1600, contact: motel,
      pitch: '"Sundown Bluffs. Switchbacks, no guardrails. Feel like a drive?"',
      steps: [
        say([
          'DEX: Out west there is a road up Sundown Bluffs that eats brakes for breakfast.',
          'DEX: Cross the Sunset Span and get to the bottom of the hill.',
          'DEX: From there you have 80 seconds to reach the lookout at the top. Hills slow you down going up.',
        ]),
        getCar('Get a car with some power.'),
        goTo(() => S.bluffStart, 'Cross the Sunset Span to the start line.', { car: true, radius: 7, dest: 'Sunset Span' }),
        timer(80),
        checkpoints([
          [N.Q1[0], N.Q1[1]], [N.Q2[0], N.Q2[1]], [N.Q3[0], N.Q3[1]], [N.S1[0], N.S1[1]], [N.S2[0] + 6, N.S2[1]],
        ], 'Climb to the Sundown Lookout before time runs out.', 'Switchback'),
      ],
    },
    {
      id: 'turn-up-heat', title: 'Turn Up the Heat', reward: 1800, contact: motel,
      pitch: '"The precinct needs humbling. Make some noise, then disappear."',
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
      id: 'harbor-lights', title: 'Harbor Lights', reward: 2500, contact: motel,
      pitch: '"A crate at the harbor has my name on it. The dockhands disagree."',
      steps: [
        say([
          'DEX: There is a crate in the Harbor District container yard with my name on it.',
          'DEX: The dockhands are armed and paid to keep it there. Bring a gun and armor.',
          'DEX: Then take it to the lighthouse on Lantern Key. Long drive across the causeway. Don\'t scratch it.',
        ]),
        goTo(() => S.harborYard, 'Drive to the Harbor District container yard.', { radius: 10, dest: 'Container yard' }),
        act((G) => {
          const M = G.missions, C = S.crate;
          for (const [dx, dz, w] of [[-20, -1, 'pistol'], [18, 0, 'smg'], [0, 18, 'pistol'], [-46, 0, 'shotgun']]) {
            const n = new Npc(G, G.world, 'guard', C.x + dx, C.z + dz, 0, { weapon: w, aggro: 32 });
            M.spawned.push(n);
          }
          const crate = new THREE.Mesh(cbox(1.4, 1.1, 1.4, 0, 0.55, 0, '#8b6a47'), MAT.vc);
          crate.position.set(C.x, G.world.groundY(C.x, C.z), C.z);
          G.scene.add(crate);
          M.props.push(crate);
        }),
        goTo(() => S.crate, 'Grab the crate. The dockhands will fight for it.', {
          radius: 2.6, dest: 'The crate',
          onArrive: (G, M) => { for (const p of M.props) G.scene.remove(p); M.props.length = 0; G.guide.post('Crate loaded. Now get it to Lantern Key.', { from: 'Job', kind: 'job' }); G.audio.equip(); },
        }),
        getCar('Get a vehicle for the long drive.'),
        goTo(() => S.lighthouse, 'Deliver the crate to the Lantern Key lighthouse.', { car: true, radius: 6, dest: 'Lantern Key lighthouse' }),
      ],
    },
    {
      id: 'solano-job', title: 'The Solano Job', reward: 0, contact: motel,
      pitch: '"This is the big one. Solano Bank. Come prepared."',
      outro: 'Dex: "Pleasure doing business. The bank will reopen, if you ever want seconds."',
      steps: [
        say([
          'DEX: This is the big one. Solano Bank, downtown.',
          'DEX: Get the keycard off the manager or a guard, swipe through the staff gate, and drill the vault.',
          'DEX: The drill takes time and makes noise, so the cops will come in force. Wear armor.',
          'DEX: Bag what you can, then make for the boat at the pier, or lose them and bring it to my lockup. I take twenty percent.',
        ]),
        check((G) => G.arsenal.drills > 0 || G.heist.running, 'Buy a thermal drill at Iron Palm Arms.', (G) => (G.wanted.stars ? 'Lose the cops first; shops won\'t serve you.' : '')),
        enter('bank', 'Go inside Solano Bank.', 'Solano Bank'),
        heistStep(),
      ],
    },
  ];
}

export class Missions {
  constructor(G) {
    this.G = G;
    this.list = missionList(G.world);
    this.completed = new Set();
    this.active = null;
    this.marker = new Marker(G, '#ffd23f', 5, 70);
    this.contactMarker = new Marker(G, '#4dd2ff', 2.5, 45);
    this.sub = '';
    this.timeLeft = 0;
    this.cooldown = 0;
    this.say = null;
    this.spawned = [];
    this.props = [];
  }

  // the next story mission is the first one not yet completed
  get index() {
    const i = this.list.findIndex((m) => !this.completed.has(m.id));
    return i < 0 ? this.list.length : i;
  }
  set index(i) { this.completed = new Set(this.list.slice(0, i).map((m) => m.id)); }
  get current() { return this.list[this.index]; }
  get done() { return this.index >= this.list.length; }
  get step() { return this.active ? this.active.m.steps[this.active.step] : null; }
  isActive(id) { return !!this.active && this.active.m.id === id; }
  reached(id) { return this.completed.has(id) || this.current?.id === id; }
  jumpTo(id) { this.index = this.list.findIndex((m) => m.id === id); }

  contactPos() {
    if (this.done || this.active) return null;
    return this.current.contact();
  }

  start() {
    const m = this.current;
    if (!m || this.active) return;
    this.active = { m, step: -1 };
    this.timeLeft = 0;
    this.contactMarker.hide();
    this.G.hud.big(m.title, 'Mission', 2.5);
    this.advance();
  }

  advance() {
    const A = this.active;
    if (!A) return;
    A.step++;
    const s = A.m.steps[A.step];
    if (!s) { this.pass(); return; }
    if (s.type === 'say') {
      // the briefing always lands in the guide's messages; it only plays as subtitles while the
      // guide is open (closed, the mission carries straight on and the lines wait behind the badge)
      const G = this.G, on = G.guide.on;
      const msgs = s.lines.map((line) => G.guide.post(line.replace(/^DEX:\s*/, ''), { from: 'Dex', kind: 'dex', shown: on }));
      G.hud.objective('');
      if (!on) { this.advance(); return; }
      this.say = { lines: s.lines, i: 0, t: 0, msgs };
      return;
    }
    if (s.type === 'timer') { this.timeLeft = s.seconds; this.advance(); return; }
    if (s.type === 'act') { s.fn(this.G); this.advance(); return; }
    this.sub = '';
    this.G.hud.objective(s.text);
    s.start?.(this.G, this);
  }

  // finish the briefing now (skipped, or the guide was closed mid-briefing)
  endBriefing() {
    const S = this.say;
    if (!S) return;
    if (S.i + 1 < S.lines.length) this.G.guide.requeue(S.msgs.slice(S.i + 1));
    this.say = null;
    this.G.hud.subtitle('');
    this.advance();
  }

  cleanup() {
    for (const n of this.spawned) if (!n.gone) n.remove();
    this.spawned.length = 0;
    for (const p of this.props) this.G.scene.remove(p);
    this.props.length = 0;
  }

  pass() {
    const G = this.G, m = this.active.m;
    this.active = null;
    this.timeLeft = 0;
    this.marker.hide();
    this.cleanup();
    if (m.reward) G.addMoney(m.reward);
    G.audio.pass();
    G.hud.objective('');
    G.hud.big('MISSION PASSED', m.reward ? `+$${m.reward.toLocaleString('en-US')}` : m.outro || '', 4);
    this.completed.add(m.id);
    this.cooldown = 4;
    G.phone.afterMission();
    G.save();
    if (this.done) {
      setTimeout(() => G.hud.big('PORT SOLANO IS YOURS', 'Every job is done. Buy property, upgrade your ride, explore the coast, find every neon shell.', 7), 4500);
    } else {
      setTimeout(() => G.phone.text('DEX', `Nice work. Catch your breath. Next up: "${this.current.title}".`), 4600);
    }
  }

  fail(reason) {
    if (!this.active) return;
    const G = this.G;
    this.active = null;
    this.say = null;
    this.timeLeft = 0;
    this.marker.hide();
    this.cleanup();
    G.hud.objective('');
    G.hud.subtitle('');
    G.hud.big('MISSION FAILED', reason, 3.5);
    G.audio.fail();
    this.cooldown = 4;
    G.phone.afterMission();
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
        if (this.cooldown <= 0 && G.player.alive && G.player.space === G.world && this.contactMarker.inside(P.x, P.z, 0.5)) {
          if (G.wanted.stars > 0) {
            if (!this._warned) { G.notify('Lose your wanted level before meeting Dex.', 2.5); this._warned = true; }
          } else if (this.current.id === 'solano-job' && G.heist.closed) {
            if (!this._warned) { G.notify(`Dex: "Lay low. The bank is crawling with cops." (${G.heist.statusLine()})`, 3); this._warned = true; }
          } else { this._warned = false; this.start(); }
        } else this._warned = false;
      } else this.contactMarker.hide();
      if (!G.heist.running) G.hud.timer(null);
      const H = G.heist;
      G.hud.objective(H.running ? H.objective : '');
      return;
    }

    if (this.say) {
      const S = this.say;
      S.t += dt;
      G.hud.subtitle(S.lines[S.i]);
      const skip = G.input.hit('Enter') || G.input.hit('NumpadEnter') || G.input.touch.enter;
      if (S.t > 4 || skip) {
        S.i++; S.t = 0;
        if (S.i >= S.lines.length) this.endBriefing();
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
