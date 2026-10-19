import type { TerminalThemeView, TerminalThemeColors } from './model.js';
import type { TerminalThemeErrorCode } from './values.js';

export interface TerminalThemeCreateRequest {
	name: string;
	themeData: TerminalThemeColors;
}

export interface TerminalThemeUpdateRequest {
	expectedVersion: number;
	name: string;
	themeData: TerminalThemeColors;
}

export interface TerminalThemeDeleteRequest {
	expectedVersion: number;
}

export interface TerminalThemeImportRequest {
	name: string;
	themeData: TerminalThemeColors;
}

export type TerminalThemeListResponse = TerminalThemeView[];

export interface TerminalThemeDeleteResponse {
	deleted: true;
}

export interface TerminalThemeErrorResponse {
	code: TerminalThemeErrorCode;
}
