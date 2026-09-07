export interface AppearanceSettings {
  customUiTheme?: string;
  activeTerminalThemeId?: number | null;
  terminalFontFamily?: string;
  terminalFontSize?: number;
  terminalFontSizeMobile?: number;
  terminalBackgroundImage?: string;
  pageBackgroundImage?: string;
  editorFontSize?: number;
  mobileEditorFontSize?: number;
  editorFontFamily?: string | null;
  terminalBackgroundEnabled?: boolean;
  terminalBackgroundOverlayOpacity?: number;
  terminalCustomHtml?: string | null;
  remoteHtmlPresetsUrl?: string | null;
  windowThemeColor?: string;
  terminalTextStrokeEnabled?: boolean;
  terminalTextStrokeWidth?: number;
  terminalTextStrokeColor?: string;
  terminalTextShadowEnabled?: boolean;
  terminalTextShadowOffsetX?: number;
  terminalTextShadowOffsetY?: number;
  terminalTextShadowBlur?: number;
  terminalTextShadowColor?: string;
}

export interface TerminalTheme {
  id: number;
  name: string;
  themeData: Record<string, string>;
  preset?: boolean;
}

export interface LocalHtmlTheme {
  name: string;
  type: 'preset' | 'custom';
}

export interface RemoteHtmlTheme {
  name: string;
  downloadUrl: string | null;
}
