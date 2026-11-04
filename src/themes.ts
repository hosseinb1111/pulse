import type { AudioFrame } from './analysis';
import { settings, type ModeSetting, type Settings, type ThemeId } from './settings';

export interface Palette {
  bg: string;
  surface: string;
  surfaceStrong: string;
  text: string;
  muted: string;
  mutedSoft: string;
  line: string;
  lineStrong: string;
  /** "r, g, b" of the background, used for canvas trails and shading. */
  shadeRgb: string;
  danger: string;
  success: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  accent2: string;
  /** Base hue the visualizer drifts around. */
  hue: number;
  /** 0 = greyscale, 1 = full colour. */
  chroma: number;
}

export interface ResolvedPalette extends Palette {
  mode: 'dark' | 'light';
  isLight: boolean;
  themeId: ThemeId;
}

type Accents = Pick<Palette, 'accent' | 'accentStrong' | 'accentInk' | 'accent2' | 'hue' | 'chroma'>;

type Neutrals = Omit<Palette, keyof Accents>;

interface ThemeDef {
  name: string;
  dark: Accents;
  light: Accents;
  /** Optional tint for the neutral surfaces, so a theme can colour the whole app and not just its accents. */
  tint?: { dark?: Partial<Neutrals>; light?: Partial<Neutrals> };
  /** The accent colour follows the music (see updateBeatTheme). */
  beat?: boolean;
}

const NEUTRALS: Record<'dark' | 'light', Neutrals> = {
  dark: {
    bg: '#070912',
    surface: 'rgba(15, 19, 35, 0.72)',
    surfaceStrong: 'rgba(16, 21, 39, 0.96)',
    text: '#f4f6ff',
    muted: '#939ab4',
    mutedSoft: '#7a82a0',
    line: 'rgba(201, 214, 255, 0.12)',
    lineStrong: 'rgba(201, 214, 255, 0.2)',
    shadeRgb: '7, 9, 18',
    danger: '#ff8b9c',
    success: '#75e5c0',
  },
  light: {
    bg: '#f5f4f1',
    surface: 'rgba(255, 255, 255, 0.74)',
    surfaceStrong: 'rgba(255, 255, 255, 0.97)',
    text: '#15161c',
    muted: '#5b5f6e',
    mutedSoft: '#696e7f',
    line: 'rgba(21, 22, 28, 0.1)',
    lineStrong: 'rgba(21, 22, 28, 0.18)',
    shadeRgb: '245, 244, 241',
    danger: '#c2334d',
    success: '#17875f',
  },
};

