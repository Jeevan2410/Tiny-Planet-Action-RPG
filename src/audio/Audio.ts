import type { BiomeId } from '../rpg/Types';

/**
 * All audio is synthesised at runtime with the Web Audio API.
 *
 * Nothing is fetched, so there are no asset licences to track, no loading screen
 * and no bandwidth cost — and because every sound is generated from parameters,
 * combat stingers can be pitched and shaped per event (a light hit and a heavy hit
 * are the same routine with different numbers).
 */

export type SfxName =
  | 'swing'
  | 'swingHeavy'
  | 'hit'
  | 'hitHeavy'
  | 'hitBlocked'
  | 'hurt'
  | 'enemyHurt'
  | 'enemyDie'
  | 'dodge'
  | 'levelUp'
  | 'questStart'
  | 'questDone'
  | 'blip'
  | 'pickup'
  | 'potion'
  | 'equip'
  | 'uiClick'
  | 'uiMove'
  | 'shrineCure'
  | 'telegraph'
  | 'spit'
  | 'cast'
  | 'footstep'
  | 'death'
  | 'victory';

const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

interface MusicConfig {
  root: number;
  scale: number[];
  bpm: number;
}

const BIOME_MUSIC: Record<BiomeId, MusicConfig> = {
  meadow: { root: 0, scale: SCALES.major, bpm: 96 },
  greenwood: { root: 3, scale: SCALES.dorian, bpm: 104 },
  dunes: { root: 7, scale: SCALES.lydian, bpm: 92 },
  tundra: { root: -2, scale: SCALES.minor, bpm: 84 },
  cinder: { root: 5, scale: SCALES.minor, bpm: 112 },
};

