import type { TerminalThemeColorKey } from './values.js';

export type TerminalThemeColors = Partial<Record<TerminalThemeColorKey, string>> & {
	foreground: string;
	background: string;
};

export interface TerminalThemeView {
	id: number;
	version: number;
	name: string;
	themeData: TerminalThemeColors;
	preset: boolean;
	createdAt: number;
	updatedAt: number;
}
