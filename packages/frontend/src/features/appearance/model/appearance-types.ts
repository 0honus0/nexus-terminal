import type { TerminalThemeColorKey } from '@nexus-terminal/shared/preferences/themes/values';
import type { HtmlThemeKind } from '@nexus-terminal/shared/preferences/html-themes/values';

export interface AppearanceSettings {
	version: number;
	terminalBackgroundImage: string | null;
	pageBackgroundImage: string | null;
	customUiTheme: string;
	activeTerminalThemeId: number | null;
	terminalFontFamily: string;
	terminalFontSize: number;
	terminalFontSizeMobile: number;
	editorFontSize: number;
	editorFontFamily: string | null;
	mobileEditorFontSize: number;
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

export interface AppearancePatch {
	customUiTheme?: string;
	activeTerminalThemeId?: number | null;
	terminalFontFamily?: string;
	terminalFontSize?: number;
	terminalFontSizeMobile?: number;
	editorFontSize?: number;
	editorFontFamily?: string | null;
	mobileEditorFontSize?: number;
	terminalBackgroundEnabled?: boolean;
	terminalBackgroundOverlayOpacity?: number;
	terminalCustomHtml?: string;
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

export type ThemeColors = Partial<Record<TerminalThemeColorKey, string>> & { foreground: string; background: string };

export interface TerminalTheme {
	id: number;
	version: number;
	name: string;
	themeData: ThemeColors;
	preset: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface LocalHtmlTheme {
	name: string;
	type: HtmlThemeKind;
	version: number;
	updatedAt: number;
}

export interface RemoteHtmlTheme {
	name: string;
	downloadUrl: string;
}

export interface HtmlRepository {
	url: string | null;
	version: number;
}

export interface BackgroundChange {
	appearance: AppearanceSettings;
	cleanupPending: boolean;
}

export type FontPreferenceKind = 'terminal' | 'mobile-terminal' | 'editor' | 'mobile-editor';
