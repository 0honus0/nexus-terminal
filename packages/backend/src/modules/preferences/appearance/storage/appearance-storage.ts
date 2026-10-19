export type StoredAppearanceUiTheme = Record<string, string>;

export interface StoredAppearanceSettings {
	customUiTheme: StoredAppearanceUiTheme;
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

export interface StoredAppearance {
	version: number;
	activeThemeId: number | null;
	settings: StoredAppearanceSettings;
	updatedAt: number;
}

export interface AppearanceAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

export interface StoredAppearanceFacts {
	current: StoredAppearance | null;
	selectedThemeExists: boolean;
	defaultThemeId: number | null;
}

export interface StoredAppearanceWrite {
	activeThemeId: number | null;
	settings: StoredAppearanceSettings;
}

export interface AppearanceStorage {
	access(
		userId: number,
		requestedThemeId: number | null,
		defaultPresetKey: string,
		authorization: AppearanceAuthorization,
		decide: (facts: StoredAppearanceFacts) => StoredAppearanceWrite | null,
	): Promise<StoredAppearance>;
}
