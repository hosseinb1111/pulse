/** Pointer and keyboard input for the background, in canvas (= viewport) pixels. */

export interface BackgroundClick {
  x: number;
  y: number;
  /** 0..1. Keyboard focus moves are weaker than real clicks. */
  power: number;
  kind: 'click' | 'focus';
}

export interface PointerState {
  x: number;
  y: number;
  /** Smoothed velocity, px/s. */
  vx: number;
  vy: number;
  /** Smoothed position as -0.5..0.5 of the viewport, for parallax. */
  nx: number;
  ny: number;
  /** True while a mouse/pen is over the page (or a finger is down). */
  active: boolean;
  down: boolean;
  /** How fast the pointer is moving, 0..1. */
  energy: number;
  /** Clicks since the last frame. Cleared by `endFrame`. */
  clicks: readonly BackgroundClick[];
}

const NO_CLICKS: readonly BackgroundClick[] = [];
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"]';

/**
 * Collects pointer, click, keyboard-focus and tab-visibility events for the background.
 * It owns no drawing; the visualizer reads `state` every frame.
 */
export class BackgroundInput {
  readonly state: PointerState = {
    x: 0, y: 0, vx: 0, vy: 0, nx: 0, ny: 0, active: false, down: false, energy: 0, clicks: [],
  };

  private readonly pending: BackgroundClick[] = [];
  private readonly abort = new AbortController();
  private lastX = 0;
  private lastY = 0;
  private hasSample = false;
  private keyboardMode = false;

  constructor() {
    const o = { passive: true, signal: this.abort.signal } as const;
    window.addEventListener('pointermove', this.onMove, o);
    window.addEventListener('pointerdown', this.onDown, o);
    window.addEventListener('pointerup', this.onUp, o);
    window.addEventListener('pointercancel', this.onUp, o);
    window.addEventListener('blur', this.reset, o);
    window.addEventListener('pagehide', this.reset, o);
    document.documentElement.addEventListener('mouseleave', this.leave, o);
    // Moving focus with Tab sends a soft ripple from the newly focused control.
    window.addEventListener('keydown', this.onKey, { capture: true, signal: this.abort.signal });
    window.addEventListener('focusin', this.onFocusIn, o);
  }

  dispose(): void {
    this.abort.abort();
  }

  /** Forget the pointer, e.g. when the tab is hidden or the window loses focus. */
  readonly reset = (): void => {
    const s = this.state;
    s.active = false;
    s.down = false;
    s.vx = 0;
    s.vy = 0;
    s.energy = 0;
    this.hasSample = false;
    this.pending.length = 0;
  };

  /** Smooths velocity and parallax. Call once per frame, before scenes draw. */
  update(dt: number, width: number, height: number): void {
    const s = this.state;
    const follow = 1 - Math.exp(-dt * 6);
    const tx = s.active ? s.x / Math.max(1, width) - 0.5 : 0;
    const ty = s.active ? s.y / Math.max(1, height) - 0.5 : 0;
    s.nx += (tx - s.nx) * follow;
    s.ny += (ty - s.ny) * follow;
    const speed = Math.hypot(s.vx, s.vy);
    const target = Math.min(1, speed / 1400);
    s.energy += (target - s.energy) * (1 - Math.exp(-dt * (target > s.energy ? 18 : 4)));
    // Velocity decays when no move events arrive (the pointer stopped).
    s.vx *= Math.exp(-dt * 9);
    s.vy *= Math.exp(-dt * 9);
    s.clicks = this.pending.length > 0 ? this.pending.slice() : NO_CLICKS;
  }

  /** Drops the clicks that scenes have just seen. */
  endFrame(): void {
    this.pending.length = 0;
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' && !this.state.down) return;
    const s = this.state;
    if (this.hasSample) {
      const dtMs = Math.max(1, event.timeStamp - this.lastTime);
      const k = 0.35;
      s.vx += ((event.clientX - this.lastX) / dtMs * 1000 - s.vx) * k;
      s.vy += ((event.clientY - this.lastY) / dtMs * 1000 - s.vy) * k;
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastTime = event.timeStamp;
    this.hasSample = true;
    s.x = event.clientX;
    s.y = event.clientY;
    s.active = true;
    this.keyboardMode = false;
  };

  private lastTime = 0;

  private readonly onDown = (event: PointerEvent): void => {
    const s = this.state;
    s.x = event.clientX;
    s.y = event.clientY;
    s.active = true;
    s.down = true;
    this.keyboardMode = false;
    // Clicks on controls still ripple, just a little softer, so the UI never feels dead.
    const onControl = event.target instanceof Element && event.target.closest(INTERACTIVE) !== null;
    this.push({ x: event.clientX, y: event.clientY, power: onControl ? 0.55 : 1, kind: 'click' });
  };

  private readonly onUp = (event: PointerEvent): void => {
    this.state.down = false;
    if (event.pointerType === 'touch') this.state.active = false;
  };

  private readonly leave = (): void => {
    this.state.active = false;
    this.state.down = false;
    this.hasSample = false;
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') this.keyboardMode = true;
  };

  private readonly onFocusIn = (event: FocusEvent): void => {
    if (!this.keyboardMode || !(event.target instanceof Element)) return;
    const rect = event.target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    this.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, power: 0.5, kind: 'focus' });
  };

  private push(click: BackgroundClick): void {
    if (this.pending.length < 8) this.pending.push(click);
  }
}
