export interface AppearanceSettings {
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
  terminalCustomHtml: string;
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
}

export type UpdateAppearanceInput = Partial<AppearanceSettings>;
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
