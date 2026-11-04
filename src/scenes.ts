import { BAND_COUNT, WAVE_POINTS, type AudioFrame } from './analysis';
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
  /** Mouse, touch and keyboard-focus input for this frame. */
  pointer: PointerState;
}

export interface Scene {
  readonly id: SceneId;
  readonly label: string;
  readonly description: string;
  /** Called once when the scene becomes active, to reset its state. */
  enter?(): void;
  draw(c: SceneContext): void;
}

/** Fades the previous frame toward the background. Lower alpha leaves longer trails. */
function wash(c: SceneContext, alpha: number): void {
  c.ctx.globalCompositeOperation = 'source-over';
  c.ctx.fillStyle = `rgba(${c.palette.shadeRgb}, ${alpha})`;
  c.ctx.fillRect(0, 0, c.width, c.height);
}

/** Additive glow on dark themes; multiply on light themes so colour stays visible. */
function blendMode(c: SceneContext): GlobalCompositeOperation {
  return c.palette.isLight ? 'multiply' : 'lighter';
}

/** A colour from the theme, adjusted for light mode and the theme's chroma. */
function tone(c: SceneContext, hue: number, saturation: number, lightness: number, alpha: number): string {
  const s = Math.min(100, saturation * c.palette.chroma);
  const l = c.palette.isLight ? Math.min(72, Math.max(30, lightness * 0.55 + 22)) : lightness;
  const h = ((hue % 360) + 360) % 360;
  return `hsla(${h}, ${s}%, ${l}%, ${Math.min(1, Math.max(0, alpha))})`;
}

/** Effective reaction strength: the user's setting, halved when the OS asks for less motion. */
function strength(c: SceneContext): number {
  return c.reactivity * (c.reducedMotion ? 0.5 : 1);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linearly interpolated value of a per-band array at position `u` in 0..1. */
function sampleBands(values: Float32Array, u: number): number {
  const p = Math.min(1, Math.max(0, u)) * (values.length - 1);
  const i = Math.floor(p);
  const a = values[i] ?? 0;
  const b = values[Math.min(values.length - 1, i + 1)] ?? a;
  return a + (b - a) * (p - i);
}

/** Mean of a slice of bands. */
function bandMean(values: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += values[i] ?? 0;
  return sum / Math.max(1, to - from);
}

interface Particle {
  /** Position in 0..1 screen space. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Displacement from the particle's home position, in px, and its velocity in px/s (a damped spring). */
  ox: number;
  oy: number;
  ix: number;
  iy: number;
  size: number;
  depth: number;
  phase: number;
  rate: number;
  hueOffset: number;
}

function seeded(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function makeParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    x: seeded(i, 1),
    y: seeded(i, 2),
    vx: (seeded(i, 3) - 0.5) * 0.06,
    vy: (seeded(i, 4) - 0.5) * 0.06,
    ox: 0,
    oy: 0,
    ix: 0,
    iy: 0,
    size: 0.5 + seeded(i, 5) * 2,
    depth: 0.4 + seeded(i, 6) * 0.6,
    phase: seeded(i, 7) * Math.PI * 2,
    rate: seeded(i, 8) * 2,
    hueOffset: seeded(i, 9) * 50 - 25,
  }));
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
    const k = strength(c);
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

    ctx.globalCompositeOperation = blendMode(c);

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