export const THEMES: Record<ThemeId, ThemeDef> = {
  aurora: {
    name: 'Aurora',
    dark: { accent: '#9a8cff', accentStrong: '#b5aaff', accentInk: '#101326', accent2: '#6be7e0', hue: 230, chroma: 1 },
    light: { accent: '#4f43d1', accentStrong: '#3d32b5', accentInk: '#ffffff', accent2: '#087b76', hue: 245, chroma: 0.9 },
  },
  ember: {
    name: 'Ember',
    dark: { accent: '#ff9a5a', accentStrong: '#ffb78a', accentInk: '#1f0e05', accent2: '#ff5d7a', hue: 18, chroma: 1 },
    light: { accent: '#c2410c', accentStrong: '#9a3412', accentInk: '#ffffff', accent2: '#be185d', hue: 16, chroma: 0.95 },
  },
  forest: {
    name: 'Forest',
    dark: { accent: '#7fd6a0', accentStrong: '#a6e9c0', accentInk: '#06150d', accent2: '#8fd3f4', hue: 150, chroma: 0.85 },
    light: { accent: '#1f7a4d', accentStrong: '#165c3a', accentInk: '#ffffff', accent2: '#0f6f9c', hue: 152, chroma: 0.8 },
    tint: {
      dark: {
        bg: '#0a140e', surface: 'rgba(20, 38, 27, 0.72)', surfaceStrong: 'rgba(18, 36, 25, 0.96)',
        text: '#e8f5ec', muted: '#9bbba5', mutedSoft: '#7c9d87',
        line: 'rgba(170, 225, 190, 0.14)', lineStrong: 'rgba(170, 225, 190, 0.24)', shadeRgb: '10, 20, 14',
      },
      light: {
        bg: '#f0f5f0', surface: 'rgba(255, 255, 255, 0.74)', surfaceStrong: 'rgba(252, 255, 252, 0.97)',
        text: '#122018', muted: '#4a5f51', mutedSoft: '#5a6f61',
        line: 'rgba(18, 32, 24, 0.1)', lineStrong: 'rgba(18, 32, 24, 0.18)', shadeRgb: '240, 245, 240',
      },
    },
  },
  ocean: {
    name: 'Ocean',
    dark: { accent: '#2ec4e8', accentStrong: '#7fdcf2', accentInk: '#04202b', accent2: '#6aa8ff', hue: 195, chroma: 1 },
    light: { accent: '#0a6f8f', accentStrong: '#07556e', accentInk: '#ffffff', accent2: '#2557c9', hue: 200, chroma: 0.9 },
    tint: {
      dark: {
        bg: '#08162a', surface: 'rgba(14, 36, 66, 0.72)', surfaceStrong: 'rgba(13, 34, 62, 0.96)',
        text: '#d6ecff', muted: '#8fb2d6', mutedSoft: '#7196bd',
        line: 'rgba(120, 200, 255, 0.14)', lineStrong: 'rgba(120, 200, 255, 0.24)', shadeRgb: '8, 22, 42',
      },
      light: {
        bg: '#eef6fb', surface: 'rgba(255, 255, 255, 0.76)', surfaceStrong: 'rgba(251, 254, 255, 0.97)',
        text: '#0d2236', muted: '#4a6379', mutedSoft: '#58708a',
        line: 'rgba(13, 34, 54, 0.1)', lineStrong: 'rgba(13, 34, 54, 0.18)', shadeRgb: '238, 246, 251',
      },
    },
  },
  sunset: {
    name: 'Sunset',
    dark: { accent: '#ff7a9c', accentStrong: '#ffa3bb', accentInk: '#2a0714', accent2: '#ffb454', hue: 345, chroma: 1 },
    light: { accent: '#c0264f', accentStrong: '#9a1c3e', accentInk: '#ffffff', accent2: '#b45309', hue: 350, chroma: 0.95 },
    tint: {
      dark: {
        bg: '#1d1016', surface: 'rgba(52, 26, 38, 0.72)', surfaceStrong: 'rgba(50, 25, 36, 0.96)',
        text: '#ffe6ee', muted: '#d4a0b4', mutedSoft: '#b98799',
        line: 'rgba(255, 170, 200, 0.14)', lineStrong: 'rgba(255, 170, 200, 0.24)', shadeRgb: '29, 16, 22',
      },
      light: {
        bg: '#fbf1ee', surface: 'rgba(255, 255, 255, 0.76)', surfaceStrong: 'rgba(255, 252, 250, 0.97)',
        text: '#2b1218', muted: '#6f4a54', mutedSoft: '#8a626c',
        line: 'rgba(43, 18, 24, 0.1)', lineStrong: 'rgba(43, 18, 24, 0.18)', shadeRgb: '251, 241, 238',
      },
    },
  },
  sakura: {
    name: 'Sakura',
    dark: { accent: '#f19ac7', accentStrong: '#f8bfdc', accentInk: '#1d0a16', accent2: '#c7a6ff', hue: 330, chroma: 1 },
    light: { accent: '#b83280', accentStrong: '#931f63', accentInk: '#ffffff', accent2: '#6d3fd1', hue: 325, chroma: 0.9 },
  },
  pulse: {
    name: 'Pulse',
    beat: true,
    dark: { accent: '#ff5ad0', accentStrong: '#ff8ee0', accentInk: '#1a0618', accent2: '#59e6ff', hue: 300, chroma: 1 },
    light: { accent: '#a8158f', accentStrong: '#85106f', accentInk: '#ffffff', accent2: '#086c85', hue: 300, chroma: 0.95 },
  },
  mono: {
    name: 'Mono',
    dark: { accent: '#e8e8ee', accentStrong: '#ffffff', accentInk: '#0b0b0e', accent2: '#9c9ca8', hue: 0, chroma: 0.05 },
    light: { accent: '#17171c', accentStrong: '#000000', accentInk: '#ffffff', accent2: '#5f5f6b', hue: 0, chroma: 0.05 },
  },
};

const systemLight = window.matchMedia('(prefers-color-scheme: light)');

function resolveMode(mode: ModeSetting): 'dark' | 'light' {
  if (mode === 'system') return systemLight.matches ? 'light' : 'dark';
  return mode;
}

