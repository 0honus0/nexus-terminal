import type { MessageResponseDto } from './common.js';

export interface AppearanceSettingsDto {
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

export type AppearanceUpdateRequestDto = Omit<Partial<AppearanceSettingsDto>, 'terminalCustomHtml'> & {
  terminalCustomHtml?: string | null;
};

export interface AppearanceBackgroundUploadResponseDto extends MessageResponseDto {
  filePath: string;
}

export interface LocalHtmlThemeDto {
  name: string;
  type: 'preset' | 'custom';
}

export interface RemoteHtmlThemeDto {
  name: string;
  downloadUrl: string | null;
}

export interface HtmlThemeCreateRequestDto {
  name: string;
  content: string;
}

export interface HtmlThemeUpdateRequestDto {
  content: string;
}

export interface RemoteHtmlRepositoryResponseDto {
  url: string | null;
}

export interface RemoteHtmlRepositoryUpdateRequestDto {
  url: string | null;
}

export type TerminalThemeDataDto = Record<string, string>;

export interface TerminalThemeDto {
  id: number;
  name: string;
  themeData: TerminalThemeDataDto;
  preset: boolean;
}

export interface TerminalThemeCreateRequestDto {
  name: string;
  themeData: TerminalThemeDataDto;
}

export type TerminalThemeUpdateRequestDto = TerminalThemeCreateRequestDto;
