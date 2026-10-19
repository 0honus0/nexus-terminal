import type { AppearanceView } from './model.js';
import type { AppearanceErrorCode } from './values.js';

export interface AppearanceUpdateRequest {
	expectedVersion: number;
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

export type AppearanceResponse = AppearanceView;

export interface AppearanceErrorResponse {
	code: AppearanceErrorCode;
}

export interface BackgroundUploadFields {
	expectedVersion: number;
}

export interface BackgroundDeleteRequest {
	expectedVersion: number;
}

export interface BackgroundMutationResponse {
	appearance: AppearanceView;
	cleanupPending: boolean;
}

export interface BackgroundFilePathParameters {
	filename: string;
}
