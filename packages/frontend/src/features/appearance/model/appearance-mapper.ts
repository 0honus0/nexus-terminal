import type { AppearanceView } from '@nexus-terminal/shared/preferences/appearance/model';
import type { AppearanceUpdateRequest } from '@nexus-terminal/shared/preferences/appearance/http';
import type { TerminalThemeView, TerminalThemeColors } from '@nexus-terminal/shared/preferences/themes/model';
import { TERMINAL_THEME_COLOR_KEYS } from '@nexus-terminal/shared/preferences/themes/values';
import type {
	HtmlThemeSummary,
	RemoteHtmlThemeSummary,
	HtmlThemeRepositoryView,
} from '@nexus-terminal/shared/preferences/html-themes/model';
import type {
	AppearanceSettings,
	AppearancePatch,
	TerminalTheme,
	ThemeColors,
	LocalHtmlTheme,
	RemoteHtmlTheme,
	HtmlRepository,
} from './appearance-types';

export function fromAppearance(value: AppearanceView): AppearanceSettings {
	return {
		version: value.version,
		terminalBackgroundImage: value.terminalBackgroundImage,
		pageBackgroundImage: value.pageBackgroundImage,
		customUiTheme: value.customUiTheme,
		activeTerminalThemeId: value.activeTerminalThemeId,
		terminalFontFamily: value.terminalFontFamily,
		terminalFontSize: value.terminalFontSize,
		terminalFontSizeMobile: value.terminalFontSizeMobile,
		editorFontSize: value.editorFontSize,
		editorFontFamily: value.editorFontFamily,
		mobileEditorFontSize: value.mobileEditorFontSize,
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

export function toAppearancePatch(value: AppearancePatch, expectedVersion: number): AppearanceUpdateRequest {
	const result: AppearanceUpdateRequest = { expectedVersion };
	if (value.customUiTheme !== undefined) {
		result.customUiTheme = value.customUiTheme;
	}
	if (value.activeTerminalThemeId !== undefined) {
		result.activeTerminalThemeId = value.activeTerminalThemeId;
	}
	if (value.terminalFontFamily !== undefined) {
		result.terminalFontFamily = value.terminalFontFamily;
	}
	if (value.terminalFontSize !== undefined) {
		result.terminalFontSize = value.terminalFontSize;
	}
	if (value.terminalFontSizeMobile !== undefined) {
		result.terminalFontSizeMobile = value.terminalFontSizeMobile;
	}
	if (value.editorFontSize !== undefined) {
		result.editorFontSize = value.editorFontSize;
	}
	if (value.editorFontFamily !== undefined) {
		result.editorFontFamily = value.editorFontFamily;
	}
	if (value.mobileEditorFontSize !== undefined) {
		result.mobileEditorFontSize = value.mobileEditorFontSize;
	}
	if (value.terminalBackgroundEnabled !== undefined) {
		result.terminalBackgroundEnabled = value.terminalBackgroundEnabled;
	}
	if (value.terminalBackgroundOverlayOpacity !== undefined) {
		result.terminalBackgroundOverlayOpacity = value.terminalBackgroundOverlayOpacity;
	}
	if (value.terminalCustomHtml !== undefined) {
		result.terminalCustomHtml = value.terminalCustomHtml;
	}
	if (value.remoteHtmlPresetsUrl !== undefined) {
		result.remoteHtmlPresetsUrl = value.remoteHtmlPresetsUrl;
	}
	if (value.windowThemeColor !== undefined) {
		result.windowThemeColor = value.windowThemeColor;
	}
	if (value.terminalTextStrokeEnabled !== undefined) {
		result.terminalTextStrokeEnabled = value.terminalTextStrokeEnabled;
	}
	if (value.terminalTextStrokeWidth !== undefined) {
		result.terminalTextStrokeWidth = value.terminalTextStrokeWidth;
	}
	if (value.terminalTextStrokeColor !== undefined) {
		result.terminalTextStrokeColor = value.terminalTextStrokeColor;
	}
	if (value.terminalTextShadowEnabled !== undefined) {
		result.terminalTextShadowEnabled = value.terminalTextShadowEnabled;
	}
	if (value.terminalTextShadowOffsetX !== undefined) {
		result.terminalTextShadowOffsetX = value.terminalTextShadowOffsetX;
	}
	if (value.terminalTextShadowOffsetY !== undefined) {
		result.terminalTextShadowOffsetY = value.terminalTextShadowOffsetY;
	}
	if (value.terminalTextShadowBlur !== undefined) {
		result.terminalTextShadowBlur = value.terminalTextShadowBlur;
	}
	if (value.terminalTextShadowColor !== undefined) {
		result.terminalTextShadowColor = value.terminalTextShadowColor;
	}
	return result;
}

export function projectThemeColors(value: ThemeColors): TerminalThemeColors {
	const result: TerminalThemeColors = { foreground: value.foreground, background: value.background };
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		if (value[key] !== undefined) {
			result[key] = value[key];
		}
	}
	return result;
}

export function fromTheme(value: TerminalThemeView): TerminalTheme {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		themeData: projectThemeColors(value.themeData),
		preset: value.preset,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromLocalHtml(value: HtmlThemeSummary): LocalHtmlTheme {
	return { name: value.name, type: value.type, version: value.version, updatedAt: value.updatedAt };
}

export function fromRemoteHtml(value: RemoteHtmlThemeSummary): RemoteHtmlTheme {
	return { name: value.name, downloadUrl: value.downloadUrl };
}

export function fromRepository(value: HtmlThemeRepositoryView): HtmlRepository {
	return { url: value.url, version: value.version };
}
