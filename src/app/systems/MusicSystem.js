const TEMPO = 76;
const EIGHTH = 60 / TEMPO / 2;
const BEATS_PER_CHORD = 8;
const LOOKAHEAD = 0.25;
const SCHEDULE_INTERVAL = 60;

function midiToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

// A-minor progression: Am9 - Fmaj7 - Cmaj7 - G6 (MIDI note numbers).
const PROGRESSION = [
  { bass: 45, pad: [57, 64, 67, 71], arp: [69, 72, 76, 79, 83, 76] },
  { bass: 41, pad: [53, 60, 64, 69], arp: [65, 69, 72, 76, 81, 72] },
  { bass: 48, pad: [55, 60, 64, 71], arp: [67, 72, 76, 79, 83, 79] },
  { bass: 43, pad: [55, 59, 62, 64], arp: [67, 71, 74, 76, 79, 74] },
];

// Arp pattern over 8 eighths per chord (null = rest).
const ARP_PATTERN = [0, 2, 1, 3, null, 2, 4, 5, 0, 2, 1, 3, 2, null, 4, 3];

function createImpulse(ctx, seconds = 2.8, decay = 3.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);

    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** decay;
    }
  }

  return impulse;
}

/**
 * Fully synthesized soundtrack (no audio files): a gliding pad, sub bass and
 * an arpeggio whose level rises with your progress, plus key-matched SFX.
 */
export class MusicSystem {
  constructor({ onStateChange, onToast }) {
    this.onStateChange = onStateChange;
    this.onToast = onToast;
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.fxBus = null;
    this.started = false;
    this.enabled = true;
    this.baseGain = 0.32;
    this.progress = 0;
    this.lastFootstep = 0;
    this.noiseBuffer = null;
    this.padVoices = [];
    this.chordIndex = 0;
    this.step = 0;
    this.nextNoteTime = 0;
    this.scheduler = null;
  }

  notifyStateChange() {
    this.onStateChange?.(this.enabled);
  }

  async ensureContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;

    if (!AudioCtx) {
      return false;
    }

    if (!this.ctx) {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 14;
      compressor.ratio.value = 3.5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      this.master.connect(compressor);
      compressor.connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = createImpulse(ctx);
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0.42;
      this.reverb.connect(reverbReturn);
      reverbReturn.connect(this.master);

      this.delay = ctx.createDelay(1.5);
      this.delay.delayTime.value = EIGHTH * 1.5;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.34;
      const delayTone = ctx.createBiquadFilter();
      delayTone.type = 'lowpass';
      delayTone.frequency.value = 2200;
      this.delay.connect(delayTone);
      delayTone.connect(feedback);
      feedback.connect(this.delay);
      const delayReturn = ctx.createGain();
      delayReturn.gain.value = 0.3;
      delayTone.connect(delayReturn);
      delayReturn.connect(this.master);
      delayReturn.connect(this.reverb);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 1;
      this.musicBus.connect(this.master);
      this.musicBus.connect(this.reverb);

      this.arpBus = ctx.createGain();
      this.arpBus.gain.value = 0.25;
      this.arpBus.connect(this.musicBus);
      this.arpBus.connect(this.delay);

      this.fxBus = ctx.createGain();
      this.fxBus.gain.value = 1.6;
      this.fxBus.connect(this.master);
      const fxSend = ctx.createGain();
      fxSend.gain.value = 0.25;
      this.fxBus.connect(fxSend);
      fxSend.connect(this.reverb);
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    return true;
  }

  async start() {
    const ok = await this.ensureContext();

    if (!ok) {
      return;
    }

    if (this.started) {
      this.applyMuteState();
      return;
    }

    this.started = true;
    this.startPad();
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.scheduler = window.setInterval(() => this.schedule(), SCHEDULE_INTERVAL);
    this.applyMuteState(true);
  }

  async unlock() {
    await this.start();
  }

