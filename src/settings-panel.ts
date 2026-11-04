import {
  CURSOR_IDS,
  DEFAULT_SETTINGS,
  MODE_IDS,
  REACTIVITY_MAX,
  REACTIVITY_MIN,
  SPECTRUM_BLEND_MAX,
  SPECTRUM_BLEND_MIN,
  SPECTRUM_DENSITY_MAX,
  SPECTRUM_DENSITY_MIN,
  SCENE_IDS,
  THEME_IDS,
  settings,
  type CursorStyle,
  type ModeSetting,
  type SceneId,
  type Settings,
  type ThemeId,
} from './settings';
import { SCENES } from './scenes';
import { THEMES } from './themes';

const MODE_LABELS: Record<ModeSetting, string> = { system: 'Auto', dark: 'Dark', light: 'Light' };
const CURSOR_LABELS: Record<CursorStyle, string> = { dot: 'Dot', ring: 'Ring', halo: 'Halo', native: 'System' };

interface Choice<T extends string> {
  value: T;
  label: string;
  detail?: string;
  swatch?: [string, string];
}

/** The right-hand drawer where the theme, mode, background and cursor are chosen. */
export class SettingsPanel {
  private readonly panel: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly reactivity: HTMLInputElement;
  private readonly reactivityValue: HTMLElement;
  private readonly spectrumBlend: HTMLInputElement;
  private readonly spectrumBlendValue: HTMLElement;
  private readonly spectrumDensity: HTMLInputElement;
  private readonly spectrumDensityValue: HTMLElement;
  private readonly groups: Array<{ key: keyof Settings; container: HTMLElement }>;
  private readonly onOpenChange: ((open: boolean) => void) | undefined;

  constructor(onOpenChange?: (open: boolean) => void) {
    this.onOpenChange = onOpenChange;
    this.panel = requiredElement('settings-panel');
    this.backdrop = requiredElement('settings-backdrop');
    this.toggle = requiredElement<HTMLButtonElement>('settings-button');
    this.closeButton = requiredElement<HTMLButtonElement>('settings-close');
    this.resetButton = requiredElement<HTMLButtonElement>('settings-reset');
    this.reactivity = requiredElement<HTMLInputElement>('reactivity-slider');
    this.reactivityValue = requiredElement('reactivity-value');
    this.spectrumBlend = requiredElement<HTMLInputElement>('spectrum-blend-slider');
    this.spectrumBlendValue = requiredElement('spectrum-blend-value');
    this.spectrumDensity = requiredElement<HTMLInputElement>('spectrum-density-slider');
    this.spectrumDensityValue = requiredElement('spectrum-density-value');

    this.groups = [
      { key: 'theme', container: this.renderChoices('theme-options', THEME_IDS.map((id) => ({
        value: id,
        label: THEMES[id].name,
        swatch: [THEMES[id].dark.accent, THEMES[id].dark.accent2] as [string, string],
      })), (value) => settings.update({ theme: value as ThemeId })) },
      { key: 'mode', container: this.renderChoices('mode-options', MODE_IDS.map((id) => ({
        value: id,
        label: MODE_LABELS[id],
      })), (value) => settings.update({ mode: value as ModeSetting })) },
      { key: 'scene', container: this.renderChoices('scene-options', SCENE_IDS.map((id) => ({
        value: id,
        label: SCENES[id].label,
        detail: SCENES[id].description,
      })), (value) => settings.update({ scene: value as SceneId })) },
      { key: 'cursor', container: this.renderChoices('cursor-options', CURSOR_IDS.map((id) => ({
        value: id,
        label: CURSOR_LABELS[id],
      })), (value) => settings.update({ cursor: value as CursorStyle })) },
    ];

    this.toggle.addEventListener('click', () => this.setOpen(!this.isOpen()));
    this.closeButton.addEventListener('click', () => this.setOpen(false));
    this.backdrop.addEventListener('click', () => this.setOpen(false));
    this.resetButton.addEventListener('click', () => settings.update({ ...DEFAULT_SETTINGS }));

    this.reactivity.min = String(REACTIVITY_MIN);
    this.reactivity.max = String(REACTIVITY_MAX);
    this.reactivity.step = '0.05';
    this.reactivity.addEventListener('input', () => {
      settings.update({ reactivity: Number(this.reactivity.value) });
    });

    this.spectrumBlend.min = String(SPECTRUM_BLEND_MIN);
    this.spectrumBlend.max = String(SPECTRUM_BLEND_MAX);
    this.spectrumBlend.step = '0.01';
    this.spectrumBlend.addEventListener('input', () => {
      settings.update({ spectrumBlend: Number(this.spectrumBlend.value) });
    });

    this.spectrumDensity.min = String(SPECTRUM_DENSITY_MIN);
    this.spectrumDensity.max = String(SPECTRUM_DENSITY_MAX);
    this.spectrumDensity.step = '0.01';
    this.spectrumDensity.addEventListener('input', () => {
      settings.update({ spectrumDensity: Number(this.spectrumDensity.value) });
    });

    settings.subscribe((next) => this.sync(next));
    this.sync(settings.get());
  }

