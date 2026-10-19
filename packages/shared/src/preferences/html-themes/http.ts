import type { HtmlThemeSummary } from './model.js';
import type { HtmlThemeErrorCode } from './values.js';

export interface HtmlThemeCreateRequest {
	name: string;
	content: string;
}

export interface HtmlThemeUpdateRequest {
	expectedVersion: number;
	content: string;
}

export interface HtmlThemeDeleteRequest {
	expectedVersion: number;
}

export type HtmlThemeListResponse = HtmlThemeSummary[];

export type HtmlThemeMutationResponse = HtmlThemeSummary;

export interface HtmlThemeDeleteResponse {
	deleted: true;
}

export interface HtmlThemeErrorResponse {
	code: HtmlThemeErrorCode;
}

export interface HtmlThemeRepositoryUpdateRequest {
	url: string | null;
	expectedVersion: number;
}

export interface RemoteHtmlThemeListQuery {
	repoUrl: string | null;
}

export interface RemoteHtmlThemeContentQuery {
	fileUrl: string;
}
