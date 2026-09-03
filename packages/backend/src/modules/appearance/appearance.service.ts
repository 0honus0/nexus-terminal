export interface AppearanceSettings {
  terminalFontFamily?: string;
  terminalFontSize?: number;
  pageBackgroundImage?: string;
  terminalBackgroundImage?: string;
  activeTerminalThemeId?: number | null;
}

export interface AppearanceService {
  get(): Promise<AppearanceSettings>;
  update(input: Partial<AppearanceSettings>): Promise<AppearanceSettings>;
}
