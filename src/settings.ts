export const THEME_IDS = ['aurora', 'ember', 'forest', 'ocean', 'sunset', 'sakura', 'pulse', 'mono'] as const;
export const MODE_IDS = ['system', 'dark', 'light'] as const;
export const SCENE_IDS = ['bloom', 'spectrum', 'waveform', 'particles', 'rings', 'aurora', 'still'] as const;
export const CURSOR_IDS = ['dot', 'ring', 'halo', 'native'] as const;
export const CHARACTER_VIBES = ['auto', 'ambient', 'lofi', 'funk', 'pop', 'rock', 'classical', 'electronic'] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ModeSetting = (typeof MODE_IDS)[number];
export type SceneId = (typeof SCENE_IDS)[number];
export type CursorStyle = (typeof CURSOR_IDS)[number];
export type CharacterVibe = (typeof CHARACTER_VIBES)[number];

export type Settings = {
  theme: ThemeId;
  mode: ModeSetting;
  scene: SceneId;
  /** Master multiplier applied to every audio-reactive scene. */
  reactivity: number;
  /** Amount of spatial smoothing and traveling energy flow in Frequency Grid. */
  spectrumBlend: number;
  /** Relative number of Frequency Grid columns, clamped to a performance-safe range. */
  spectrumDensity: number;
  cursor: CursorStyle;
  /** Automatic audio-energy movement profile or a user-selected musical movement preset. */
  characterVibe: CharacterVibe;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'aurora',
  mode: 'system',
  scene: 'bloom',
  reactivity: 1,
  spectrumBlend: 0.58,
  spectrumDensity: 1,
  cursor: 'ring',
  characterVibe: 'auto',
};

export const REACTIVITY_MIN = 0.5;
export const REACTIVITY_MAX = 2;
export const SPECTRUM_BLEND_MIN = 0;
export const SPECTRUM_BLEND_MAX = 1;
export const SPECTRUM_DENSITY_MIN = 0.7;
export const SPECTRUM_DENSITY_MAX = 1.35;

const STORAGE_KEY = 'pulse:settings:v2';

type SettingsListener = (settings: Readonly<Settings>) => void;

class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<SettingsListener>();

  constructor() {
    this.current = readStored();
  }

  get(): Readonly<Settings> {
    return this.current;
  }

  update(patch: Partial<Settings>): void {
    const next = sanitize({ ...this.current, ...patch });
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    writeStored(next);
    for (const listener of this.listeners) listener(next);
  }

  reset(): void {
    this.update({ ...DEFAULT_SETTINGS });
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const settings = new SettingsStore();

/** Accepts any input and returns a fully valid settings object. */
export function sanitize(input: Partial<Record<keyof Settings, unknown>>): Settings {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;

  const rawReactivity = typeof input.reactivity === 'number' && Number.isFinite(input.reactivity)
    ? input.reactivity
    : DEFAULT_SETTINGS.reactivity;
  const clamped = Math.min(REACTIVITY_MAX, Math.max(REACTIVITY_MIN, rawReactivity));
  const rawBlend = typeof input.spectrumBlend === 'number' && Number.isFinite(input.spectrumBlend)
    ? input.spectrumBlend : DEFAULT_SETTINGS.spectrumBlend;
  const rawDensity = typeof input.spectrumDensity === 'number' && Number.isFinite(input.spectrumDensity)
    ? input.spectrumDensity : DEFAULT_SETTINGS.spectrumDensity;

  return {
    theme: pick(input.theme, THEME_IDS, DEFAULT_SETTINGS.theme),
    mode: pick(input.mode, MODE_IDS, DEFAULT_SETTINGS.mode),
    scene: pick(input.scene, SCENE_IDS, DEFAULT_SETTINGS.scene),
    reactivity: Math.round(clamped * 20) / 20,
    spectrumBlend: Math.round(Math.min(SPECTRUM_BLEND_MAX, Math.max(SPECTRUM_BLEND_MIN, rawBlend)) * 100) / 100,
    spectrumDensity: Math.round(Math.min(SPECTRUM_DENSITY_MAX, Math.max(SPECTRUM_DENSITY_MIN, rawDensity)) * 100) / 100,
    cursor: pick(input.cursor, CURSOR_IDS, DEFAULT_SETTINGS.cursor),
    characterVibe: pick(input.characterVibe, CHARACTER_VIBES, DEFAULT_SETTINGS.characterVibe),
  };
}

function readStored(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    return sanitize(
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Partial<Record<keyof Settings, unknown>>)
        : {},
    );
  } catch {
    // Storage can be blocked in restricted webviews; fall back to defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

function writeStored(value: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Settings still apply for this session when storage is unavailable.
  }
}
