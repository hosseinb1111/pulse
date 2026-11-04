import { AudioAnalysis, type AudioFrame } from './analysis';
import { settings } from './settings';
import { SCENES, type Scene, type SceneContext } from './scenes';
import { BackgroundInput } from './pointer';
import { PointerLayer } from './pointer-layer';
import { currentPalette, updateBeatTheme } from './themes';

type FrameListener = (frame: AudioFrame) => void;

/**
 * Owns the background canvas: sizes it for the screen, reads audio every frame,
 * and hands the result to whichever scene is selected in settings.
 */
export class Visualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private analysis: AudioAnalysis;
  private readonly reducedMotion: boolean;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly unsubscribe: () => void;
  private scene: Scene;
  private frameId = 0;
  private width = 1;
  private height = 1;
  private lastTimestamp = 0;
  private elapsed = 0;
  /** Degrees of slow hue drift, swung around the theme's base hue. */
  private drift = 0;
  private disposed = false;
  private readonly input = new BackgroundInput();
  private readonly pointerLayer = new PointerLayer();

  constructor(canvas: HTMLCanvasElement, analyser: AnalyserNode) {
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D is not available on this device.');

    this.canvas = canvas;
    this.ctx = ctx;
    this.analysis = new AudioAnalysis(analyser);
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.scene = SCENES[settings.get().scene];
    this.scene.enter?.();

    this.unsubscribe = settings.subscribe((next) => this.setScene(next.scene));
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.resize();
    this.frameId = window.requestAnimationFrame(this.draw);
  }

  /** Switches the live source without rebuilding the canvas renderer. */
  setAnalyser(analyser: AnalyserNode): void {
    this.analysis = new AudioAnalysis(analyser);
  }

  /** Registers a callback that receives the audio frame after each draw. */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  setScene(id: string): void {
    const next = SCENES[id as keyof typeof SCENES];
    if (!next || next === this.scene) return;
    this.scene = next;
    next.enter?.();
  }

  dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.unsubscribe();
    this.input.dispose();
    this.frameListeners.clear();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private readonly resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width || window.innerWidth);
    this.height = Math.max(1, rect.height || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // Stop drawing while the tab is hidden, and pick the loop back up when it returns.
  // On return the background starts clean: no stale pointer, no half-faded ripples, no huge first dt.
  private readonly onVisibility = (): void => {
    if (this.disposed) return;
    this.input.reset();
    this.pointerLayer.clear();
    if (document.hidden) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = 0;
      this.lastTimestamp = 0;
    } else if (this.frameId === 0) {
      this.lastTimestamp = 0;
      this.frameId = window.requestAnimationFrame(this.draw);
    }
  };

  private readonly draw = (timestamp: number): void => {
    if (this.disposed) return;

    const dt = this.lastTimestamp === 0
      ? 1 / 60
      : Math.min(0.05, Math.max(0.001, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    this.elapsed += dt;

    const s = settings.get();
    const frame = this.analysis.update(dt);
    const palette = currentPalette();

    // Idle drift is slow; audio speeds it up with treble, as the original did.
    const driftRate = frame.active
      ? 0.1 + frame.treble * 1.9
      : this.reducedMotion ? 0.018 : 0.055;
    this.drift += driftRate * dt * 60;

    const beatHue = updateBeatTheme(frame, dt, this.elapsed, this.reducedMotion);
    this.input.update(dt, this.width, this.height);

    const context: SceneContext = {
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      time: this.elapsed,
      dt,
      frame,
      palette,
      hue: palette.hue + Math.sin((this.drift * Math.PI) / 180) * 50 + beatHue,
      reactivity: s.reactivity,
      spectrumBlend: s.spectrumBlend,
      spectrumDensity: s.spectrumDensity,
      reducedMotion: this.reducedMotion,
      pointer: this.input.state,
    };

    this.scene.draw(context);
    this.pointerLayer.draw({
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      time: this.elapsed,
      frame,
      palette,
      hue: context.hue,
      strength: s.reactivity * (this.reducedMotion ? 0.5 : 1),
      pointer: this.input.state,
      reducedMotion: this.reducedMotion,
    });
    this.input.endFrame();
    for (const listener of this.frameListeners) listener(frame);

    this.frameId = window.requestAnimationFrame(this.draw);
  };
}