// 2. Spectrum: a soft, mirrored frequency ribbon that travels around all four edges.
//    The two arcs keep bass anchored at the lower centre and graduate toward the highs at the top.
const spectrumWaveBuffers = [new Float32Array(180), new Float32Array(180)];
const spectrumScene: Scene = {
  id: 'spectrum',
  label: 'Spectrum',
  description: 'A smooth, glowing frequency ribbon around the screen.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = strength(c);
    const blend = Math.min(1, Math.max(0, c.spectrumBlend));
    wash(c, 0.39);

    const min = Math.min(w, h);
    const margin = Math.max(12, min * 0.022);
    const bottomLength = Math.max(1, w * 0.5 - margin);
    const sideLength = Math.max(1, h - margin * 2);
    const topLength = bottomLength;
    const arcLength = bottomLength + sideLength + topLength;
    const pitchTarget = Math.min(48, Math.max(20, min * 0.042));
    // 48–90 bars per mirrored side: at most 180 moving bars on screen.
    const count = Math.min(90, Math.max(48, Math.round((arcLength / pitchTarget) * c.spectrumDensity)));
    const pitch = arcLength / count;
    const barWidth = Math.max(2.1, Math.min(5.6, pitch * 0.37));
    const maxDepth = min * (0.105 + Math.min(1, f.level * k) * 0.05);
    const idle = Math.max(1.8, min * 0.0024);

    // A low-contrast ambient wash gives the spectrum a little colour even between hits.
    ctx.globalCompositeOperation = blendMode(c);
    const glowDepth = min * (0.08 + Math.min(1, f.level * k) * 0.075);
    const paintEdgeGlow = (
      x0: number, y0: number, x1: number, y1: number,
      x: number, y: number, width: number, height: number,
      hueShift: number, alpha: number,
    ): void => {
      const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
      gradient.addColorStop(0, tone(c, hue + hueShift, 82, 58, alpha));
      gradient.addColorStop(1, tone(c, hue + hueShift + 24, 82, 52, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, width, height);
    };
    paintEdgeGlow(0, h, 0, h - glowDepth, 0, h - glowDepth, w, glowDepth, 0, 0.055 + f.bass * 0.14 * k);
    paintEdgeGlow(0, 0, 0, glowDepth, 0, 0, w, glowDepth, 112, 0.045 + f.treble * 0.12 * k);
    paintEdgeGlow(0, 0, glowDepth, 0, 0, 0, glowDepth, h, 42, 0.035 + f.mid * 0.1 * k);
    paintEdgeGlow(w, 0, w - glowDepth, 0, w - glowDepth, 0, glowDepth, h, 72, 0.035 + f.mid * 0.1 * k);

    const pointAt = (u: number, side: number): { x: number; y: number; nx: number; ny: number; corner: number } => {
      const d = u * arcLength;
      let px: number;
      let py: number;
      let nx: number;
      let ny: number;
      let corner: number;
      if (d < bottomLength) {
        px = w * 0.5 + d;
        py = h - margin;
        nx = 0;
        ny = -1;
        corner = bottomLength - d;
      } else if (d < bottomLength + sideLength) {
        px = w - margin;
        py = h - margin - (d - bottomLength);
        nx = -1;
        ny = 0;
        corner = Math.min(d - bottomLength, bottomLength + sideLength - d);
      } else {
        px = w - margin - (d - bottomLength - sideLength);
        py = margin;
        nx = 0;
        ny = 1;
        corner = d - bottomLength - sideLength;
      }
      if (side === 1) {
        px = w - px;
        nx = -nx;
      }
      return { x: px, y: py, nx, ny, corner };
    };

    for (let side = 0; side < 2; side += 1) {
      const points = spectrumWaveBuffers[side];
      if (!points) continue;

      // First pass: make a spatially filtered energy curve. Linear interpolation in
      // sampleBands removes hard FFT-bin steps; this 3-tap filter softens the joins.
      for (let j = 0; j < count; j += 1) {
        const u = (j + 0.5) / count;
        const step = 1 / count;
        const centre = sampleBands(f.bands, u);
        const before = sampleBands(f.bands, Math.max(0, u - step));
        const after = sampleBands(f.bands, Math.min(1, u + step));
        const filtered = (before + centre * 2 + after) * 0.25;
        const soft = centre + (filtered - centre) * blend;
        const travelling = Math.sin(t * 1.25 - u * 8.5 + side * 0.24) * 0.55
          + Math.sin(t * 0.58 + u * 5.4) * 0.25;
        const organic = travelling * (0.012 + f.level * 0.075) * blend;
        const value = Math.min(1, Math.max(0, idle / Math.max(1, maxDepth) + soft * k + organic * k));
        const location = pointAt(u, side);
        const taper = 0.48 + 0.52 * smoothstep(0, min * 0.11, location.corner);
        const length = idle + value * maxDepth * taper;
        const ex = location.x + location.nx * length;
        const ey = location.y + location.ny * length;
        points[j * 2] = ex;
        points[j * 2 + 1] = ey;
      }

      // The connected energy wave is intentionally understated; it ties the discrete
      // bars into one continuous, breathing contour without turning into a noisy graph.
      const waveGradient = ctx.createLinearGradient(0, h, w, 0);
      waveGradient.addColorStop(0, tone(c, hue + 8, 86, 69, 0.12 + f.bass * 0.12 * k));
      waveGradient.addColorStop(0.52, tone(c, hue + 66, 90, 76, 0.32 + f.level * 0.16 * k));
      waveGradient.addColorStop(1, tone(c, hue + 142, 86, 70, 0.12 + f.treble * 0.12 * k));
      ctx.beginPath();
      for (let j = 0; j < count; j += 1) {
        const ex = points[j * 2] ?? 0;
        const ey = points[j * 2 + 1] ?? 0;
        if (j === 0) {
          ctx.moveTo(ex, ey);
        } else {
          const px = points[(j - 1) * 2] ?? ex;
          const py = points[(j - 1) * 2 + 1] ?? ey;
          ctx.quadraticCurveTo(px, py, (px + ex) * 0.5, (py + ey) * 0.5);
        }
      }
      const lastX = points[(count - 1) * 2] ?? 0;
      const lastY = points[(count - 1) * 2 + 1] ?? 0;
      ctx.lineTo(lastX, lastY);
      ctx.strokeStyle = waveGradient;
      ctx.lineWidth = 1.15 + blend * 1.15;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Second pass: compact rounded strokes, with a restrained outer glow pass.
      for (let j = 0; j < count; j += 1) {
        const u = (j + 0.5) / count;
        const location = pointAt(u, side);
        const ex = points[j * 2] ?? location.x;
        const ey = points[j * 2 + 1] ?? location.y;
        const dx = ex - location.x;
        const dy = ey - location.y;
        const length = Math.hypot(dx, dy);
        const value = Math.min(1, Math.max(0, (length - idle) / Math.max(1, maxDepth)));
        const barHue = hue + 12 + u * 138;

        ctx.beginPath();
        ctx.moveTo(location.x, location.y);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = tone(c, barHue, 88, 62, 0.12 + value * 0.19);
        ctx.lineWidth = barWidth * 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(location.x, location.y);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = tone(c, barHue + 12, 88, 68 + value * 9, 0.38 + value * 0.54);
        ctx.lineWidth = Math.max(1.8, barWidth * (0.68 + value * 0.16));
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // Fine perimeter highlight: it brightens on bass hits without competing with the bars.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = tone(c, hue + 34, 62, 70, 0.055 + f.beat * 0.18 * k);
    ctx.lineWidth = 1 + f.beat * 1.1 * k;
    ctx.strokeRect(margin * 0.5, margin * 0.5, w - margin, h - margin);
  },
};

// 3. Waveform: a glowing, trigger-locked oscilloscope line with echoes.
const waveHistory: Float32Array[] = [new Float32Array(WAVE_POINTS), new Float32Array(WAVE_POINTS), new Float32Array(WAVE_POINTS)];
let waveClock = 0;
const waveformScene: Scene = {
  id: 'waveform',
  label: 'Waveform',
  description: 'A living line that traces the sound as it plays.',
  enter() {
    for (const frame of waveHistory) frame.fill(0);
    waveClock = 0;
  },
  draw(c) {
    const { ctx, width: w, height: h, hue, frame: f, dt } = c;
    const k = strength(c);
    wash(c, 0.3);

    // Keep a short history for the echo lines (every ~3rd frame so they are visibly offset).
    waveClock += dt;
    if (waveClock > 0.045) {
      waveClock = 0;
      const recycled = waveHistory.pop();
      if (recycled) {
        recycled.set(f.wave);
        waveHistory.unshift(recycled);
      }
    }

    const midY = h * 0.5;
    const amp = h * (0.07 + Math.min(1, f.level * k) * 0.3 + f.beat * 0.04 * k);
    const lead = 96;
    const count = WAVE_POINTS - lead;

    // The trigger point: a rising zero crossing, which keeps the picture from jittering.
    const start = (wave: Float32Array): number => {
      for (let i = 1; i < lead; i += 1) {
        if ((wave[i - 1] ?? 0) <= 0 && (wave[i] ?? 0) > 0) return i;
      }
      return 0;
    };

    const trace = (wave: Float32Array, yOffset: number, scale: number): void => {
      const s = start(wave);
      ctx.beginPath();
      let px = 0;
      let py = midY + yOffset;
      for (let i = 0; i < count; i += 1) {
        const u = i / (count - 1);
        // Pinned to the centre line at both ends, so the line seems to float.
        const envelope = Math.pow(Math.sin(Math.PI * u), 0.7);
        const x = u * w;
        const y = midY + yOffset + (wave[s + i] ?? 0) * amp * scale * envelope;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        }
        px = x;
        py = y;
      }
      ctx.lineTo(px, py);
      ctx.stroke();
    };

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, tone(c, hue, 78, 70, 0.15));
    gradient.addColorStop(0.2, tone(c, hue + 30, 80, 72, 0.95));
    gradient.addColorStop(0.5, tone(c, hue + 70, 85, 76, 1));
    gradient.addColorStop(0.8, tone(c, hue + 120, 80, 72, 0.95));
    gradient.addColorStop(1, tone(c, hue + 150, 78, 70, 0.15));

    ctx.globalCompositeOperation = blendMode(c);

    // Beat flash: a horizontal band of light behind the line.
    const flash = Math.min(1, f.beat * k);
    if (flash > 0.02 || f.level > 0.02) {
      const band = ctx.createLinearGradient(0, midY - amp * 1.4, 0, midY + amp * 1.4);
      const a = 0.03 + f.level * 0.1 * k + flash * 0.16;
      band.addColorStop(0, tone(c, hue + 60, 80, 55, 0));
      band.addColorStop(0.5, tone(c, hue + 60, 80, 55, a));
      band.addColorStop(1, tone(c, hue + 60, 80, 55, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, midY - amp * 1.4, w, amp * 2.8);
    }

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = gradient;

    // Echoes of the past, nudged outward by the bass.
    const spread = h * (0.012 + f.bass * 0.03 * k);
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1.2;
    trace(waveHistory[1] ?? f.wave, -spread, 0.9);
    ctx.globalAlpha = 0.11;
    trace(waveHistory[2] ?? f.wave, spread * 1.8, 0.8);

    // Faint reflection below.
    ctx.globalAlpha = 0.13;
    ctx.lineWidth = 1.4;
    trace(f.wave, amp * 0.55 + h * 0.03, -0.45);

    // The live line: wide bloom, tighter glow, bright core.
    ctx.globalAlpha = 0.12 + f.level * 0.1;
    ctx.lineWidth = 14 + f.level * 12 * k;
    trace(f.wave, 0, 1);
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 5;
    trace(f.wave, 0, 1);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.8 + f.level * 1.4 * k;
    trace(f.wave, 0, 1);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 4. Particles: a drifting field where every particle listens to one frequency and bursts outward on each kick.
let particleField: Particle[] | null = null;
let lastBurst = -10;
const particlesScene: Scene = {
  id: 'particles',
  label: 'Particles',
  description: 'Drifting light that scatters outward on every beat.',
  enter() {
    particleField = null;
    lastBurst = -10;
  },
  draw(c) {
    const { ctx, width: w, height: h, time: t, dt, frame: f, hue } = c;
    const k = strength(c);
    wash(c, 0.22);

    const items = (particleField ??= makeParticles(320));
    const min = Math.min(w, h);
    const speed = (c.reducedMotion ? 0.14 : 0.42) + f.level * 1.8 * k;
    const kick = f.beat > 0.95 && t - lastBurst > 0.14;
    if (kick) lastBurst = t;
    const originX = w / 2;
    const originY = h * 0.45;
    // Damped spring pulling every particle back to its home position after a burst.
    const stiffness = 34;
    const damping = 6.5;
    const pointer = c.pointer;
    const pointerRadius = 150 * (min / 800 + 0.3);

    ctx.globalCompositeOperation = blendMode(c);
    ctx.lineCap = 'round';
    for (const p of items) {
      const prevX = p.x * w + p.ox;
      const prevY = p.y * h + p.oy;

      if (kick) {
        const dx = prevX - originX;
        const dy = prevY - originY;
        const len = Math.max(30, Math.hypot(dx, dy));
        const push = (260 + f.bass * 900 * k) * p.depth * (min / 800);
        p.ix += (dx / len) * push;
        p.iy += (dy / len) * push;
      }
      if (f.snap > 0.95) {
        // Treble transients make the field flutter.
        p.ix += Math.sin(p.phase * 9) * 90 * k;
        p.iy += Math.cos(p.phase * 7) * 90 * k;
      }

      // Mouse: particles flee the pointer, are drawn in while the button is held,
      // and scatter from every click or Tab focus ripple.
      if (pointer.active) {
        const dx = prevX - pointer.x;
        const dy = prevY - pointer.y;
        const d = Math.max(8, Math.hypot(dx, dy));
        if (d < pointerRadius) {
          const fall = 1 - d / pointerRadius;
          const force = (pointer.down ? -1400 : 900 + pointer.energy * 900) * fall * fall * p.depth;
          p.ix += (dx / d) * force * dt;
          p.iy += (dy / d) * force * dt;
        }
      }
      for (const click of pointer.clicks) {
        const dx = prevX - click.x;
        const dy = prevY - click.y;
        const d = Math.max(20, Math.hypot(dx, dy));
        const reach = pointerRadius * 2.4;
        if (d < reach) {
          const push = click.power * 520 * (1 - d / reach) * p.depth * (min / 800 + 0.3);
          p.ix += (dx / d) * push;
          p.iy += (dy / d) * push;
        }
      }

      p.ix += (-stiffness * p.ox - damping * p.ix) * dt;
      p.iy += (-stiffness * p.oy - damping * p.iy) * dt;
      p.ox += p.ix * dt;
      p.oy += p.iy * dt;

      p.x += p.vx * dt * speed;
      p.y += p.vy * dt * speed;
      let wrapped = false;
      if (p.x < -0.03) { p.x = 1.03; wrapped = true; }
      if (p.x > 1.03) { p.x = -0.03; wrapped = true; }
      if (p.y < -0.03) { p.y = 1.03; wrapped = true; }
      if (p.y > 1.03) { p.y = -0.03; wrapped = true; }

      const x = p.x * w + p.ox;
      const y = p.y * h + p.oy;
      // Each particle follows the band that matches its horizontal position.
      const heard = Math.min(1, (f.bands[Math.min(BAND_COUNT - 1, Math.floor(p.x * 48))] ?? 0) * k);
      const twinkle = 0.58 + Math.sin(t * (0.7 + p.rate) + p.phase) * 0.24;
      const alpha = Math.min(0.95, twinkle * (f.active ? 0.25 + heard * 1.0 + f.level * 0.5 : 0.3) * p.depth);
      const size = p.size * (0.6 + heard * 1.8 + f.beat * 0.6 * k);
      const color = tone(c, hue + p.hueOffset + p.x * 70, 55 + f.treble * 30, 64 + heard * 18, alpha);

      if (!wrapped && Math.hypot(p.ix, p.iy) > 60) {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.6, size);
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, size), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 5. Rings: a living core that mirrors the spectrum, and a ring born on each beat that keeps that shape as it expands.
interface Ring {
  born: number;
  power: number;
  shape: Float32Array;
}
const ringList: Ring[] = [];
let lastRingSpawn = -10;
const RING_POINTS = 120;

/** Traces a closed curve whose radius is modulated by `shape` (mirrored left/right so it reads as one object). */
function tracePolar(c: SceneContext, cx: number, cy: number, radius: number, shape: Float32Array, depth: number, spin: number): void {
  const { ctx } = c;
  ctx.beginPath();
  for (let i = 0; i <= RING_POINTS; i += 1) {
    const u = i / RING_POINTS;
    const mirrored = u < 0.5 ? u * 2 : (1 - u) * 2;
    const r = radius * (1 + sampleBands(shape, mirrored) * depth);
    const angle = u * Math.PI * 2 - Math.PI / 2 + spin;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const ringsScene: Scene = {
  id: 'rings',
  label: 'Rings',
  description: 'A ring is born on every beat and drifts outward.',
  enter() {
    ringList.length = 0;
    lastRingSpawn = -10;
  },
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = strength(c);
    wash(c, 0.16);

    const min = Math.min(w, h);
    const cx = w / 2;
    const cy = h * 0.45;
    const since = t - lastRingSpawn;
    const spawn = f.active ? f.beat > 0.95 && since > 0.17 : since > 2.4;
    if (spawn) {
      ringList.push({ born: t, power: f.active ? Math.min(1, f.bass * k * 0.8 + 0.3) : 0.2, shape: Float32Array.from(f.bands) });
      lastRingSpawn = t;
      if (ringList.length > 14) ringList.shift();
    }

    ctx.globalCompositeOperation = blendMode(c);
    ctx.lineJoin = 'round';

    // Expanding rings keep the shape of the sound at the moment they were born.
    const lifetime = 2.8;
    for (let i = ringList.length - 1; i >= 0; i -= 1) {
      const ring = ringList[i];
      if (!ring) continue;
      const age = t - ring.born;
      if (age > lifetime) {
        ringList.splice(i, 1);
        continue;
      }
      const e = age / lifetime;
      const eased = 1 - Math.pow(1 - e, 2.2);
      const radius = min * (0.1 + eased * 0.6 * (0.6 + ring.power * 0.6));
      tracePolar(c, cx, cy, radius, ring.shape, 0.2 * (1 - e) * (0.5 + k * 0.5), age * 0.15);
      ctx.strokeStyle = tone(c, hue + i * 17 + age * 24, 74, 70, Math.pow(1 - e, 1.3) * (0.28 + ring.power * 0.55));
      ctx.lineWidth = 1 + ring.power * 3.5 * (1 - e);
      ctx.stroke();
    }

    // The core: a soft disc with a bright outline that follows the live spectrum.
    const pulse = Math.min(1, f.pulse * k);
    const coreRadius = min * (0.07 + pulse * 0.035 + f.beat * 0.02 * k);
    const spin = t * 0.12;
    tracePolar(c, cx, cy, coreRadius, f.bands, 0.9 * k, spin);
    const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius * 2.2);
    fill.addColorStop(0, tone(c, hue + 20, 78, 62, 0.22 + pulse * 0.2));
    fill.addColorStop(1, tone(c, hue + 20, 78, 50, 0));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = tone(c, hue, 80, 76, 0.5 + pulse * 0.4);
    ctx.lineWidth = 1.6 + f.beat * 3 * k;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 6. Aurora: layered ribbons, each driven by a slice of the spectrum, flaring with the beat.
const auroraScene: Scene = {
  id: 'aurora',
  label: 'Aurora',
  description: 'Layered ribbons of light that swell with the mids.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = strength(c);
    wash(c, 1);

    const layers = 6;
    const step = Math.max(4, w / 160);
    ctx.globalCompositeOperation = blendMode(c);

    // A wash of light from above on every kick.
    const flare = Math.min(1, f.beat * k);
    if (flare > 0.02) {
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.7);
      g.addColorStop(0, tone(c, hue + 40, 80, 60, flare * 0.16));
      g.addColorStop(1, tone(c, hue + 40, 80, 60, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h * 0.7);
    }

    for (let layer = 0; layer < layers; layer += 1) {
      const from = 2 + layer * 9;
      const band = Math.min(1, bandMean(f.bands, from, from + 8) * k * (1 + layer * 0.12));
      const amp = h * (0.03 + band * 0.22) * (1 + flare * 0.3);
      const baseY = h * (0.26 + layer * 0.085) - band * h * 0.02;
      const phase = layer * 1.3;

      ctx.beginPath();
      for (let x = 0; x <= w + step; x += step) {
        const u = Math.min(1, x / w);
        // Energy is local: each stretch of the ribbon leans on the band under it.
        const local = sampleBands(f.bands, (u * 0.6 + layer * 0.07) % 1) * k;
        const y = baseY
          + Math.sin(u * 3.2 + t * (0.4 + layer * 0.12) + phase) * amp
          + Math.sin(u * 7.1 - t * 0.7 + layer * 2) * amp * 0.35
          + Math.sin(u * 13 + t * 1.4 + layer) * local * h * 0.012;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = tone(c, hue + layer * 26, 80, 76, 0.1 + band * 0.5);
      ctx.lineWidth = 1 + band * 2.5;
      ctx.stroke();

      ctx.lineTo(w + step, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, baseY - amp, 0, h);
      gradient.addColorStop(0, tone(c, hue + layer * 26, 78, 66, 0.12 + band * 0.3));
      gradient.addColorStop(1, tone(c, hue + layer * 26, 75, 40, 0));
      ctx.fillStyle = gradient;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 7. Still: a slow, nearly static glow for focus. Reacts only faintly.
const stillScene: Scene = {
  id: 'still',
  label: 'Still',
  description: 'A calm, slow glow that barely moves. For focus.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = strength(c) * 0.4;
    wash(c, 1);

    const min = Math.min(w, h);
    const cx = w / 2;
    const cy = h * 0.45;
    const radius = min * (0.55 + Math.sin(t * 0.12) * 0.03 + f.level * 0.1 * k);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, tone(c, hue, 55, 62, 0.22 + f.level * 0.1 * k));
    gradient.addColorStop(1, `rgba(${c.palette.shadeRgb}, 0)`);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  },
};

export const SCENES: Record<SceneId, Scene> = {
  bloom: bloomScene,
  spectrum: spectrumScene,
  waveform: waveformScene,
  particles: particlesScene,
  rings: ringsScene,
  aurora: auroraScene,
  still: stillScene,
};
