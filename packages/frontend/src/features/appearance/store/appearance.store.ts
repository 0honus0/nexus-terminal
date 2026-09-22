import { defineStore } from 'pinia';
import { logger } from '@/client/logging/logger';
import { appearanceApi } from '../api/appearanceApi';
import { defaultWindowThemeColor, normalizeUiTheme } from '../config/default-theme';
import type {
  AppearanceSettingsDto,
  AppearanceUpdateRequestDto,
  TerminalThemeDto,
} from '@nexus-terminal/protocol/appearance';

let appearanceCacheGeneration = 0;

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

const applySettings = (settings: AppearanceSettingsDto): void => {
  applyUiTheme(parseTheme(settings.customUiTheme));
  applyWindowColor(settings.windowThemeColor);
  applyPageBackground(settings.pageBackgroundImage);
};

export const useAppearanceStore = defineStore('appearance', {
  state: () => ({
    settings: {} as AppearanceSettingsDto,
    themes: [] as TerminalThemeDto[],
    loaded: false,
    settingsRevision: 0,
    customizerVisible: false,
  }),
  actions: {
    reset() {
      appearanceCacheGeneration += 1;
      this.settingsRevision += 1;
      this.settings = {} as AppearanceSettingsDto;
      this.themes = [];
      this.loaded = false;
      this.customizerVisible = false;
      applySettings(this.settings);
    },

    openCustomizer() {
      this.customizerVisible = true;
    },

    closeCustomizer() {
      this.customizerVisible = false;
    },

    async load(force = false) {
      if (this.loaded && !force) return;
      const generation = appearanceCacheGeneration;
      const settingsRevision = this.settingsRevision;
      const settings = await appearanceApi.load();
      if (generation !== appearanceCacheGeneration) return;
      this.loaded = true;
      if (settingsRevision === this.settingsRevision) {
        this.settings = settings;
        applySettings(settings);
      }
      try {
        const themes = await appearanceApi.listThemes();
        if (generation === appearanceCacheGeneration) this.themes = themes;
      } catch (cause) {
        logger.warn({ err: cause }, 'Failed to load terminal themes; appearance settings remain available');
      }
    },

    async update(patch: AppearanceUpdateRequestDto) {
      const generation = appearanceCacheGeneration;
      const settings = await appearanceApi.update(patch);
      if (generation !== appearanceCacheGeneration) return;
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

    previewSettings(patch: AppearanceUpdateRequestDto) {
      const { terminalCustomHtml, ...previewPatch } = patch;
      this.settings = {
        ...this.settings,
        ...previewPatch,
        ...(terminalCustomHtml === undefined ? {} : { terminalCustomHtml: terminalCustomHtml ?? '' }),
      };
    },

    async saveUiTheme(theme: Record<string, string>) {
      await this.update({ customUiTheme: JSON.stringify(theme) });
    },

    async refreshThemes() {
      this.themes = await appearanceApi.listThemes();
    },
  },
});
