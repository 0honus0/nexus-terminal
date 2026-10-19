import {
	TERMINAL_THEME_NAME_MAX_BYTES,
	TERMINAL_THEME_COLOR_MAX_BYTES,
	TERMINAL_THEME_COLOR_KEYS,
} from '@nexus-terminal/shared/preferences/themes/values';
import { ThemeFailure } from '../theme-failure.js';
import type {
	ThemeInput,
	ThemePreset,
	ThemeSeedFacts,
	ThemeSeedDecision,
	ThemeMutationFacts,
	ThemeVersion,
} from './model/theme-types.js';
const MAX_USER_THEMES = 2000;

function validText(value: string, max: number): boolean {
	return (
		!!value.trim() &&
		!value.includes('\0') &&
		Buffer.byteLength(value) <= max &&
		Buffer.from(value).toString('utf8') === value
	);
}

export function validateThemeInput(input: ThemeInput): void {
	if (
		!validText(input.name, TERMINAL_THEME_NAME_MAX_BYTES) ||
		!validText(input.colors.foreground, TERMINAL_THEME_COLOR_MAX_BYTES) ||
		!validText(input.colors.background, TERMINAL_THEME_COLOR_MAX_BYTES) ||
		Object.keys(input.colors).some((key) => !TERMINAL_THEME_COLOR_KEYS.some((value) => value === key))
	) {
		throw new ThemeFailure('invalid_input');
	}
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		const value = input.colors[key];
		if (value !== undefined && !validText(value, TERMINAL_THEME_COLOR_MAX_BYTES)) {
			throw new ThemeFailure('invalid_input');
		}
	}
}

export function admitThemeMutation(facts: ThemeMutationFacts, version: ThemeVersion | null): void {
	if (version === null) {
		if (facts.count >= MAX_USER_THEMES) {
			throw new ThemeFailure('limit_exceeded');
		}
	} else {
		if (!facts.current) {
			throw new ThemeFailure('not_found');
		}
		if (facts.current.presetKey !== null) {
			throw new ThemeFailure('preset_readonly');
		}
		if (facts.current.version !== version.expectedVersion) {
			throw new ThemeFailure('version_conflict');
		}
	}
	if (facts.nameTaken) {
		throw new ThemeFailure('name_conflict');
	}
}

export function planThemePreset(
	preset: ThemePreset,
	facts: ThemeSeedFacts,
	presetNames: ReadonlySet<string>,
): ThemeSeedDecision {
	const renames = facts.conflicts.map((row) => {
		const suffix = ' (user ' + row.id + ')';
		let base = preset.name;
		while (Buffer.byteLength(base + suffix + ' 999999') > TERMINAL_THEME_NAME_MAX_BYTES) {
			base = Array.from(base).slice(0, -1).join('');
		}
		const occupied = new Set([...row.names, ...presetNames]);
		let name = base + suffix;
		let index = 2;
		while (occupied.has(name)) {
			name = base + suffix + ' ' + index++;
		}
		return { id: row.id, version: row.version, name };
	});
	const current = facts.current;
	const sameColors =
		current !== null && TERMINAL_THEME_COLOR_KEYS.every((key) => current.colors[key] === preset.colors[key]);
	return { update: current !== null && (current.name !== preset.name || !sameColors), renames };
}
