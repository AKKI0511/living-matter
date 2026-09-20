// All sounds are synthesized locally. No network, assets or autoplay dependency.
class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: GainNode | null = null;
  private muted = false;
  private voices = new Set<OscillatorNode>();
  reset() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* Already ended. */
      }
    }
    this.voices.clear();
  }
  async start() {
    if (!this.context) {
      const ctx = new AudioContext();
      this.context = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(ctx.destination);
      this.ambience = ctx.createGain();
      this.ambience.gain.value = 0.13;
      this.ambience.connect(this.master);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.018) / 1.018;
        data[i] = last;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 480;
      noise.connect(filter);
      filter.connect(this.ambience);
      noise.start();
      [55, 82.41, 110.16].forEach((f, i) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.frequency.value = f;
        gain.gain.value = 0.045 / (i + 1);
        osc.connect(gain);
        gain.connect(this.ambience!);
        osc.start();
      });
    }
    await this.context.resume();
    this.mute(this.muted);
  }
  mute(value: boolean) {
    this.muted = value;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        value ? 0 : 0.42,
        this.context.currentTime,
        0.12,
      );
  }
  pause(value: boolean) {
    if (this.context && this.ambience)
      this.ambience.gain.setTargetAtTime(
        value ? 0.025 : 0.13,
        this.context.currentTime,
        0.6,
      );
  }
  tone(
    frequency: number,
    duration: number,
    volume: number,
    type: OscillatorType = "sine",
    delay = 0,
  ) {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator(),
      gain = ctx.createGain(),
      t = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.75, t + duration);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
    this.voices.add(osc);
    osc.onended = () => {
      this.voices.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
  }
  step() {
    this.tone(85 + Math.random() * 30, 0.1, 0.065, "triangle");
  }
  land() {
    this.tone(65, 0.25, 0.12, "triangle");
  }
  transform() {
    [146.83, 220, 293.66, 440, 587.33].forEach((f, i) =>
      this.tone(f, 2.2, 0.075, "sine", i * 0.32),
    );
  }
  settle() {
    this.tone(110, 0.6, 0.17, "triangle");
    this.tone(880, 1.5, 0.035);
  }
  arrive() {
    [220, 329.63, 440, 554.37, 659.25].forEach((f, i) =>
      this.tone(f, 5, 0.09, "sine", i * 0.24),
    );
  }
}
export const sound = new Soundscape();
