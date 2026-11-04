import type { AudioFrame } from './analysis';
import type { PointerState } from './pointer';
import type { ResolvedPalette } from './themes';

interface Ripple {
  x: number;
  y: number;
  born: number;
  power: number;
  life: number;
}

interface TrailPoint {
  x: number;
  y: number;
  born: number;
}

export interface LayerContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  frame: AudioFrame;
  palette: ResolvedPalette;
  hue: number;
  strength: number;
  pointer: PointerState;
  reducedMotion: boolean;
}

const MAX_RIPPLES = 24;
const TRAIL_LIFE = 0.55;
const MAX_TRAIL = 36;

/**
 * A pointer-driven layer drawn over every scene, so the background responds to the mouse
 * whichever scene is selected: a glow under the cursor that swells with the music, a short
 * comet trail, ripples on every click or Tab focus move, and extra ripples on each beat while
 * the button is held ("conducting").
 */
export class PointerLayer {
  private readonly ripples: Ripple[] = [];
  private readonly trail: TrailPoint[] = [];
  private lastBeatRipple = -10;
  private lastTrailTime = -10;

  clear(): void {
    this.ripples.length = 0;
    this.trail.length = 0;
  }

  draw(c: LayerContext): void {
    const { ctx, time: t, frame: f, pointer: p } = c;
    const k = c.strength;
    const light = c.palette.isLight;
    const colorAt = (hueShift: number, lightness: number, alpha: number): string => {
      const s = Math.min(100, 75 * c.palette.chroma);
      const l = light ? Math.min(60, lightness * 0.55 + 12) : lightness;
      return `hsla(${(((c.hue + hueShift) % 360) + 360) % 360}, ${s}%, ${l}%, ${Math.max(0, Math.min(1, alpha))})`;
    };

    for (const click of p.clicks) {
      this.add(click.x, click.y, t, click.power * (click.kind === 'focus' ? 0.6 : 1) * Math.min(1.4, 0.7 + f.level * 0.8));
    }
    if (p.active && p.down && f.beat > 0.95 && t - this.lastBeatRipple > 0.16) {
      this.lastBeatRipple = t;
      this.add(p.x, p.y, t, 0.5 + f.bass * 0.5);
    }
    if (p.active && p.energy > 0.04 && t - this.lastTrailTime > 0.016) {
      this.lastTrailTime = t;
      this.trail.push({ x: p.x, y: p.y, born: t });
      if (this.trail.length > MAX_TRAIL) this.trail.shift();
    }
    while (this.trail.length > 0 && t - this.trail[0]!.born > TRAIL_LIFE) this.trail.shift();
    while (this.ripples.length > 0 && t - this.ripples[0]!.born > this.ripples[0]!.life) this.ripples.shift();

    if (this.ripples.length === 0 && this.trail.length === 0 && !p.active) return;

    ctx.save();
    ctx.globalCompositeOperation = light ? 'multiply' : 'lighter';

    if (p.active) {
      const min = Math.min(c.width, c.height);
      const radius = (90 + f.level * 120 * k + f.beat * 70 * k + (p.down ? 50 : 0)) * (min / 900 + 0.35);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      const a = (0.1 + p.energy * 0.12 + f.pulse * 0.1 * k + (p.down ? 0.08 : 0)) * (c.reducedMotion ? 0.6 : 1);
      g.addColorStop(0, colorAt(0, 66, a));
      g.addColorStop(0.45, colorAt(40, 58, a * 0.4));
      g.addColorStop(1, colorAt(80, 50, 0));
      ctx.fillStyle = g;
      ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
    }

    if (this.trail.length > 1 && !c.reducedMotion) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < this.trail.length; i += 1) {
        const a = this.trail[i - 1]!;
        const b = this.trail[i]!;
        const life = 1 - (t - b.born) / TRAIL_LIFE;
        if (life <= 0) continue;
        ctx.strokeStyle = colorAt(i * 3, 68, life * life * 0.5);
        ctx.lineWidth = 1 + life * (2.5 + f.level * 3 * k);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    for (const r of this.ripples) {
      const age = (t - r.born) / r.life;
      const ease = 1 - Math.pow(1 - age, 2.4);
      const radius = (24 + ease * (150 + r.power * 230)) * (0.8 + Math.min(1, c.width / 1400) * 0.4);
      const alpha = Math.pow(1 - age, 1.6) * (0.55 + r.power * 0.35);
      ctx.strokeStyle = colorAt(0, 70, alpha);
      ctx.lineWidth = 1.5 + (1 - age) * 3.5 * r.power;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (age < 0.6) {
        ctx.strokeStyle = colorAt(70, 62, alpha * 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private add(x: number, y: number, time: number, power: number): void {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    const p = Math.min(1.2, Math.max(0.2, power));
    this.ripples.push({ x, y, born: time, power: p, life: 0.8 + p * 0.5 });
  }
}
