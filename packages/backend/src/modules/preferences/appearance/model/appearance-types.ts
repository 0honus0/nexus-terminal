export type AppearanceUiTheme = Record<string, string>;

export interface AppearanceActor {
	userId: number;
	token: string;
}

export interface AppearanceSettings {
	customUiTheme: AppearanceUiTheme;
	activeTerminalThemeId: number | null;
	terminalFontFamily: string;
	terminalFontSize: number;
	terminalFontSizeMobile: number;
	editorFontSize: number;
	editorFontFamily: string | null;
	mobileEditorFontSize: number;
	terminalBackgroundId: string | null;
	pageBackgroundId: string | null;
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

export interface AppearanceRecord {
	version: number;
	customUiTheme: AppearanceUiTheme;
	activeTerminalThemeId: number | null;
	terminalFontFamily: string;
	terminalFontSize: number;
	terminalFontSizeMobile: number;
	editorFontSize: number;
	editorFontFamily: string | null;
	mobileEditorFontSize: number;
	terminalBackgroundId: string | null;
	pageBackgroundId: string | null;
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

export interface AppearanceAccessResult {
	value: AppearanceRecord;
	changed: boolean;
}

export interface AppearancePatch {
	customUiTheme?: AppearanceUiTheme;
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

export interface AppearanceChange {
	expectedVersion: number;
	patch: AppearancePatch;
}

export interface AppearanceWriteFacts {
	current: AppearanceRecord | null;
	selectedThemeExists: boolean;
	defaultThemeId: number | null;
}
