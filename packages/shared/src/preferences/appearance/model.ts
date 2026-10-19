export type AppearanceUiTheme = Record<string, string>;

export interface AppearanceView {
	version: number;
	customUiTheme: string;
	activeTerminalThemeId: number | null;
	terminalFontFamily: string;
	terminalFontSize: number;
	terminalFontSizeMobile: number;
	editorFontSize: number;
	editorFontFamily: string | null;
	mobileEditorFontSize: number;
	terminalBackgroundImage: string | null;
	pageBackgroundImage: string | null;
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
