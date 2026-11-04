export interface Track {
  id: string;
  name: string;
  file: File;
  duration: number | null;
}

export type TrackSelectHandler = (trackId: string) => void;
export type TrackReorderHandler = (orderedIds: string[]) => void;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function createTrackName(filename: string): string {
  const normalized = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const decoded = safeDecodeURIComponent(normalized);
  const withoutExtension = decoded.replace(/\.(mp3|wav|flac|ogg|m4a|aac)$/i, '');
  return withoutExtension.trim() || 'Untitled track';
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class PlaylistView {
  private readonly list: HTMLOListElement;
  private readonly emptyState: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly libraryCount: HTMLElement;
  private readonly queueCount: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly selectHandler: TrackSelectHandler;
  private readonly reorderHandler: TrackReorderHandler;
  private dragging: { row: HTMLElement; pointerId: number } | null = null;
  private lastRender: { tracks: readonly Track[]; activeTrackId: string | null } | null = null;
  private pendingRender: { tracks: readonly Track[]; activeTrackId: string | null } | null = null;

  constructor(selectHandler: TrackSelectHandler, reorderHandler: TrackReorderHandler) {
    this.list = requiredElement<HTMLOListElement>('track-list');
    this.emptyState = requiredElement<HTMLElement>('playlist-empty');
    this.summary = requiredElement<HTMLElement>('playlist-summary');
    this.libraryCount = requiredElement<HTMLElement>('library-count');
    this.queueCount = requiredElement<HTMLElement>('queue-count');
    this.panel = requiredElement<HTMLElement>('playlist-panel');
    this.backdrop = requiredElement<HTMLElement>('panel-backdrop');
    this.toggleButton = requiredElement<HTMLButtonElement>('playlist-toggle');
    this.selectHandler = selectHandler;
    this.reorderHandler = reorderHandler;

    this.list.addEventListener('pointerdown', (event: PointerEvent) => this.startDrag(event));
    this.list.addEventListener('pointermove', (event: PointerEvent) => this.moveDrag(event));
    this.list.addEventListener('pointerup', (event: PointerEvent) => this.endDrag(event, true));
    this.list.addEventListener('pointercancel', (event: PointerEvent) => this.endDrag(event, false));
    this.list.addEventListener('keydown', (event: KeyboardEvent) => this.handleHandleKey(event));

    this.list.addEventListener('click', (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('[data-track-id]');
      if (!button) return;
      this.selectHandler(button.dataset.trackId ?? '');
    });

    this.toggleButton.addEventListener('click', () => this.setOpen(!this.isOpen()));
    requiredElement<HTMLButtonElement>('close-playlist-button').addEventListener('click', () => this.setOpen(false));
    this.backdrop.addEventListener('click', () => this.setOpen(false));
  }

  render(tracks: readonly Track[], activeTrackId: string | null): void {
    // Re-rendering mid-drag would destroy the row being moved; apply it once the drag ends.
    if (this.dragging) {
      this.pendingRender = { tracks, activeTrackId };
      return;
    }
    this.lastRender = { tracks, activeTrackId };
    this.list.replaceChildren();
    this.emptyState.hidden = tracks.length > 0;
    this.list.hidden = tracks.length === 0;

    const count = tracks.length;
    const countLabel = `${count} ${count === 1 ? 'track' : 'tracks'}`;
    this.libraryCount.textContent = countLabel;
    this.queueCount.textContent = String(count);
    this.summary.textContent = count === 0 ? 'No tracks added' : `${countLabel} in your library`;

    const fragment = document.createDocumentFragment();
    tracks.forEach((track, index) => {
      const item = document.createElement('li');
      item.className = `track-row${track.id === activeTrackId ? ' is-active' : ''}`;
      item.dataset.rowId = track.id;

      const handle = document.createElement('button');
      handle.className = 'track-drag-handle';
      handle.type = 'button';
      handle.dataset.dragHandle = track.id;
      handle.setAttribute('aria-label', `Reorder ${track.name}. Drag, or use the up and down arrow keys.`);
      handle.title = 'Drag to reorder';
      handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';

      const button = document.createElement('button');
      button.className = 'track-row-button';
      button.type = 'button';
      button.dataset.trackId = track.id;
      button.setAttribute('aria-label', `Play ${track.name}`);
      button.setAttribute('aria-current', track.id === activeTrackId ? 'true' : 'false');

      const number = document.createElement('span');
      number.className = 'track-index';
      number.textContent = track.id === activeTrackId ? '♫' : String(index + 1).padStart(2, '0');

      const info = document.createElement('span');
      info.className = 'track-row-info';
      const name = document.createElement('span');
      name.className = 'track-row-name';
      name.textContent = track.name;
      const meta = document.createElement('span');
      meta.className = 'track-row-meta';
      meta.textContent = track.file.name || 'Local audio';
      info.append(name, meta);

      const duration = document.createElement('span');
      duration.className = 'track-duration';
      duration.textContent = track.duration === null ? '—:—' : formatTime(track.duration);

      const playIndicator = document.createElement('span');
      playIndicator.className = 'track-play-indicator';
      playIndicator.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z" /></svg>';
      button.append(number, info, duration, playIndicator);
      item.append(handle, button);
      fragment.append(item);
    });
    this.list.append(fragment);
  }

  private rowIds(): string[] {
    return Array.from(this.list.children).map((child) => (child as HTMLElement).dataset.rowId ?? '').filter(Boolean);
  }

  private startDrag(event: PointerEvent): void {
    if (this.dragging || event.button > 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const handle = target.closest<HTMLElement>('[data-drag-handle]');
    const row = handle?.closest<HTMLElement>('.track-row');
    if (!handle || !row) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    this.dragging = { row, pointerId: event.pointerId };
    row.classList.add('is-dragging');
    this.list.classList.add('is-reordering');
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.dragging;
    if (!drag || event.pointerId !== drag.pointerId) return;

    // Keep the list scrolling when the pointer nears its top or bottom edge.
    const bounds = this.list.getBoundingClientRect();
    if (event.clientY < bounds.top + 32) this.list.scrollTop -= 12;
    else if (event.clientY > bounds.bottom - 32) this.list.scrollTop += 12;

    const siblings = Array.from(this.list.children).filter((child) => child !== drag.row) as HTMLElement[];
    const next = siblings.find((sibling) => {
      const box = sibling.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    if (next) {
      if (drag.row.nextElementSibling !== next) this.list.insertBefore(drag.row, next);
    } else if (this.list.lastElementChild !== drag.row) {
      this.list.append(drag.row);
    }
  }

  private endDrag(event: PointerEvent, commit: boolean): void {
    const drag = this.dragging;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.dragging = null;
    drag.row.classList.remove('is-dragging');
    this.list.classList.remove('is-reordering');

    const pending = this.pendingRender;
    this.pendingRender = null;
    if (commit) this.reorderHandler(this.rowIds());
    // A cancelled drag, or a render queued during the drag, must redraw from the source of truth.
    if (!commit) {
      const latest = pending ?? this.lastRender;
      if (latest) this.render(latest.tracks, latest.activeTrackId);
    }
  }

  private handleHandleKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const handle = target.closest<HTMLElement>('[data-drag-handle]');
    const row = handle?.closest<HTMLElement>('.track-row');
    if (!handle || !row) return;
    event.preventDefault();
    const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (event.key === 'ArrowUp') this.list.insertBefore(row, sibling);
    else this.list.insertBefore(sibling, row);
    handle.focus();
    this.reorderHandler(this.rowIds());
  }

  setOpen(open: boolean): void {
    this.panel.classList.toggle('is-open', open);
    this.backdrop.classList.toggle('is-visible', open);
    this.panel.setAttribute('aria-hidden', String(!open));
    this.toggleButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('playlist-open', open);
  }

  isOpen(): boolean {
    return this.panel.classList.contains('is-open');
  }
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required interface element #${id} was not found.`);
  return element as T;
}
