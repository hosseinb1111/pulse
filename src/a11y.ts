/**
 * Keeps Tab / Shift+Tab focus cycling inside `container`. Call from a keydown
 * listener attached to the container itself (the panel). No-ops for any key
 * other than Tab, so it composes with Esc / shortcut handlers elsewhere.
 */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = getFocusable(container);
  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && container.contains(active);

  if (event.shiftKey) {
    if (active === first || !inside) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !inside) {
    event.preventDefault();
    first.focus();
  }
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
    .filter((el) => el.getAttribute('aria-hidden') !== 'true');
}