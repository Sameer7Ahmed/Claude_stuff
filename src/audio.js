// All sound is synthesised with WebAudio: engine, sirens, impacts and two
// generative radio stations. Nothing is loaded from disk.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const STATIONS = [
  {
    name: 'NEON FM 88.4', bpm: 104, style: 'synth',
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  },
  {
    name: 'TIDE 101.7 · Low Tide Grooves', bpm: 86, style: 'chill',
    chords: [[50, 53, 57, 60], [46, 50, 53, 57], [53, 57, 60, 64], [48, 52, 55, 59]],
  },
  { name: 'RADIO OFF', off: true },
];

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.inCar = false;
    this.station = 0;
    this.muted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // white noise buffer shared by all noisy voices
    const nb = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;

    // engine: two detuned oscillators through a lowpass
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600;
    this.eng1 = ctx.createOscillator(); this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator(); this.eng2.type = 'square';
    const e2g = ctx.createGain(); e2g.gain.value = 0.4;
    this.eng1.connect(this.engFilter); this.eng2.connect(e2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.eng1.start(); this.eng2.start();

    // tyre screech
    this.skid = this.loopNoise('bandpass', 1800, 6);
    // siren
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle';
    this.sirenLfo = ctx.createOscillator(); this.sirenLfo.frequency.value = 0.55;
    const lfoAmp = ctx.createGain(); lfoAmp.gain.value = 330;
    this.sirenLfo.connect(lfoAmp).connect(this.sirenOsc.frequency);
    this.sirenOsc.frequency.value = 950;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start(); this.sirenLfo.start();
    // helicopter rotor: noise amplitude-modulated at ~14 Hz
    this.rotor = this.loopNoise('lowpass', 420, 0.7);
    const am = ctx.createOscillator(); am.frequency.value = 13;
    const amg = ctx.createGain(); amg.gain.value = 0.5;
    am.connect(amg).connect(this.rotor.amp.gain); am.start();
    // wind / ambience
    this.wind = this.loopNoise('lowpass', 300, 0.5);
    this.wind.gain.gain.value = 0.02;

    // radio bus
    this.radioGain = ctx.createGain(); this.radioGain.gain.value = 0;
    this.radioFilter = ctx.createBiquadFilter(); this.radioFilter.type = 'lowpass'; this.radioFilter.frequency.value = 9000;
    this.radioGain.connect(this.radioFilter).connect(this.master);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.ready = true;
  }

  loopNoise(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const amp = ctx.createGain(); amp.gain.value = 0.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(f).connect(amp).connect(gain).connect(this.master);
    src.start();
    return { src, f, amp, gain };
  }

  setInCar(v) { this.inCar = v; }
  get stationName() { return STATIONS[this.station].name; }
  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    this.onStation?.(this.stationName);
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }

  // per-frame continuous sounds
  update(dt, car, speedRatio, throttle, slip) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const on = this.inCar && car && !car.destroyed;
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(speedRatio * gears));
    const within = speedRatio * gears - g;
    const rpm = 0.25 + within * 0.75 * (0.6 + g * 0.1) + Math.abs(throttle) * 0.08;
    const f = 38 + rpm * 120 + g * 6;
    this.eng1.frequency.setTargetAtTime(f, t, 0.05);
    this.eng2.frequency.setTargetAtTime(f * 0.501, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(380 + rpm * 1500 + Math.abs(throttle) * 500, t, 0.08);
    this.engGain.gain.setTargetAtTime(on ? 0.085 + Math.abs(throttle) * 0.05 : 0, t, 0.1);
    this.skid.gain.gain.setTargetAtTime(on ? Math.min(0.22, Math.max(0, slip - 4) * 0.03) : 0, t, 0.05);
    this.wind.gain.gain.setTargetAtTime(on ? 0.02 + speedRatio * 0.08 : 0.025, t, 0.3);
    const st = STATIONS[this.station];
    this.radioGain.gain.setTargetAtTime(on && !st.off ? 0.32 : 0, t, 0.3);
    this.scheduleRadio();
  }

  setSiren(v) {
    if (!this.ready) return;
    this.sirenGain.gain.setTargetAtTime(v * 0.06, this.ctx.currentTime, 0.2);
  }
  setRotor(v) {
    if (!this.ready) return;
    this.rotor.gain.gain.setTargetAtTime(v * 0.35, this.ctx.currentTime, 0.3);
  }

  // ------------------------------------------------------------ one-shots
  burst(type, freq, dur, vol, q = 1, sweepTo = null) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(type, freq, dur, vol, when = 0, slideTo = null, dest = this.master) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }
  crash(k) { this.burst('lowpass', 900, 0.35 + k * 0.3, 0.4 + k * 0.5, 0.7, 120); this.tone('sine', 90, 0.25, 0.3 * k + 0.1, 0, 40); }
  thud() { this.tone('sine', 140, 0.18, 0.35, 0, 50); this.burst('lowpass', 500, 0.12, 0.25); }
  punch() { this.tone('sine', 180, 0.12, 0.45, 0, 60); this.burst('bandpass', 1200, 0.08, 0.3, 2); }
  whoosh() { this.burst('bandpass', 700, 0.18, 0.12, 1.2, 2200); }
  explosion() { this.burst('lowpass', 1400, 1.8, 1.0, 0.6, 50); this.tone('sine', 70, 1.2, 0.7, 0, 25); }
  horn() { this.tone('square', 392, 0.45, 0.08); this.tone('square', 494, 0.45, 0.08); }
  cash() { this.tone('sine', 1318, 0.12, 0.18); this.tone('sine', 1760, 0.2, 0.18, 0.08); }
  token() { [72, 76, 79, 84].forEach((m, i) => this.tone('triangle', mtof(m), 0.25, 0.16, i * 0.07)); }
  alert() { this.tone('square', 880, 0.12, 0.07); this.tone('square', 660, 0.16, 0.07, 0.12); }
  pass() { [60, 64, 67, 72, 76, 79].forEach((m, i) => this.tone('triangle', mtof(m), 0.5, 0.14, i * 0.09)); this.tone('sawtooth', mtof(48), 1.2, 0.05, 0.1); }
  fail() { [64, 60, 55, 48].forEach((m, i) => this.tone('sawtooth', mtof(m), 0.5, 0.06, i * 0.18)); }
  checkpoint() { this.tone('sine', 988, 0.15, 0.2); this.tone('sine', 1318, 0.2, 0.2, 0.09); }
  spray() { this.burst('highpass', 3000, 1.2, 0.25, 0.5); }

  // ------------------------------------------------------------ radio
  scheduleRadio() {
    const st = STATIONS[this.station];
    const ctx = this.ctx;
    if (st.off) { this.nextTime = ctx.currentTime + 0.1; return; }
    const spb = 60 / st.bpm / 4; // seconds per 16th
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.2) {
      this.playStep(st, this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step++;
    }
  }

  playStep(st, s, t, spb) {
    const ctx = this.ctx, out = this.radioGain;
    const bar = Math.floor(s / 16) % st.chords.length;
    const b16 = s % 16;
    const chord = st.chords[bar];
    const when = t - ctx.currentTime;
    const synth = st.style === 'synth';
    // drums
    if (synth ? b16 % 4 === 0 : (b16 === 0 || b16 === 10)) this.kick(t, out);
    if (b16 === 4 || b16 === 12) this.snare(t, out, synth ? 0.35 : 0.18);
    if (b16 % 2 === 0 || (!synth && b16 % 3 === 0)) this.hat(t, out, b16 % 4 === 2 ? 0.08 : 0.04);
    // bass
    const root = chord[0] - 24;
    if (synth) {
      if (b16 % 2 === 0) this.voice('sawtooth', mtof(root + (b16 % 4 === 2 ? 12 : 0)), t, spb * 1.8, 0.11, out, 500);
    } else if (b16 === 0 || b16 === 6 || b16 === 8 || b16 === 14) {
      this.voice('sine', mtof(root + (b16 === 6 ? 7 : 0)), t, spb * 3, 0.22, out, 800);
    }
    // pad
    if (b16 === 0) for (const n of chord) this.voice(synth ? 'sawtooth' : 'triangle', mtof(n), t, spb * 15, synth ? 0.03 : 0.045, out, synth ? 1400 : 1100, 0.25);
    // generative lead
    if (synth && b16 % 2 === 1 && Math.random() < 0.55) {
      const n = chord[Math.floor(Math.random() * chord.length)] + 12 + (Math.random() < 0.3 ? 12 : 0);
      this.voice('square', mtof(n), t, spb * 1.5, 0.025, out, 2600);
    }
    if (!synth && (b16 === 3 || b16 === 11) && Math.random() < 0.6) {
      const n = chord[Math.floor(Math.random() * chord.length)] + 12;
      this.voice('sine', mtof(n), t, spb * 4, 0.05, out, 3000);
    }
    void when;
  }

  voice(type, freq, t, dur, vol, out, cutoff = 2000, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  kick(t, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.35);
  }
  snare(t, out, v) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(f).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + 0.2);
  }
  hat(t, out, v) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(f).connect(g).connect(out); src.start(t, Math.random()); src.stop(t + 0.06);
  }
}
