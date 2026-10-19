import { TERMINAL_THEME_COLOR_KEYS } from '@nexus-terminal/shared/preferences/themes/values';
import type { TerminalThemeColors, TerminalThemeView } from '@nexus-terminal/shared/preferences/themes/model';
import type { TerminalThemeCreateRequest } from '@nexus-terminal/shared/preferences/themes/http';
import type { ThemeColors, ThemeInput, ThemeRecord } from '../../themes/model/theme-types.js';

export function toApplicationTheme(value: TerminalThemeCreateRequest): ThemeInput {
	const colors: ThemeColors = { foreground: value.themeData.foreground, background: value.themeData.background };
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		const entry = value.themeData[key];
		if (entry !== undefined) {
			colors[key] = entry;
		}
	}
	return { name: value.name, colors };
}

export function toWireThemeColors(value: ThemeColors): TerminalThemeColors {
	const colors: TerminalThemeColors = { foreground: value.foreground, background: value.background };
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		const entry = value[key];
		if (entry !== undefined) {
			colors[key] = entry;
		}
	}
	return colors;
}

export function toWireTheme(value: ThemeRecord): TerminalThemeView {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		themeData: toWireThemeColors(value.colors),
		preset: value.presetKey !== null,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
