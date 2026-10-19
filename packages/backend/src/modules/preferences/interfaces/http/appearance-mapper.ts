import { readAppearanceUiTheme } from '@nexus-terminal/shared/preferences/appearance/http-codec';
import { BACKGROUND_FILE_PREFIX } from '@nexus-terminal/shared/preferences/appearance/values';
import type { AppearanceView } from '@nexus-terminal/shared/preferences/appearance/model';
import type { AppearanceUpdateRequest } from '@nexus-terminal/shared/preferences/appearance/http';
import type { AppearanceRecord, AppearanceChange } from '../../appearance/model/appearance-types.js';

export function toApplicationAppearance(input: AppearanceUpdateRequest): AppearanceChange {
	return {
		expectedVersion: input.expectedVersion,
		patch: {
			customUiTheme: input.customUiTheme === undefined ? undefined : toApplicationUiTheme(input.customUiTheme),
			activeTerminalThemeId: input.activeTerminalThemeId,
			terminalFontFamily: input.terminalFontFamily,
			terminalFontSize: input.terminalFontSize,
			terminalFontSizeMobile: input.terminalFontSizeMobile,
			editorFontSize: input.editorFontSize,
			editorFontFamily: input.editorFontFamily,
			mobileEditorFontSize: input.mobileEditorFontSize,
			terminalBackgroundEnabled: input.terminalBackgroundEnabled,
			terminalBackgroundOverlayOpacity: input.terminalBackgroundOverlayOpacity,
			terminalCustomHtml: input.terminalCustomHtml,
			remoteHtmlPresetsUrl: input.remoteHtmlPresetsUrl,
			windowThemeColor: input.windowThemeColor,
			terminalTextStrokeEnabled: input.terminalTextStrokeEnabled,
			terminalTextStrokeWidth: input.terminalTextStrokeWidth,
			terminalTextStrokeColor: input.terminalTextStrokeColor,
			terminalTextShadowEnabled: input.terminalTextShadowEnabled,
			terminalTextShadowOffsetX: input.terminalTextShadowOffsetX,
			terminalTextShadowOffsetY: input.terminalTextShadowOffsetY,
			terminalTextShadowBlur: input.terminalTextShadowBlur,
			terminalTextShadowColor: input.terminalTextShadowColor,
		},
	};
}

export function toWireAppearance(value: AppearanceRecord): AppearanceView {
	return {
		version: value.version,
		customUiTheme: JSON.stringify(value.customUiTheme),
		activeTerminalThemeId: value.activeTerminalThemeId,
		terminalFontFamily: value.terminalFontFamily,
		terminalFontSize: value.terminalFontSize,
		terminalFontSizeMobile: value.terminalFontSizeMobile,
		editorFontSize: value.editorFontSize,
		editorFontFamily: value.editorFontFamily,
		mobileEditorFontSize: value.mobileEditorFontSize,
		terminalBackgroundImage:
			value.terminalBackgroundId === null ? null : BACKGROUND_FILE_PREFIX + value.terminalBackgroundId,
		pageBackgroundImage: value.pageBackgroundId === null ? null : BACKGROUND_FILE_PREFIX + value.pageBackgroundId,
		terminalBackgroundEnabled: value.terminalBackgroundEnabled,
		terminalBackgroundOverlayOpacity: value.terminalBackgroundOverlayOpacity,
		terminalCustomHtml: value.terminalCustomHtml,
		remoteHtmlPresetsUrl: value.remoteHtmlPresetsUrl,
		windowThemeColor: value.windowThemeColor,
		terminalTextStrokeEnabled: value.terminalTextStrokeEnabled,
		terminalTextStrokeWidth: value.terminalTextStrokeWidth,
		terminalTextStrokeColor: value.terminalTextStrokeColor,
		terminalTextShadowEnabled: value.terminalTextShadowEnabled,
		terminalTextShadowOffsetX: value.terminalTextShadowOffsetX,
		terminalTextShadowOffsetY: value.terminalTextShadowOffsetY,
		terminalTextShadowBlur: value.terminalTextShadowBlur,
		terminalTextShadowColor: value.terminalTextShadowColor,
	};
}

function toApplicationUiTheme(input: string): Record<string, string> {
	const decoded = readAppearanceUiTheme(input);
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(decoded)) {
		result[key] = value;
	}
	return result;
}
