import { Npc } from './npc.js';
import { Marker } from './pickups.js';
import { fmtMoney, rand } from './util.js';

export const HEIST_MISSION = 5; // index of "The Solano Job" in the mission list
const DRILL_TIME = 34;
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Bank heist state machine:
// ready → active (inside: keycard → gate → drill → loot) → escape (outside) → payout → cooldown
export class Heist {
  constructor(G) {
    this.G = G;
    this.phase = 'ready';
    this.cooldownT = 0;
    this.successes = 0;
    this.boatMarker = new Marker(G, '#ffd23f', 4, 26);
    this.lockupMarker = new Marker(G, '#29e7ff', 5, 26);
    this.resetState();
  }

  get bank() { return this.G.interiors.list.bank; }
  get closed() { return this.phase === 'cooldown' && this.cooldownT > 0; }
  get available() { return this.G.missions.index >= HEIST_MISSION && this.phase === 'ready'; }
  get running() { return this.phase === 'active' || this.phase === 'escape'; }

  resetState() {
    this.alarm = false;
    this.alarmT = 0;
    this.keycard = false;
    this.drill = { state: 'none', progress: 0, jams: [] };
    this.vaultOpen = false;
    this.bag = 0;
    this.gold = false;
    this.wave = 0;
    this.waveT = 0;
    this.copsDown = 0;
    this.nagT = 0;
    this.objective = '';
  }

  // reset the physical bank: gate shut, vault shut, cash back on the trolleys
  resetBank() {
    const I = this.bank, p = I.parts;
    p.gateBox.disabled = false;
    p.vaultBox.disabled = false;
    p.vaultOpenT = 0;
    p.drill.visible = false;
    for (const t of p.trolleys) { t.taken = false; t.cash.visible = true; }
    p.gold.visible = true;
    p.goldTaken = false;
    I.alarm = false;
    I.lockdown = false;
  }

  attach() {
    const G = this.G, I = this.bank, p = I.parts;
    I.onAlert = () => { if (this.phase === 'active') this.triggerAlarm(); };
    // manager: demand the keycard at gunpoint
    I.interactables.push({
      pos: () => (p.manager && !p.manager.dead && !p.manager.gone ? p.manager : null), r: 2.6,
      label: () => {
        if (this.keycard || !p.manager || p.manager.dead) return null;
        if (!this.available && this.phase !== 'active') return null;
        return G.arsenal.armed ? 'Demand the vault keycard' : null;
      },
      onPress: () => {
        if (this.phase === 'ready' && !this.start('quiet')) return;
        p.manager.handsUp(5);
        this.keycard = true;
        G.audio.equip();
        G.hud.big('KEYCARD', '"Take it! Just don\'t hurt anyone!"', 2.2);
      },
    });
    I.at(11, 4.6, 2.2, () => {
      if (p.gateBox.disabled) return null;
      if (this.phase !== 'active') return 'Staff only';
      return this.keycard ? 'Swipe the keycard' : 'Staff gate (needs a keycard)';
    }, () => {
      if (this.phase !== 'active' || !this.keycard) { G.audio.deny(); return; }
      p.gateBox.disabled = true;
      G.audio.equip();
      G.notify('Gate open. Get to the vault.', 2);
    });
    I.at(0, -4.4, 2.4, () => this.vaultLabel(), () => this.vaultPress());
    p.trolleys.forEach((t, i) => {
      I.interactables.push({
        x: t.x, z: t.z + 0.9, r: 1.6, hold: 2.4,
        label: () => (this.vaultOpen && !t.taken ? 'Hold to bag the cash' : null),
        onHold: () => this.take(t, i),
      });
    });
    I.interactables.push({
      x: p.goldPos.x, z: p.goldPos.z, r: 1.7, hold: 4,
      label: () => (this.vaultOpen && !p.goldTaken ? 'Hold to bag the gold (heavy)' : null),
      onHold: () => {
        p.goldTaken = true;
        p.gold.visible = false;
        this.gold = true;
        this.bag += Math.round(rand(22000, 26000) / 100) * 100;
        G.audio.cash();
        G.notify('Gold bagged. It weighs you down.', 2);
      },
    });
    this.resetBank();
  }

  vaultLabel() {
    const G = this.G, I = this.bank;
    if (this.vaultOpen) return null;
    if (this.phase !== 'active') return this.available ? null : 'Vault door (time-locked)';
    if (!I.parts.gateBox.disabled) return null;
    const d = this.drill;
    if (d.state === 'none') return G.arsenal.drills ? 'Set the thermal drill' : 'Vault door (you need a thermal drill)';
    if (d.state === 'jammed') return 'Drill jammed! Restart it';
    return null;
  }
  vaultPress() {
    const G = this.G, d = this.drill;
    if (this.phase !== 'active') return;
    if (d.state === 'none') {
      if (!G.arsenal.drills) { G.notify('Buy a thermal drill at Iron Palm Arms.', 2.5); G.audio.deny(); return; }
      G.arsenal.drills--;
      d.state = 'running';
      d.progress = 0;
      d.jams = [rand(0.28, 0.42), rand(0.62, 0.78)];
      this.bank.parts.drill.visible = true;
      this.triggerAlarm();
      G.notify('Drill running. Hold them off.', 2.5);
    } else if (d.state === 'jammed') {
      d.state = 'running';
      G.audio.equip();
    }
  }

