import { BAND_COUNT, type AudioFrame } from './analysis';
import type { PointerState } from './pointer';
import type { SceneId } from './settings';
import type { ResolvedPalette } from './themes';

export interface SceneContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Seconds since the visualizer started. */
  time: number;
  dt: number;
  frame: AudioFrame;
  palette: ResolvedPalette;
  hue: number;
  reactivity: number;
  spectrumBlend: number;
  spectrumDensity: number;
  reducedMotion: boolean;
  pointer: PointerState;
}

export interface Scene {
  readonly id: SceneId;
  readonly label: string;
  readonly description: string;
  enter?(): void;
  draw(c: SceneContext): void;
}

const TAU = Math.PI * 2;

function wash(c: SceneContext, alpha = 1): void {
  const { ctx, width, height, palette } = c;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(${palette.shadeRgb}, ${alpha})`;
  ctx.fillRect(0, 0, width, height);
}

function tone(c: SceneContext, hue: number, saturation = 82, lightness = 68, alpha = 1): string {
  const h = ((hue % 360) + 360) % 360;
  // Light canvases need richer pigment rather than the pale, low-contrast
  // pastels that disappear against a bright app background.
  const s = Math.min(100, Math.max(0, saturation * c.palette.chroma * (c.palette.isLight ? 1.08 : 1)));
  const l = c.palette.isLight
    ? Math.min(78, Math.max(27, lightness * 0.7 + 4))
    : Math.min(90, Math.max(8, lightness));
  return `hsla(${h}, ${s}%, ${l}%, ${Math.min(1, Math.max(0, alpha))})`;
}

function composite(c: SceneContext): GlobalCompositeOperation {
  return c.palette.isLight ? 'multiply' : 'lighter';
}

function energy(c: SceneContext, value: number): number {
  return Math.min(1, Math.max(0, value * c.reactivity * (c.reducedMotion ? 0.5 : 1)));
}

function sample(values: Float32Array, position: number): number {
  if (values.length === 0) return 0;
  const p = Math.min(1, Math.max(0, position)) * (values.length - 1);
  const i = Math.floor(p);
  const a = values[i] ?? 0;
  const b = values[Math.min(values.length - 1, i + 1)] ?? a;
  return a + (b - a) * (p - i);
}

function seeded(index: number, salt: number): number {
  const value = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function drawGlow(
  c: SceneContext,
  x: number,
  y: number,
  radius: number,
  hue: number,
  alpha: number,
): void {
  const gradient = c.ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
  gradient.addColorStop(0, tone(c, hue, 88, 72, alpha));
  gradient.addColorStop(0.34, tone(c, hue + 28, 82, 54, alpha * 0.42));
  gradient.addColorStop(1, tone(c, hue + 60, 82, 40, 0));
  c.ctx.fillStyle = gradient;
  c.ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}


// 1. Bloom: a soft orb that punches with every kick, with two satellites and shockwaves.
interface Wave {
  born: number;
  power: number;
}
const bloomWaves: Wave[] = [];
let lastBloomWave = -10;
const bloomScene: Scene = {
  id: 'bloom',
  label: 'Bloom',
  description: 'A soft orb that punches with the bass.',
  enter() {
    bloomWaves.length = 0;
    lastBloomWave = -10;
  },
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reactivity * (c.reducedMotion ? 0.5 : 1);
    wash(c, f.active ? 0.24 : 0.13);

    const min = Math.min(w, h);
    // The orb leans gently toward the pointer.
    const cx = w * (0.5 + Math.sin(t * 0.19) * 0.04 + c.pointer.nx * 0.07);
    const cy = h * (0.43 + Math.cos(t * 0.16) * 0.04 + c.pointer.ny * 0.07);
    const pulse = Math.min(1, f.pulse * k);
    const punch = Math.min(1, f.beat * k);
    const breath = 0.5 + Math.sin(t * 0.65) * 0.5;
    const radius = min * (0.11 + pulse * 0.22 + punch * 0.045 + f.bass * 0.03 * k + breath * 0.02);
    const outer = Math.max(radius * 3.8, min * 0.55);

    if (f.beat > 0.95 && t - lastBloomWave > 0.15) {
      bloomWaves.push({ born: t, power: Math.min(1, 0.35 + f.bass * k * 0.65) });
      lastBloomWave = t;
    } else if (!f.active && t - lastBloomWave > 3.2) {
      bloomWaves.push({ born: t, power: 0.18 });
      lastBloomWave = t;
    }

    // Core glow: brightens and warms on every hit.
    const gradient = ctx.createRadialGradient(cx, cy, Math.max(1, radius * 0.06), cx, cy, outer);
    gradient.addColorStop(0, tone(c, hue + punch * 14, 60 + f.treble * 24, 24 + pulse * 10 + punch * 12, 0.5 + pulse * 0.22 + punch * 0.2));
    gradient.addColorStop(0.24, tone(c, hue + 37, 72, 21, 0.28 + punch * 0.08));
    gradient.addColorStop(0.56, tone(c, hue + 88, 72, 13, 0.15));
    gradient.addColorStop(1, `rgba(${c.palette.shadeRgb}, 0)`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = composite(c);

    // Satellites: mids and highs orbit the core and flare with their own bands.
    const satellites: Array<{ level: number; speed: number; dist: number; hueShift: number }> = [
      { level: Math.min(1, f.mid * k), speed: 0.45, dist: 0.2, hueShift: 62 },
      { level: Math.min(1, (f.treble + f.snap * 0.5) * k), speed: -0.72, dist: 0.31, hueShift: 140 },
    ];
    satellites.forEach((s, i) => {
      const angle = t * s.speed + i * 2.1;
      const d = min * (s.dist + s.level * 0.07);
      const sx = cx + Math.cos(angle) * d;
      const sy = cy + Math.sin(angle) * d * 0.78;
      const sr = min * (0.04 + s.level * 0.13);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, tone(c, hue + s.hueShift, 80, 62, 0.16 + s.level * 0.5));
      g.addColorStop(1, tone(c, hue + s.hueShift, 80, 40, 0));
      ctx.fillStyle = g;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    });

    // Shockwaves born on each kick.
    for (let i = bloomWaves.length - 1; i >= 0; i -= 1) {
      const wave = bloomWaves[i];
      if (!wave) continue;
      const age = t - wave.born;
      const life = 1.5;
      if (age > life) {
        bloomWaves.splice(i, 1);
        continue;
      }
      const e = age / life;
      const eased = 1 - Math.pow(1 - e, 3);
      ctx.beginPath();
      ctx.strokeStyle = tone(c, hue + 20 + e * 50, 78, 74, Math.pow(1 - e, 1.6) * (0.18 + wave.power * 0.5));
      ctx.lineWidth = 1 + wave.power * 5 * (1 - e);
      ctx.arc(cx, cy, radius * 0.9 + eased * min * (0.35 + wave.power * 0.45), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Slow breathing rings that never stop, so silence still feels alive.
    for (let i = 0; i < 3; i += 1) {
      const e = (t * (f.active ? 0.11 + f.bass * 0.13 : 0.035) + i / 3) % 1;
      ctx.beginPath();
      ctx.strokeStyle = tone(c, hue + i * 19, 72, 71, (1 - e) * (f.active ? 0.08 + pulse * 0.1 : 0.05));
      ctx.lineWidth = 0.7 + pulse * 1.3;
      ctx.arc(cx, cy, radius * (0.82 + e * (1.2 + pulse * 1.3)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};


// 2. FREQUENCY GRID — a perspective field of luminous sound architecture.
// A compact lookup avoids repeatedly sampling/smoothing the same frequency band
// for every depth layer. The drawing pass also uses flat fills instead of hundreds
// of per-column CanvasGradient allocations.
const spectrumValues = new Float32Array(64);
const spectrumPeaks = new Float32Array(64);
const spectrumScene: Scene = {
  id: 'spectrum',
  label: 'Frequency Grid',
  description: 'A deep, perspective sound field built from living frequency columns.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reducedMotion ? 0.52 : c.reactivity;
    const cols = Math.max(30, Math.min(58, Math.round((w > 1500 ? 46 : 40) * c.spectrumDensity)));
    const rows = 9;
    const blend = Math.min(1, Math.max(0, c.spectrumBlend));
    const horizon = h * 0.32;
    const min = Math.min(w, h);

    // A stronger wash in light mode prevents old geometry from accumulating as haze.
    wash(c, c.palette.isLight ? 0.82 : 0.56);

    // Sample and smooth each frequency only once per column, not once per depth.
    for (let col = 0; col < cols; col += 1) {
      const u = col / Math.max(1, cols - 1);
      const band = sample(f.bands, u);
      const before = sample(f.bands, Math.max(0, u - 1 / cols));
      const after = sample(f.bands, Math.min(1, u + 1 / cols));
      const filtered = (before + band * 2 + after) * 0.25;
      const smoothed = band + (filtered - band) * blend;
      const travelling = Math.sin(t * 0.92 - u * 8.5) * blend * 0.025;
      spectrumValues[col] = Math.min(1, Math.max(0, (smoothed + travelling) * k));
      spectrumPeaks[col] = f.peaks[Math.min(BAND_COUNT - 1, Math.floor(u * BAND_COUNT))] ?? 0;
    }

    // One restrained atmospheric source anchors the horizon without flooding the field.
    drawGlow(c, w * 0.5, horizon + h * 0.09, min * 0.48, hue + 36, 0.13 + f.level * 0.12);
    ctx.globalCompositeOperation = composite(c);

    // Perspective floor: batch all floor lines into two strokes.
    ctx.lineWidth = c.palette.isLight ? 0.85 : 0.7;
    ctx.beginPath();
    for (let row = 0; row <= 10; row += 1) {
      const z = row / 10;
      const y = horizon + Math.pow(z, 1.72) * h * 0.66;
      const half = 0.54 * (0.2 + z * 0.8);
      ctx.moveTo(w * (0.5 - half), y);
      ctx.lineTo(w * (0.5 + half), y);
    }
    ctx.strokeStyle = tone(c, hue + 132, 62, 65, c.palette.isLight ? 0.16 : 0.095);
    ctx.stroke();

    ctx.beginPath();
    const vanishingLines = Math.max(16, Math.round(cols * 0.58));
    for (let line = 0; line <= vanishingLines; line += 1) {
      const u = line / vanishingLines - 0.5;
      ctx.moveTo(w * (0.5 + u * 0.43), horizon);
      ctx.lineTo(w * (0.5 + u * 1.1), h * 0.99);
    }
    ctx.strokeStyle = tone(c, hue + 178, 58, 67, c.palette.isLight ? 0.12 : 0.065);
    ctx.stroke();

    // Back-to-front columns form a broad, legible sound city.
    for (let row = 0; row < rows; row += 1) {
      const depth = row / (rows - 1);
      const scale = 0.22 + depth * 0.78;
      const baseY = horizon + Math.pow(depth, 1.72) * h * 0.66;
      const pitch = (w * 0.94 * scale) / cols;
      const barWidth = Math.max(1.25, pitch * 0.68);
      const depthFactor = 0.42 + depth * 0.58;
      const alpha = (0.14 + depth * 0.24) * (c.palette.isLight ? 1.12 : 1);

      for (let col = 0; col < cols; col += 1) {
        const u = col / Math.max(1, cols - 1);
        const amplitude = spectrumValues[col] ?? 0;
        const peak = spectrumPeaks[col] ?? 0;
        const shimmer = Math.sin(t * 0.72 + u * 10 - depth * 3) * 0.006;
        const height = Math.max(1.6, (h * 0.018 + amplitude * h * 0.245 + shimmer * h) * depthFactor);
        const x = w * 0.5 + (u - 0.5) * w * 0.94 * scale - barWidth * 0.5;
        const top = baseY - height;
        const colHue = hue + 188 - u * 142 + depth * 12;
        const bodyAlpha = Math.min(0.82, alpha + amplitude * 0.28);

        ctx.fillStyle = tone(c, colHue, 90, 62, bodyAlpha);
        ctx.fillRect(x, top, barWidth, height);

        // A narrow shaded side gives each column a little volume at almost no cost.
        ctx.fillStyle = tone(c, colHue - 24, 88, 28, bodyAlpha * 0.68);
        ctx.fillRect(x + barWidth * 0.72, top, Math.max(0.7, barWidth * 0.28), height);

        // Bright caps and peak-hold markers make transients readable at a glance.
        ctx.fillStyle = tone(c, colHue + 20, 92, 88, 0.3 + amplitude * 0.46 + depth * 0.08);
        ctx.fillRect(x, top, barWidth * 0.76, Math.max(1.1, 1.5 * scale));
        if (peak > 0.12 && depth > 0.48) {
          const peakY = baseY - (h * 0.018 + peak * k * h * 0.245) * depthFactor;
          ctx.fillStyle = tone(c, colHue + 32, 92, 90, 0.34 + peak * 0.42);
          ctx.fillRect(x, peakY - 1.1, barWidth * 0.76, 1.1);
        }
      }
    }

    // A crisp horizon separates the skyline from its perspective floor.
    const horizonGradient = ctx.createLinearGradient(w * 0.1, 0, w * 0.9, 0);
    horizonGradient.addColorStop(0, tone(c, hue + 28, 82, 62, 0));
    horizonGradient.addColorStop(0.5, tone(c, hue + 190, 86, 80, c.palette.isLight ? 0.76 : 0.58));
    horizonGradient.addColorStop(1, tone(c, hue + 330, 82, 62, 0));
    ctx.beginPath();
    ctx.moveTo(w * 0.1, horizon);
    ctx.lineTo(w * 0.9, horizon);
    ctx.strokeStyle = horizonGradient;
    ctx.lineWidth = 1.2 + energy(c, f.beat) * 1.8;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 3. SOFT HALO — a complete orbital instrument around one luminous sound core.
interface HaloDust {
  angle: number;
  distance: number;
  size: number;
  phase: number;
  depth: number;
}
const haloDust: HaloDust[] = Array.from({ length: 76 }, (_, i) => ({
  angle: seeded(i, 31) * TAU,
  distance: 1.95 + seeded(i, 32) * 1.45,
  size: 0.45 + seeded(i, 33) * 1.45,
  phase: seeded(i, 34) * TAU,
  depth: 0.35 + seeded(i, 35) * 0.65,
}));

const waveformScene: Scene = {
  id: 'waveform',
  label: 'Soft Halo',
  description: 'A luminous orbital sound instrument with a living spectral crown.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const min = Math.min(w, h);
    const bass = energy(c, f.bass);
    const beat = energy(c, f.beat);
    const treble = energy(c, f.treble);
    const breath = 0.5 + Math.sin(t * 0.42) * 0.5;
    const cx = w * (0.5 + c.pointer.nx * 0.014);
    const cy = h * (0.48 + c.pointer.ny * 0.014);
    const radius = min * (0.105 + breath * 0.012 + bass * 0.026 + beat * 0.015);
    const outer = radius * 3.7;

    wash(c, c.palette.isLight ? 0.91 : 0.84);

    // Layered atmosphere establishes depth before the orbital geometry appears.
    const atmosphere = ctx.createRadialGradient(cx, cy, radius * 0.22, cx, cy, outer);
    atmosphere.addColorStop(0, tone(c, hue + 20, 74, 75, 0.19 + bass * 0.12));
    atmosphere.addColorStop(0.28, tone(c, hue + 76, 72, 58, 0.12 + beat * 0.08));
    atmosphere.addColorStop(0.62, tone(c, hue + 142, 62, 40, 0.045));
    atmosphere.addColorStop(1, tone(c, hue + 178, 54, 30, 0));
    ctx.globalCompositeOperation = composite(c);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);

    // Three orbital ellipses: a soft outer track, a precise middle rail and a tilted inner ring.
    const orbitSpecs = [
      { rx: 2.72, ry: 1.16, rotation: -0.13, alpha: 0.13, width: 1 },
      { rx: 2.28, ry: 0.74, rotation: 0.2, alpha: 0.2, width: 1.15 },
      { rx: 1.62, ry: 0.56, rotation: -0.31, alpha: 0.22, width: 0.85 },
    ];
    for (let i = 0; i < orbitSpecs.length; i += 1) {
      const orbit = orbitSpecs[i];
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * orbit.rx, radius * orbit.ry, orbit.rotation, 0, TAU);
      ctx.strokeStyle = tone(c, hue + 48 + i * 38, 76, 75, orbit.alpha + bass * (i === 1 ? 0.09 : 0.035));
      ctx.lineWidth = orbit.width + beat * (i === 1 ? 1.2 : 0.35);
      ctx.stroke();
    }

    // Radial spectrum crown. One batched path replaces dozens of individual strokes.
    const spokes = 72;
    ctx.beginPath();
    const innerRadius = radius * 1.35;
    for (let i = 0; i < spokes; i += 1) {
      const u = i / spokes;
      const angle = u * TAU - Math.PI / 2;
      const level = energy(c, sample(f.bands, u) * 0.82 + f.mid * 0.12 + f.treble * 0.08);
      const flutter = Math.sin(t * 0.8 + i * 0.19) * 0.018;
      const length = radius * (0.09 + level * 0.72 + treble * 0.04 + flutter);
      const x1 = cx + Math.cos(angle) * innerRadius;
      const y1 = cy + Math.sin(angle) * innerRadius;
      const x2 = cx + Math.cos(angle) * (innerRadius + length);
      const y2 = cy + Math.sin(angle) * (innerRadius + length);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    const crownGradient = ctx.createLinearGradient(cx - radius * 2.2, cy - radius * 2.2, cx + radius * 2.2, cy + radius * 2.2);
    crownGradient.addColorStop(0, tone(c, hue + 176, 80, 66, 0.58));
    crownGradient.addColorStop(0.5, tone(c, hue + 24, 88, 76, 0.82));
    crownGradient.addColorStop(1, tone(c, hue + 112, 82, 62, 0.58));
    ctx.strokeStyle = crownGradient;
    ctx.lineWidth = c.palette.isLight ? 1.45 : 1.2;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Fine radial index marks give the halo the feel of a tuned instrument.
    ctx.beginPath();
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * TAU - Math.PI / 2;
      const inner = radius * 1.15;
      const length = i % 4 === 0 ? radius * 0.14 : radius * 0.075;
      ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      ctx.lineTo(cx + Math.cos(angle) * (inner + length), cy + Math.sin(angle) * (inner + length));
    }
    ctx.strokeStyle = tone(c, hue + 34, 62, 73, 0.34 + bass * 0.18);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // A luminous, glass-like core with a bright centre and a defined outer edge.
    const core = ctx.createRadialGradient(cx - radius * 0.28, cy - radius * 0.34, radius * 0.025, cx, cy, radius);
    core.addColorStop(0, tone(c, hue + 30, 58, 98, 0.94));
    core.addColorStop(0.22, tone(c, hue + 18, 76, 86, 0.72 + bass * 0.12));
    core.addColorStop(0.58, tone(c, hue + 68, 72, 61, 0.43 + beat * 0.12));
    core.addColorStop(1, tone(c, hue + 112, 72, 48, 0.08));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.34 + bass * 0.06), 0, TAU);
    ctx.strokeStyle = tone(c, hue + 16, 74, 91, 0.34 + beat * 0.28);
    ctx.lineWidth = 1 + beat * 1.4;
    ctx.stroke();

    // Two satellites travel on separate rails, with a compact bloom at each node.
    for (let i = 0; i < 2; i += 1) {
      const angle = t * (i === 0 ? 0.2 : -0.145) + (i === 0 ? 0.65 : 3.15);
      const orbitX = radius * (i === 0 ? 2.28 : 1.62);
      const orbitY = radius * (i === 0 ? 0.74 : 0.56);
      const sx = cx + Math.cos(angle) * orbitX;
      const sy = cy + Math.sin(angle) * orbitY;
      const satellite = radius * (0.042 + (i === 0 ? bass : treble) * 0.045);
      drawGlow(c, sx, sy, satellite * 4, hue + (i === 0 ? 30 : 166), 0.36 + (i === 0 ? bass : treble) * 0.32);
      ctx.beginPath();
      ctx.arc(sx, sy, satellite, 0, TAU);
      ctx.fillStyle = tone(c, hue + (i === 0 ? 24 : 164), 86, 82, 0.78);
      ctx.fill();
    }

    // Sparse orbital dust makes the field feel inhabited without becoming noisy.
    for (const mote of haloDust) {
      const angle = mote.angle + t * (0.018 + mote.depth * 0.025);
      const distance = radius * mote.distance;
      const x = cx + Math.cos(angle) * distance * 1.42;
      const y = cy + Math.sin(angle) * distance * 0.62;
      const twinkle = 0.28 + (Math.sin(t * 0.55 + mote.phase) + 1) * 0.22;
      ctx.fillStyle = tone(c, hue + mote.depth * 90, 64, 72, twinkle * mote.depth);
      ctx.fillRect(x, y, mote.size, mote.size);
    }

    // Quiet travelling ripples respond to the beat and remain visible during silence.
    for (let i = 0; i < 2; i += 1) {
      const phase = (t * 0.105 + i * 0.5) % 1;
      const rippleRadius = radius * (2.35 + phase * 1.7 + beat * 0.12);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rippleRadius * 1.18, rippleRadius * 0.62, -0.12, 0, TAU);
      ctx.strokeStyle = tone(c, hue + 68 + i * 38, 70, 74, (1 - phase) * (0.1 + bass * 0.12));
      ctx.lineWidth = 0.8 + beat * 0.75;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  },
};

// 4. CONSTELLATION — a force-responsive star field with audio-driven connections.
interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  size: number;
  depth: number;
  hue: number;
}

const stars: Star[] = Array.from({ length: 132 }, (_, i) => ({
  x: 0.04 + seeded(i, 1) * 0.92,
  y: 0.04 + seeded(i, 2) * 0.92,
  vx: (seeded(i, 3) - 0.5) * 0.018,
  vy: (seeded(i, 4) - 0.5) * 0.018,
  phase: seeded(i, 5) * TAU,
  size: 0.7 + seeded(i, 6) * 1.7,
  depth: 0.35 + seeded(i, 7) * 0.65,
  hue: seeded(i, 8) * 100 - 50,
}));

const constellationScene: Scene = {
  id: 'particles',
  label: 'Constellation',
  description: 'A living star map whose connections ripple with sound and respond to your pointer.',
  enter() {
    for (const star of stars) {
      star.vx *= 0.6;
      star.vy *= 0.6;
    }
  },
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reducedMotion ? 0.5 : c.reactivity;
    wash(c, 0.34);
    const min = Math.min(w, h);
    const cx = w * (0.5 + c.pointer.nx * 0.025);
    const cy = h * 0.48;
    const kick = energy(c, f.beat);
    drawGlow(c, cx, cy, min * (0.52 + f.bass * 0.18), hue + 60, 0.09 + f.level * 0.08);
    ctx.globalCompositeOperation = composite(c);

    const positions: Array<{ x: number; y: number; brightness: number; size: number }> = [];
    const pointer = c.pointer;
    const pointerRadius = min * 0.22;
    for (let i = 0; i < stars.length; i += 1) {
      const star = stars[i];
      if (!star) continue;
      const px = star.x * w;
      const py = star.y * h;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.max(10, Math.hypot(dx, dy));
      if (kick > 0.02) {
        const force = kick * (14 + f.bass * 34) * star.depth;
        star.vx += (dx / dist) * force * c.dt * 0.0008;
        star.vy += (dy / dist) * force * c.dt * 0.0008;
      }

      if (pointer.active) {
        const mx = px - pointer.x;
        const my = py - pointer.y;
        const md = Math.max(8, Math.hypot(mx, my));
        if (md < pointerRadius) {
          const falloff = 1 - md / pointerRadius;
          const force = (pointer.down ? -0.65 : 0.42 + pointer.energy * 0.5) * falloff * falloff;
          star.vx += (mx / md) * force * c.dt;
          star.vy += (my / md) * force * c.dt;
        }
      }
      for (const click of pointer.clicks) {
        const mx = px - click.x;
        const my = py - click.y;
        const md = Math.max(10, Math.hypot(mx, my));
        if (md < pointerRadius * 1.4) {
          const impulse = click.power * (1 - md / (pointerRadius * 1.4)) * 0.08;
          star.vx += (mx / md) * impulse;
          star.vy += (my / md) * impulse;
        }
      }

      star.vx += (0.009 * Math.sin(t * 0.17 + star.phase) - star.vx) * c.dt * 0.16;
      star.vy += (0.008 * Math.cos(t * 0.14 + star.phase * 1.3) - star.vy) * c.dt * 0.16;
      star.vx *= Math.exp(-c.dt * 0.18);
      star.vy *= Math.exp(-c.dt * 0.18);
      star.x += star.vx * c.dt;
      star.y += star.vy * c.dt;
      if (star.x < -0.02) star.x = 1.02;
      if (star.x > 1.02) star.x = -0.02;
      if (star.y < -0.02) star.y = 1.02;
      if (star.y > 1.02) star.y = -0.02;

      const x = star.x * w;
      const y = star.y * h;
      const band = sample(f.bands, star.x);
      const twinkle = 0.48 + Math.sin(t * (0.5 + star.depth) + star.phase) * 0.2;
      const brightness = Math.min(1, twinkle + band * k * 0.82 + kick * 0.25);
      const size = star.size * (0.6 + band * 1.6 * k + kick * 0.65);
      positions.push({ x, y, brightness, size });
    }

    // Connect close stars, weighted by their audio energy. The capped node count keeps this bounded.
    for (let i = 0; i < positions.length; i += 1) {
      const a = positions[i];
      if (!a) continue;
      for (let j = i + 1; j < positions.length; j += 1) {
        const b = positions[j];
        if (!b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);
        const threshold = min * (0.095 + (a.brightness + b.brightness) * 0.012);
        if (distance > threshold) continue;
        const alpha = (1 - distance / threshold) * Math.min(a.brightness, b.brightness) * (0.06 + f.level * 0.1);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = tone(c, hue + (i % 17) * 11, 72, 74, alpha);
        ctx.lineWidth = 0.6 + Math.min(0.8, f.level * 0.6);
        ctx.stroke();
      }
    }

    for (let i = 0; i < positions.length; i += 1) {
      const point = positions[i];
      if (!point) continue;
      const star = stars[i];
      if (!star) continue;
      ctx.fillStyle = tone(c, hue + star.hue + 10, 78, 78, 0.2 + point.brightness * 0.68);
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.size, 0, TAU);
      ctx.fill();
      if (point.size > 2.1) {
        ctx.strokeStyle = tone(c, hue + star.hue, 80, 80, 0.22 + point.brightness * 0.25);
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(point.x - point.size * 3, point.y);
        ctx.lineTo(point.x + point.size * 3, point.y);
        ctx.moveTo(point.x, point.y - point.size * 3);
        ctx.lineTo(point.x, point.y + point.size * 3);
        ctx.stroke();
      }
    }

    // One broad wavefront rolls outward on each bass transient.
    if (kick > 0.08) {
      ctx.beginPath();
      ctx.arc(cx, cy, min * (0.08 + kick * 0.05), 0, TAU);
      ctx.strokeStyle = tone(c, hue + 160, 80, 78, kick * 0.22);
      ctx.lineWidth = 1.2 + kick * 2;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 5. ORBIT — a precision orbital instrument with live radial telemetry.
interface OrbitSatellite {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  hue: number;
}
const satellites: OrbitSatellite[] = Array.from({ length: 7 }, (_, i) => ({
  angle: seeded(i, 1) * TAU,
  radius: 0.19 + seeded(i, 2) * 0.3,
  speed: (seeded(i, 3) - 0.5) * 0.42,
  size: 1.6 + seeded(i, 4) * 2.8,
  hue: seeded(i, 5) * 120,
}));

const orbitScene: Scene = {
  id: 'rings',
  label: 'Orbit Engine',
  description: 'A kinetic orbital instrument with a rotating spectral crown and beat-driven satellites.',
  enter() {
    satellites.forEach((satellite, index) => {
      satellite.angle += index * 0.11;
    });
  },
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reducedMotion ? 0.5 : c.reactivity;
    wash(c, 0.32);
    const min = Math.min(w, h);
    const cx = w * (0.5 + c.pointer.nx * 0.018);
    const cy = h * 0.47;
    const bass = energy(c, f.bass);
    const beat = energy(c, f.beat);
    const base = min * (0.115 + bass * 0.035 + beat * 0.025);

    drawGlow(c, cx, cy, min * (0.47 + bass * 0.12), hue + 34, 0.12 + f.level * 0.1);
    ctx.globalCompositeOperation = composite(c);

    // Four asymmetric orbital rails, with a small counter-rotating shift.
    for (let i = 0; i < 4; i += 1) {
      const rotation = t * (i % 2 === 0 ? 0.08 : -0.11) + i * 0.48;
      ctx.beginPath();
      ctx.ellipse(cx, cy, min * (0.2 + i * 0.085), min * (0.075 + i * 0.035), rotation, 0, TAU);
      ctx.strokeStyle = tone(c, hue + i * 58, 74, 74, 0.18 + (i === 0 ? beat * 0.24 : 0));
      ctx.lineWidth = i === 1 ? 1.6 : 0.85;
      ctx.stroke();
    }

    // A 96-point radial crown turns the whole spectrum into an instrument dial.
    const bars = 96;
    for (let i = 0; i < bars; i += 1) {
      const u = i / bars;
      const angle = u * TAU - Math.PI / 2 + t * 0.035;
      const band = sample(f.bands, u);
      const peak = sample(f.peaks, u);
      const value = energy(c, band * 0.72 + peak * 0.28);
      const inner = base * 1.52;
      const outer = inner + min * (0.018 + value * 0.14);
      const x1 = cx + Math.cos(angle) * inner;
      const y1 = cy + Math.sin(angle) * inner;
      const x2 = cx + Math.cos(angle) * outer;
      const y2 = cy + Math.sin(angle) * outer;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = tone(c, hue + 20 + u * 190, 84, 74 + value * 10, 0.22 + value * 0.66);
      ctx.lineWidth = 1 + value * 2.4;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // The central body has several concentric precision rings and a bright glass core.
    for (let i = 0; i < 5; i += 1) {
      const r = base * (0.48 + i * 0.23);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = tone(c, hue + 25 + i * 25, 66, 75, 0.15 + (i === 2 ? bass * 0.22 : 0));
      ctx.lineWidth = i === 2 ? 1.5 : 0.7;
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(cx - base * 0.18, cy - base * 0.22, 0, cx, cy, base * 0.86);
    core.addColorStop(0, tone(c, hue + 82, 44, 96, 0.96));
    core.addColorStop(0.2, tone(c, hue + 22, 86, 76, 0.88));
    core.addColorStop(0.64, tone(c, hue + 88, 84, 42, 0.7));
    core.addColorStop(1, tone(c, hue + 145, 80, 22, 0.12));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (0.72 + beat * 0.1), 0, TAU);
    ctx.fill();

    // Satellites travel on independent, tilted orbits.
    satellites.forEach((satellite, index) => {
      satellite.angle += satellite.speed * c.dt * (c.reducedMotion ? 0.4 : 1) * (0.5 + f.level * k);
      const rx = min * satellite.radius;
      const ry = rx * (0.38 + (index % 3) * 0.08);
      const angle = satellite.angle;
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      const radius = satellite.size * (0.8 + f.mid * k * 1.4 + beat * 0.6);
      drawGlow(c, x, y, radius * 8, hue + satellite.hue, 0.08 + f.treble * 0.12);
      ctx.fillStyle = tone(c, hue + satellite.hue, 84, 82, 0.72 + f.level * 0.2);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
      if (index % 2 === 0) {
        ctx.strokeStyle = tone(c, hue + satellite.hue, 76, 74, 0.24);
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - radius * 4, y);
        ctx.lineTo(x + radius * 4, y);
        ctx.stroke();
      }
    });
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 6. CALM — no visualizer, no pointer trails, just the app's native background.
const calmScene: Scene = {
  id: 'aurora',
  label: 'Calm',
  description: 'No visualizer or animated background — just a clean, quiet screen.',
  enter() {
    // Any previous frame trails are erased on the next draw.
  },
  draw(c) {
    c.ctx.globalCompositeOperation = 'source-over';
    c.ctx.clearRect(0, 0, c.width, c.height);
  },
};

// 7. MOONLIGHT — a cinematic eclipse with orbital structure and a living star field.
interface MoonStar {
  x: number;
  y: number;
  size: number;
  phase: number;
  depth: number;
}
const moonStars: MoonStar[] = Array.from({ length: 176 }, (_, i) => ({
  x: 0.025 + seeded(i, 41) * 0.95,
  y: 0.035 + seeded(i, 42) * 0.92,
  size: 0.45 + seeded(i, 43) * (seeded(i, 44) > 0.93 ? 2.1 : 1.05),
  phase: seeded(i, 45) * TAU,
  depth: 0.25 + seeded(i, 46) * 0.75,
}));

const moonScene: Scene = {
  id: 'still',
  label: 'Moonlight',
  description: 'A cinematic lunar eclipse, orbital dust and a restrained pulse of light.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reducedMotion ? 0.32 : c.reactivity * 0.55;
    const min = Math.min(w, h);
    const bass = energy(c, f.bass);
    const beat = energy(c, f.beat);
    const cx = w * (0.51 + Math.sin(t * 0.065) * 0.022 + c.pointer.nx * 0.026);
    const cy = h * (0.445 + Math.cos(t * 0.075) * 0.02 + c.pointer.ny * 0.02);
    const radius = min * (0.195 + f.level * k * 0.014 + beat * 0.012);

    wash(c, c.palette.isLight ? 0.96 : 1);

    // Broad, quiet nebula light gives the scene a horizon and a sense of scale.
    drawGlow(c, cx, cy, min * 0.82, hue + 36, c.palette.isLight ? 0.19 : 0.15);
    const haze = ctx.createRadialGradient(cx, cy + radius * 0.4, radius * 0.15, cx, cy, min * 0.78);
    haze.addColorStop(0, tone(c, hue + 150, 55, 62, 0.075 + f.level * 0.035));
    haze.addColorStop(0.55, tone(c, hue + 205, 48, 48, 0.035));
    haze.addColorStop(1, tone(c, hue + 230, 42, 36, 0));
    ctx.globalCompositeOperation = composite(c);
    ctx.fillStyle = haze;
    ctx.fillRect(cx - min * 0.82, cy - min * 0.82, min * 1.64, min * 1.64);

    // Distant stars are deterministic, so no objects are allocated during the frame loop.
    for (const star of moonStars) {
      const twinkle = 0.28 + (Math.sin(t * (0.22 + star.depth * 0.22) + star.phase) + 1) * 0.28;
      const alpha = twinkle * star.depth * (0.78 + f.treble * 0.12);
      const x = star.x * w + Math.sin(t * 0.012 + star.phase) * star.depth * 4;
      const y = star.y * h + Math.cos(t * 0.01 + star.phase) * star.depth * 3;
      ctx.fillStyle = tone(c, hue + 176 + star.depth * 42, 42, c.palette.isLight ? 32 : 86, alpha * (c.palette.isLight ? 0.62 : 0.82));
      ctx.fillRect(x, y, star.size, star.size);
      if (star.size > 1.8) {
        ctx.beginPath();
        ctx.moveTo(x - star.size * 2.1, y + star.size * 0.5);
        ctx.lineTo(x + star.size * 3.1, y + star.size * 0.5);
        ctx.moveTo(x + star.size * 0.5, y - star.size * 2.1);
        ctx.lineTo(x + star.size * 0.5, y + star.size * 3.1);
        ctx.strokeStyle = tone(c, hue + 190, 46, c.palette.isLight ? 30 : 88, alpha * 0.26);
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
    }

    // Elliptical orbital tracks cross behind the body at different inclinations.
    const orbitRadii = [1.62, 2.05, 2.52, 3.05];
    for (let i = 0; i < orbitRadii.length; i += 1) {
      const scale = orbitRadii[i];
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * scale, radius * (0.46 + i * 0.105), -0.2 + i * 0.085, 0, TAU);
      ctx.strokeStyle = tone(c, hue + 42 + i * 34, 54, c.palette.isLight ? 42 : 76, 0.105 + (i === 1 ? f.level * 0.045 : 0));
      ctx.lineWidth = i === 1 ? 1.15 : 0.75;
      ctx.stroke();
    }

    // The eclipse body is a dark, dimensional sphere so it remains legible in light mode too.
    const lunar = ctx.createRadialGradient(cx - radius * 0.34, cy - radius * 0.42, radius * 0.025, cx, cy, radius * 1.08);
    lunar.addColorStop(0, tone(c, hue + 212, 34, 25, 0.99));
    lunar.addColorStop(0.42, tone(c, hue + 224, 48, 19, 0.99));
    lunar.addColorStop(0.78, tone(c, hue + 188, 56, 13, 0.99));
    lunar.addColorStop(1, tone(c, hue + 170, 62, 9, 0.99));
    ctx.fillStyle = lunar;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();

    // Low-contrast lunar terrain adds detail without competing with the crescent.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.985, 0, TAU);
    ctx.clip();
    for (let i = 0; i < 10; i += 1) {
      const ox = (seeded(i, 51) - 0.5) * radius * 1.2;
      const oy = (seeded(i, 52) - 0.5) * radius * 1.2;
      if (ox * ox + oy * oy > radius * radius * 0.53) continue;
      const crater = radius * (0.035 + seeded(i, 53) * 0.085);
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, crater, 0, TAU);
      ctx.strokeStyle = tone(c, hue + 190, 26, 68, 0.12);
      ctx.lineWidth = Math.max(0.65, crater * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + ox - crater * 0.18, cy + oy - crater * 0.18, crater * 0.72, 0, TAU);
      ctx.fillStyle = tone(c, hue + 208, 38, 14, 0.12);
      ctx.fill();
    }
    ctx.restore();

    // A curved, illuminated crescent cuts across the dark lunar disc.
    const crescent = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    crescent.addColorStop(0, tone(c, hue + 38, 58, 94, 0.98));
    crescent.addColorStop(0.42, tone(c, hue + 64, 68, 82, 0.92));
    crescent.addColorStop(1, tone(c, hue + 126, 70, 58, 0.58));
    ctx.save();
    ctx.shadowColor = tone(c, hue + 62, 84, 82, 0.62);
    ctx.shadowBlur = radius * (0.16 + bass * 0.11);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (0.97 + beat * 0.012), -Math.PI * 0.76, Math.PI * 0.72);
    ctx.strokeStyle = crescent;
    ctx.lineWidth = radius * (0.085 + bass * 0.018 + beat * 0.025);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
    ctx.lineCap = 'butt';

    // A finer rim and two travelling shock rings make the eclipse pulse on bass hits.
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.045, -Math.PI * 0.78, Math.PI * 0.74);
    ctx.strokeStyle = tone(c, hue + 50, 68, 90, 0.36 + bass * 0.3 + beat * 0.22);
    ctx.lineWidth = 0.8 + beat * 1.4;
    ctx.stroke();
    for (let i = 0; i < 2; i += 1) {
      const phase = (t * 0.085 + i * 0.5) % 1;
      const ripple = radius * (1.3 + phase * 2.2);
      ctx.beginPath();
      ctx.arc(cx, cy, ripple, -Math.PI * 0.86, Math.PI * 0.84);
      ctx.strokeStyle = tone(c, hue + 72 + i * 28, 54, 78, (1 - phase) * (0.12 + bass * 0.12));
      ctx.lineWidth = 0.75 + beat * 0.45;
      ctx.stroke();
    }

    // Three orbiting bodies give the orbital paths a clear purpose and scale.
    const satellites = [
      { orbit: 2.05, speed: 0.11, phase: 0.7, size: 0.023, hue: 44 },
      { orbit: 2.52, speed: -0.075, phase: 2.8, size: 0.014, hue: 178 },
      { orbit: 3.05, speed: 0.052, phase: 4.4, size: 0.011, hue: 108 },
    ];
    for (const satellite of satellites) {
      const angle = t * satellite.speed + satellite.phase;
      const sx = cx + Math.cos(angle) * radius * satellite.orbit;
      const sy = cy + Math.sin(angle) * radius * (0.46 + (satellite.orbit - 1.62) * 0.105);
      const sr = radius * (satellite.size + (satellite.orbit === 2.05 ? bass * 0.008 : 0));
      drawGlow(c, sx, sy, sr * 5, hue + satellite.hue, 0.26 + bass * 0.18);
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, TAU);
      ctx.fillStyle = tone(c, hue + satellite.hue, 68, 84, 0.86);
      ctx.fill();
    }

    // A thin lower atmospheric arc keeps the planet grounded in the larger scene.
    const lowerAtmosphere = ctx.createLinearGradient(cx - radius * 2.8, cy + radius * 2.4, cx + radius * 2.8, cy + radius * 2.4);
    lowerAtmosphere.addColorStop(0, tone(c, hue + 28, 66, 68, 0));
    lowerAtmosphere.addColorStop(0.5, tone(c, hue + 172, 64, 76, 0.18 + f.level * 0.1));
    lowerAtmosphere.addColorStop(1, tone(c, hue + 320, 66, 68, 0));
    ctx.beginPath();
    ctx.ellipse(cx, cy + radius * 2.52, radius * 2.8, radius * 0.38, -0.03, 0, TAU);
    ctx.strokeStyle = lowerAtmosphere;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.globalCompositeOperation = 'source-over';
  },
};

export const SCENES: Record<SceneId, Scene> = {
  bloom: bloomScene,
  spectrum: spectrumScene,
  waveform: waveformScene,
  particles: constellationScene,
  rings: orbitScene,
  aurora: calmScene,
  still: moonScene,
};
