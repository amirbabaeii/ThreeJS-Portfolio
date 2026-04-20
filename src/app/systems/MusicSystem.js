export class MusicSystem {
  constructor({ onStateChange, onToast }) {
    this.onStateChange = onStateChange;
    this.onToast = onToast;
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.fxBus = null;
    this.compressor = null;
    this.started = false;
    this.enabled = true;
    this.lastFootstep = 0;
    this.padLfos = [];
    this.baseGain = 0.3;
    this.noiseBuffer = null;
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
      this.ctx = new AudioCtx();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0;

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 1.1;

      this.fxBus = this.ctx.createGain();
      this.fxBus.gain.value = 1.95;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -22;
      this.compressor.knee.value = 14;
      this.compressor.ratio.value = 3.5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.18;

      this.musicBus.connect(this.master);
      this.fxBus.connect(this.master);
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
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

    this.startAmbientPad(98.0, 130.81, 164.81);
    this.started = true;
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

    if (immediate) {
      this.master.gain.setValueAtTime(target, now);
      return;
    }

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.linearRampToValueAtTime(target, now + 0.12);
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

  startAmbientPad(...freqs) {
    if (!this.ctx || !this.musicBus) {
      return;
    }

    freqs.forEach((freq, index) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      const now = this.ctx.currentTime;

      osc.type = 'sine';
      osc.frequency.value = freq;

      filter.type = 'lowpass';
      filter.frequency.value = 170 + index * 35;
      filter.Q.value = 0.12;

      const targetGain = [0.034, 0.02, 0.013][index] ?? 0.01;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(targetGain, now + 3.2 + index * 0.35);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.musicBus);
      osc.start();
    });
  }

  pulse(now, freq, length = 0.28, volume = 0.034, type = 'triangle', targetBus = this.musicBus) {
    if (!this.ctx || !targetBus) {
      return;
    }

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(targetBus);
    osc.start(now);
    osc.stop(now + length + 0.03);
  }

  getNoiseBuffer() {
    if (!this.ctx) {
      return null;
    }

    if (this.noiseBuffer) {
      return this.noiseBuffer;
    }

    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * 0.7;
    }

    this.noiseBuffer = buffer;
    return buffer;
  }

  noiseBurst(now, { volume = 0.035, duration = 0.12, lowpass = 900, highpass = 60 } = {}) {
    if (!this.ctx || !this.fxBus) {
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer();

    const highPass = this.ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = highpass;

    const lowPass = this.ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = lowpass;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(gain);
    gain.connect(this.fxBus);
    source.start(now);
    source.stop(now + duration + 0.03);
  }

  footstep(now) {
    if (!this.ctx || !this.fxBus || now - this.lastFootstep < 0.16) {
      return;
    }

    this.lastFootstep = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(172, now);
    osc.frequency.exponentialRampToValueAtTime(72, now + 0.09);
    filter.type = 'bandpass';
    filter.frequency.value = 280;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.fxBus);
    osc.start(now);
    osc.stop(now + 0.12);
    this.noiseBurst(now, { volume: 0.018, duration: 0.06, lowpass: 420, highpass: 80 });
  }

  playJump() {
    if (!this.ctx || !this.enabled) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pulse(now, 330, 0.14, 0.05, 'square', this.fxBus);
    this.pulse(now + 0.04, 494, 0.16, 0.04, 'triangle', this.fxBus);
  }

  playLand(intensity = 1) {
    if (!this.ctx || !this.enabled) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pulse(now, 110, 0.12, 0.03 * intensity, 'sine', this.fxBus);
    this.noiseBurst(now, { volume: 0.03 * intensity, duration: 0.09, lowpass: 500, highpass: 50 });
  }

  playUnlock() {
    if (!this.ctx || !this.enabled) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pulse(now, 523.25, 0.16, 0.05, 'triangle', this.fxBus);
    this.pulse(now + 0.08, 659.25, 0.18, 0.05, 'triangle', this.fxBus);
    this.pulse(now + 0.16, 783.99, 0.24, 0.055, 'sawtooth', this.fxBus);
    this.noiseBurst(now + 0.05, { volume: 0.018, duration: 0.12, lowpass: 1800, highpass: 250 });
  }

  playLink() {
    if (!this.ctx || !this.enabled) {
      return;
    }

    const now = this.ctx.currentTime;
    this.pulse(now, 392, 0.12, 0.04, 'square', this.fxBus);
    this.pulse(now + 0.06, 587.33, 0.18, 0.045, 'triangle', this.fxBus);
  }

  playPortal() {
    if (!this.ctx || !this.enabled) {
      return;
    }

    const now = this.ctx.currentTime;

    [392, 523.25, 659.25, 783.99].forEach((freq, index) => {
      this.pulse(
        now + index * 0.08,
        freq,
        0.32,
        0.05 + index * 0.004,
        index % 2 ? 'triangle' : 'sawtooth',
        this.fxBus,
      );
    });

    this.noiseBurst(now + 0.08, { volume: 0.028, duration: 0.26, lowpass: 2200, highpass: 180 });
  }

  update(movingFast) {
    if (!this.ctx || !this.master || !this.enabled) {
      return;
    }

    const now = this.ctx.currentTime;

    if (movingFast) {
      this.footstep(now);
    }
  }
}