  take(t, i) {
    const G = this.G;
    if (t.taken) return;
    t.taken = true;
    t.cash.visible = false;
    const amount = Math.round(rand(7500, 10500) / 100) * 100;
    this.bag += amount;
    G.audio.cash();
    G.effects.sparkle(t.x, this.bank.floorY + 1.2, t.z, '#3ddc84', 14);
    G.notify(`+${fmtMoney(amount)} in the bag`, 1.4);
    void i;
  }

  // Called when the player first commits: aiming at people, firing, or demanding the keycard.
  start(how) {
    const G = this.G;
    if (!this.available) return false;
    this.resetState();
    this.phase = 'active';
    this.bank.lockdown = true;
    for (const n of this.bank.npcs()) if (n.civilian && n !== this.bank.parts.manager) { n.state = 'cower'; n.timer = 999; }
    G.hud.big('THE SOLANO JOB', how === 'loud' ? 'Loud and messy. Move fast.' : 'Quiet for now. The silent alarm is ticking.', 2.8);
    if (how === 'loud') this.triggerAlarm();
    else this.alarmT = 28;
    return true;
  }

  triggerAlarm() {
    const G = this.G;
    if (this.alarm) return;
    this.alarm = true;
    this.bank.alarm = true;
    G.audio.setLoop('alarm', true);
    G.wanted.setStars(Math.max(3, G.wanted.stars));
    G.wanted.lethal = true;
    G.wanted.locked = true;
    this.waveT = 16;
    for (const g of this.bank.parts.guards || []) if (!g.dead) { g.hostile = true; g.state = 'combat'; }
    G.notify('ALARM! Police are on the way.', 2.5);
  }

  spawnWave() {
    const G = this.G, I = this.bank;
    this.wave++;
    const comp = this.wave === 1 ? ['cop', 'cop'] : this.wave === 2 ? ['cop', 'cop', 'swat'] : ['swat', 'swat', 'swat'];
    comp.forEach((role, k) => {
      const n = new Npc(G, I, role, I.wx(-2 + k * 2), I.wz(15.5), Math.PI, { weapon: role === 'swat' ? 'rifle' : Math.random() < 0.3 ? 'shotgun' : 'pistol' });
      n.state = 'combat';
    });
    G.notify(this.wave === 1 ? 'Cops are storming the lobby!' : this.wave === 2 ? 'Tactical team inbound!' : 'More SWAT through the front doors!', 2.2);
  }

  onNpcDown(n, byPlayer) {
    if (n.space !== this.bank) return;
    if (n.isCop && byPlayer) this.copsDown++;
    if (n.keycard && !this.keycard) {
      this.G.pickups.add('keycard', n.x, n.z, {}, this.bank);
      n.keycard = false;
    }
  }
  pickKeycard() {
    this.keycard = true;
    this.G.notify('Got the vault keycard.', 2);
    this.G.audio.equip();
  }

  onPlayerGunfire() {
    if (this.phase === 'ready' && this.available) this.start('loud');
    else if (this.phase === 'active') this.triggerAlarm();
  }

  onLeaveBank() {
    const G = this.G;
    if (this.phase !== 'active') return;
    G.audio.setLoop('alarm', false);
    G.audio.setLoop('drill', false);
    if (this.bag <= 0) { this.fail('You walked away empty-handed.', 60); return; }
    this.phase = 'escape';
    G.wanted.locked = false;
    G.wanted.lethal = true;
    G.wanted.setStars(this.copsDown >= 6 || this.bag >= 45000 ? 5 : 4);
    const d = this.bank.door;
    G.wanted.spawnPoliceNear(d.x, d.z, 3);
    const S = G.world.specials;
    this.boatMarker.show(S.boat.x, S.boat.z);
    this.lockupMarker.show(S.chop.x, S.chop.z);
    G.hud.big('GET AWAY', `Bag: ${fmtMoney(this.bag)}`, 2.6);
  }

  secure(via) {
    const G = this.G;
    const take = Math.round(this.bag);
    const cut = Math.round(take * 0.2);
    const pay = take - cut;
    this.boatMarker.hide();
    this.lockupMarker.hide();
    G.transition(() => {
      G.wanted.clear();
      G.addMoney(pay);
      this.phase = 'cooldown';
      this.cooldownT = 360;
      this.successes++;
      this.bag = 0;
      this.gold = false;
      G.save();
      G.ui.payout({
        kicker: 'The Solano Job',
        title: via === 'boat' ? 'CLEAN GETAWAY' : 'SCORE SECURED',
        note: via === 'boat' ? 'The boat slips past the breakwater with its lights off.' : 'Dex rolls the lockup door shut behind you.',
        lines: [['Total take', fmtMoney(take)], ["Dex's cut (20%)", `-${fmtMoney(cut)}`], ['Cops put down', String(this.copsDown)]],
        total: fmtMoney(pay),
      });
    }, 1.2);
  }

