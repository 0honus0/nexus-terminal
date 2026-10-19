import { record, integer, InvalidPayload } from '../../common/http-codec.js';
import {
	APPEARANCE_UI_THEME_MAX_BYTES,
	APPEARANCE_UI_THEME_MAX_ENTRIES,
	APPEARANCE_UI_THEME_VALUE_MAX_BYTES,
	APPEARANCE_UI_THEME_KEY_PATTERN,
	BACKGROUND_FILE_PREFIX,
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
	APPEARANCE_REQUEST_MAX_BYTES,
	APPEARANCE_RESPONSE_MAX_BYTES,
	APPEARANCE_ERROR_CODES,
} from './values.js';
import type { AppearanceView, AppearanceUiTheme } from './model.js';
import type {
	AppearanceUpdateRequest,
	AppearanceErrorResponse,
	BackgroundUploadFields,
	BackgroundDeleteRequest,
	BackgroundMutationResponse,
	BackgroundFilePathParameters,
} from './http.js';

function stringValue(input: unknown, max: number): string {
	if (
		typeof input !== 'string' ||
		input.includes('\0') ||
		new TextEncoder().encode(input).byteLength > max ||
		new TextDecoder().decode(new TextEncoder().encode(input)) !== input
	) {
		throw new InvalidPayload();
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
		throw new InvalidPayload();
	}
	return input;
}

function booleanValue(input: unknown): boolean {
	if (typeof input !== 'boolean') {
		throw new InvalidPayload();
	}
	return input;
}

export function readAppearanceUpdate(input: unknown): AppearanceUpdateRequest {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidPayload();
	}
	const keys = Object.keys(input);
	const allowed = [
		'expectedVersion',
		'customUiTheme',
		'activeTerminalThemeId',
		'terminalFontFamily',
		'terminalFontSize',
		'terminalFontSizeMobile',
		'editorFontSize',
		'editorFontFamily',
		'mobileEditorFontSize',
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
	if (keys.length < 2 || !keys.includes('expectedVersion') || keys.some((key) => !allowed.includes(key))) {
		throw new InvalidPayload();
	}
	const value = record(input, keys, APPEARANCE_REQUEST_MAX_BYTES);
	const result: AppearanceUpdateRequest = {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
	};
	if (Object.hasOwn(value, 'customUiTheme')) {
		readAppearanceUiTheme(value.customUiTheme);
		result.customUiTheme = stringValue(value.customUiTheme, APPEARANCE_UI_THEME_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'activeTerminalThemeId')) {
		result.activeTerminalThemeId = nullableId(value.activeTerminalThemeId);
	}
	if (Object.hasOwn(value, 'terminalFontFamily')) {
		result.terminalFontFamily = stringValue(value.terminalFontFamily, APPEARANCE_FONT_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'terminalFontSize')) {
		result.terminalFontSize = numberValue(
			value.terminalFontSize,
			APPEARANCE_FONT_MIN_SIZE,
			APPEARANCE_FONT_MAX_SIZE,
		);
	}
	if (Object.hasOwn(value, 'terminalFontSizeMobile')) {
		result.terminalFontSizeMobile = numberValue(
			value.terminalFontSizeMobile,
			APPEARANCE_FONT_MIN_SIZE,
			APPEARANCE_FONT_MAX_SIZE,
		);
	}
	if (Object.hasOwn(value, 'editorFontSize')) {
		result.editorFontSize = numberValue(value.editorFontSize, APPEARANCE_FONT_MIN_SIZE, APPEARANCE_FONT_MAX_SIZE);
	}
	if (Object.hasOwn(value, 'editorFontFamily')) {
		result.editorFontFamily = nullableString(value.editorFontFamily, APPEARANCE_FONT_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'mobileEditorFontSize')) {
		result.mobileEditorFontSize = numberValue(
			value.mobileEditorFontSize,
			APPEARANCE_FONT_MIN_SIZE,
			APPEARANCE_FONT_MAX_SIZE,
		);
	}
	if (Object.hasOwn(value, 'terminalBackgroundEnabled')) {
		result.terminalBackgroundEnabled = booleanValue(value.terminalBackgroundEnabled);
	}
	if (Object.hasOwn(value, 'terminalBackgroundOverlayOpacity')) {
		result.terminalBackgroundOverlayOpacity = numberValue(value.terminalBackgroundOverlayOpacity, 0, 1);
	}
	if (Object.hasOwn(value, 'terminalCustomHtml')) {
		result.terminalCustomHtml = stringValue(value.terminalCustomHtml, APPEARANCE_HTML_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'remoteHtmlPresetsUrl')) {
		result.remoteHtmlPresetsUrl = nullableString(value.remoteHtmlPresetsUrl, APPEARANCE_URL_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'windowThemeColor')) {
		result.windowThemeColor = stringValue(value.windowThemeColor, APPEARANCE_COLOR_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'terminalTextStrokeEnabled')) {
		result.terminalTextStrokeEnabled = booleanValue(value.terminalTextStrokeEnabled);
	}
	if (Object.hasOwn(value, 'terminalTextStrokeWidth')) {
		result.terminalTextStrokeWidth = numberValue(value.terminalTextStrokeWidth, 0, APPEARANCE_STROKE_MAX_WIDTH);
	}
	if (Object.hasOwn(value, 'terminalTextStrokeColor')) {
		result.terminalTextStrokeColor = stringValue(value.terminalTextStrokeColor, APPEARANCE_COLOR_MAX_BYTES);
	}
	if (Object.hasOwn(value, 'terminalTextShadowEnabled')) {
		result.terminalTextShadowEnabled = booleanValue(value.terminalTextShadowEnabled);
	}
	if (Object.hasOwn(value, 'terminalTextShadowOffsetX')) {
		result.terminalTextShadowOffsetX = numberValue(
			value.terminalTextShadowOffsetX,
			-APPEARANCE_SHADOW_MAX_DISTANCE,
			APPEARANCE_SHADOW_MAX_DISTANCE,
		);
	}
	if (Object.hasOwn(value, 'terminalTextShadowOffsetY')) {
		result.terminalTextShadowOffsetY = numberValue(
			value.terminalTextShadowOffsetY,
			-APPEARANCE_SHADOW_MAX_DISTANCE,
			APPEARANCE_SHADOW_MAX_DISTANCE,
		);
	}
	if (Object.hasOwn(value, 'terminalTextShadowBlur')) {
		result.terminalTextShadowBlur = numberValue(value.terminalTextShadowBlur, 0, APPEARANCE_SHADOW_MAX_BLUR);
	}
	if (Object.hasOwn(value, 'terminalTextShadowColor')) {
		result.terminalTextShadowColor = stringValue(value.terminalTextShadowColor, APPEARANCE_COLOR_MAX_BYTES);
	}
	return result;
}

