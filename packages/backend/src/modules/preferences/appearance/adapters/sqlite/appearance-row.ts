import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import {
	APPEARANCE_UI_THEME_MAX_BYTES,
	APPEARANCE_UI_THEME_MAX_ENTRIES,
	APPEARANCE_UI_THEME_VALUE_MAX_BYTES,
	APPEARANCE_UI_THEME_KEY_PATTERN,
	BACKGROUND_ID_PATTERN,
	APPEARANCE_COLOR_MAX_BYTES,
	APPEARANCE_FONT_MIN_SIZE,
	APPEARANCE_FONT_MAX_SIZE,
	APPEARANCE_STROKE_MAX_WIDTH,
	APPEARANCE_SHADOW_MAX_DISTANCE,
	APPEARANCE_SHADOW_MAX_BLUR,
	APPEARANCE_HTML_MAX_BYTES,
	APPEARANCE_FONT_MAX_BYTES,
	APPEARANCE_URL_MAX_BYTES,
	APPEARANCE_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/appearance/values';
import type { StoredAppearance, StoredAppearanceUiTheme } from '../../storage/appearance-storage.js';

function integer(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
		throw new Error('Corrupt appearance integer');
	}
	return input;
}

function stringValue(input: unknown, max: number): string {
	if (
		typeof input !== 'string' ||
		input.includes('\0') ||
		new TextEncoder().encode(input).byteLength > max ||
		new TextDecoder().decode(new TextEncoder().encode(input)) !== input
	) {
		throw new Error('Corrupt appearance text');
	}
	return input;
}

function nullableString(input: unknown, max: number): string | null {
	return input === null ? null : stringValue(input, max);
}

function nullableId(input: unknown): number | null {
	return input === null ? null : integer(input, 1);
}

function numberValue(input: unknown, min: number, max: number): number {
	if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max) {
		throw new Error('Corrupt appearance number');
	}
	return input;
}

function booleanValue(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new Error('Corrupt appearance boolean');
	}
	return input;
}

export function appearanceRow(row: SqlRow): StoredAppearance {
	if (typeof row.settings_json !== 'string' || Buffer.byteLength(row.settings_json) > APPEARANCE_RESPONSE_MAX_BYTES) {
		throw new Error('Corrupt appearance payload');
	}
	const raw: unknown = JSON.parse(row.settings_json);
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('Corrupt appearance object');
	}
	const value: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
	const keys = [
		'customUiTheme',
		'terminalFontFamily',
		'terminalFontSize',
		'terminalFontSizeMobile',
		'editorFontSize',
		'editorFontFamily',
		'mobileEditorFontSize',
		'terminalBackgroundId',
		'pageBackgroundId',
		'terminalBackgroundEnabled',
		'terminalBackgroundOverlayOpacity',
		'terminalCustomHtml',
		'remoteHtmlPresetsUrl',
		'windowThemeColor',
		'terminalTextStrokeEnabled',
		'terminalTextStrokeWidth',
		'terminalTextStrokeColor',
		'terminalTextShadowEnabled',
		'terminalTextShadowOffsetX',
		'terminalTextShadowOffsetY',
		'terminalTextShadowBlur',
		'terminalTextShadowColor',
	];
	if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
		throw new Error('Corrupt appearance fields');
	}
	return {
		version: integer(row.version, 1),
		activeThemeId: nullableId(row.active_theme_id),
		updatedAt: integer(row.updated_at),
		settings: {
			customUiTheme: uiTheme(value.customUiTheme),
			terminalFontFamily: stringValue(value.terminalFontFamily, APPEARANCE_FONT_MAX_BYTES),
			terminalFontSize: numberValue(value.terminalFontSize, APPEARANCE_FONT_MIN_SIZE, APPEARANCE_FONT_MAX_SIZE),
			terminalFontSizeMobile: numberValue(
				value.terminalFontSizeMobile,
				APPEARANCE_FONT_MIN_SIZE,
				APPEARANCE_FONT_MAX_SIZE,
			),
			editorFontSize: numberValue(value.editorFontSize, APPEARANCE_FONT_MIN_SIZE, APPEARANCE_FONT_MAX_SIZE),
			editorFontFamily: nullableString(value.editorFontFamily, APPEARANCE_FONT_MAX_BYTES),
			mobileEditorFontSize: numberValue(
				value.mobileEditorFontSize,
				APPEARANCE_FONT_MIN_SIZE,
				APPEARANCE_FONT_MAX_SIZE,
			),
			terminalBackgroundId: backgroundId(value.terminalBackgroundId),
			pageBackgroundId: backgroundId(value.pageBackgroundId),
			terminalBackgroundEnabled: booleanValue(value.terminalBackgroundEnabled),
			terminalBackgroundOverlayOpacity: numberValue(value.terminalBackgroundOverlayOpacity, 0, 1),
			terminalCustomHtml: stringValue(value.terminalCustomHtml, APPEARANCE_HTML_MAX_BYTES),
			remoteHtmlPresetsUrl: nullableString(value.remoteHtmlPresetsUrl, APPEARANCE_URL_MAX_BYTES),
			windowThemeColor: stringValue(value.windowThemeColor, APPEARANCE_COLOR_MAX_BYTES),
			terminalTextStrokeEnabled: booleanValue(value.terminalTextStrokeEnabled),
			terminalTextStrokeWidth: numberValue(value.terminalTextStrokeWidth, 0, APPEARANCE_STROKE_MAX_WIDTH),
			terminalTextStrokeColor: stringValue(value.terminalTextStrokeColor, APPEARANCE_COLOR_MAX_BYTES),
			terminalTextShadowEnabled: booleanValue(value.terminalTextShadowEnabled),
			terminalTextShadowOffsetX: numberValue(
				value.terminalTextShadowOffsetX,
				-APPEARANCE_SHADOW_MAX_DISTANCE,
				APPEARANCE_SHADOW_MAX_DISTANCE,
			),
			terminalTextShadowOffsetY: numberValue(
				value.terminalTextShadowOffsetY,
				-APPEARANCE_SHADOW_MAX_DISTANCE,
				APPEARANCE_SHADOW_MAX_DISTANCE,
			),
			terminalTextShadowBlur: numberValue(value.terminalTextShadowBlur, 0, APPEARANCE_SHADOW_MAX_BLUR),
			terminalTextShadowColor: stringValue(value.terminalTextShadowColor, APPEARANCE_COLOR_MAX_BYTES),
		},
	};
}

function backgroundId(input: unknown): string | null {
	if (input === null) {
		return null;
	}
	if (typeof input !== 'string' || !BACKGROUND_ID_PATTERN.test(input)) {
		throw new Error('Corrupt background reference');
	}
	return input;
}

function uiTheme(input: unknown): StoredAppearanceUiTheme {
	if (
		input === null ||
		typeof input !== 'object' ||
		Array.isArray(input) ||
		Object.keys(input).length > APPEARANCE_UI_THEME_MAX_ENTRIES ||
		Buffer.byteLength(JSON.stringify(input)) > APPEARANCE_UI_THEME_MAX_BYTES
	) {
		throw new Error('Corrupt UI theme');
	}
	const result: StoredAppearanceUiTheme = {};
	for (const [key, value] of Object.entries(input)) {
		if (!APPEARANCE_UI_THEME_KEY_PATTERN.test(key)) {
			throw new Error('Corrupt UI theme key');
		}
		result[key] = stringValue(value, APPEARANCE_UI_THEME_VALUE_MAX_BYTES);
	}
	return result;
}