  applyMuteState(immediate = false) {
    if (!this.master || !this.ctx) {
      return;
    }

    const now = this.ctx.currentTime;
    const target = this.enabled ? this.baseGain : 0;
    this.master.gain.cancelScheduledValues(now);

    if (immediate) {
      this.master.gain.setValueAtTime(0.0001, now);
      this.master.gain.linearRampToValueAtTime(target, now + 2.5);
      return;
    }

    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(target, now + 0.15);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.applyMuteState();
    this.notifyStateChange();
    this.onToast?.(this.enabled ? 'Music enabled' : 'Music muted');

    if (this.enabled) {
      void this.unlock();
    }
  }

  setProgress(progress) {
    this.progress = Math.max(0, Math.min(1, progress));

    if (this.arpBus && this.ctx) {
      this.arpBus.gain.setTargetAtTime(0.22 + this.progress * 0.55, this.ctx.currentTime, 1.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Score
  // ---------------------------------------------------------------------------

  startPad() {
    const ctx = this.ctx;
    const padBus = ctx.createGain();
    padBus.gain.value = 0.9;
    padBus.connect(this.musicBus);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 820;
    filter.Q.value = 0.6;
    filter.connect(padBus);

    // Slow filter sweep for movement.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const chord = PROGRESSION[0];

    this.padVoices = chord.pad.map((note, index) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime([0.05, 0.04, 0.035, 0.03][index], ctx.currentTime, 1.8);
      gain.connect(filter);

      const oscillators = [
        { type: 'sawtooth', detune: -7, level: 0.55 },
        { type: 'triangle', detune: 6, level: 1 },
      ].map(({ type, detune, level }) => {
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = type;
        osc.detune.value = detune;
        osc.frequency.value = midiToFrequency(note);
        oscGain.gain.value = level;
        osc.connect(oscGain);
        oscGain.connect(gain);
        osc.start();
        return osc;
      });

      return { oscillators };
    });
  }

  setPadChord(chord, time) {
    chord.pad.forEach((note, index) => {
      const voice = this.padVoices[index];

      if (!voice) {
        return;
      }

      for (const osc of voice.oscillators) {
        osc.frequency.setTargetAtTime(midiToFrequency(note), time, 0.35);
      }
    });
  }

  playBass(note, time) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = midiToFrequency(note - 12);
    const duration = EIGHTH * BEATS_PER_CHORD;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.13, time + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.98);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + duration);
  }

  playPluck(note, time, velocity = 1) {
    const ctx = this.ctx;
    const frequency = midiToFrequency(note);
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3800, time);
    filter.frequency.exponentialRampToValueAtTime(700, time + 0.45);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.09 * velocity, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.6);
    filter.connect(gain);
    gain.connect(this.arpBus);

    for (const [type, ratio, level] of [['triangle', 1, 1], ['sine', 2, 0.35]]) {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency * ratio;
      oscGain.gain.value = level;
      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(time);
      osc.stop(time + 0.65);
    }
  }

  schedule() {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') {
      if (this.ctx) {
        this.nextNoteTime = this.ctx.currentTime + 0.05;
      }
      return;
    }

    const now = this.ctx.currentTime;

    // If the tab was throttled, skip missed notes instead of bunching them.
    if (this.nextNoteTime < now - 0.1) {
      this.nextNoteTime = now + 0.05;
    }

    while (this.nextNoteTime < now + LOOKAHEAD) {
      const time = this.nextNoteTime;
      const beat = this.step % BEATS_PER_CHORD;

      if (beat === 0) {
        this.chordIndex = Math.floor(this.step / BEATS_PER_CHORD) % PROGRESSION.length;
        const chord = PROGRESSION[this.chordIndex];
        this.setPadChord(chord, time);
        this.playBass(chord.bass, time);
      }

      const chord = PROGRESSION[this.chordIndex];
      const patternIndex = ARP_PATTERN[this.step % ARP_PATTERN.length];

      if (patternIndex !== null) {
        const accent = beat % 4 === 0 ? 1 : 0.7;
        const swing = beat % 2 === 1 ? EIGHTH * 0.08 : 0;
        this.playPluck(chord.arp[patternIndex], time + swing, accent);
      }

      this.step += 1;
      this.nextNoteTime += EIGHTH;
    }
  }

  // ---------------------------------------------------------------------------
  // Sound effects
  // ---------------------------------------------------------------------------

  pulse(time, frequency, length = 0.28, volume = 0.034, type = 'triangle', targetBus = this.fxBus) {
    if (!this.ctx || !targetBus) {
      return;
    }

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, time);
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(targetBus);
    osc.start(time);
    osc.stop(time + length + 0.03);
  }

  getNoiseBuffer() {
    if (!this.ctx) {
      return null;
    }

    if (!this.noiseBuffer) {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);

      for (let index = 0; index < data.length; index += 1) {
        data[index] = (Math.random() * 2 - 1) * 0.7;
      }

      this.noiseBuffer = buffer;
    }

    return this.noiseBuffer;
  }

  noiseBurst(time, { volume = 0.035, duration = 0.12, lowpass = 900, highpass = 60 } = {}) {
    if (!this.ctx || !this.fxBus) {
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();
    source.playbackRate.value = 0.85 + Math.random() * 0.3;

    const highPass = this.ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = highpass;

    const lowPass = this.ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = lowpass;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(gain);
    gain.connect(this.fxBus);
    source.start(time, Math.random() * 0.5);
    source.stop(time + duration + 0.03);
  }

  canPlayFx() {
    return Boolean(this.ctx && this.enabled && this.ctx.state === 'running');
  }

  /** Called on each foot strike by the character animation. */
  footstep(strength = 1) {
    if (!this.canPlayFx()) {
      return;
    }

    const now = this.ctx.currentTime;

    if (now - this.lastFootstep < 0.11) {
      return;
    }

    this.lastFootstep = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const pitch = 150 + Math.random() * 40;

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(62, now + 0.09);
    filter.type = 'bandpass';
    filter.frequency.value = 260;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05 * strength, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.fxBus);
    osc.start(now);
    osc.stop(now + 0.12);
    this.noiseBurst(now, { volume: 0.016 * strength, duration: 0.07, lowpass: 1400, highpass: 300 });
  }

  playJump() {
    if (!this.canPlayFx()) {
      return;
    }

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.14);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(this.fxBus);
    osc.start(now);
    osc.stop(now + 0.25);
    this.noiseBurst(now, { volume: 0.02, duration: 0.18, lowpass: 3200, highpass: 900 });
  }

  playLand(intensity = 1) {
    if (!this.canPlayFx()) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pulse(now, 92, 0.16, 0.05 * intensity, 'sine');
    this.noiseBurst(now, { volume: 0.035 * intensity, duration: 0.12, lowpass: 600, highpass: 50 });
  }

  playUnlock() {
    if (!this.canPlayFx()) {
      return;
    }

    const now = this.ctx.currentTime;
    // A-minor add9 bell arpeggio.
    [69, 72, 76, 81, 83].forEach((note, index) => {
      const time = now + index * 0.075;
      this.pulse(time, midiToFrequency(note), 0.9, 0.045, 'sine');
      this.pulse(time, midiToFrequency(note) * 2, 0.4, 0.012, 'triangle');
    });
    this.noiseBurst(now + 0.05, { volume: 0.02, duration: 0.5, lowpass: 6000, highpass: 2500 });
  }

  playLink() {
    if (!this.canPlayFx()) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pulse(now, midiToFrequency(76), 0.25, 0.04, 'triangle');
    this.pulse(now + 0.07, midiToFrequency(81), 0.4, 0.045, 'triangle');
  }

  playPortal() {
    if (!this.canPlayFx()) {
      return;
    }

    const now = this.ctx.currentTime;

    [57, 64, 69, 72, 76, 79, 84].forEach((note, index) => {
      this.pulse(now + index * 0.09, midiToFrequency(note), 1.4, 0.035 + index * 0.003, index % 2 ? 'triangle' : 'sine');
    });

    this.noiseBurst(now + 0.1, { volume: 0.03, duration: 0.9, lowpass: 5000, highpass: 400 });
  }
}
