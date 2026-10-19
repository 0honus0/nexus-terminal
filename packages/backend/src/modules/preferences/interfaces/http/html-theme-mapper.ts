import type {
	HtmlThemeSummary,
	HtmlThemeRepositoryView,
	RemoteHtmlThemeSummary,
} from '@nexus-terminal/shared/preferences/html-themes/model';
import type {
	HtmlThemeCreateRequest,
	HtmlThemeUpdateRequest,
	HtmlThemeDeleteRequest,
	HtmlThemeRepositoryUpdateRequest,
} from '@nexus-terminal/shared/preferences/html-themes/http';
import type {
	HtmlThemeInput,
	HtmlThemeChange,
	HtmlThemeVersion,
	HtmlThemeListing,
	HtmlThemeSource,
	HtmlThemeSourceChange,
	RemoteHtmlThemeListing,
} from '../../appearance/model/html-theme-types.js';

export function toApplicationHtmlTheme(input: HtmlThemeCreateRequest): HtmlThemeInput {
	return { name: input.name, content: input.content };
}

export function toApplicationHtmlThemeChange(name: string, input: HtmlThemeUpdateRequest): HtmlThemeChange {
	return { name, expectedVersion: input.expectedVersion, content: input.content };
}

export function toApplicationHtmlThemeVersion(name: string, input: HtmlThemeDeleteRequest): HtmlThemeVersion {
	return { name, expectedVersion: input.expectedVersion };
}

export function toWireHtmlTheme(value: HtmlThemeListing): HtmlThemeSummary {
	return { name: value.name, type: value.kind, version: value.version, updatedAt: value.updatedAt };
}

export function toApplicationHtmlThemeSource(value: HtmlThemeRepositoryUpdateRequest): HtmlThemeSourceChange {
	return { url: value.url, expectedVersion: value.expectedVersion };
}

export function toWireHtmlThemeSource(value: HtmlThemeSource): HtmlThemeRepositoryView {
	return { url: value.url, version: value.version };
}

export function toWireRemoteHtmlTheme(value: RemoteHtmlThemeListing): RemoteHtmlThemeSummary {
	return { name: value.name, downloadUrl: value.downloadUrl };
}
