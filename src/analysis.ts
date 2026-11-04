export const BAND_COUNT = 64;
export const WAVE_POINTS = 256;

export interface AudioFrame {
  /** Overall loudness, 0..1 (auto-gain normalised, before the user's reactivity setting). */
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** Smoothed bass envelope, 0..1. */
  pulse: number;
  /** Jumps to 1 on a detected kick / bass onset, then decays. */
  beat: number;
  /** Jumps to 1 on a detected high-frequency transient (snare, hat, clap), then decays. */
  snap: number;
  /** Spectral brightness, 0 (dark, bassy) .. 1 (airy, trebly). Smoothed. */
  brightness: number;
  /** True when there is audible signal. */
  active: boolean;
  /** Log-spaced (30 Hz – 16 kHz), attack/release-smoothed spectrum bars, 0..1. */
  bands: Float32Array;
  /** Peak-hold value for every band: sticks at the top for a moment, then falls with gravity. */
  peaks: Float32Array;
  /** Time-domain samples, -1..1. */
  wave: Float32Array;
}

const MIN_HZ = 30;
const MAX_HZ = 16000;
/** Extra boost for high bands (music has far less energy up there). Expressed on the 0..1 dB-mapped scale. */
const TILT = 0.2;

export class AudioAnalysis {
  readonly frame: AudioFrame;
  private readonly analyser: AnalyserNode;
  private readonly freq: Uint8Array<ArrayBuffer>;
  private readonly time: Uint8Array<ArrayBuffer>;
  /** Per band: [startBin, endBin] as fractional FFT bin positions. */
  private readonly ranges: Float32Array;
  private readonly tilt: Float32Array;
  private readonly peakHold: Float32Array;
  private readonly peakVelocity: Float32Array;
  private previousBass = 0;
  private previousHigh = 0;
  private fluxBassAverage = 0;
  private fluxHighAverage = 0;
  private sinceBeat = 1;
  private sinceSnap = 1;
  /** Slowly-adapting gain so quiet tracks and low volume still make the visuals move. */
  private gain = 1.4;
  private reference = 0.6;

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser;
    this.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.time = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    this.ranges = new Float32Array(BAND_COUNT * 2);
    this.tilt = new Float32Array(BAND_COUNT);
    this.peakHold = new Float32Array(BAND_COUNT);
    this.peakVelocity = new Float32Array(BAND_COUNT);

    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const maxHz = Math.min(MAX_HZ, analyser.context.sampleRate / 2 - binHz);
    const ratio = maxHz / MIN_HZ;
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const lo = (MIN_HZ * Math.pow(ratio, i / BAND_COUNT)) / binHz;
      const hi = (MIN_HZ * Math.pow(ratio, (i + 1) / BAND_COUNT)) / binHz;
      this.ranges[i * 2] = lo;
      this.ranges[i * 2 + 1] = Math.max(lo + 0.001, hi);
      this.tilt[i] = TILT * (i / (BAND_COUNT - 1));
    }

    this.frame = {
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      pulse: 0,
      beat: 0,
      snap: 0,
      brightness: 0.4,
      active: false,
      bands: new Float32Array(BAND_COUNT),
      peaks: new Float32Array(BAND_COUNT),
      wave: new Float32Array(WAVE_POINTS),
    };
  }

  /** Reads the analyser and advances the smoothed state by `dt` seconds. */
  update(dt: number): AudioFrame {
    const f = this.frame;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    const bins = this.freq.length;
    const rawLevel = averageRange(this.freq, 0, bins);
    f.active = rawLevel > 0.012;

    // --- Auto gain: aim the loudest recent band at ~0.85 so quiet material is not left flat. ---
    let loudest = 0;
    for (let i = 0; i < BAND_COUNT; i += 1) loudest = Math.max(loudest, this.sampleBand(i));
    if (f.active) {
      // Reference rises fast on loud hits, falls slowly (~6 s) so dynamics are preserved.
      this.reference += (loudest - this.reference) * (1 - Math.exp(-dt * (loudest > this.reference ? 8 : 0.18)));
      const target = Math.min(2.4, Math.max(1, 0.85 / Math.max(0.2, this.reference)));
      this.gain += (target - this.gain) * (1 - Math.exp(-dt * 1.2));
    }
    const g = this.gain;

    // --- Smoothed bars + peak-hold ---
    const bands = f.bands;
    const peaks = f.peaks;
    let weighted = 0;
    let total = 0;
    for (let i = 0; i < BAND_COUNT; i += 1) {
      const raw = this.sampleBand(i);
      const lifted = raw > 0.03 ? raw + (this.tilt[i] ?? 0) * Math.min(1, raw / 0.2) : raw;
      const target = Math.min(1, Math.max(0, lifted * g));
      const current = bands[i] ?? 0;
      // Very fast attack so transients read instantly; slower release so bars glide down.
      const rate = target > current ? 1 - Math.exp(-dt * 38) : 1 - Math.exp(-dt * 7.5);
      const next = current + (target - current) * rate;
      bands[i] = next;
      weighted += next * i;
      total += next;

      // Peak hold: stick for 0.22 s, then fall with gravity.
      let peak = peaks[i] ?? 0;
      let hold = this.peakHold[i] ?? 0;
      let vel = this.peakVelocity[i] ?? 0;
      if (next >= peak) {
        peak = next;
        hold = 0.22;
        vel = 0;
      } else if (hold > 0) {
        hold -= dt;
      } else {
        vel += dt * 2.4;
        peak = Math.max(next, peak - vel * dt);
      }
      peaks[i] = peak;
      this.peakHold[i] = hold;
      this.peakVelocity[i] = vel;
    }

    // --- Region levels from the smoothed bands (so they match what the scenes draw) ---
    const region = (from: number, to: number): number => {
      let sum = 0;
      for (let i = from; i < to; i += 1) sum += bands[i] ?? 0;
      return sum / (to - from);
    };
    const bassNow = Math.min(1, region(0, 10) * 1.1);
    f.bass = bassNow;
    f.mid = Math.min(1, region(10, 36) * 1.25);
    f.treble = Math.min(1, region(36, BAND_COUNT) * 1.9);
    f.level = Math.min(1, Math.pow(region(0, BAND_COUNT), 0.7) * 1.55);

    const centroid = total > 0.02 ? weighted / total / (BAND_COUNT - 1) : 0.35;
    f.brightness += (centroid - f.brightness) * (1 - Math.exp(-dt * 3));

    // Frame-rate independent envelope: a lerp whose strength depends on dt.
    const pulseTarget = Math.min(1, Math.pow(f.bass, 0.8));
    f.pulse += (pulseTarget - f.pulse) * (1 - Math.exp(-dt * 12));

    // --- Onsets via spectral flux (how much the spectrum *rose* since last frame) ---
    const lowRaw = this.rawRegion(0, 10);
    const highRaw = this.rawRegion(34, BAND_COUNT);
    const fluxBass = Math.max(0, lowRaw - this.previousBass);
    const fluxHigh = Math.max(0, highRaw - this.previousHigh);
    this.previousBass = lowRaw;
    this.previousHigh = highRaw;

    this.sinceBeat += dt;
    this.sinceSnap += dt;
    this.fluxBassAverage += (fluxBass - this.fluxBassAverage) * (1 - Math.exp(-dt * 3));
    this.fluxHighAverage += (fluxHigh - this.fluxHighAverage) * (1 - Math.exp(-dt * 3));

    const kick = f.active && fluxBass * g > this.fluxBassAverage * g * 1.6 + 0.03 && this.sinceBeat > 0.17;
    if (kick) {
      f.beat = 1;
      this.sinceBeat = 0;
    } else {
      f.beat *= Math.exp(-dt * 6.5);
    }
    const hit = f.active && fluxHigh * g > this.fluxHighAverage * g * 1.7 + 0.02 && this.sinceSnap > 0.1;
    if (hit) {
      f.snap = 1;
      this.sinceSnap = 0;
    } else {
      f.snap *= Math.exp(-dt * 9);
    }

    const waveLength = this.time.length;
    for (let i = 0; i < WAVE_POINTS; i += 1) {
      const index = Math.floor((i * waveLength) / WAVE_POINTS);
      f.wave[i] = ((this.time[index] ?? 128) - 128) / 128;
    }

    return f;
  }

  /** Raw (unsmoothed, un-gained) value of one band: blends peak and mean, interpolating when narrower than a bin. */
  private sampleBand(i: number): number {
    const lo = this.ranges[i * 2] ?? 0;
    const hi = this.ranges[i * 2 + 1] ?? lo + 1;
    const bins = this.freq.length;
    if (hi - lo <= 1) {
      // Narrower than one FFT bin: interpolate between neighbours instead of repeating a single bin.
      const centre = (lo + hi) / 2;
      const a = Math.min(bins - 1, Math.floor(centre));
      const b = Math.min(bins - 1, a + 1);
      const t = centre - a;
      return (((this.freq[a] ?? 0) * (1 - t)) + ((this.freq[b] ?? 0) * t)) / 255;
    }
    const start = Math.floor(lo);
    const end = Math.min(bins, Math.ceil(hi));
    let peak = 0;
    let sum = 0;
    for (let k = start; k < end; k += 1) {
      const v = this.freq[k] ?? 0;
      peak = Math.max(peak, v);
      sum += v;
    }
    return (peak * 0.65 + (sum / Math.max(1, end - start)) * 0.35) / 255;
  }

  private rawRegion(from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i += 1) sum += this.sampleBand(i);
    return sum / (to - from);
  }
}

function averageRange(data: Uint8Array, start: number, end: number): number {
  const safeStart = Math.max(0, Math.min(data.length, start));
  const safeEnd = Math.max(safeStart, Math.min(data.length, end));
  if (safeEnd <= safeStart) return 0;
  let total = 0;
  for (let i = safeStart; i < safeEnd; i += 1) total += data[i] ?? 0;
  return total / (safeEnd - safeStart) / 255;
}
