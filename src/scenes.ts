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
  const s = Math.min(100, Math.max(0, saturation * c.palette.chroma));
  const l = c.palette.isLight
    ? Math.min(72, Math.max(30, lightness * 0.58 + 18))
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
const spectrumScene: Scene = {
  id: 'spectrum',
  label: 'Frequency Grid',
  description: 'A deep, perspective sound field built from living frequency columns.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reducedMotion ? 0.52 : c.reactivity;
    wash(c, 0.58);
    const horizon = h * 0.34;
    const cols = Math.max(34, Math.min(72, Math.round(48 * c.spectrumDensity)));
    const rows = 13;
    const blend = Math.min(1, Math.max(0, c.spectrumBlend));

    drawGlow(c, w * 0.5, horizon + h * 0.08, Math.min(w, h) * 0.55, hue + 35, 0.12 + f.level * 0.12);
    ctx.globalCompositeOperation = composite(c);

    // Perspective grid floor.
    ctx.lineWidth = 0.7;
    for (let row = 0; row <= 16; row += 1) {
      const z = row / 16;
      const y = horizon + Math.pow(z, 1.7) * h * 0.66;
      ctx.beginPath();
      ctx.moveTo(w * (0.5 - 0.54 * (0.23 + z * 0.77)), y);
      ctx.lineTo(w * (0.5 + 0.54 * (0.23 + z * 0.77)), y);
      ctx.strokeStyle = tone(c, hue + 130, 60, 66, 0.06 + z * 0.1);
      ctx.stroke();
    }
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols - 0.5;
      ctx.beginPath();
      ctx.moveTo(w * (0.5 + u * 0.42), horizon);
      ctx.lineTo(w * (0.5 + u * 1.12), h * 0.99);
      ctx.strokeStyle = tone(c, hue + 175, 56, 68, 0.055);
      ctx.stroke();
    }

    // Back-to-front layers of columns create the illusion of a receding audio city.
    for (let row = 0; row < rows; row += 1) {
      const depth = row / (rows - 1);
      const scale = 0.24 + depth * 0.76;
      const baseY = horizon + Math.pow(depth, 1.72) * h * 0.65;
      const colPitch = (w * 0.94 * scale) / cols;
      const barWidth = Math.max(1.2, colPitch * 0.66);
      for (let col = 0; col < cols; col += 1) {
        const u = col / Math.max(1, cols - 1);
        const band = sample(f.bands, u);
        const before = sample(f.bands, Math.max(0, u - 1 / cols));
        const after = sample(f.bands, Math.min(1, u + 1 / cols));
        const filtered = (before + band * 2 + after) * 0.25;
        const smoothed = band + (filtered - band) * blend;
        const wave = Math.sin(t * 1.2 - u * 9 + depth * 4) * blend * 0.035;
        const echo = smoothed * (0.64 + depth * 0.36) + wave;
        const amplitude = Math.min(1, Math.max(0, echo * k));
        const height = Math.max(1.8, (h * 0.025 + amplitude * h * 0.29) * (0.35 + depth * 0.65));
        const x = w * 0.5 + (u - 0.5) * w * 0.94 * scale - barWidth * 0.5;
        const top = baseY - height;
        const shade = 0.14 + depth * 0.4 + amplitude * 0.34;
        const colHue = hue + 180 - u * 150 + depth * 16;

        const gradient = ctx.createLinearGradient(x, top, x, baseY);
        gradient.addColorStop(0, tone(c, colHue + 20, 90, 82, shade + amplitude * 0.1));
        gradient.addColorStop(0.26, tone(c, colHue, 86, 61, shade));
        gradient.addColorStop(1, tone(c, colHue - 24, 84, 34, shade * 0.48));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, top, barWidth, height);

        // Luminous top edge and tiny peak marker.
        ctx.fillStyle = tone(c, colHue + 10, 82, 83, 0.14 + amplitude * 0.6);
        ctx.fillRect(x, top, barWidth, Math.max(1, 1.4 * scale));
        const peak = f.peaks[Math.min(BAND_COUNT - 1, Math.floor(u * BAND_COUNT))] ?? 0;
        if (peak > 0.09 && depth > 0.42) {
          const peakY = baseY - (h * 0.025 + peak * k * h * 0.29) * (0.35 + depth * 0.65);
          ctx.fillStyle = tone(c, colHue + 28, 90, 88, 0.2 + peak * 0.5);
          ctx.fillRect(x, peakY - 1.2, barWidth, 1.2);
        }
      }
    }

    // Horizon line provides a crisp visual anchor.
    const horizonGradient = ctx.createLinearGradient(0, 0, w, 0);
    horizonGradient.addColorStop(0, tone(c, hue + 30, 80, 65, 0));
    horizonGradient.addColorStop(0.5, tone(c, hue + 190, 80, 80, 0.6));
    horizonGradient.addColorStop(1, tone(c, hue + 330, 80, 65, 0));
    ctx.beginPath();
    ctx.moveTo(w * 0.12, horizon);
    ctx.lineTo(w * 0.88, horizon);
    ctx.strokeStyle = horizonGradient;
    ctx.lineWidth = 1.25 + energy(c, f.beat) * 2;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },
};

