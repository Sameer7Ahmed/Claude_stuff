import { WEAPONS } from './weapons.js';
import { CAR_TYPES, repaintCar } from './models.js';
import { CAR_COLORS } from './config.js';
import { fmtMoney, pick, rand } from './util.js';
import { Vehicle } from './vehicle.js';

export const PROPERTIES = {
  motel: { name: 'Seabreeze Room 6', price: 2500, desc: 'Safehouse. Sleep to save and heal, refill armor once a day, and keep your personal car in the garage.' },
  arcade: { name: 'Neon Arcade', price: 12000, desc: 'Business. Earns $250 every in-game hour into the office safe, up to $4,000.', income: 250, cap: 4000 },
};
const ENGINE = [1200, 2800, 5500];
const ARMOR = [1500, 3800];
const SELL = { sedan: 900, suv: 1300, taxi: 700, van: 1000, sports: 2600, police: 0 };
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Economy {
  constructor(G) {
    this.G = G;
    this.owned = new Set();
    this.arcadeSafe = 0;
    this.lastHour = null;
    this.chopT = 0;
    this.storeT = 0;
    this.lockerDay = -1;
    this.day = 0;
    this.personal = null; // {type, color, mods}
    this.robbing = null;
    this.zones = [];
  }

  save() {
    return { owned: [...this.owned], arcadeSafe: this.arcadeSafe, personal: this.personal, day: this.day, lockerDay: this.lockerDay };
  }
  load(s) {
    if (!s) return;
    for (const id of s.owned || []) if (PROPERTIES[id]) this.owned.add(id);
    this.arcadeSafe = s.arcadeSafe || 0;
    this.personal = s.personal || null;
    this.day = s.day || 0;
    this.lockerDay = s.lockerDay ?? -1;
  }

  // ------------------------------------------------------------ wiring
  attach() {
    const G = this.G, L = G.interiors.list;
    this.zonePrompt = null;
    // outdoor doors
    for (const I of G.interiors.all) {
      const d = I.door;
      G.worldInteractables.push({ x: d.x, z: d.z, r: 1.9, label: () => this.doorLabel(I), onPress: () => this.doorPress(I) });
    }
    // drive-in zones
    const S = G.world.specials;
    this.zones.push({ ...S.paint, r: 7, name: 'Paint & Pay Customs', open: () => this.openCustoms() });
    this.zones.push({ x: S.chop.x, z: S.chop.z, r: 6, name: "Dex's Lockup", open: () => this.openChop() });

    // gun shop + shooting range
    L.gunshop.at(-3.4, 7.6, 2.2, () => 'Browse weapons and gear', () => this.openGunShop());
    const gs = L.gunshop;
    gs.range = { active: false, t: 0, hits: 0, last: 0, best: 0, runs: 0 };
    gs.at(0, 0.3, 2.8, () => (gs.range.active ? null : G.arsenal.armed ? 'Start the range challenge (30 s)' : 'Shooting range (draw a gun first)'), () => this.startRange());
    gs.onTargetHit = () => { if (gs.range.active) { gs.range.hits++; G.audio.checkpoint(); } };
    // Late Mart counter: shop or stick-up, depending on whether a gun is out
    L.store.at(4, 5.5, 2.2, () => this.storeLabel(), () => this.storePress());
    // arcade
    L.arcade.at(0, -5.1, 2.2, () => (this.owned.has('arcade') ? null : `Buy the Neon Arcade (${fmtMoney(PROPERTIES.arcade.price)})`), () => this.openPropertyDeal('arcade'));
    L.arcade.at(6.0, -8.3, 1.6, () => (this.owned.has('arcade') ? (this.arcadeSafe >= 1 ? `Collect ${fmtMoney(this.arcadeSafe)} from the safe` : 'Safe is empty. Check back later.') : null), () => this.collectSafe());
    L.arcade.at(-6.3, 6.6, 1.6, () => 'Play Lucky Tides ($25)', () => this.playSlots());
    // safehouse
    L.motel.at(-2.4, -0.9, 1.7, () => 'Sleep (save, heal, skip 8 hours)', () => this.sleep());
    L.motel.at(2.2, -3.7, 1.6, () => (this.lockerDay === this.day ? 'Armor locker (restocks tomorrow)' : 'Armor locker: free refill'), () => this.locker());
  }

  doorLabel(I) {
    const G = this.G;
    if (I.id === 'motel' && !this.owned.has('motel')) return `Buy ${PROPERTIES.motel.name} (${fmtMoney(PROPERTIES.motel.price)})`;
    if (I.id === 'motel') return 'Enter your safehouse';
    if (I.id === 'bank' && G.heist.phase === 'escape') return 'Solano Bank: sealed by police';
    if (I.id === 'bank' && G.heist.closed) return `Solano Bank: closed for investigation (${fmtT(G.heist.cooldownT)})`;
    return `Enter ${I.name}`;
  }
  doorPress(I) {
    const G = this.G;
    if (I.id === 'motel' && !this.owned.has('motel')) { this.openPropertyDeal('motel'); return; }
    if (I.id === 'bank' && G.heist.phase === 'escape') { G.notify('No going back in. Get the bag out of here!', 2); return; }
    if (I.id === 'bank' && G.heist.closed) { G.notify('Crime-scene tape across the doors. Come back later.', 2); return; }
    G.interiors.enter(I);
  }

  // ------------------------------------------------------------ money helpers
  canTrade() {
    if (this.G.wanted.stars > 0) { this.G.notify('"Not while the cops are on you. Get out!"', 2.2); this.G.audio.deny(); return false; }
    return true;
  }

  openGunShop() {
    const G = this.G, A = G.arsenal, P = G.player;
    if (!this.canTrade()) return;
    G.ui.openShop({
      kicker: 'Iron Palm Arms', title: 'Weapons & Gear', sub: 'Licensed, mostly. Ammo for anything you already own.', accent: '#ff8a3d',
      items: () => {
        const items = [];
        for (const id of ['pistol', 'smg', 'shotgun', 'rifle']) {
          const w = WEAPONS[id];
          if (!A.has(id)) {
            items.push({ name: w.name, desc: `Slot ${w.slot} · ${w.mag}-round magazine${w.driveBy ? ' · drive-by capable' : ''}`, stats: w.stats, price: w.price, action: () => { A.give(id); G.audio.equip(); return `${w.name} purchased and equipped (key ${w.slot}).`; } });
          } else {
            items.push({ name: `${w.name} ammo`, desc: `+${w.ammo.rounds} rounds · carrying ${A.total(id)}`, price: w.ammo.price, action: () => { A.addAmmo(id, w.ammo.rounds); return `+${w.ammo.rounds} ${w.name} rounds.`; } });
          }
        }
        items.push({ name: 'Suppressor', desc: 'Fits the Coral P9 and Hornet SMG. Quiet shots draw far less attention.', price: 900, tag: A.suppressor ? 'FITTED' : null, disabled: A.suppressor ? 'Already fitted' : null, action: () => { A.suppressor = true; return 'Suppressor fitted.'; } });
        items.push({ name: 'Body armor', desc: `Soaks up most incoming fire · currently ${Math.round(P.armor)}/100`, price: 350, disabled: P.armor >= 100 ? 'Armor is already full' : null, action: () => { P.armor = 100; return 'Armor strapped on.'; } });
        items.push({ name: 'Thermal drill', desc: 'Industrial vault drill. One use. "For the right kind of job."', price: 1500, tag: A.drills ? 'IN BAG' : null, disabled: A.drills ? 'You already carry one' : null, action: () => { A.drills = 1; return 'Thermal drill packed. Solano Bank has a vault.'; } });
        return items;
      },
    });
  }

  storeLabel() {
    const G = this.G;
    if (this.robbing) return null;
    if (G.arsenal.armed) return this.storeT > 0 ? `Register is empty (${fmtT(this.storeT)})` : 'Rob the register';
    return 'Shop: snacks, first aid, scratch tickets';
  }
  storePress() {
    const G = this.G, P = G.player;
    if (G.arsenal.armed) {
      const clerk = G.interiors.list.store.parts.clerk;
      if (this.storeT > 0 || !clerk || clerk.dead) { G.notify('Nothing left in the till.', 1.5); return; }
      this.robbing = { t: 0, clerk };
      clerk.handsUp(8);
      G.audio.alert();
      G.notify('"Okay, okay! Just don\'t shoot!"', 2);
      return;
    }
    if (!this.canTrade()) return;
    G.ui.openShop({
      kicker: 'Late Mart 24/7', title: 'Counter', sub: 'Fresh-ish. Open all night.', accent: '#7dff7a',
      items: () => [
        { name: 'Coral Cola & chips', desc: 'Restores 35 health.', price: 15, disabled: P.health >= 100 ? 'Health is full' : null, action: () => { P.health = Math.min(100, P.health + 35); return 'Crunchy. +35 health.'; } },
        { name: 'First-aid kit', desc: 'Restores full health.', price: 90, disabled: P.health >= 100 ? 'Health is full' : null, action: () => { P.health = 100; return 'Patched up.'; } },
        { name: 'Tide Ticket scratch card', desc: 'Win up to $1,000. Odds printed very small.', price: 20, action: () => this.scratch() },
      ],
    });
  }
  scratch() {
    const r = Math.random();
    const win = r < 0.005 ? 1000 : r < 0.05 ? 150 : r < 0.25 ? 40 : 0;
    if (win) { this.G.addMoney(win); this.G.audio.slot(true); return win >= 1000 ? 'JACKPOT! $1,000!' : `Winner! ${fmtMoney(win)}.`; }
    return 'No luck this time.';
  }

  updateRobbery(dt) {
    const R = this.robbing;
    if (!R) return;
    const G = this.G, P = G.player, I = G.interiors.list.store;
    if (P.space !== I || R.clerk.dead || !P.alive) { this.robbing = null; G.hud.hold(null); return; }
    const d = Math.hypot(P.x - R.clerk.x, P.z - R.clerk.z);
    if (d > 7) { this.robbing = null; G.hud.hold(null); G.notify('You backed off. The clerk hits the alarm.', 2); G.wanted.crime(1.1, P.x, P.z); return; }
    R.t += dt;
    G.hud.hold(R.t / 3.5, 'Clerk is emptying the till');
    if (R.t >= 3.5) {
      const take = Math.round(rand(280, 680) / 10) * 10;
      G.addMoney(take);
      G.audio.cash();
      this.robbing = null;
      this.storeT = 240;
      G.hud.hold(null);
      R.clerk.state = 'cower'; R.clerk.timer = 30;
      G.wanted.setStars(Math.max(2, G.wanted.stars));
      G.hud.big('REGISTER EMPTIED', `+${fmtMoney(take)} · Silent alarm tripped`, 2.6);
    }
  }

  // ------------------------------------------------------------ shooting range
  startRange() {
    const G = this.G, R = G.interiors.list.gunshop.range;
    if (!G.arsenal.armed) { G.notify('Draw a gun first (number keys or Q).', 2); return; }
    R.active = true; R.t = 30; R.hits = 0; R.popT = 0;
    G.notify('Targets up! 30 seconds.', 1.6);
    G.audio.alert();
  }
  updateRange(dt) {
    const G = this.G, I = G.interiors.list.gunshop, R = I.range;
    if (!R || !R.active) return;
    if (G.player.space !== I) { R.active = false; for (const T of I.targets) T.up = false; return; }
    R.t -= dt;
    G.hud.timer(R.t);
    // keep two targets standing; knocked-down ones are replaced at random lanes
    for (const T of I.targets) if (!T.up && T.downT > 0) T.downT -= dt;
    const up = I.targets.filter((T) => T.up).length;
    if (up < 2) {
      const ready = I.targets.filter((T) => !T.up && T.downT <= 0);
      if (ready.length) ready[(Math.random() * ready.length) | 0].up = true;
    }
    if (R.t <= 0) {
      R.active = false;
      R.runs++;
      R.last = R.hits;
      R.best = Math.max(R.best, R.hits);
      for (const T of I.targets) T.up = false;
      G.hud.timer(null);
      const onMission = G.missions.isActive('iron-lesson');
      const pay = onMission ? 0 : R.hits * 8;
      if (pay) G.addMoney(pay);
      G.hud.big('RANGE', `${R.hits} hits · best ${R.best}${pay ? ` · +${fmtMoney(pay)}` : ''}`, 2.6);
    }
  }

  // ------------------------------------------------------------ properties
  openPropertyDeal(id) {
    const G = this.G, p = PROPERTIES[id];
    if (!this.canTrade()) return;
    G.ui.openShop({
      kicker: 'Property for sale', title: p.name, sub: p.desc, accent: '#ff3fa4',
      items: () => [{
        name: `Buy ${p.name}`, desc: p.desc, price: p.price, tag: this.owned.has(id) ? 'OWNED' : null, disabled: this.owned.has(id) ? 'Already yours' : null,
        action: () => {
          this.owned.add(id);
          G.save();
          setTimeout(() => G.hud.big('PROPERTY ACQUIRED', p.name, 3), 50);
          return id === 'motel' ? 'Keys are yours. Your personal car will wait in the motel lot.' : 'The arcade is yours. Income lands in the office safe.';
        },
      }],
    });
  }
  collectSafe() {
    const G = this.G;
    if (!this.owned.has('arcade') || this.arcadeSafe < 1) return;
    const n = Math.floor(this.arcadeSafe);
    this.arcadeSafe = 0;
    G.addMoney(n);
    G.audio.cash();
    G.save();
  }
  playSlots() {
    const G = this.G;
    if (!G.spend(25)) return;
    G.audio.slot(false);
    setTimeout(() => {
      const r = Math.random();
      const win = r < 0.004 ? 2000 : r < 0.05 ? 150 : r < 0.23 ? 40 : 0;
      if (win) {
        G.addMoney(win);
        G.audio.slot(true);
        G.hud.big(win >= 2000 ? 'JACKPOT' : 'LUCKY TIDES', `+${fmtMoney(win)}`, 2);
        if (this.owned.has('arcade')) this.arcadeSafe = Math.max(0, this.arcadeSafe - win * 0.2);
      } else {
        G.notify('Three seashells... and a crab. No win.', 1.6);
        if (this.owned.has('arcade')) this.arcadeSafe = Math.min(PROPERTIES.arcade.cap, this.arcadeSafe + 10);
      }
    }, 650);
  }
  sleep() {
    const G = this.G, P = G.player;
    if (G.wanted.stars > 0) { G.notify("You can't sleep with sirens outside.", 2); return; }
    G.transition(() => {
      G.env.time = (G.env.time + 8) % 24;
      P.health = 100;
      G.save();
      G.hud.big('SAVED', `Woke up at ${G.env.clock}`, 2.4);
    }, 0.9);
  }
  locker() {
    const G = this.G, P = G.player;
    if (this.lockerDay === this.day) { G.notify('The locker restocks tomorrow.', 1.5); return; }
    if (P.armor >= 100) { G.notify('Your armor is already full.', 1.5); return; }
    P.armor = 100;
    this.lockerDay = this.day;
    G.audio.equip();
    G.notify('Armor refilled from the locker.', 1.8);
  }

  // ------------------------------------------------------------ vehicles
  openCustoms() {
    const G = this.G, v = G.player.vehicle;
    if (!v) return;
    const W = G.wanted;
    const firstJob = G.missions.isActive('fresh-coat');
    G.ui.openShop({
      kicker: 'Paint & Pay Customs', title: v.spec.name, sub: 'Upgrades turn this car into your personal ride.', accent: '#ff3fa4',
      items: () => {
        const m = v.mods;
        const respray = firstJob ? 0 : 150 + W.stars * 200;
        const items = [
          {
            name: W.stars ? `Respray: lose ${W.stars}★ heat` : 'Respray', desc: W.stars ? 'New colour, new plates. The cops lose the description.' : 'Fresh coat in a random colour.',
            price: respray, disabled: v.type === 'police' || v.type === 'taxi' ? "Can't respray a fleet vehicle" : null,
            action: () => {
              let c = pick(CAR_COLORS);
              while (c === v.color) c = pick(CAR_COLORS);
              v.color = c;
              repaintCar(v.model, v.type, c);
              const had = W.stars;
              W.clear();
              G.audio.spray();
              G.effects.sparkle(v.x, v.y + 1.5, v.z, '#ff3fa4', 30);
              if (v.personal) this.rememberPersonal(v);
              return had ? 'Resprayed. The heat is off.' : 'Resprayed.';
            },
          },
          {
            name: 'Repair', desc: `Body at ${Math.round(v.health)}%`, price: Math.ceil((100 - v.health) * 2.5),
            disabled: v.health >= 99 ? 'Already in top shape' : null,
            action: () => { v.health = 100; v.fireT = 0; return 'Good as new.'; },
          },
        ];
        if (m.engine < 3) items.push({ name: `Engine stage ${m.engine + 1}`, desc: `+10% top speed, +18% acceleration per stage (now stage ${m.engine})`, price: ENGINE[m.engine], action: () => { m.engine++; this.setPersonal(v); return `Engine stage ${m.engine} installed.`; } });
        else items.push({ name: 'Engine stage 3', desc: 'Maxed out.', price: null, tag: 'MAX' });
        if (m.armor < 2) items.push({ name: `Armor plating ${m.armor + 1 === 1 ? 'I' : 'II'}`, desc: `Takes ${m.armor ? '65' : '40'}% less damage from crashes and bullets`, price: ARMOR[m.armor], action: () => { m.armor++; this.setPersonal(v); return 'Armor plating fitted.'; } });
        else items.push({ name: 'Armor plating II', desc: 'Maxed out.', price: null, tag: 'MAX' });
        items.push({ name: 'Sport tires', desc: '+25% grip in corners and drifts', price: 1400, tag: m.grip ? 'FITTED' : null, disabled: m.grip ? 'Already fitted' : null, action: () => { m.grip = 1; this.setPersonal(v); return 'Sport tires fitted.'; } });
        items.push({ name: 'Nitro', desc: 'Hold Shift while driving for a boost. Refills over time.', price: 2500, tag: m.nitro ? 'FITTED' : null, disabled: m.nitro ? 'Already fitted' : null, action: () => { m.nitro = 1; v.nitro = 1; this.setPersonal(v); return 'Nitro installed. Hold Shift.'; } });
        return items;
      },
    });
  }
  setPersonal(v) {
    const G = this.G;
    for (const o of G.vehicles) if (o !== v) o.personal = false;
    v.personal = true;
    this.rememberPersonal(v);
  }
  rememberPersonal(v) {
    this.personal = { type: v.type, color: v.color, mods: { ...v.mods } };
    this.G.save();
  }

  openChop() {
    const G = this.G, v = G.player.vehicle;
    if (!v) return;
    G.ui.openShop({
      kicker: "Dex's Lockup", title: 'Chop shop', sub: 'Dex pays cash for clean, fast cars. No questions.', accent: '#29e7ff',
      items: () => {
        const base = SELL[v.type] ?? 800;
        const modsValue = (v.mods.engine * 600 + v.mods.armor * 700 + v.mods.grip * 400 + v.mods.nitro * 700);
        const price = Math.round(((base + modsValue) * (0.35 + 0.65 * (v.health / 100))) / 10) * 10;
        let disabled = null;
        if (v.type === 'police') disabled = 'Too hot. Nobody buys patrol cars.';
        else if (v.personal) disabled = "That's your personal ride.";
        else if (this.chopT > 0) disabled = `Crusher is busy (${fmtT(this.chopT)})`;
        else if (G.wanted.stars > 0) disabled = 'Lose the cops first.';
        return [{
          name: `Sell this ${v.spec.name}`, desc: `Condition ${Math.round(v.health)}%`, price: -price, disabled,
          action: () => {
            this.chopT = 120;
            G.player.exitVehicle(true);
            G.removeVehicle(v);
            G.addMoney(price);
            setTimeout(() => G.ui.close(), 600);
            return `Sold for ${fmtMoney(price)}.`;
          },
        }];
      },
    });
  }

  // drive-in zones open their menu once the car stops inside
  updateZones() {
    const G = this.G, v = G.player.vehicle;
    this.zonePrompt = null;
    for (const z of this.zones) {
      const inside = v && G.player.space === G.world && Math.hypot(v.x - z.x, v.z - z.z) < z.r;
      if (!inside) { z.latched = false; continue; }
      if (z.latched || G.ui.open) continue;
      if (v.speed > 4) { this.zonePrompt = `Stop to use <b>${z.name}</b>`; continue; }
      z.latched = true;
      z.open();
    }
  }

  // personal car waits at the motel garage when it's been lost
  updateGarage() {
    const G = this.G;
    if (!this.owned.has('motel') || !this.personal) return;
    const S = G.world.specials.garage;
    const P = G.player.pos;
    if (G.player.space !== G.world || Math.hypot(P.x - S.x, P.z - S.z) > 90) return;
    if (G.vehicles.some((v) => v.personal && !v.destroyed)) return;
    if (G.vehicles.some((v) => Math.hypot(v.x - S.x, v.z - S.z) < 3)) return;
    const p = this.personal;
    if (!CAR_TYPES[p.type]) return;
    const v = new Vehicle(G, p.type, p.color, S.x, S.z, S.h);
    Object.assign(v.mods, p.mods);
    v.nitro = 1;
    v.personal = true;
    G.vehicles.push(v);
    G.notify(`Your ${v.spec.name} is parked at the motel.`, 2.5);
  }

  update(dt) {
    const G = this.G;
    if (this.chopT > 0) this.chopT -= dt;
    if (this.storeT > 0) this.storeT -= dt;
    const hour = Math.floor(G.env.time);
    if (this.lastHour === null) this.lastHour = hour;
    if (hour !== this.lastHour) {
      if (hour === 6) this.day++;
      this.lastHour = hour;
      if (this.owned.has('arcade')) {
        const before = this.arcadeSafe;
        this.arcadeSafe = Math.min(PROPERTIES.arcade.cap, this.arcadeSafe + PROPERTIES.arcade.income);
        if (before < PROPERTIES.arcade.cap && this.arcadeSafe >= PROPERTIES.arcade.cap) G.notify('Neon Arcade: the office safe is full.', 3);
      }
    }
    this.updateRobbery(dt);
    this.updateRange(dt);
    this.updateZones();
    this.updateGarage();
  }
}
