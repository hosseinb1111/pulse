import { settings, type CursorStyle } from './settings';

const HOVER_TARGETS = 'a, button, input, select, label, [role="button"], .track-row-button';

/** The ring catches up to the pointer with a ~14 ms time constant: 95% of the way in about 42 ms. */
const RING_FOLLOW_RATE = 70;

/**
 * Custom pointer for mouse, trackpad and pen users.
 *
 * Invariants that keep it from jumping:
 *  - The only source of coordinates is a mouse/pen PointerEvent (clientX/clientY).
 *    Focus, blur, Tab, key presses and element geometry never produce a position.
 *  - Both layers are `position: fixed`, so viewport coordinates stay correct through
 *    scroll and resize without any layout reads.
 *  - The dot is written synchronously in the pointer event (no rAF delay). The ring is
 *    eased, but quickly enough to stay within the 50 ms budget.
 *  - Hover state is refreshed after scroll/resize on the next animation frame only, so a
 *    burst of scroll events costs one hit-test per frame.
 *  - Touch input hides the cursor, and a non-fine primary pointer detaches it completely.
 */
export function initCursor(): void {
  const ringEl = document.getElementById('cursor');
  const dotEl = document.getElementById('cursor-dot');
  if (!(ringEl instanceof HTMLElement) || !(dotEl instanceof HTMLElement)) return;
  const ring: HTMLElement = ringEl;
  const dot: HTMLElement = dotEl;

  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const body = document.body;
  const root = document.documentElement;

  let listeners: AbortController | null = null;
  let x = 0;
  let y = 0;
  let ringX = 0;
  let ringY = 0;
  let hasPointerPosition = false;
  let needsSnap = true;
  let frame = 0;
  let hoverFrame = 0;
  let lastTime = 0;

  const place = (element: HTMLElement, px: number, py: number): void => {
    // `translate` is the outermost transform property, so `scale` (press/hover) can only resize the
    // element around its centre and can never move it. Do not put the position in `transform`.
    element.style.translate = `${px.toFixed(2)}px ${py.toFixed(2)}px`;
  };

  const snap = (): void => {
    ringX = x;
    ringY = y;
    place(dot, x, y);
    place(ring, x, y);
  };

  const resetTransient = (): void => {
    body.classList.remove('cursor-hover', 'cursor-down');
  };

  const hide = (): void => {
    body.classList.add('cursor-away');
    resetTransient();
    needsSnap = true;
  };

  const setHoverFrom = (target: Element | null): void => {
    body.classList.toggle('cursor-hover', target?.closest(HOVER_TARGETS) != null);
  };

  const scheduleHoverRefresh = (): void => {
    if (hoverFrame !== 0 || !hasPointerPosition) return;
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = 0;
      if (listeners === null || body.classList.contains('cursor-away')) return;
      setHoverFrom(document.elementFromPoint(x, y));
    });
  };

  const tick = (time: number): void => {
    frame = 0;
    if (listeners === null) return;

    const dt = lastTime === 0 ? 1 / 60 : Math.min(0.05, Math.max(0.001, (time - lastTime) / 1000));
    lastTime = time;
    const follow = reduced.matches ? 1 : 1 - Math.exp(-dt * RING_FOLLOW_RATE);
    ringX += (x - ringX) * follow;
    ringY += (y - ringY) * follow;

    if (Math.abs(x - ringX) < 0.1 && Math.abs(y - ringY) < 0.1) {
      ringX = x;
      ringY = y;
      place(ring, ringX, ringY);
      lastTime = 0;
      return;
    }
    place(ring, ringX, ringY);
    frame = window.requestAnimationFrame(tick);
  };

  const wake = (): void => {
    if (frame === 0 && listeners !== null) frame = window.requestAnimationFrame(tick);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      hide();
      return;
    }
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;

    x = event.clientX;
    y = event.clientY;
    hasPointerPosition = true;

    if (needsSnap || body.classList.contains('cursor-away')) {
      // First real pointer sample after attach, tab switch, touch or window exit:
      // jump straight to the hardware pointer instead of easing from a stale spot.
      needsSnap = false;
      snap();
      body.classList.remove('cursor-away');
      setHoverFrom(event.target instanceof Element ? event.target : null);
      return;
    }

    place(dot, x, y);
    wake();
    setHoverFrom(event.target instanceof Element ? event.target : null);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      hide();
      return;
    }
    // Any button: re-lock to the hardware position carried by the event itself.
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      x = event.clientX;
      y = event.clientY;
      hasPointerPosition = true;
      if (needsSnap || body.classList.contains('cursor-away')) {
        needsSnap = false;
        snap();
        body.classList.remove('cursor-away');
      } else {
        place(dot, x, y);
        wake();
      }
    }
    body.classList.add('cursor-down');
  };

  const onPointerUp = (): void => body.classList.remove('cursor-down');

  // Right-click opens the context menu, which swallows the matching pointerup. Release the pressed
  // state here, and keep the cursor on the position the event reports.
  const onContextMenu = (event: MouseEvent): void => {
    body.classList.remove('cursor-down');
    if (hasPointerPosition && !body.classList.contains('cursor-away')) {
      x = event.clientX;
      y = event.clientY;
      place(dot, x, y);
      wake();
    }
  };

  // Window focus changes can swallow the matching pointerup, which would leave the ring squashed.
  // They never touch the position.
  const onWindowBlur = (): void => resetTransient();

  const onVisibility = (): void => {
    lastTime = 0;
    hide();
  };

  const onViewportChange = (): void => {
    if (listeners === null || !hasPointerPosition) return;
    // Resizing can leave the cached point outside the new viewport.
    if (x > window.innerWidth || y > window.innerHeight) {
      hide();
      return;
    }
    scheduleHoverRefresh();
  };

  const applyStyle = (style: CursorStyle): void => {
    root.dataset.cursor = style;
    if (fine.matches && style !== 'native') attach();
    else detach();
  };

  function attach(): void {
    if (listeners !== null) return;
    const controller = new AbortController();
    const options = { passive: true, signal: controller.signal } as const;
    listeners = controller;
    needsSnap = true;
    body.classList.add('custom-cursor', 'cursor-away');

    window.addEventListener('pointermove', onPointerMove, options);
    // Chromium delivers un-throttled samples here, which shaves up to a frame off the dot's latency.
    if ('onpointerrawupdate' in window) {
      window.addEventListener('pointerrawupdate' as 'pointermove', onPointerMove, options);
    }
    window.addEventListener('pointerdown', onPointerDown, options);
    window.addEventListener('pointerup', onPointerUp, options);
    window.addEventListener('pointercancel', onPointerUp, options);
    window.addEventListener('mouseup', onPointerUp, options);
    window.addEventListener('auxclick', onPointerUp, options);
    window.addEventListener('contextmenu', onContextMenu, options);
    window.addEventListener('dragend', onPointerUp, options);
    window.addEventListener('blur', onWindowBlur, options);
    window.addEventListener('resize', onViewportChange, options);
    window.addEventListener('scroll', onViewportChange, { ...options, capture: true });
    window.visualViewport?.addEventListener('resize', onViewportChange, options);
    document.addEventListener('visibilitychange', onVisibility, { signal: controller.signal });
    // mouseleave on the root fires only when the pointer really leaves the window,
    // not when focus or the element under the pointer changes.
    root.addEventListener('mouseleave', hide, options);
  }

  function detach(): void {
    body.classList.remove('custom-cursor', 'cursor-hover', 'cursor-down', 'cursor-away');
    if (listeners === null) return;
    listeners.abort();
    listeners = null;
    window.cancelAnimationFrame(frame);
    window.cancelAnimationFrame(hoverFrame);
    frame = 0;
    hoverFrame = 0;
    lastTime = 0;
    hasPointerPosition = false;
    needsSnap = true;
    ring.style.translate = '';
    dot.style.translate = '';
  }

  applyStyle(settings.get().cursor);
  settings.subscribe((next) => applyStyle(next.cursor));
  fine.addEventListener('change', () => applyStyle(settings.get().cursor));
}
