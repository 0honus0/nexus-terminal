import { parseHtmlThemeRepository } from './html-theme-rules.js';
import {
	APPEARANCE_UI_THEME_MAX_BYTES,
	APPEARANCE_UI_THEME_MAX_ENTRIES,
	APPEARANCE_UI_THEME_VALUE_MAX_BYTES,
	APPEARANCE_UI_THEME_KEY_PATTERN,
} from '@nexus-terminal/shared/preferences/appearance/values';
import { AppearanceFailure } from '../appearance-failure.js';
import type {
	AppearanceSettings,
	AppearanceRecord,
	AppearanceChange,
	AppearanceWriteFacts,
} from './model/appearance-types.js';
import { defaultUiTheme } from './default-ui-theme.js';

export function defaultAppearance(defaultThemeId: number | null): AppearanceSettings {
	return {
		customUiTheme: copyDefaultUiTheme(),
		activeTerminalThemeId: defaultThemeId,
		terminalFontFamily: 'Consolas, "Courier New", monospace, "Microsoft YaHei", "微软雅黑"',
		terminalFontSize: 14,
		terminalFontSizeMobile: 14,
		editorFontSize: 14,
		editorFontFamily: 'Consolas, "Noto Sans SC", "Microsoft YaHei"',
		mobileEditorFontSize: 16,
		terminalBackgroundId: null,
		pageBackgroundId: null,
		terminalBackgroundEnabled: true,
		terminalBackgroundOverlayOpacity: 0.5,
		terminalCustomHtml: '',
		remoteHtmlPresetsUrl: 'https://github.com/0honus0/nexus-terminal/tree/main/assets/html-themes/remote',
		windowThemeColor: '#343A40',
		terminalTextStrokeEnabled: false,
		terminalTextStrokeWidth: 1,
		terminalTextStrokeColor: '#000000',
		terminalTextShadowEnabled: false,
		terminalTextShadowOffsetX: 2,
		terminalTextShadowOffsetY: 2,
		terminalTextShadowBlur: 0,
		terminalTextShadowColor: '#000000',
	};
}

export function validateAppearance(settings: AppearanceSettings): void {
	const fonts = [settings.terminalFontFamily, settings.editorFontFamily];
	if (fonts.some((font) => font !== null && !font.trim())) {
		throw new AppearanceFailure('invalid_input');
	}
	if (!/^#[0-9a-f]{6}$/iu.test(settings.windowThemeColor)) {
		throw new AppearanceFailure('invalid_input');
	}
	if (!settings.terminalTextStrokeColor.trim() || !settings.terminalTextShadowColor.trim()) {
		throw new AppearanceFailure('invalid_input');
	}
	const theme = settings.customUiTheme;
	if (
		Object.keys(theme).length > APPEARANCE_UI_THEME_MAX_ENTRIES ||
		Buffer.byteLength(JSON.stringify(theme)) > APPEARANCE_UI_THEME_MAX_BYTES
	) {
		throw new AppearanceFailure('invalid_input');
	}
	for (const [key, value] of Object.entries(theme)) {
		if (
			!APPEARANCE_UI_THEME_KEY_PATTERN.test(key) ||
			Buffer.byteLength(value) > APPEARANCE_UI_THEME_VALUE_MAX_BYTES ||
			/[\0\r\n]/u.test(value)
		) {
			throw new AppearanceFailure('invalid_input');
		}
	}
	if (settings.remoteHtmlPresetsUrl !== null) {
		try {
			parseHtmlThemeRepository(settings.remoteHtmlPresetsUrl);
		} catch (cause) {
			throw new AppearanceFailure('invalid_input', { cause });
		}
	}
}

