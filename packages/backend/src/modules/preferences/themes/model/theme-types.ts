import type { TerminalThemeColorKey } from '@nexus-terminal/shared/preferences/themes/values';

export type ThemeColors = Partial<Record<TerminalThemeColorKey, string>> & { foreground: string; background: string };

export interface ThemeActor {
	userId: number;
	token: string;
}

export interface ThemeRecord {
	id: number;
	version: number;
	name: string;
	colors: ThemeColors;
	presetKey: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ThemeInput {
	name: string;
	colors: ThemeColors;
}

export interface ThemeChange {
	id: number;
	expectedVersion: number;
	input: ThemeInput;
}

export interface ThemeVersion {
	id: number;
	expectedVersion: number;
}

export interface ThemeMutationFacts {
	current: ThemeRecord | null;
	nameTaken: boolean;
	count: number;
}

export interface ThemePreset {
	key: string;
	name: string;
	colors: ThemeColors;
}

export interface ThemeSeedFacts {
	current: ThemeRecord | null;
	conflicts: Array<{ id: number; userId: number; version: number; names: string[] }>;
}

export interface ThemeRename {
	id: number;
	version: number;
	name: string;
}

export interface ThemeSeedDecision {
	update: boolean;
	renames: ThemeRename[];
}