  setOpen(open: boolean): void {
    this.panel.classList.toggle('is-open', open);
    this.backdrop.classList.toggle('is-visible', open);
    this.panel.setAttribute('aria-hidden', String(!open));
    this.toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('settings-open', open);
    if (open) this.closeButton.focus({ preventScroll: true });
    this.onOpenChange?.(open);
  }

  isOpen(): boolean {
    return this.panel.classList.contains('is-open');
  }

  private renderChoices<T extends string>(
    containerId: string,
    choices: Choice<T>[],
    onPick: (value: T) => void,
  ): HTMLElement {
    const container = requiredElement(containerId);
    container.replaceChildren(...choices.map((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = choice.detail ? 'choice choice-wide' : 'choice';
      button.dataset.value = choice.value;
      button.setAttribute('aria-pressed', 'false');

      if (choice.swatch) {
        const swatch = document.createElement('span');
        swatch.className = 'choice-swatch';
        swatch.style.setProperty('--swatch-a', choice.swatch[0]);
        swatch.style.setProperty('--swatch-b', choice.swatch[1]);
        swatch.setAttribute('aria-hidden', 'true');
        button.append(swatch);
      }

      const text = document.createElement('span');
      text.className = 'choice-text';
      const label = document.createElement('span');
      label.className = 'choice-label';
      label.textContent = choice.label;
      text.append(label);
      if (choice.detail) {
        const detail = document.createElement('span');
        detail.className = 'choice-detail';
        detail.textContent = choice.detail;
        text.append(detail);
      }
      button.append(text);

      button.addEventListener('click', () => onPick(choice.value));
      return button;
    }));
    return container;
  }

  private sync(current: Readonly<Settings>): void {
    for (const group of this.groups) {
      const selected = String(current[group.key]);
      for (const button of group.container.querySelectorAll<HTMLButtonElement>('button')) {
        const active = button.dataset.value === selected;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }

    if (document.activeElement !== this.reactivity) this.reactivity.value = String(current.reactivity);
    this.reactivity.style.setProperty('--range-progress', `${((current.reactivity - REACTIVITY_MIN) / (REACTIVITY_MAX - REACTIVITY_MIN)) * 100}%`);
    this.reactivityValue.textContent = `${current.reactivity.toFixed(2)}×`;

    if (document.activeElement !== this.spectrumBlend) this.spectrumBlend.value = String(current.spectrumBlend);
    this.spectrumBlend.style.setProperty('--range-progress', `${current.spectrumBlend * 100}%`);
    this.spectrumBlendValue.textContent = `${Math.round(current.spectrumBlend * 100)}%`;

    if (document.activeElement !== this.spectrumDensity) this.spectrumDensity.value = String(current.spectrumDensity);
    const densityProgress = ((current.spectrumDensity - SPECTRUM_DENSITY_MIN) / (SPECTRUM_DENSITY_MAX - SPECTRUM_DENSITY_MIN)) * 100;
    this.spectrumDensity.style.setProperty('--range-progress', `${densityProgress}%`);
    this.spectrumDensityValue.textContent = `${Math.round(current.spectrumDensity * 100)}%`;
  }
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required interface element #${id} was not found.`);
  return element as T;
}
