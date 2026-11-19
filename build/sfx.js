// Procedural sound design with the Web Audio API: no audio files, everything is synthesised.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.level = 0.9; }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try { const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C(); } catch (e) { return false; }
    const c = this.ctx;
    this.out = c.createGain();
    this.out.gain.value = this.muted ? 0 : this.level;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.out.connect(comp).connect(c.destination);
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(3.6, 2.4);
    this.verbIn = c.createGain();
    this.verbIn.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(this.out);
    this.noise = this.noiseBuf(4);
    this.shaper = this.curve(2.4);
    return true;
  }
  get t() { return this.ctx.currentTime; }
  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.setTargetAtTime(m ? 0 : this.level, this.t, 0.05);
  }

  impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  noiseBuf(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    return b;
  }
  curve(k) {
    const n = 2048, a = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; a[i] = Math.tanh(k * x) / Math.tanh(k); }
    return a;
  }
  src() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); return s; }
  bus(dry = 1, wet = 0.3) {
    const c = this.ctx, g = c.createGain(), d = c.createGain(), w = c.createGain();
    d.gain.value = dry; w.gain.value = wet;
    g.connect(d).connect(this.out); g.connect(w).connect(this.verbIn);
    return g;
  }
  env(param, t, a, peak, hold, rel) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + hold);
    param.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }

  // filtered noise sweep, panned across the stereo field
  whoosh(dur = 2, f0 = 200, f1 = 3000, peak = 0.45, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t + delay, s = this.src(), bp = c.createBiquadFilter(), g = c.createGain(), pan = c.createStereoPanner();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.65);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, f0 * 0.6), t + dur);
    pan.pan.setValueAtTime(-0.7, t); pan.pan.linearRampToValueAtTime(0.7, t + dur);
    this.env(g.gain, t, dur * 0.6, peak, 0.01, dur * 0.4);
    s.connect(bp).connect(g).connect(pan).connect(this.bus(1, 0.35));
    s.start(t); s.stop(t + dur + 0.1);
  }

  // deep impact: pitch-dropping sine plus a dull noise burst
  boom(peak = 1, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t + delay;
    const o = c.createOscillator(), g = c.createGain(), ws = c.createWaveShaper();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(28, t + 1.6);
    ws.curve = this.shaper;
    this.env(g.gain, t, 0.006, peak, 0.08, 2.4);
    o.connect(ws).connect(g).connect(this.bus(1, 0.5));
    o.start(t); o.stop(t + 3);
    const s = this.src(), lp = c.createBiquadFilter(), ng = c.createGain();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    this.env(ng.gain, t, 0.004, peak * 0.8, 0.02, 1.1);
    s.connect(lp).connect(ng).connect(this.bus(1, 0.7));
    s.start(t); s.stop(t + 1.5);
  }

  // soft digital glitch: muted triangle bleeps on a pentatonic scale, a little echo, and a tape-stop at the end
  glitch(dur = 0.8) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = this.t;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.5;
    const b = this.bus(0.9, 0.45);
    lp.connect(b);
    const notes = [523.25, 622.25, 698.46, 783.99, 932.33, 1046.5, 1244.5];
    let x = 0;
    while (x < dur) {
      const t = t0 + x, o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = notes[Math.floor(Math.random() * notes.length)] * (Math.random() < 0.3 ? 0.5 : 1);
      this.env(g.gain, t, 0.004, 0.05 + Math.random() * 0.025, 0.02, 0.07);
      o.connect(g).connect(lp); o.start(t); o.stop(t + 0.12);
      x += 0.05 + Math.random() * 0.06;
    }
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(440, t0); o.frequency.exponentialRampToValueAtTime(70, t0 + dur);
    this.env(g.gain, t0, 0.05, 0.035, dur * 0.6, dur * 0.4);
    o.connect(g).connect(lp); o.start(t0); o.stop(t0 + dur + 0.1);
  }

  // rising engine tone for the ascent
  riser(dur = 3) {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t, o = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'sawtooth';
    o.frequency.setValueAtTime(48, t); o.frequency.exponentialRampToValueAtTime(420, t + dur);
    o2.frequency.setValueAtTime(48.7, t); o2.frequency.exponentialRampToValueAtTime(426, t + dur);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(5200, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(this.bus(1, 0.3));
    o.start(t); o2.start(t); o.stop(t + dur + 0.5); o2.stop(t + dur + 0.5);
    this.whoosh(dur + 0.4, 120, 7000, 0.35);
  }

  // space ambience: two detuned low tones and a slowly breathing band of noise
  droneOn(level = 0.06) {
    if (!this.ctx) return;
    if (this.drone) { this.drone.g.gain.setTargetAtTime(level, this.t, 1.2); return; }
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(), lfo = c.createOscillator(), lfoG = c.createGain();
    g.gain.value = 0.0001;
    lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
    lfo.frequency.value = 0.07; lfoG.gain.value = 220;
    lfo.connect(lfoG).connect(lp.frequency);
    const oscs = [55, 55.4, 82.4, 110.2].map((f, i) => { const o = c.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f; const og = c.createGain(); og.gain.value = [0.5, 0.4, 0.22, 0.08][i]; o.connect(og).connect(lp); o.start(); return o; });
    const s = this.src(), ng = c.createGain(); ng.gain.value = 0.12; s.connect(ng).connect(lp); s.start();
    lp.connect(g).connect(this.bus(1, 0.45));
    lfo.start();
    g.gain.setTargetAtTime(level, this.t, 1.5);
    this.drone = { g, oscs, s, lfo };
  }
  droneOff(fade = 1.2) {
    if (!this.ctx || !this.drone) return;
    const d = this.drone; this.drone = null;
    d.g.gain.setTargetAtTime(0.0001, this.t, fade / 3);
    const end = this.t + fade * 2;
    d.oscs.forEach((o) => o.stop(end)); d.s.stop(end); d.lfo.stop(end);
  }

  // gravitational rumble: distorted sub tones and dark noise, level controlled live
  rumbleOn() {
    if (!this.ctx || this.rumble) return;
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(), ws = c.createWaveShaper();
    g.gain.value = 0.0001;
    lp.type = 'lowpass'; lp.frequency.value = 140;
    ws.curve = this.shaper;
    const oscs = [29, 31.5, 43.5].map((f) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(ws); o.start(); return o; });
    const s = this.src(), nlp = c.createBiquadFilter(), ng = c.createGain();
    nlp.type = 'lowpass'; nlp.frequency.value = 110; ng.gain.value = 1.4;
    s.connect(nlp).connect(ng).connect(lp); s.start();
    ws.connect(lp); lp.connect(g).connect(this.bus(1, 0.25));
    this.rumble = { g, lp, oscs, s };
  }
  rumbleLevel(v, tc = 0.2) {
    if (!this.ctx || !this.rumble) return;
    this.rumble.g.gain.setTargetAtTime(Math.max(0.0001, v), this.t, tc);
    this.rumble.lp.frequency.setTargetAtTime(120 + v * 260, this.t, tc);
  }
  rumbleOff(fade = 1.5) {
    if (!this.ctx || !this.rumble) return;
    const r = this.rumble; this.rumble = null;
    r.g.gain.setTargetAtTime(0.0001, this.t, fade / 3);
    const end = this.t + fade * 2;
    r.oscs.forEach((o) => o.stop(end)); r.s.stop(end);
  }

  // the accretion disk catching fire
  roar() {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t, s = this.src(), lp = c.createBiquadFilter(), g = c.createGain(), ws = c.createWaveShaper();
    lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(220, t); lp.frequency.exponentialRampToValueAtTime(4200, t + 0.35); lp.frequency.exponentialRampToValueAtTime(260, t + 3.2);
    ws.curve = this.shaper;
    this.env(g.gain, t, 0.05, 0.75, 0.3, 3.2);
    s.connect(ws).connect(lp).connect(g).connect(this.bus(1, 0.6));
    s.start(t); s.stop(t + 4);
    this.boom(0.9);
  }

  // soft major chord on the way back home
  chime() {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t, b = this.bus(0.6, 1.0);
    [261.63, 329.63, 392.0, 523.25].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      this.env(g.gain, t + i * 0.08, 0.6, 0.05, 0.4, 3.4);
      o.connect(g).connect(b); o.start(t + i * 0.08); o.stop(t + 5);
    });
  }

  // muffled arrival
  thud(delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t + delay, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.8);
    this.env(g.gain, t, 0.02, 0.45, 0.05, 1.2);
    o.connect(g).connect(this.bus(1, 0.5)); o.start(t); o.stop(t + 1.6);
  }

  // everything slides down and goes quiet (time dilation)
  sink(dur = 4) {
    if (!this.ctx) return;
    if (this.drone) this.drone.oscs.forEach((o) => o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.25, this.t + dur));
    if (this.rumble) this.rumble.oscs.forEach((o) => o.frequency.exponentialRampToValueAtTime(14, this.t + dur));
    this.whoosh(dur, 3000, 60, 0.4);
  }

  // record scratch for the easter egg
  scratch() {
    if (!this.ctx) return;
    const c = this.ctx, t = this.t, s = this.src(), bp = c.createBiquadFilter(), g = c.createGain();
    bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    this.env(g.gain, t, 0.01, 0.6, 0.2, 0.15);
    s.connect(bp).connect(g).connect(this.bus(1, 0.1)); s.start(t); s.stop(t + 0.5);
  }

  // a simple four-on-the-floor loop: kick, hats, bass
  partyOn(bpm = 118) {
    if (!this.ctx || this.party) return;
    const c = this.ctx, b = this.bus(1, 0.15), step = 60 / bpm / 2;
    const bass = [43.65, 43.65, 51.91, 43.65, 58.27, 43.65, 51.91, 38.89];
    let n = 0, next = this.t + 0.1;
    const sched = () => {
      while (next < this.t + 0.25) {
        const t = next;
        if (n % 2 === 0) { // kick
          const o = c.createOscillator(), g = c.createGain();
          o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
          this.env(g.gain, t, 0.003, 0.9, 0.02, 0.22);
          o.connect(g).connect(b); o.start(t); o.stop(t + 0.3);
          const o2 = c.createOscillator(), g2 = c.createGain(), lp = c.createBiquadFilter();
          o2.type = 'sawtooth'; o2.frequency.value = bass[(n / 2) % 8] * 2;
          lp.type = 'lowpass'; lp.frequency.value = 420;
          this.env(g2.gain, t + 0.02, 0.01, 0.16, step * 0.8, 0.08);
          o2.connect(lp).connect(g2).connect(b); o2.start(t); o2.stop(t + step * 2);
        } else { // offbeat hat
          const s = this.src(), hp = c.createBiquadFilter(), g = c.createGain();
          hp.type = 'highpass'; hp.frequency.value = 7000;
          this.env(g.gain, t, 0.002, 0.18, 0.01, 0.05);
          s.connect(hp).connect(g).connect(b); s.start(t); s.stop(t + 0.1);
        }
        if (n % 8 === 4) { // clap
          const s = this.src(), bp = c.createBiquadFilter(), g = c.createGain();
          bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.8;
          this.env(g.gain, t, 0.002, 0.35, 0.01, 0.14);
          s.connect(bp).connect(g).connect(b); s.start(t); s.stop(t + 0.2);
        }
        n++; next += step;
      }
    };
    sched();
    this.party = { id: setInterval(sched, 50), b, t0: next - step * n, step };
  }
  partyOff() {
    if (!this.party) return;
    clearInterval(this.party.id);
    this.party = null;
  }
}
