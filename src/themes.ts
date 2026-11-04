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

interface ThemeDef {
  name: string;
  description: string;
  /** Three colours used by the visual theme preview. */
  preview: [string, string, string];
  dark: Palette;
  light: Palette;
  /** The accent colour follows the music (see updateBeatTheme). */
  beat?: boolean;
}

const COMMON_DANGER = '#ff8194';
const COMMON_SUCCESS = '#70dfb0';

/**
 * Complete colour systems rather than accent-only skins. Each theme owns its
 * background, layered surfaces, typography, borders and visualizer colours in
 * both display modes. Theme IDs remain stable so existing saved preferences
 * continue to work.
 */
export const THEMES: Record<ThemeId, ThemeDef> = {
  aurora: {
    name: 'Aurora',
    description: 'Violet light with an arctic-cyan edge',
    preview: ['#9d8cff', '#59e5d7', '#25204b'],
    dark: {
      bg: '#080b19', surface: 'rgba(23, 24, 49, 0.82)', surfaceStrong: 'rgba(17, 18, 39, 0.97)',
      text: '#f5f3ff', muted: '#aaa7cc', mutedSoft: '#807da7',
      line: 'rgba(187, 177, 255, 0.15)', lineStrong: 'rgba(187, 177, 255, 0.25)', shadeRgb: '8, 11, 25',
      danger: COMMON_DANGER, success: COMMON_SUCCESS,
      accent: '#a394ff', accentStrong: '#c0b5ff', accentInk: '#15112c', accent2: '#67e9dc', hue: 247, chroma: 1,
    },
    light: {
      bg: '#f4f2ff', surface: 'rgba(255, 255, 255, 0.78)', surfaceStrong: 'rgba(255, 255, 255, 0.97)',
      text: '#211d3b', muted: '#625d7d', mutedSoft: '#817c9b',
      line: 'rgba(77, 63, 145, 0.12)', lineStrong: 'rgba(77, 63, 145, 0.2)', shadeRgb: '244, 242, 255',
      danger: '#bd3858', success: '#187b5b',
      accent: '#6554d8', accentStrong: '#5140c2', accentInk: '#ffffff', accent2: '#087f84', hue: 247, chroma: 0.94,
    },
  },
  ember: {
    name: 'Ember',
    description: 'Burnished copper, warm light and golden heat',
    preview: ['#ff9b62', '#ffd477', '#51251c'],
    dark: {
      bg: '#170d0b', surface: 'rgba(48, 27, 22, 0.84)', surfaceStrong: 'rgba(31, 18, 15, 0.97)',
      text: '#fff2e9', muted: '#d0a795', mutedSoft: '#a98272',
      line: 'rgba(255, 190, 151, 0.14)', lineStrong: 'rgba(255, 190, 151, 0.24)', shadeRgb: '23, 13, 11',
      danger: '#ff8790', success: '#91d6a4',
      accent: '#ff9c65', accentStrong: '#ffc08f', accentInk: '#321307', accent2: '#ffd276', hue: 22, chroma: 1,
    },
    light: {
      bg: '#fff4eb', surface: 'rgba(255, 255, 255, 0.8)', surfaceStrong: 'rgba(255, 252, 248, 0.98)',
      text: '#351b13', muted: '#805b4b', mutedSoft: '#9b7665',
      line: 'rgba(111, 53, 29, 0.12)', lineStrong: 'rgba(111, 53, 29, 0.2)', shadeRgb: '255, 244, 235',
      danger: '#bd3548', success: '#23734d',
      accent: '#bd4c20', accentStrong: '#963918', accentInk: '#ffffff', accent2: '#a66a13', hue: 22, chroma: 0.96,
    },
  },
  forest: {
    name: 'Forest',
    description: 'Deep evergreen with fresh mint highlights',
    preview: ['#75dca3', '#c4e68b', '#183d2c'],
    dark: {
      bg: '#081710', surface: 'rgba(21, 43, 31, 0.84)', surfaceStrong: 'rgba(14, 31, 22, 0.97)',
      text: '#effaf1', muted: '#a4c4ac', mutedSoft: '#7e9f87',
      line: 'rgba(171, 232, 187, 0.14)', lineStrong: 'rgba(171, 232, 187, 0.24)', shadeRgb: '8, 23, 16',
      danger: '#ff8d9b', success: '#77e0a3',
      accent: '#79dda5', accentStrong: '#a7edc2', accentInk: '#092015', accent2: '#c5e88e', hue: 148, chroma: 0.9,
    },
    light: {
      bg: '#eff7ef', surface: 'rgba(255, 255, 255, 0.8)', surfaceStrong: 'rgba(252, 255, 251, 0.98)',
      text: '#172d20', muted: '#526c59', mutedSoft: '#718878',
      line: 'rgba(27, 77, 46, 0.12)', lineStrong: 'rgba(27, 77, 46, 0.2)', shadeRgb: '239, 247, 239',
      danger: '#b93850', success: '#176c45',
      accent: '#287d4f', accentStrong: '#1d633e', accentInk: '#ffffff', accent2: '#638e2f', hue: 148, chroma: 0.84,
    },
  },
  ocean: {
    name: 'Ocean',
    description: 'Abyssal blue, clear cyan and open space',
    preview: ['#4acbe9', '#759fff', '#123b59'],
    dark: {
      bg: '#071522', surface: 'rgba(17, 42, 67, 0.84)', surfaceStrong: 'rgba(11, 29, 49, 0.97)',
      text: '#eaf7ff', muted: '#9bbbd2', mutedSoft: '#759bb8',
      line: 'rgba(126, 204, 255, 0.15)', lineStrong: 'rgba(126, 204, 255, 0.25)', shadeRgb: '7, 21, 34',
      danger: '#ff879d', success: '#6ee0c0',
      accent: '#4ecce9', accentStrong: '#8be4f3', accentInk: '#062431', accent2: '#7aa6ff', hue: 194, chroma: 1,
    },
    light: {
      bg: '#eff8fc', surface: 'rgba(255, 255, 255, 0.82)', surfaceStrong: 'rgba(251, 254, 255, 0.98)',
      text: '#102b40', muted: '#4d6a80', mutedSoft: '#6e879b',
      line: 'rgba(24, 86, 125, 0.12)', lineStrong: 'rgba(24, 86, 125, 0.2)', shadeRgb: '239, 248, 252',
      danger: '#b83250', success: '#13765f',
      accent: '#087c9b', accentStrong: '#06627d', accentInk: '#ffffff', accent2: '#315fce', hue: 194, chroma: 0.92,
    },
  },
  sunset: {
    name: 'Sunset',
    description: 'Velvet plum, coral pink and late-day amber',
    preview: ['#ff789d', '#ffc078', '#48213c'],
    dark: {
      bg: '#1a0e19', surface: 'rgba(49, 27, 44, 0.84)', surfaceStrong: 'rgba(33, 18, 31, 0.97)',
      text: '#fff0f3', muted: '#d1a4b4', mutedSoft: '#ac8094',
      line: 'rgba(255, 174, 200, 0.15)', lineStrong: 'rgba(255, 174, 200, 0.24)', shadeRgb: '26, 14, 25',
      danger: '#ff8798', success: '#88d9b2',
      accent: '#ff7f9f', accentStrong: '#ffabc0', accentInk: '#32101f', accent2: '#ffc078', hue: 344, chroma: 1,
    },
    light: {
      bg: '#fff1f1', surface: 'rgba(255, 255, 255, 0.82)', surfaceStrong: 'rgba(255, 252, 251, 0.98)',
      text: '#351824', muted: '#7a5361', mutedSoft: '#9c7481',
      line: 'rgba(116, 43, 71, 0.12)', lineStrong: 'rgba(116, 43, 71, 0.2)', shadeRgb: '255, 241, 241',
      danger: '#b62e4e', success: '#227653',
      accent: '#c43c64', accentStrong: '#a62b50', accentInk: '#ffffff', accent2: '#a86620', hue: 344, chroma: 0.96,
    },
  },
  sakura: {
    name: 'Sakura',
    description: 'Soft blossom pink with a lilac glow',
    preview: ['#ef9bc9', '#c4a1ff', '#4d294b'],
    dark: {
      bg: '#1a1020', surface: 'rgba(48, 29, 53, 0.84)', surfaceStrong: 'rgba(32, 19, 38, 0.97)',
      text: '#fff0fa', muted: '#d0a9c7', mutedSoft: '#a984a3',
      line: 'rgba(244, 183, 223, 0.15)', lineStrong: 'rgba(244, 183, 223, 0.24)', shadeRgb: '26, 16, 32',
      danger: '#ff889f', success: '#83d9b5',
      accent: '#f19fcd', accentStrong: '#ffc1e2', accentInk: '#35152d', accent2: '#c5a3ff', hue: 326, chroma: 1,
    },
    light: {
      bg: '#fff3f9', surface: 'rgba(255, 255, 255, 0.82)', surfaceStrong: 'rgba(255, 252, 254, 0.98)',
      text: '#351c31', muted: '#76546e', mutedSoft: '#98758f',
      line: 'rgba(115, 43, 91, 0.12)', lineStrong: 'rgba(115, 43, 91, 0.2)', shadeRgb: '255, 243, 249',
      danger: '#b63059', success: '#237556',
      accent: '#b83f85', accentStrong: '#982b6c', accentInk: '#ffffff', accent2: '#7952cf', hue: 326, chroma: 0.93,
    },
  },
  pulse: {
    name: 'Pulse',
    description: 'Electric magenta and cyan that move with the beat',
    preview: ['#ff59d3', '#5be9ff', '#41134a'],
    beat: true,
    dark: {
      bg: '#130a1b', surface: 'rgba(42, 20, 52, 0.86)', surfaceStrong: 'rgba(26, 13, 36, 0.98)',
      text: '#fff0ff', muted: '#c6a3cd', mutedSoft: '#9875a4',
      line: 'rgba(255, 136, 231, 0.16)', lineStrong: 'rgba(255, 136, 231, 0.27)', shadeRgb: '19, 10, 27',
      danger: '#ff8299', success: '#73e5c0',
      accent: '#ff5bd3', accentStrong: '#ff9ce5', accentInk: '#2b0827', accent2: '#5be9ff', hue: 302, chroma: 1,
    },
    light: {
      bg: '#fff0fb', surface: 'rgba(255, 255, 255, 0.84)', surfaceStrong: 'rgba(255, 252, 255, 0.98)',
      text: '#35152f', muted: '#7c5276', mutedSoft: '#a07599',
      line: 'rgba(147, 40, 128, 0.13)', lineStrong: 'rgba(147, 40, 128, 0.22)', shadeRgb: '255, 240, 251',
      danger: '#b72e53', success: '#187a5c',
      accent: '#ae238f', accentStrong: '#8f1475', accentInk: '#ffffff', accent2: '#087d91', hue: 302, chroma: 0.96,
    },
  },
  mono: {
    name: 'Mono',
    description: 'Quiet contrast, graphite and polished silver',
    preview: ['#f1f1f4', '#a3a3ad', '#34343e'],
    dark: {
      bg: '#0b0b0f', surface: 'rgba(31, 31, 39, 0.86)', surfaceStrong: 'rgba(19, 19, 24, 0.98)',
      text: '#f3f3f6', muted: '#aaaab5', mutedSoft: '#858591',
      line: 'rgba(232, 232, 240, 0.12)', lineStrong: 'rgba(232, 232, 240, 0.2)', shadeRgb: '11, 11, 15',
      danger: '#ff8794', success: '#8bd8b4',
      accent: '#e8e8ef', accentStrong: '#ffffff', accentInk: '#17171d', accent2: '#a4a4b0', hue: 0, chroma: 0.04,
    },
    light: {
      bg: '#f1f1f4', surface: 'rgba(255, 255, 255, 0.82)', surfaceStrong: 'rgba(255, 255, 255, 0.98)',
      text: '#202027', muted: '#62626d', mutedSoft: '#80808b',
      line: 'rgba(30, 30, 40, 0.1)', lineStrong: 'rgba(30, 30, 40, 0.18)', shadeRgb: '241, 241, 244',
      danger: '#b83248', success: '#237653',
      accent: '#25252e', accentStrong: '#08080c', accentInk: '#ffffff', accent2: '#777783', hue: 0, chroma: 0.04,
    },
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
  beatState.lastUi = -10;
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

const beatState = { hue: 0, target: 0, lastHit: -10, lastUi: -10, glowOn: false };
let glowElement: HTMLElement | null | undefined;

function hsl(h: number, s: number, l: number): string {
  return `hsl(${(((h % 360) + 360) % 360).toFixed(1)}, ${s}%, ${l}%)`;
}

/**
 * Drives the beat-reactive theme. Called once per frame by the visualizer.
 *
 * - Every kick pushes the hue forward, and the hue eases toward it.
 * - A single full-screen glow flashes on the beat (opacity only).
 * - UI accents follow the hue at ~8 Hz to avoid restyling the document every frame.
 *
 * Returns the hue offset (degrees) that scenes should add to the palette hue.
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
    root.setProperty('--accent', hsl(h, 88, light ? 31 : 66));
    root.setProperty('--accent-strong', hsl(h, 92, light ? 24 : 76));
    root.setProperty('--accent-2', hsl(h + 140, 85, light ? 28 : 68));
    root.setProperty('--beat-rgb', light ? '170, 40, 150' : '255, 90, 208');
  }
  return beatState.hue;
}