// 3. SOFT HALO — one quiet, breathing light with a restrained bass response.
const waveformScene: Scene = {
  id: 'waveform',
  label: 'Soft Halo',
  description: 'A single luminous halo that breathes gently with the music.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const min = Math.min(w, h);
    const bass = energy(c, f.bass);
    const beat = energy(c, f.beat);
    const breath = 0.5 + Math.sin(t * 0.34) * 0.5;
    const cx = w * (0.5 + c.pointer.nx * 0.012);
    const cy = h * (0.49 + c.pointer.ny * 0.012);
    const radius = min * (0.12 + breath * 0.009 + bass * 0.025 + beat * 0.012);
    const outer = radius * 3.15;

    // Near-opaque wash avoids trails and keeps the visual intentionally clean.
    wash(c, 0.94);

    const atmosphere = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, outer);
    atmosphere.addColorStop(0, tone(c, hue + 18, 64, 74, 0.19 + bass * 0.09));
    atmosphere.addColorStop(0.28, tone(c, hue + 64, 58, 54, 0.10 + beat * 0.06));
    atmosphere.addColorStop(0.68, tone(c, hue + 120, 52, 38, 0.035));
    atmosphere.addColorStop(1, tone(c, hue + 160, 45, 26, 0));
    ctx.globalCompositeOperation = composite(c);
    ctx.fillStyle = atmosphere;
    ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);

    // A single soft disc gives the centre a little definition without visual clutter.
    const core = ctx.createRadialGradient(
      cx - radius * 0.22, cy - radius * 0.28, radius * 0.02,
      cx, cy, radius,
    );
    core.addColorStop(0, tone(c, hue + 28, 42, 96, 0.22 + bass * 0.12));
    core.addColorStop(0.42, tone(c, hue + 6, 66, 78, 0.12 + beat * 0.08));
    core.addColorStop(1, tone(c, hue + 80, 62, 55, 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();

    // One fine elliptical rim, nearly still when the track is quiet.
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius * (1.72 + bass * 0.08), radius * (0.68 + bass * 0.035), -0.12, 0, TAU);
    ctx.strokeStyle = tone(c, hue + 52, 54, 82, 0.13 + bass * 0.12 + beat * 0.08);
    ctx.lineWidth = 0.9 + beat * 0.75;
    ctx.stroke();
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

// 7. MOONLIGHT — a deliberate, cinematic visual for quieter listening.
const moonScene: Scene = {
  id: 'still',
  label: 'Moonlight',
  description: 'A quiet eclipse, drifting orbital dust and a restrained pulse of light.',
  draw(c) {
    const { ctx, width: w, height: h, time: t, frame: f, hue } = c;
    const k = c.reducedMotion ? 0.24 : c.reactivity * 0.34;
    wash(c, 1);
    const min = Math.min(w, h);
    const cx = w * (0.5 + Math.sin(t * 0.07) * 0.025 + c.pointer.nx * 0.035);
    const cy = h * (0.44 + Math.cos(t * 0.08) * 0.025 + c.pointer.ny * 0.025);
    const radius = min * (0.22 + f.level * k * 0.025 + f.beat * k * 0.02);

    // A barely visible atmospheric gradient gives the scene a cinematic depth.
    drawGlow(c, cx, cy, min * 0.76, hue + 30, 0.14 + f.level * k * 0.08);
    ctx.globalCompositeOperation = composite(c);

    // Long, elliptical orbital lines.
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * (1.7 + i * 0.52), radius * (0.48 + i * 0.13), -0.15 + i * 0.075, 0, TAU);
      ctx.strokeStyle = tone(c, hue + 42 + i * 26, 44, 74, 0.07 + (i === 1 ? f.level * 0.08 : 0));
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Moon body: a layered, softly lit disc with a clean eclipsed edge.
    const lunar = ctx.createRadialGradient(cx - radius * 0.34, cy - radius * 0.38, radius * 0.03, cx, cy, radius * 1.12);
    lunar.addColorStop(0, tone(c, hue + 32, 26, 94, 0.96));
    lunar.addColorStop(0.32, tone(c, hue + 18, 38, 78, 0.94));
    lunar.addColorStop(0.72, tone(c, hue + 72, 48, 43, 0.9));
    lunar.addColorStop(1, tone(c, hue + 120, 54, 20, 0.75));
    ctx.fillStyle = lunar;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();

    // A dark mask creates the eclipse crescent; its offset is subtly audio-reactive.
    const maskGradient = ctx.createRadialGradient(cx + radius * (0.46 + f.bass * k * 0.1), cy - radius * 0.1, radius * 0.06, cx + radius * 0.44, cy, radius * 1.04);
    maskGradient.addColorStop(0, `rgba(${c.palette.shadeRgb}, 0.96)`);
    maskGradient.addColorStop(0.72, `rgba(${c.palette.shadeRgb}, 0.88)`);
    maskGradient.addColorStop(1, `rgba(${c.palette.shadeRgb}, 0)`);
    ctx.fillStyle = maskGradient;
    ctx.beginPath();
    ctx.arc(cx + radius * (0.38 + f.bass * k * 0.08), cy - radius * 0.06, radius * 0.98, 0, TAU);
    ctx.fill();

    // The illuminated rim blooms on a bass hit.
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1.02 + f.beat * k * 0.035), -Math.PI * 0.78, Math.PI * 0.73);
    ctx.strokeStyle = tone(c, hue + 48, 62, 86, 0.28 + f.bass * k * 0.24 + f.beat * k * 0.28);
    ctx.lineWidth = 1.2 + f.beat * k * 1.8;
    ctx.stroke();

    // Sparse dust points; slower and quieter than the other scenes by design.
    for (let i = 0; i < 88; i += 1) {
      const angle = seeded(i, 9) * TAU + t * (0.008 + seeded(i, 10) * 0.015);
      const distance = min * (0.14 + seeded(i, 11) * 0.52);
      const x = cx + Math.cos(angle) * distance * (w / min);
      const y = cy + Math.sin(angle) * distance;
      const twinkle = 0.22 + (Math.sin(t * 0.35 + seeded(i, 12) * TAU) + 1) * 0.18;
      const size = 0.45 + seeded(i, 13) * 1.2;
      ctx.fillStyle = tone(c, hue + seeded(i, 14) * 80, 48, 82, twinkle + f.treble * 0.06);
      ctx.beginPath();
      ctx.arc(x, y, size, 0, TAU);
      ctx.fill();
    }

    // A soft, slow halo remains visible even with no signal.
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1.52 + f.pulse * k * 0.1), 0, TAU);
    ctx.strokeStyle = tone(c, hue + 90, 44, 72, 0.06 + f.level * k * 0.07);
    ctx.lineWidth = 1;
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