/** Semitones above A3 (220 Hz) to frequency. */
function freq(semitone: number): number {
  return 220 * Math.pow(2, semitone / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuffer!: AudioBuffer;

  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private biome: BiomeId = 'meadow';
  private cured = false;
  private intensity = 0;
  private targetIntensity = 0;

  private _muted = false;
  private _volume = 0.7;
  private _musicEnabled = true;
  private started = false;

  get muted(): boolean {
    return this._muted;
  }

  get volume(): number {
    return this._volume;
  }

  get musicEnabled(): boolean {
    return this._musicEnabled;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture — browsers will not start audio otherwise. */
  async unlock(): Promise<void> {
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }
    if (!this.started) {
      this.started = true;
      this.startMusic();
    }
  }

  private init(): void {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : this._volume;
    this.master.connect(ctx.destination);

    // A short synthetic impulse response gives everything a little air.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.7, 2.6);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.38;
    this.reverb.connect(reverbReturn);
    reverbReturn.connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.85;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this._musicEnabled ? 0.34 : 0;
    this.musicBus.connect(this.master);

    this.noiseBuffer = this.makeNoise(2);
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setVolume(value: number): void {
    this._volume = Math.max(0, Math.min(1, value));
    if (this.ctx) this.master.gain.value = this._muted ? 0 : this._volume;
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this._volume, this.ctx.currentTime, 0.05);
  }

  setMusicEnabled(enabled: boolean): void {
    this._musicEnabled = enabled;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(enabled ? 0.34 : 0, this.ctx.currentTime, 0.2);
  }

  /* ------------------------------------------------------------ synthesis */

  private envelope(
    node: AudioNode,
    start: number,
    attack: number,
    decay: number,
    peak: number,
    sustain = 0,
    release = 0.05,
  ): GainNode {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
    const sustainLevel = Math.max(0.0001, peak * sustain);
    gain.gain.exponentialRampToValueAtTime(sustainLevel, start + attack + decay);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay + release);
    node.connect(gain);
    return gain;
  }

  private tone(
    type: OscillatorType,
    frequency: number,
    start: number,
    duration: number,
    peak: number,
    options: { to?: number; attack?: number; detune?: number; bus?: AudioNode; reverb?: number } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (options.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + duration);
    if (options.detune) osc.detune.value = options.detune;
    const attack = options.attack ?? 0.006;
    const gain = this.envelope(osc, start, attack, duration * 0.8, peak, 0.0001, duration * 0.3);
    gain.connect(options.bus ?? this.sfxBus);
    if (options.reverb) {
      const send = ctx.createGain();
      send.gain.value = options.reverb;
      gain.connect(send);
      send.connect(this.reverbSend);
    }
    osc.start(start);
    osc.stop(start + duration + 0.4);
  }

  private noise(
    start: number,
    duration: number,
    peak: number,
    options: {
      type?: BiquadFilterType;
      frequency?: number;
      to?: number;
      q?: number;
      bus?: AudioNode;
      reverb?: number;
    } = {},
  ): void {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.frequency.setValueAtTime(options.frequency ?? 1200, start);
    if (options.to) filter.frequency.exponentialRampToValueAtTime(Math.max(60, options.to), start + duration);
    filter.Q.value = options.q ?? 1;
    source.connect(filter);
    const gain = this.envelope(filter, start, 0.004, duration * 0.7, peak, 0.0001, duration * 0.4);
    gain.connect(options.bus ?? this.sfxBus);
    if (options.reverb) {
      const send = ctx.createGain();
      send.gain.value = options.reverb;
      gain.connect(send);
      send.connect(this.reverbSend);
    }
    source.start(start);
    source.stop(start + duration + 0.4);
  }

  /** Fire a sound effect. `pitch` multiplies every frequency in the recipe. */
  play(name: SfxName, options: { pitch?: number; gain?: number } = {}): void {
    if (!this.ctx || this.ctx.state !== 'running' || this._muted) return;
    const t = this.ctx.currentTime + 0.001;
    const p = options.pitch ?? 1;
    const g = options.gain ?? 1;

    switch (name) {
      case 'swing':
        this.noise(t, 0.17, 0.2 * g, { frequency: 2600 * p, to: 700 * p, q: 1.2 });
        break;
      case 'swingHeavy':
        this.noise(t, 0.26, 0.28 * g, { frequency: 1500 * p, to: 300 * p, q: 1.6 });
        this.tone('sine', 150 * p, t, 0.22, 0.14 * g, { to: 60 * p });
        break;
      case 'hit':
        this.noise(t, 0.11, 0.34 * g, { frequency: 2200 * p, to: 500 * p, q: 0.8 });
        this.tone('triangle', 260 * p, t, 0.13, 0.26 * g, { to: 110 * p });
        break;
      case 'hitHeavy':
        this.noise(t, 0.2, 0.42 * g, { frequency: 1400 * p, to: 180 * p, q: 0.7 });
        this.tone('sine', 140 * p, t, 0.26, 0.4 * g, { to: 48 * p, reverb: 0.25 });
        this.tone('square', 320 * p, t, 0.1, 0.12 * g, { to: 120 * p });
        break;
      case 'hitBlocked':
        this.noise(t, 0.12, 0.2 * g, { type: 'highpass', frequency: 3200 * p, q: 0.6 });
        this.tone('square', 900 * p, t, 0.09, 0.1 * g, { to: 600 * p });
        break;
      case 'hurt':
        this.tone('sawtooth', 380 * p, t, 0.26, 0.24 * g, { to: 120 * p });
        this.noise(t, 0.2, 0.2 * g, { frequency: 900 * p, to: 200 * p });
        break;
      case 'enemyHurt':
        this.tone('square', 420 * p, t, 0.14, 0.16 * g, { to: 200 * p });
        this.noise(t, 0.1, 0.14 * g, { frequency: 1800 * p, to: 700 * p });
        break;
      case 'enemyDie':
        this.tone('sawtooth', 300 * p, t, 0.5, 0.2 * g, { to: 60 * p, reverb: 0.3 });
        this.noise(t, 0.46, 0.22 * g, { frequency: 1600 * p, to: 120 * p, reverb: 0.3 });
        break;
      case 'dodge':
        this.noise(t, 0.3, 0.17 * g, { frequency: 420 * p, to: 2400 * p, q: 2.4 });
        break;
      case 'levelUp': {
        const notes = [0, 4, 7, 12, 16];
        notes.forEach((semi, i) => {
          this.tone('triangle', freq(semi + 12) * p, t + i * 0.085, 0.42, 0.2 * g, { reverb: 0.4 });
          this.tone('sine', freq(semi + 24) * p, t + i * 0.085, 0.3, 0.07 * g, { reverb: 0.5 });
        });
        break;
      }
      case 'questStart':
        this.tone('triangle', freq(7) * p, t, 0.2, 0.15 * g, { reverb: 0.3 });
        this.tone('triangle', freq(12) * p, t + 0.11, 0.3, 0.15 * g, { reverb: 0.3 });
        break;
      case 'questDone':
        [0, 5, 9, 12].forEach((semi, i) =>
          this.tone('triangle', freq(semi + 12) * p, t + i * 0.1, 0.36, 0.16 * g, { reverb: 0.4 }),
        );
        break;
      case 'blip':
        this.tone('square', 620 * p, t, 0.045, 0.055 * g, { to: 700 * p });
        break;
      case 'pickup':
        this.tone('triangle', freq(12) * p, t, 0.12, 0.15 * g);
        this.tone('triangle', freq(19) * p, t + 0.07, 0.2, 0.15 * g, { reverb: 0.25 });
        break;
      case 'potion':
        this.tone('sine', 180 * p, t, 0.34, 0.2 * g, { to: 620 * p, attack: 0.05 });
        this.noise(t + 0.06, 0.2, 0.06 * g, { frequency: 900, to: 2600 });
        break;
      case 'equip':
        this.noise(t, 0.1, 0.16 * g, { type: 'highpass', frequency: 2600 * p });
        this.tone('square', 1200 * p, t, 0.07, 0.07 * g, { to: 1800 * p });
        break;
      case 'uiClick':
        this.tone('square', 900 * p, t, 0.05, 0.06 * g, { to: 1300 * p });
        break;
      case 'uiMove':
        this.tone('sine', 700 * p, t, 0.05, 0.045 * g, { to: 900 * p });
        break;
      case 'shrineCure': {
        const chord = [0, 4, 7, 11, 14, 19];
        chord.forEach((semi, i) => {
          this.tone('sine', freq(semi) * p, t + i * 0.055, 1.9, 0.12 * g, { attack: 0.16, reverb: 0.75 });
          this.tone('triangle', freq(semi + 12) * p, t + 0.3 + i * 0.055, 1.5, 0.07 * g, {
            attack: 0.24,
            reverb: 0.8,
          });
        });
        this.noise(t, 1.6, 0.1 * g, { type: 'highpass', frequency: 1800, to: 6000, reverb: 0.7 });
        break;
      }
      case 'telegraph':
        this.tone('sawtooth', 120 * p, t, 0.42, 0.11 * g, { to: 190 * p, attack: 0.1 });
        break;
      case 'spit':
        this.noise(t, 0.16, 0.16 * g, { frequency: 700 * p, to: 2400 * p, q: 3 });
        this.tone('square', 240 * p, t, 0.12, 0.1 * g, { to: 520 * p });
        break;
      case 'cast':
        this.tone('sawtooth', 200 * p, t, 0.36, 0.16 * g, { to: 900 * p, attack: 0.04, reverb: 0.35 });
        this.noise(t, 0.34, 0.14 * g, { frequency: 600, to: 4200, q: 1.4, reverb: 0.3 });
        break;
      case 'footstep':
        this.noise(t, 0.07, 0.055 * g, { frequency: 420 * p, to: 180 * p, q: 0.8 });
        break;
      case 'death':
        this.tone('sawtooth', 220 * p, t, 1.1, 0.24 * g, { to: 45 * p, reverb: 0.5 });
        this.noise(t, 0.9, 0.16 * g, { frequency: 1200, to: 90, reverb: 0.4 });
        break;
      case 'victory': {
        const melody = [0, 4, 7, 12, 7, 12, 16, 19];
        melody.forEach((semi, i) => {
          this.tone('triangle', freq(semi + 12), t + i * 0.16, 0.5, 0.18 * g, { reverb: 0.5 });
          if (i % 2 === 0) this.tone('sine', freq(semi), t + i * 0.16, 0.7, 0.1 * g, { reverb: 0.6 });
        });
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- music */

  setBiome(biome: BiomeId, cured: boolean): void {
    this.biome = biome;
    this.cured = cured;
  }

  /** 0 = wandering, 1 = in a fight. Drives drums and the lead line. */
  setIntensity(value: number): void {
    this.targetIntensity = Math.max(0, Math.min(1, value));
  }

  private startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /**
   * Lookahead scheduler: every 25 ms, queue any sixteenth notes falling in the next
   * 150 ms. Keeps timing sample-accurate even when the main thread stutters.
   */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this._musicEnabled) return;
    const config = BIOME_MUSIC[this.biome];
    const stepDuration = 60 / config.bpm / 4;

    this.intensity += (this.targetIntensity - this.intensity) * 0.06;

    while (this.nextNoteTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextNoteTime, config, stepDuration);
      this.nextNoteTime += stepDuration;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, time: number, config: MusicConfig, stepDuration: number): void {
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const scale = config.scale;
    const root = config.root;
    const bus = this.musicBus;
    // A gentle i–VI–III–VII style rotation so four bars do not feel like one.
    const degrees = [0, 5, 3, 4];
    const degree = degrees[bar % degrees.length];
    const chordRoot = root + scale[degree % scale.length] - 12;

    // Bass on the beat.
    if (beat % 8 === 0) {
      this.tone('triangle', freq(chordRoot - 12), time, stepDuration * 7, 0.16, {
        attack: 0.02,
        bus,
      });
    }

    // Sustained pad at the top of each bar, two voices slightly detuned.
    if (beat === 0) {
      const third = scale[(degree + 2) % scale.length];
      const fifth = scale[(degree + 4) % scale.length];
      for (const semi of [0, third - scale[degree % scale.length], fifth - scale[degree % scale.length]]) {
        this.tone('sine', freq(chordRoot + semi), time, stepDuration * 15, 0.055, {
          attack: 0.4,
          bus,
          reverb: 0.5,
        });
        this.tone('sine', freq(chordRoot + semi), time, stepDuration * 15, 0.04, {
          attack: 0.5,
          detune: 7,
          bus,
          reverb: 0.5,
        });
      }
    }

    // Plucked arpeggio; it steps up an octave once the biome's shrine is cured.
    if (beat % 2 === 0) {
      const pattern = [0, 2, 4, 6, 4, 2, 4, 1];
      const index = pattern[(step / 2) % pattern.length | 0];
      const octave = this.cured && (step / 2) % 4 === 0 ? 12 : 0;
      const semitone = root + scale[(degree + index) % scale.length] + octave;
      const level = 0.05 + this.intensity * 0.05;
      this.tone('triangle', freq(semitone), time, stepDuration * 2.2, level, {
        attack: 0.01,
        bus,
        reverb: 0.35,
      });
    }

    // Lead counter-melody, only once a fight is on.
    if (this.intensity > 0.35 && beat % 4 === 2) {
      const semitone = root + scale[(degree + (step % 5)) % scale.length] + 12;
      this.tone('square', freq(semitone), time, stepDuration * 1.4, 0.03 * this.intensity, {
        attack: 0.008,
        bus,
      });
    }

    // Percussion swells in with intensity.
    if (this.intensity > 0.12) {
      if (beat % 8 === 4) {
        this.noise(time, 0.13, 0.07 * this.intensity, { type: 'highpass', frequency: 2200, bus });
      }
      if (beat % 16 === 0 || beat % 16 === 10) {
        this.tone('sine', 62, time, 0.16, 0.14 * this.intensity, { to: 40, bus });
      }
    }
  }
}

export const audio = new AudioEngine();
