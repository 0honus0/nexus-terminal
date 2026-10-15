import type { HtmlThemeKind } from './values.js';

export interface HtmlThemeSummary {
	name: string;
	type: HtmlThemeKind;
	version: number;
	updatedAt: number;
}

export interface RemoteHtmlThemeSummary {
	name: string;
	downloadUrl: string;
}

export interface HtmlThemeRepositoryView {
	url: string | null;
	version: number;
}
