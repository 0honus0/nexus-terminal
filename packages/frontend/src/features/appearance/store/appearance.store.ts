import { defineStore } from 'pinia';
import { appearanceApi } from '../api/appearanceApi';
import { defaultUiTheme, defaultWindowThemeColor } from '../config/default-theme';
import type { AppearanceSettings, TerminalTheme } from '../model/appearance';

const parseTheme = (value?: string): Record<string, string> => {
  if (!value) return { ...defaultUiTheme };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...defaultUiTheme, ...parsed }
      : { ...defaultUiTheme };
  } catch {
    return { ...defaultUiTheme };
  }
};

const applyUiTheme = (theme: Record<string, string>): void => {
  for (const [key, value] of Object.entries(theme)) {
    document.documentElement.style.setProperty(key, value);
  }
};

const applyWindowColor = (value?: string): void => {
  const color = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : defaultWindowThemeColor;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);
  }
  meta.content = color;
};

const applyPageBackground = (path?: string): void => {
  const body = document.body;
  body.style.backgroundImage = path ? `url(${new URL(path, window.location.origin).href})` : 'none';
  body.style.backgroundSize = path ? 'cover' : '';
  body.style.backgroundPosition = path ? 'center' : '';
  body.style.backgroundRepeat = path ? 'no-repeat' : '';
  body.style.backgroundAttachment = path ? 'fixed' : '';
};

const applySettings = (settings: AppearanceSettings): void => {
  applyUiTheme(parseTheme(settings.customUiTheme));
  applyWindowColor(settings.windowThemeColor);
  applyPageBackground(settings.pageBackgroundImage);
};

export const useAppearanceStore = defineStore('appearance', {
  state: () => ({
    settings: {} as AppearanceSettings,
    themes: [] as TerminalTheme[],
    loaded: false,
    customizerVisible: false,
  }),
  actions: {
    openCustomizer() {
      this.customizerVisible = true;
    },

    closeCustomizer() {
      this.customizerVisible = false;
    },

    async load(force = false) {
      if (this.loaded && !force) return;
      const [settings, themes] = await Promise.all([appearanceApi.load(), appearanceApi.listThemes()]);
      this.settings = settings;
      this.themes = themes;
      this.loaded = true;
      applySettings(settings);
    },

    async update(patch: Partial<AppearanceSettings>) {
      this.settings = await appearanceApi.update(patch);
      applySettings(this.settings);
    },

    async saveUiTheme(theme: Record<string, string>) {
      await this.update({ customUiTheme: JSON.stringify(theme) });
    },

    async refreshThemes() {
      this.themes = await appearanceApi.listThemes();
    },
  },
});
