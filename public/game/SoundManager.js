/**
 * SoundManager
 * ------------
 * 100% procedural Web Audio: a synthwave sequencer (kick / snare / hats /
 * pumping bass / delayed arpeggio / detuned pads over an Am-F-C-G loop)
 * plus crisp one-shot SFX for slipping, collecting, peeling, boosting and
 * existential game-overs. No audio files are loaded — everything is
 * synthesized live, so it works offline with zero downloads.
 */

const BPM = 116;
const STEP = 60 / BPM / 4; // 16th note duration

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Am - F - C - G : the eternal synthwave loop
const PROGRESSION = [
  { root: 45, triad: [57, 60, 64] },
  { root: 41, triad: [53, 57, 60] },
  { root: 48, triad: [55, 60, 64] },
  { root: 43, triad: [55, 59, 62] },
];
const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 1];

export class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.intensity = 'menu'; // 'menu' | 'playing' | 'super'
    this._step = 0;
    this._nextNoteTime = 0;
    this._timer = null;
    this._comboPitch = 0;
  }

  /** Must be called from a user gesture (click/tap). */
  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 8;
    this.master.connect(comp).connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.3;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.75;
    this.sfxGain.connect(this.master);

    // shared ping-pong-ish delay for the arp
    this.delay = this.ctx.createDelay(1.0);
    this.delay.delayTime.value = STEP * 3;
    this.delayFb = this.ctx.createGain();
    this.delayFb.gain.value = 0.32;
    this.delayWet = this.ctx.createGain();
    this.delayWet.gain.value = 0.35;
    this.delay.connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.delayWet).connect(this.musicGain);

    // noise buffer (2s white noise, reused everywhere)
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._nextNoteTime = this.ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._scheduler(), 25);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  setIntensity(level) { this.intensity = level; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /* ================= sequencer ================= */

  _scheduler() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    while (this._nextNoteTime < this.ctx.currentTime + 0.15) {
      this._scheduleStep(this._step, this._nextNoteTime);
      this._step = (this._step + 1) % 64; // 4 bars of 16 steps
      this._nextNoteTime += STEP;
    }
  }

  _scheduleStep(step, t) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = PROGRESSION[bar];
    const full = this.intensity !== 'menu';
    const sup = this.intensity === 'super';

    // pad — retrigger every bar
    if (s === 0) this._pad(chord.triad, t, sup);

    // arp — 16ths
    this._arp(chord.triad[ARP_PATTERN[s] % 3] + (ARP_PATTERN[s] === 3 ? 12 : 0) + (sup ? 12 : 0), t);

    if (!full) {
      // menu: soft hats only
      if (s % 4 === 2) this._hat(t, 0.05);
      return;
    }

    // drums
    if (s % 4 === 0) this._kick(t);
    if (s === 4 || s === 12) this._snare(t);
    if (s % 2 === 0 || sup) this._hat(t, s % 2 === 0 ? 0.11 : 0.06);

    // bass — pumping 8ths with octave bounce
    if (s % 2 === 0) this._bass(chord.root + (s % 4 === 2 ? 12 : 0), t, sup);
  }

  _osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    return o;
  }

  _env(t, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  _noise(t, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.start(t); src.stop(t + dur + 0.05);
    return src;
  }

  _kick(t) {
    const o = this._osc('sine', 130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.13);
    const g = this._env(t, 0.002, 0.16, 0.62);
    o.connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + 0.2);
  }

  _snare(t) {
    const n = this._noise(t, 0.16);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
    const g = this._env(t, 0.001, 0.14, 0.34);
    n.connect(f).connect(g).connect(this.musicGain);
    const o = this._osc('triangle', 210, t);
    const g2 = this._env(t, 0.001, 0.08, 0.22);
    o.connect(g2).connect(this.musicGain);
    o.start(t); o.stop(t + 0.1);
  }

  _hat(t, vol) {
    const n = this._noise(t, 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 8200;
    const g = this._env(t, 0.001, 0.035, vol);
    n.connect(f).connect(g).connect(this.musicGain);
  }

  _bass(note, t, sup) {
    const o = this._osc('sawtooth', midi(note), t);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = sup ? 420 : 260; f.Q.value = 4;
    const g = this._env(t, 0.004, 0.2, 0.3);
    o.connect(f).connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + 0.26);
  }

  _arp(note, t) {
    const o = this._osc('square', midi(note), t);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = this.intensity === 'super' ? 3600 : 2400;
    const g = this._env(t, 0.002, 0.1, this.intensity === 'menu' ? 0.05 : 0.075);
    o.connect(f).connect(g);
    g.connect(this.musicGain);
    g.connect(this.delay);
    o.start(t); o.stop(t + 0.15);
  }

  _pad(triad, t, sup) {
    const barDur = STEP * 16;
    for (const note of triad) {
      for (const detune of [-6, 6]) {
        const o = this._osc('sawtooth', midi(note), t);
        o.detune.value = detune;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = sup ? 1300 : 800;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.038, t + 0.4);
        g.gain.setValueAtTime(0.038, t + barDur - 0.5);
        g.gain.linearRampToValueAtTime(0.0001, t + barDur);
        o.connect(f).connect(g).connect(this.musicGain);
        o.start(t); o.stop(t + barDur + 0.05);
      }
    }
  }

  /* ================= SFX ================= */

  _sfxReady() { return this.ctx && this.ctx.state === 'running' && !this.muted; }

  sfxJump() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('square', 240, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.14);
    const g = this._env(t, 0.002, 0.15, 0.16);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.2);
  }

  sfxCollect(combo) {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    this._comboPitch = Math.min(combo || 0, 12);
    const base = 620 * Math.pow(1.059, this._comboPitch);
    [0, 0.06].forEach((dt, i) => {
      const o = this._osc('sine', base * (i ? 1.5 : 1), t + dt);
      const g = this._env(t + dt, 0.002, 0.11, 0.2);
      o.connect(g).connect(this.sfxGain);
      o.start(t + dt); o.stop(t + dt + 0.16);
    });
  }

  sfxSlip() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const n = this._noise(t, 0.55);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.exponentialRampToValueAtTime(320, t + 0.5);
    const g = this._env(t, 0.01, 0.5, 0.3);
    n.connect(f).connect(g).connect(this.sfxGain);
  }

  sfxPeelHit() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    // squelch: filtered noise burst
    const n = this._noise(t, 0.25);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.22);
    const g = this._env(t, 0.002, 0.22, 0.5);
    n.connect(f).connect(g).connect(this.sfxGain);
    // sad pitch drop
    const o = this._osc('sawtooth', 330, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    const g2 = this._env(t, 0.002, 0.3, 0.22);
    o.connect(g2).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.36);
  }

  sfxBoost() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const n = this._noise(t, 0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(280, t);
    f.frequency.exponentialRampToValueAtTime(3800, t + 0.5);
    const g = this._env(t, 0.03, 0.5, 0.28);
    n.connect(f).connect(g).connect(this.sfxGain);
    const o = this._osc('sawtooth', 120, t);
    o.frequency.exponentialRampToValueAtTime(480, t + 0.45);
    const g2 = this._env(t, 0.02, 0.45, 0.12);
    o.connect(g2).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.5);
  }

  sfxSuper() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    // bright chord stab + riser
    [69, 73, 76, 81].forEach((note, i) => {
      const o = this._osc('square', midi(note), t + i * 0.045);
      const g = this._env(t + i * 0.045, 0.005, 0.5, 0.13);
      o.connect(g).connect(this.sfxGain);
      o.start(t + i * 0.045); o.stop(t + i * 0.045 + 0.6);
    });
    const n = this._noise(t, 0.8);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(6000, t + 0.75);
    const g = this._env(t, 0.05, 0.75, 0.16);
    n.connect(f).connect(g).connect(this.sfxGain);
  }

  sfxSmash() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const n = this._noise(t, 0.18);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1400;
    const g = this._env(t, 0.001, 0.16, 0.4);
    n.connect(f).connect(g).connect(this.sfxGain);
    const o = this._osc('square', 180, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.1);
    const g2 = this._env(t, 0.001, 0.12, 0.18);
    o.connect(g2).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.16);
  }

  sfxVoidFall() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('sine', 220, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const g = this._env(t, 0.01, 0.7, 0.4);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.8);
    const n = this._noise(t, 0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    const g2 = this._env(t, 0.05, 0.55, 0.2);
    n.connect(f).connect(g2).connect(this.sfxGain);
  }

  sfxGameOver() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    [64, 60, 57, 52, 45, 33].forEach((note, i) => {
      const tt = t + i * 0.17;
      const o = this._osc('sawtooth', midi(note), tt);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 900;
      const g = this._env(tt, 0.01, 0.22, 0.16);
      o.connect(f).connect(g).connect(this.sfxGain);
      o.start(tt); o.stop(tt + 0.3);
    });
    const o = this._osc('sine', 90, t + 1.05);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.6);
    const g = this._env(t + 1.05, 0.02, 0.6, 0.5);
    o.connect(g).connect(this.sfxGain);
    o.start(t + 1.05); o.stop(t + 1.8);
  }

  sfxClick() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('triangle', 900, t);
    const g = this._env(t, 0.001, 0.06, 0.15);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.08);
  }

  /* ================= v2 COSMIC+ SFX ================= */

  /** HELI-PEEL double jump: quick two-tone flutter. */
  sfxDoubleJump() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    [0, 0.07].forEach((dt, i) => {
      const o = this._osc('sine', 480 + i * 180, t + dt);
      o.frequency.exponentialRampToValueAtTime(900 + i * 260, t + dt + 0.12);
      const g = this._env(t + dt, 0.003, 0.13, 0.15);
      o.connect(g).connect(this.sfxGain);
      o.start(t + dt); o.stop(t + dt + 0.18);
    });
  }

  /** Near-miss graze: airy whoosh. */
  sfxNearMiss() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const n = this._noise(t, 0.3);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.26);
    const g = this._env(t, 0.008, 0.26, 0.22);
    n.connect(f).connect(g).connect(this.sfxGain);
  }

  /** Zone transition jingle: three rising teal notes. */
  sfxZone() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    [76, 80, 83].forEach((note, i) => {
      const tt = t + i * 0.09;
      const o = this._osc('triangle', midi(note), tt);
      const g = this._env(tt, 0.005, 0.3, 0.16);
      o.connect(g).connect(this.sfxGain);
      o.start(tt); o.stop(tt + 0.34);
    });
  }

  /** Golden banana jackpot fanfare. */
  sfxGolden() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    [69, 73, 76, 81, 88].forEach((note, i) => {
      const tt = t + i * 0.06;
      const o = this._osc('square', midi(note), tt);
      const g = this._env(tt, 0.004, 0.24, 0.12);
      o.connect(g).connect(this.sfxGain);
      o.start(tt); o.stop(tt + 0.28);
    });
    const n = this._noise(t + 0.1, 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.setValueAtTime(3000, t + 0.1);
    f.frequency.exponentialRampToValueAtTime(9000, t + 0.55);
    const g = this._env(t + 0.1, 0.04, 0.5, 0.1);
    n.connect(f).connect(g).connect(this.sfxGain);
  }

  /** Speed pad: electric zap. */
  sfxSpeedPad() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('square', 180, t);
    o.frequency.exponentialRampToValueAtTime(940, t + 0.16);
    const g = this._env(t, 0.004, 0.16, 0.2);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.2);
  }

  /** Hot toast projectile hit: comedic bonk + crunch. */
  sfxToastHit() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('triangle', 330, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.16);
    const g = this._env(t, 0.002, 0.16, 0.3);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.2);
    const n = this._noise(t, 0.12);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const g2 = this._env(t, 0.002, 0.1, 0.22);
    n.connect(f).connect(g2).connect(this.sfxGain);
  }

  /** Anti-stuck cosmic phase: riser warp. */
  sfxUnstuck() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('sine', 140, t);
    o.frequency.exponentialRampToValueAtTime(680, t + 0.3);
    const g = this._env(t, 0.02, 0.3, 0.26);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.36);
  }

  /** Dive-stomp landing: low thump. */
  sfxDiveLand() {
    if (!this._sfxReady()) return;
    const t = this.ctx.currentTime;
    const o = this._osc('sine', 130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = this._env(t, 0.002, 0.2, 0.5);
    o.connect(g).connect(this.sfxGain);
    o.start(t); o.stop(t + 0.24);
    const n = this._noise(t, 0.1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    const g2 = this._env(t, 0.001, 0.09, 0.24);
    n.connect(f).connect(g2).connect(this.sfxGain);
  }
}