  fail(reason, cooldown = 45) {
    const G = this.G;
    if (!this.running) return;
    G.audio.setLoop('alarm', false);
    G.audio.setLoop('drill', false);
    this.boatMarker.hide();
    this.lockupMarker.hide();
    G.wanted.locked = false;
    this.phase = 'cooldown';
    this.cooldownT = cooldown;
    this.bag = 0;
    this.gold = false;
    G.hud.bag(null);
    if (G.missions.active && G.missions.index === HEIST_MISSION) G.missions.fail(reason);
    else G.hud.big('HEIST FAILED', reason, 3);
  }

  update(dt) {
    const G = this.G, I = this.bank, P = G.player;
    if (this.phase === 'cooldown') {
      this.cooldownT -= dt;
      if (this.cooldownT <= 0 && P.space !== I) { this.phase = 'ready'; this.resetState(); this.resetBank(); }
    }
    // starting the job by pointing a gun at people in the lobby
    if (this.phase === 'ready' && this.available && P.space === I && P.aiming && G.arsenal.armed) {
      const target = P.aimTarget;
      if (target && target.space === I && !target.dead) this.start(target.role === 'guard' ? 'loud' : 'quiet');
    }
    if (this.phase === 'active') this.updateInside(dt);
    if (this.phase === 'escape') this.updateEscape(dt);
    G.hud.bag(this.running && this.bag > 0 ? this.bag : null);
    if (I.parts.vaultOpenT !== undefined && this.vaultOpen && I.parts.vaultOpenT < 1) I.parts.vaultOpenT += dt / 2.4;
  }

  updateInside(dt) {
    const G = this.G, I = this.bank, d = this.drill;
    if (!this.alarm && this.alarmT > 0) {
      this.alarmT -= dt;
      if (this.alarmT <= 0) this.triggerAlarm();
    }
    if (this.alarm && G.player.space === I) {
      this.waveT -= dt;
      const inside = I.npcs().filter((n) => n.isCop && !n.dead).length;
      if (this.waveT <= 0 && inside < 6) { this.spawnWave(); this.waveT = 20; }
    }
    if (d.state === 'running') {
      d.progress += dt / DRILL_TIME;
      G.audio.setLoop('drill', true);
      const p = I.parts.drill.position;
      if (Math.random() < 0.5) G.effects.drillSparks(p.x, p.y, p.z + 0.2);
      if (d.jams.length && d.progress >= d.jams[0]) {
        d.jams.shift();
        d.state = 'jammed';
        G.audio.setLoop('drill', false);
        G.audio.deny();
        G.notify('The drill jammed! Get back to the vault door.', 2.5);
      }
      if (d.progress >= 1) {
        d.state = 'done';
        G.audio.setLoop('drill', false);
        I.parts.drill.visible = false;
        this.vaultOpen = true;
        I.parts.vaultBox.disabled = true;
        I.parts.vaultOpenT = 0;
        G.audio.vault();
        G.shake(0.4);
        G.hud.big('VAULT OPEN', 'Grab what you can carry', 2.4);
      }
    }
    this.objective = this.insideObjective();
  }

  insideObjective() {
    const G = this.G, I = this.bank, d = this.drill;
    if (!this.keycard) return 'Get the vault keycard: hold up the manager in his office, or take it off the lobby guard.';
    if (!I.parts.gateBox.disabled) return 'Swipe the keycard at the staff gate.';
    if (d.state === 'none') return G.arsenal.drills ? 'Set the thermal drill on the vault door.' : 'You need a thermal drill. Iron Palm Arms sells them.';
    if (d.state === 'running') return `Defend the drill: ${Math.floor(d.progress * 100)}%`;
    if (d.state === 'jammed') return `Drill jammed at ${Math.floor(d.progress * 100)}%! Restart it.`;
    const left = I.parts.trolleys.filter((t) => !t.taken).length + (I.parts.goldTaken ? 0 : 1);
    return left ? `Loot the vault (${left} left), then get out.` : 'Vault cleaned out. Get out of the bank!';
  }

  updateEscape(dt) {
    const G = this.G, P = G.player;
    this.boatMarker.update(dt);
    this.lockupMarker.update(dt);
    this.objective = G.wanted.stars > 0
      ? 'Reach the boat at the end of the pier, or lose the cops and get to Dex\'s lockup.'
      : 'Heat is off. Take the bag to Dex\'s lockup or the boat.';
    if (P.space !== G.world || !P.alive) return;
    const p = P.pos;
    if (this.boatMarker.inside(p.x, p.z, 0.5) && !P.vehicle) { this.secure('boat'); return; }
    if (this.lockupMarker.inside(p.x, p.z, 1.5)) {
      if (G.wanted.stars === 0) { this.secure('lockup'); return; }
      this.nagT -= dt;
      if (this.nagT <= 0) { G.notify('Dex won\'t open up with cops on your tail.', 2); this.nagT = 3; }
    }
  }

  statusLine() {
    if (this.phase === 'cooldown') return `Bank reopens in ${fmtT(this.cooldownT)}`;
    return '';
  }
}
