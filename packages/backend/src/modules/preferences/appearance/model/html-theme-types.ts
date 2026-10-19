import type { HtmlThemeKind } from '@nexus-terminal/shared/preferences/html-themes/values';

export interface HtmlThemeActor {
	userId: number;
	token: string;
}

export interface HtmlThemeRecord {
	name: string;
	kind: HtmlThemeKind;
	version: number;
	content: string;
	updatedAt: number;
}

export interface HtmlThemeListing {
	name: string;
	kind: HtmlThemeKind;
	version: number;
	updatedAt: number;
}

export interface HtmlThemeInput {
	name: string;
	content: string;
}

export interface HtmlThemeVersion {
	name: string;
	expectedVersion: number;
}

export interface HtmlThemeChange {
	name: string;
	expectedVersion: number;
	content: string;
}

export interface HtmlThemeWriteFacts {
	current: HtmlThemeRecord | null;
	count: number;
}

export interface HtmlThemeRepository {
	owner: string;
	repository: string;
	ref: string;
	path: string;
}

export interface RemoteHtmlThemeListing {
	name: string;
	downloadUrl: string;
}

export interface HtmlThemeSource {
	url: string | null;
	version: number;
	changed: boolean;
}

export interface HtmlThemeSourceChange {
	url: string | null;
	expectedVersion: number;
}

export interface HtmlThemeDirectoryEntry {
	name: string;
	regularFile: boolean;
	url: string | null;
}
