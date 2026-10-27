import { record, integer, text, InvalidPayload } from '../../common/http-codec.js';
import {
	TERMINAL_THEME_COLOR_KEYS,
	TERMINAL_THEME_COLOR_MAX_BYTES,
	TERMINAL_THEME_NAME_MAX_BYTES,
	TERMINAL_THEME_REQUEST_MAX_BYTES,
	TERMINAL_THEME_RESPONSE_MAX_BYTES,
	TERMINAL_THEME_LIST_MAX_ITEMS,
	TERMINAL_THEME_ERROR_CODES,
} from './values.js';
import type { TerminalThemeColors, TerminalThemeView } from './model.js';
import type {
	TerminalThemeCreateRequest,
	TerminalThemeUpdateRequest,
	TerminalThemeDeleteRequest,
	TerminalThemeListResponse,
	TerminalThemeErrorResponse,
	TerminalThemeDeleteResponse,
} from './http.js';

export function readTerminalThemeColors(input: unknown): TerminalThemeColors {
	if (
		input === null ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		Object.keys(input).some((key) => !TERMINAL_THEME_COLOR_KEYS.some((value) => value === key))
	) {
		throw new InvalidPayload();
	}
	const entries: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		entries[key] = value;
	}
	const result: TerminalThemeColors = {
		foreground: text(entries.foreground, TERMINAL_THEME_COLOR_MAX_BYTES),
		background: text(entries.background, TERMINAL_THEME_COLOR_MAX_BYTES),
	};
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		const value = entries[key];
		if (value !== undefined) {
			result[key] = text(value, TERMINAL_THEME_COLOR_MAX_BYTES);
		}
	}
	return result;
}

export function readTerminalThemeCreate(input: unknown): TerminalThemeCreateRequest {
	const value = record(input, ['name', 'themeData'], TERMINAL_THEME_REQUEST_MAX_BYTES);
	return {
		name: text(value.name, TERMINAL_THEME_NAME_MAX_BYTES),
		themeData: readTerminalThemeColors(value.themeData),
	};
}

export function readTerminalThemeUpdate(input: unknown): TerminalThemeUpdateRequest {
	const value = record(input, ['expectedVersion', 'name', 'themeData'], TERMINAL_THEME_REQUEST_MAX_BYTES);
	return {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		name: text(value.name, TERMINAL_THEME_NAME_MAX_BYTES),
		themeData: readTerminalThemeColors(value.themeData),
	};
}

export function readTerminalThemeDelete(input: unknown): TerminalThemeDeleteRequest {
	const value = record(input, ['expectedVersion'], TERMINAL_THEME_REQUEST_MAX_BYTES);
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) };
}

export function readTerminalThemeId(input: unknown): number {
	if (typeof input !== 'string' || !/^[1-9]\d*$/.test(input)) {
		throw new InvalidPayload();
	}
	return integer(Number(input), 1);
}

export function readTerminalThemeView(input: unknown): TerminalThemeView {
	const value = record(
		input,
		['id', 'version', 'name', 'themeData', 'preset', 'createdAt', 'updatedAt'],
		TERMINAL_THEME_REQUEST_MAX_BYTES,
	);
	if (typeof value.preset !== 'boolean') {
		throw new InvalidPayload();
	}
	const createdAt = integer(value.createdAt);
	const updatedAt = integer(value.updatedAt, createdAt);
	return {
		id: integer(value.id, 1),
		version: integer(value.version, 1),
		name: text(value.name, TERMINAL_THEME_NAME_MAX_BYTES),
		themeData: readTerminalThemeColors(value.themeData),
		preset: value.preset,
		createdAt,
		updatedAt,
	};
}

export function readTerminalThemeList(input: unknown): TerminalThemeListResponse {
	if (
		!Array.isArray(input) ||
		input.length > TERMINAL_THEME_LIST_MAX_ITEMS ||
		new TextEncoder().encode(JSON.stringify(input)).byteLength > TERMINAL_THEME_RESPONSE_MAX_BYTES
	) {
		throw new InvalidPayload();
	}
	const rows = input.map((row: unknown) => readTerminalThemeView(row));
	if (new Set(rows.map((row) => row.id)).size !== rows.length) {
		throw new InvalidPayload();
	}
	return rows;
}

export function readTerminalThemeError(input: unknown): TerminalThemeErrorResponse {
	const value = record(input, ['code']);
	const code = TERMINAL_THEME_ERROR_CODES.find((code) => code === value.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}

export function readTerminalThemeDeleted(input: unknown): TerminalThemeDeleteResponse {
	const value = record(input, ['deleted']);
	if (value.deleted !== true) {
		throw new InvalidPayload();
	}
	return { deleted: true };
}