function buildPalette(s: Readonly<Settings>): ResolvedPalette {
  const mode = resolveMode(s.mode);
  return {
    ...NEUTRALS[mode],
    ...THEMES[s.theme].tint?.[mode],
    ...THEMES[s.theme][mode],
    mode,
    isLight: mode === 'light',
    themeId: s.theme,
  };
}

let active: ResolvedPalette = buildPalette(settings.get());

/** The palette in effect right now. Read every frame by the visualizer. */
export function currentPalette(): ResolvedPalette {
  return active;
}

/** Writes the active theme and mode into CSS custom properties on the document root. */
export function applyAppearance(): void {
  const s = settings.get();
  active = buildPalette(s);
  beatState.lastUi = -10; // re-apply the beat accents on the next frame instead of flashing the base ones
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.mode = active.mode;
  root.style.colorScheme = active.mode;

  const vars: Record<string, string> = {
    '--bg': active.bg,
    '--surface': active.surface,
    '--surface-strong': active.surfaceStrong,
    '--text': active.text,
    '--muted': active.muted,
    '--muted-soft': active.mutedSoft,
    '--line': active.line,
    '--line-strong': active.lineStrong,
    '--shade-rgb': active.shadeRgb,
    '--danger': active.danger,
    '--success': active.success,
    '--accent': active.accent,
    '--accent-strong': active.accentStrong,
    '--accent-ink': active.accentInk,
    '--accent-2': active.accent2,
  };
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', active.bg);
}

// When the mode is "system", follow the operating system live.
systemLight.addEventListener('change', () => {
  if (settings.get().mode === 'system') applyAppearance();
});

// ---------------------------------------------------------------------------------------------
// Beat-reactive theme ("Pulse")
// ---------------------------------------------------------------------------------------------

const beatState = { hue: 0, target: 0, lastHit: -10, lastUi: -10, glowOn: false, uiDirty: false };
let glowElement: HTMLElement | null | undefined;

function hsl(h: number, s: number, l: number): string {
  return `hsl(${(((h % 360) + 360) % 360).toFixed(1)}, ${s}%, ${l}%)`;
}

/**
 * Drives the beat-reactive theme. Called once per frame by the visualizer.
 *
 *  - Every kick pushes the hue forward, and the hue eases toward it, so colour travels with the rhythm.
 *  - A full-screen glow (one element, opacity only, so it stays on the compositor) flashes on the beat.
 *  - UI accents follow the hue at ~8 Hz. Changing a root custom property restyles the whole document,
 *    so it is deliberately not done every frame.
 *
 * Returns the hue offset (degrees) that scenes should add to the palette hue. Other themes get 0.
 */
export function updateBeatTheme(frame: AudioFrame, dt: number, time: number, reducedMotion: boolean): number {
  const palette = active;
  glowElement ??= document.getElementById('beat-glow');

  if (!THEMES[palette.themeId].beat) {
    if (beatState.glowOn && glowElement) {
      glowElement.style.opacity = '0';
      beatState.glowOn = false;
    }
    beatState.hue = 0;
    beatState.target = 0;
    return 0;
  }

  const motion = reducedMotion ? 0.35 : 1;
  const hit = frame.active && frame.beat > 0.95 && time - beatState.lastHit > 0.14;
  if (hit) {
    beatState.lastHit = time;
    beatState.target += (24 + frame.bass * 22) * motion;
  } else if (!frame.active) {
    beatState.target += dt * 5 * motion;
  }
  beatState.hue += (beatState.target - beatState.hue) * (1 - Math.exp(-dt * 8));
  if (beatState.target > 720) {
    beatState.target -= 360;
    beatState.hue -= 360;
  }

  if (glowElement) {
    const glow = frame.active ? Math.min(1, frame.beat * 0.85 + frame.pulse * 0.4) * motion : 0.12;
    glowElement.style.opacity = glow.toFixed(3);
    beatState.glowOn = true;
  }

  if (time - beatState.lastUi > 0.125 || hit) {
    beatState.lastUi = time;
    const h = palette.hue + beatState.hue;
    const root = document.documentElement.style;
    const light = palette.isLight;
    // Fixed lightness per mode keeps contrast against the page background regardless of hue.
    root.setProperty('--accent', hsl(h, 88, light ? 31 : 66));
    root.setProperty('--accent-strong', hsl(h, 92, light ? 24 : 76));
    root.setProperty('--accent-2', hsl(h + 140, 85, light ? 28 : 68));
    root.setProperty('--beat-rgb', light ? '170, 40, 150' : '255, 90, 208');
  }
  return beatState.hue;
}
