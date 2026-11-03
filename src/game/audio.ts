/* Procedural WebAudio engine: synthesized SFX + generative ambient space music. */

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private delaySend!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private nextChordTime = 0;
  private chordIndex = 0;
  muted = false;
  musicOn = true;
  private ducked = false;

  /** Must be called from a user gesture. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.34 : 0;
    this.musicBus.connect(this.master);
    // shared spatial delay for plucks / pings
    const delay = c.createDelay(1.2);
    delay.delayTime.value = 0.34;
    const fb = c.createGain();
    fb.gain.value = 0.36;
    const wet = c.createGain();
    wet.gain.value = 0.3;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.master);
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 1;
    this.delaySend.connect(delay);
    // noise buffer
    const len = c.sampleRate * 1.2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }
  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.applyMusicGain();
  }
  setDucked(d: boolean) {
    this.ducked = d;
    if (this.ctx) this.applyMusicGain();
  }
  private applyMusicGain() {
    if (!this.ctx) return;
    const v = this.musicOn ? (this.ducked ? 0.1 : 0.34) : 0;
    this.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.3);
  }

  /* ---------------- synth helpers ---------------- */
  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; vol?: number; to?: number; attack?: number; delaySend?: number; when?: number } = {}
  ) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = opts.when ?? c.currentTime;
    const o = c.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    const g = c.createGain();
    const v = opts.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxBus);
    if (opts.delaySend) {
      const s = c.createGain();
      s.gain.value = opts.delaySend;
      g.connect(s);
      s.connect(this.delaySend);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, opts: { vol?: number; freq?: number; type?: BiquadFilterType; to?: number; when?: number } = {}) {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx;
    const t = opts.when ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? "lowpass";
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + dur);
    const g = c.createGain();
    const v = opts.vol ?? 0.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /* ---------------- SFX ---------------- */
  click() { this.tone(660, 0.07, { type: "triangle", vol: 0.14 }); this.tone(990, 0.09, { type: "sine", vol: 0.08, when: this.ctx ? this.ctx.currentTime + 0.04 : 0 }); }
  jump() { this.tone(300, 0.2, { type: "sine", vol: 0.22, to: 680 }); this.noise(0.12, { vol: 0.05, freq: 2400, type: "highpass" }); }
  doubleJump() { this.tone(430, 0.2, { type: "sine", vol: 0.22, to: 940 }); this.tone(860, 0.14, { type: "triangle", vol: 0.1, to: 1400 }); }
  slide() { this.noise(0.28, { vol: 0.16, freq: 1600, to: 300 }); }
  lane() { this.noise(0.11, { vol: 0.1, freq: 900, to: 2600, type: "bandpass" }); }
  star(streak: number) {
    const f = 740 * Math.pow(2, Math.min(streak, 14) / 12);
    this.tone(f, 0.14, { type: "sine", vol: 0.16, delaySend: 0.5 });
    this.tone(f * 2, 0.1, { type: "triangle", vol: 0.06 });
  }
  power() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, { type: "triangle", vol: 0.16, when: t + i * 0.07, delaySend: 0.5 }));
  }
  rocket() { this.noise(1.1, { vol: 0.22, freq: 400, to: 3200, type: "bandpass" }); this.tone(120, 0.9, { type: "sawtooth", vol: 0.1, to: 320 }); }
  shieldPop() { this.tone(880, 0.25, { type: "sine", vol: 0.24, to: 220 }); this.noise(0.22, { vol: 0.16, freq: 3000, to: 400 }); }
  rescue() { if (!this.ctx) return; const t = this.ctx.currentTime; [392, 523, 659, 880].forEach((f, i) => this.tone(f, 0.18, { type: "sine", vol: 0.18, when: t + i * 0.05 })); }
  boom() { this.tone(95, 0.5, { type: "sine", vol: 0.34, to: 32 }); this.noise(0.45, { vol: 0.22, freq: 900, to: 90 }); }
  crash() {
    this.noise(0.55, { vol: 0.4, freq: 4000, to: 120 });
    this.tone(180, 0.6, { type: "sawtooth", vol: 0.22, to: 40 });
    this.tone(60, 0.7, { type: "sine", vol: 0.36, to: 28 });
  }
  fall() { this.tone(600, 0.9, { type: "sine", vol: 0.2, to: 90 }); }
  gameOver() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [330, 262, 196].forEach((f, i) => this.tone(f, 0.5, { type: "triangle", vol: 0.18, when: t + i * 0.24, delaySend: 0.4 }));
  }
  record() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, { type: "triangle", vol: 0.16, when: t + i * 0.09, delaySend: 0.5 }));
  }

  /* ---------------- generative music ---------------- */
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextChordTime = this.ctx.currentTime + 0.15;
    this.chordIndex = 0;
    const tick = () => {
      if (!this.ctx) return;
      while (this.nextChordTime < this.ctx.currentTime + 1.2) {
        this.scheduleChord(this.nextChordTime, this.chordIndex);
        this.nextChordTime += 3.6;
        this.chordIndex++;
      }
    };
    tick();
    this.musicTimer = window.setInterval(tick, 300);
  }

  private scheduleChord(t: number, idx: number) {
    if (!this.ctx) return;
    const c = this.ctx;
    // A minor-ish dreamy progression: Am, F, Cmaj7, G
    const chords = [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [48, 55, 60, 64],
      [55, 59, 62, 67],
    ];
    const chord = chords[idx % chords.length];
    const dur = 3.7;
    // pad
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(450, t + dur);
    lp.Q.value = 1.4;
    const padGain = c.createGain();
    padGain.gain.setValueAtTime(0.0001, t);
    padGain.gain.linearRampToValueAtTime(0.055, t + 1.3);
    padGain.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    lp.connect(padGain);
    padGain.connect(this.musicBus);
    chord.forEach((m) => {
      [-6, 5].forEach((det) => {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midi(m - 12);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.8);
      });
    });
    // sub bass pulse
    const bass = c.createOscillator();
    bass.type = "sine";
    bass.frequency.value = midi(chord[0] - 24);
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.11, t + 0.4);
    bg.gain.linearRampToValueAtTime(0.0001, t + dur);
    bass.connect(bg);
    bg.connect(this.musicBus);
    bass.start(t);
    bass.stop(t + dur + 0.2);
    // sparkle arpeggio (8th notes, probabilistic)
    const scale = [...chord, chord[1] + 12, chord[2] + 12];
    for (let i = 0; i < 8; i++) {
      if (Math.random() < 0.42) continue;
      const note = scale[Math.floor(Math.random() * scale.length)] + 12;
      const at = t + i * 0.45;
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = midi(note);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.045, at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      o.connect(g);
      g.connect(this.musicBus);
      const send = c.createGain();
      send.gain.value = 0.6;
      g.connect(send);
      send.connect(this.delaySend);
      o.start(at);
      o.stop(at + 0.6);
    }
  }

  dispose() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}