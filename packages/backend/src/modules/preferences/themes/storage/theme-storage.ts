import type { TerminalThemeColorKey } from '@nexus-terminal/shared/preferences/themes/values';

export type StoredThemeColors = Partial<Record<TerminalThemeColorKey, string>> & {
	foreground: string;
	background: string;
};

export interface StoredTheme {
	id: number;
	version: number;
	name: string;
	colors: StoredThemeColors;
	presetKey: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface ThemeAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

export interface ThemeWrite {
	action: 'create' | 'update' | 'delete';
	userId: number;
	id: number | null;
	expectedVersion: number | null;
	name: string | null;
	colors: StoredThemeColors | null;
}

export interface ThemeStorageFacts {
	current: StoredTheme | null;
	nameTaken: boolean;
	count: number;
}

export interface StoredThemePreset {
	key: string;
	name: string;
	colors: StoredThemeColors;
}

export interface StoredThemeSeedFacts {
	current: StoredTheme | null;
	conflicts: Array<{ id: number; userId: number; version: number; names: string[] }>;
}

export interface StoredThemeSeedDecision {
	update: boolean;
	renames: Array<{ id: number; version: number; name: string }>;
}

export interface ThemeStorage {
	list(userId: number): Promise<StoredTheme[]>;
	get(userId: number, id: number): Promise<StoredTheme | null>;
	write(
		command: ThemeWrite,
		authorization: ThemeAuthorization,
		admit: (facts: ThemeStorageFacts) => void,
	): Promise<StoredTheme | null>;
	seed(
		presets: StoredThemePreset[],
		plan: (preset: StoredThemePreset, facts: StoredThemeSeedFacts) => StoredThemeSeedDecision,
	): Promise<void>;
}
