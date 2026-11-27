const $ = (id) => document.getElementById(id);

// Dex and his phone. While the mission guide is open he rings when he has the next job: answer (Y)
// to start it on the spot, or ignore it (X). While the guide is closed he never interrupts; he
// leaves a voicemail in the guide instead. You can call him yourself from the open guide (Y), or
// meet him at the motel.
export class Phone {
  constructor(G) {
    this.G = G;
    this.state = 'idle';
    this.callT = 25;
    this.t = 0;
    this.ringT = 0;
    this.voicemail = false; // Dex is waiting for a call back
    this.el = { box: $('phone'), from: $('ph-from'), msg: $('ph-msg'), actions: $('ph-actions') };
    for (const [id, fn] of [['ph-answer', () => this.answer()], ['ph-decline', () => this.decline(false)]]) {
      const b = $(id);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { fn(); b.blur(); });
    }
  }

  get ringing() { return this.state === 'ringing'; }

  canCall() {
    const G = this.G;
    return !G.missions.active && !G.missions.done && G.wanted.stars === 0 && G.player.alive && !G.sequence &&
      !G.heist.running && G.player.space === G.world && !G.ui.open && !G.transitioning;
  }
  // can the player ring Dex for the next job right now?
  canDial() {
    const m = this.G.missions.current;
    return !this.ringing && !!m && m.phone !== false && this.canCall();
  }

  show(from, msg) {
    this.el.from.textContent = from;
    this.el.msg.textContent = msg;
    this.el.box.hidden = false;
    this.el.box.classList.add('ringing');
  }
  hide() { this.el.box.hidden = true; this.el.box.classList.remove('ringing'); }

  // texts from Dex land in the guide
  text(from, msg) {
    this.G.guide.post(msg, { from: from === 'DEX' ? 'Dex' : from, kind: 'dex' });
    this.G.audio.click();
  }

  ring() {
    const m = this.G.missions.current;
    this.state = 'ringing';
    this.t = 0;
    this.ringT = 0;
    this.show('INCOMING CALL · DEX', m.pitch || m.title);
    this.G.guide.tip('call');
  }

  leaveVoicemail() {
    const m = this.G.missions.current;
    this.voicemail = true;
    this.G.guide.post(m.pitch || `Got a job for you: ${m.title}.`, { from: 'Dex · voicemail', kind: 'dex' });
    this.G.audio.click();
  }

  answer() {
    if (!this.ringing) return;
    this.state = 'idle';
    this.hide();
    this.voicemail = false;
    this.G.audio.click();
    this.G.missions.start();
  }

  dial() {
    if (!this.canDial()) return;
    this.voicemail = false;
    this.G.audio.click();
    this.G.missions.start();
  }

  decline(missed) {
    if (!this.ringing) return;
    this.state = 'idle';
    this.hide();
    this.voicemail = true;
    this.G.guide.post(missed ? 'Missed call. I\'ll be at the Seabreeze Motel, or call me back.' : 'Fine, call me back when you\'re ready.', { from: 'Dex', kind: 'dex' });
  }

  afterMission() { this.callT = 22; this.voicemail = false; }

  update(dt) {
    const G = this.G, inp = G.input;
    if (this.ringing) {
      // closing the guide mid-call turns the call into a voicemail
      if (!G.guide.on) { this.state = 'idle'; this.hide(); this.leaveVoicemail(); return; }
      this.t += dt;
      this.ringT -= dt;
      if (this.ringT <= 0) { G.audio.ring(); this.ringT = 1.6; }
      if (!this.canCall()) { this.state = 'idle'; this.hide(); this.callT = 30; return; }
      if (inp.hit('KeyY')) this.answer();
      else if (inp.hit('KeyX')) this.decline(false);
      else if (this.t > 15) this.decline(true);
      return;
    }
    if (G.guide.on && inp.hit('KeyY') && this.canDial()) { this.dial(); return; }
    const M = G.missions;
    if (M.active || M.done || M.current.phone === false || this.voicemail) return;
    if (!this.canCall()) return;
    this.callT -= dt;
    if (this.callT <= 0) { if (G.guide.on) this.ring(); else this.leaveVoicemail(); }
  }
}
