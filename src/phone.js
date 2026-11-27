const $ = (id) => document.getElementById(id);

// Dex rings when he has the next job. Answer (Y) to start it on the spot,
// or ignore it (X) and meet him at the motel later.
export class Phone {
  constructor(G) {
    this.G = G;
    this.state = 'idle';
    this.callT = 25;
    this.t = 0;
    this.ringT = 0;
    this.textT = 0;
    this.el = { box: $('phone'), from: $('ph-from'), msg: $('ph-msg'), actions: $('ph-actions') };
    $('ph-answer').addEventListener('click', () => this.answer());
    $('ph-decline').addEventListener('click', () => this.decline(false));
  }

  get ringing() { return this.state === 'ringing'; }

  canCall() {
    const G = this.G;
    return !G.missions.active && !G.missions.done && G.wanted.stars === 0 && G.player.alive && !G.sequence &&
      !G.heist.running && G.player.space === G.world && !G.ui.open && !G.transitioning;
  }

  show(from, msg, actions) {
    this.el.from.textContent = from;
    this.el.msg.textContent = msg;
    this.el.actions.hidden = !actions;
    this.el.box.hidden = false;
    this.el.box.classList.toggle('ringing', actions);
  }
  hide() { this.el.box.hidden = true; this.el.box.classList.remove('ringing'); }

  text(from, msg, dur = 6) {
    if (this.ringing) return;
    this.state = 'text';
    this.textT = dur;
    this.show(from, msg, false);
    this.G.audio.click();
  }

  ring() {
    const m = this.G.missions.current;
    this.state = 'ringing';
    this.t = 0;
    this.ringT = 0;
    this.show('INCOMING CALL · DEX', m.pitch || m.title, true);
    this.G.guide.tip('call');
  }

  answer() {
    if (!this.ringing) return;
    this.state = 'idle';
    this.hide();
    this.G.audio.click();
    this.G.missions.start();
  }

  decline(missed) {
    if (!this.ringing) return;
    this.state = 'idle';
    this.hide();
    this.callT = 120;
    this.G.notify(missed ? 'Missed call from Dex. He\'ll be at the Seabreeze Motel.' : 'Sent Dex to voicemail. Meet him at the motel when you\'re ready.', 3.5);
  }

  afterMission() { this.callT = 22; }

  update(dt) {
    const G = this.G, inp = G.input;
    if (this.state === 'text') {
      this.textT -= dt;
      if (this.textT <= 0) { this.state = 'idle'; this.hide(); }
    }
    if (this.ringing) {
      this.t += dt;
      this.ringT -= dt;
      if (this.ringT <= 0) { G.audio.ring(); this.ringT = 1.6; }
      if (!this.canCall()) { this.state = 'idle'; this.hide(); this.callT = 30; return; }
      if (inp.hit('KeyY')) this.answer();
      else if (inp.hit('KeyX')) this.decline(false);
      else if (this.t > 15) this.decline(true);
      return;
    }
    const M = G.missions;
    if (M.active || M.done || M.current.phone === false) return;
    if (!this.canCall()) return;
    this.callT -= dt;
    if (this.callT <= 0) this.ring();
  }
}