export function applyAppearanceChange(current: AppearanceRecord, change: AppearanceChange): AppearanceSettings {
	return {
		customUiTheme: change.patch.customUiTheme === undefined ? current.customUiTheme : change.patch.customUiTheme,
		activeTerminalThemeId:
			change.patch.activeTerminalThemeId === undefined
				? current.activeTerminalThemeId
				: change.patch.activeTerminalThemeId,
		terminalFontFamily:
			change.patch.terminalFontFamily === undefined
				? current.terminalFontFamily
				: change.patch.terminalFontFamily,
		terminalFontSize:
			change.patch.terminalFontSize === undefined ? current.terminalFontSize : change.patch.terminalFontSize,
		terminalFontSizeMobile:
			change.patch.terminalFontSizeMobile === undefined
				? current.terminalFontSizeMobile
				: change.patch.terminalFontSizeMobile,
		editorFontSize:
			change.patch.editorFontSize === undefined ? current.editorFontSize : change.patch.editorFontSize,
		editorFontFamily:
			change.patch.editorFontFamily === undefined ? current.editorFontFamily : change.patch.editorFontFamily,
		mobileEditorFontSize:
			change.patch.mobileEditorFontSize === undefined
				? current.mobileEditorFontSize
				: change.patch.mobileEditorFontSize,
		terminalBackgroundId: current.terminalBackgroundId,
		pageBackgroundId: current.pageBackgroundId,
		terminalBackgroundEnabled:
			change.patch.terminalBackgroundEnabled === undefined
				? current.terminalBackgroundEnabled
				: change.patch.terminalBackgroundEnabled,
		terminalBackgroundOverlayOpacity:
			change.patch.terminalBackgroundOverlayOpacity === undefined
				? current.terminalBackgroundOverlayOpacity
				: change.patch.terminalBackgroundOverlayOpacity,
		terminalCustomHtml:
			change.patch.terminalCustomHtml === undefined
				? current.terminalCustomHtml
				: change.patch.terminalCustomHtml,
		remoteHtmlPresetsUrl:
			change.patch.remoteHtmlPresetsUrl === undefined
				? current.remoteHtmlPresetsUrl
				: change.patch.remoteHtmlPresetsUrl,
		windowThemeColor:
			change.patch.windowThemeColor === undefined ? current.windowThemeColor : change.patch.windowThemeColor,
		terminalTextStrokeEnabled:
			change.patch.terminalTextStrokeEnabled === undefined
				? current.terminalTextStrokeEnabled
				: change.patch.terminalTextStrokeEnabled,
		terminalTextStrokeWidth:
			change.patch.terminalTextStrokeWidth === undefined
				? current.terminalTextStrokeWidth
				: change.patch.terminalTextStrokeWidth,
		terminalTextStrokeColor:
			change.patch.terminalTextStrokeColor === undefined
				? current.terminalTextStrokeColor
				: change.patch.terminalTextStrokeColor,
		terminalTextShadowEnabled:
			change.patch.terminalTextShadowEnabled === undefined
				? current.terminalTextShadowEnabled
				: change.patch.terminalTextShadowEnabled,
		terminalTextShadowOffsetX:
			change.patch.terminalTextShadowOffsetX === undefined
				? current.terminalTextShadowOffsetX
				: change.patch.terminalTextShadowOffsetX,
		terminalTextShadowOffsetY:
			change.patch.terminalTextShadowOffsetY === undefined
				? current.terminalTextShadowOffsetY
				: change.patch.terminalTextShadowOffsetY,
		terminalTextShadowBlur:
			change.patch.terminalTextShadowBlur === undefined
				? current.terminalTextShadowBlur
				: change.patch.terminalTextShadowBlur,
		terminalTextShadowColor:
			change.patch.terminalTextShadowColor === undefined
				? current.terminalTextShadowColor
				: change.patch.terminalTextShadowColor,
	};
}

export function admitAppearanceChange(facts: AppearanceWriteFacts, change: AppearanceChange): AppearanceSettings {
	if (facts.current === null) {
		throw new AppearanceFailure('version_conflict');
	}
	if (facts.current.version !== change.expectedVersion) {
		throw new AppearanceFailure('version_conflict');
	}
	if (
		change.patch.activeTerminalThemeId !== undefined &&
		change.patch.activeTerminalThemeId !== null &&
		!facts.selectedThemeExists
	) {
		throw new AppearanceFailure('theme_not_found');
	}
	const next = applyAppearanceChange(facts.current, change);
	validateAppearance(next);
	return next;
}

function copyDefaultUiTheme(): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(defaultUiTheme)) {
		result[key] = value;
	}
	return result;
}
