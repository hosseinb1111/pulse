export interface PersistedPlayback {
  trackName: string;
  position: number;
}

const VOLUME_KEY = 'pulse:volume:v1';
const PLAYBACK_KEY = 'pulse:last-playback:v1';

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadVolume(fallback = 0.75): number {
  const storage = getStorage();
  if (!storage) return fallback;

  try {
    const value = Number(storage.getItem(VOLUME_KEY));
    return Number.isFinite(value) && storage.getItem(VOLUME_KEY) !== null
      ? Math.min(1, Math.max(0, value))
      : fallback;
  } catch {
    return fallback;
  }
}

export function saveVolume(volume: number): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(VOLUME_KEY, String(Math.min(1, Math.max(0, volume))));
  } catch {
    // Storage may be unavailable in private or restricted webviews.
  }
}

export function loadLastPlayback(): PersistedPlayback | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(PLAYBACK_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'trackName' in parsed &&
      'position' in parsed &&
      typeof parsed.trackName === 'string' &&
      typeof parsed.position === 'number' &&
      Number.isFinite(parsed.position) &&
      parsed.position >= 0
    ) {
      return { trackName: parsed.trackName, position: parsed.position };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastPlayback(trackName: string, position: number): void {
  const storage = getStorage();
  if (!storage || !trackName.trim() || !Number.isFinite(position)) return;

  try {
    storage.setItem(
      PLAYBACK_KEY,
      JSON.stringify({ trackName, position: Math.max(0, position) } satisfies PersistedPlayback),
    );
  } catch {
    // Storage may be unavailable in private or restricted webviews.
  }
}
