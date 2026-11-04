export interface Track {
  id: string;
  name: string;
  file: File;
  duration: number | null;
}

export type TrackSelectHandler = (trackId: string) => void;

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

  constructor(selectHandler: TrackSelectHandler) {
    this.list = requiredElement<HTMLOListElement>('track-list');
    this.emptyState = requiredElement<HTMLElement>('playlist-empty');
    this.summary = requiredElement<HTMLElement>('playlist-summary');
    this.libraryCount = requiredElement<HTMLElement>('library-count');
    this.queueCount = requiredElement<HTMLElement>('queue-count');
    this.panel = requiredElement<HTMLElement>('playlist-panel');
    this.backdrop = requiredElement<HTMLElement>('panel-backdrop');
    this.toggleButton = requiredElement<HTMLButtonElement>('playlist-toggle');
    this.selectHandler = selectHandler;

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
      item.append(button);
      fragment.append(item);
    });
    this.list.append(fragment);
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
