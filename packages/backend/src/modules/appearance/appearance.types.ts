export interface AppearanceSettings {
  _id: 'global_appearance';
  customUiTheme: string;
  activeTerminalThemeId: number | null;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalFontSizeMobile: number;
  editorFontSize: number;
  editorFontFamily: string | null;
  mobileEditorFontSize: number;
  terminalBackgroundImage?: string;
  pageBackgroundImage?: string;
  terminalBackgroundEnabled: boolean;
  terminalBackgroundOverlayOpacity: number;
  terminal_custom_html: string;
  remoteHtmlPresetsUrl: string | null;
  windowThemeColor: string;
  terminalTextStrokeEnabled: boolean;
  terminalTextStrokeWidth: number;
  terminalTextStrokeColor: string;
  terminalTextShadowEnabled: boolean;
  terminalTextShadowOffsetX: number;
  terminalTextShadowOffsetY: number;
  terminalTextShadowBlur: number;
  terminalTextShadowColor: string;
  updatedAt: number;
}

export type UpdateAppearanceInput = Partial<Omit<AppearanceSettings, '_id' | 'updatedAt'>>;
export type BackgroundKind = 'page' | 'terminal';

export interface HtmlThemeSummary {
  name: string;
  type: 'preset' | 'custom';
}

export interface RemoteHtmlThemeSummary {
  name: string;
  downloadUrl: string | null;
}

export interface GitHubThemeRepositoryRef {
  owner: string;
  repository: string;
  ref: string;
  path: string;
}
