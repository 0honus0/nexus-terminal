import { defineStore } from 'pinia';
import { appearanceApi } from '../api/appearanceApi';
import { defaultWindowThemeColor, normalizeUiTheme } from '../config/default-theme';
import type { AppearanceSettings, TerminalTheme } from '../model/appearance';

const parseTheme = (value?: string): Record<string, string> => {
  if (!value) return normalizeUiTheme({});
  try {
    const parsed: unknown = JSON.parse(value);
    return normalizeUiTheme(
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {},
    );
  } catch {
    return normalizeUiTheme({});
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
    settingsRevision: 0,
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
      const settingsRevision = this.settingsRevision;
      const settings = await appearanceApi.load();
      this.loaded = true;
      if (settingsRevision === this.settingsRevision) {
        this.settings = settings;
        applySettings(settings);
      }
      try {
        this.themes = await appearanceApi.listThemes();
      } catch (cause) {
        console.warn('[Appearance] Failed to load terminal themes; appearance settings remain available.', cause);
      }
    },

    async update(patch: Partial<AppearanceSettings>) {
      const settings = await appearanceApi.update(patch);
      this.settingsRevision += 1;
      this.settings = settings;
      applySettings(settings);
    },

    applyBackgroundReference(kind: 'page' | 'terminal', filePath: string) {
      this.settingsRevision += 1;
      if (kind === 'page') {
        this.settings = { ...this.settings, pageBackgroundImage: filePath };
        applyPageBackground(filePath);
      } else {
        this.settings = { ...this.settings, terminalBackgroundImage: filePath };
      }
    },

    async saveUiTheme(theme: Record<string, string>) {
      await this.update({ customUiTheme: JSON.stringify(theme) });
    },

    async refreshThemes() {
      this.themes = await appearanceApi.listThemes();
    },
  },
});