export function readAppearanceView(input: unknown): AppearanceView {
	const value = record(
		input,
		[
			'version',
			'customUiTheme',
			'activeTerminalThemeId',
			'terminalFontFamily',
			'terminalFontSize',
			'terminalFontSizeMobile',
			'editorFontSize',
			'editorFontFamily',
			'mobileEditorFontSize',
			'terminalBackgroundImage',
			'pageBackgroundImage',
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
		],
		APPEARANCE_RESPONSE_MAX_BYTES,
	);
	readAppearanceUiTheme(value.customUiTheme);
	return {
		version: integer(value.version, 1),
		customUiTheme: stringValue(value.customUiTheme, APPEARANCE_UI_THEME_MAX_BYTES),
		activeTerminalThemeId: nullableId(value.activeTerminalThemeId),
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
		terminalBackgroundImage: backgroundPath(value.terminalBackgroundImage),
		pageBackgroundImage: backgroundPath(value.pageBackgroundImage),
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
	};
}

export function readAppearanceError(input: unknown): AppearanceErrorResponse {
	const value = record(input, ['code']);
	const code = APPEARANCE_ERROR_CODES.find((code) => code === value.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}

export function readBackgroundUploadFields(input: unknown): BackgroundUploadFields {
	const value = record(input, ['expectedVersion']);
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) };
}

export function readBackgroundDelete(input: unknown): BackgroundDeleteRequest {
	const value = record(input, ['expectedVersion']);
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) };
}

export function readBackgroundFilePath(input: unknown): BackgroundFilePathParameters {
	if (typeof input !== 'string' || !BACKGROUND_ID_PATTERN.test(input)) {
		throw new InvalidPayload();
	}
	return { filename: input };
}

export function readBackgroundMutation(input: unknown): BackgroundMutationResponse {
	const value = record(input, ['appearance', 'cleanupPending'], APPEARANCE_RESPONSE_MAX_BYTES);
	if (typeof value.cleanupPending !== 'boolean') {
		throw new InvalidPayload();
	}
	return { appearance: readAppearanceView(value.appearance), cleanupPending: value.cleanupPending };
}

function backgroundPath(input: unknown): string | null {
	if (input === null) {
		return null;
	}
	if (
		typeof input !== 'string' ||
		!input.startsWith(BACKGROUND_FILE_PREFIX) ||
		!BACKGROUND_ID_PATTERN.test(input.slice(BACKGROUND_FILE_PREFIX.length))
	) {
		throw new InvalidPayload();
	}
	return input;
}

export function readAppearanceUiTheme(input: unknown): AppearanceUiTheme {
	const encoded = stringValue(input, APPEARANCE_UI_THEME_MAX_BYTES);
	let value: unknown;
	try {
		value = JSON.parse(encoded);
	} catch {
		throw new InvalidPayload();
	}
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length > APPEARANCE_UI_THEME_MAX_ENTRIES
	) {
		throw new InvalidPayload();
	}
	const result: AppearanceUiTheme = {};
	for (const [key, item] of Object.entries(value)) {
		if (!APPEARANCE_UI_THEME_KEY_PATTERN.test(key)) {
			throw new InvalidPayload();
		}
		result[key] = stringValue(item, APPEARANCE_UI_THEME_VALUE_MAX_BYTES);
	}
	return result;
}
