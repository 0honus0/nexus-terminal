import { record, integer, text, InvalidPayload } from '../../common/http-codec.js';
import {
	HTML_THEME_NAME_MAX_BYTES,
	HTML_THEME_NAME_PATTERN,
	HTML_THEME_CONTENT_MAX_BYTES,
	HTML_THEME_REQUEST_MAX_BYTES,
	HTML_THEME_RESPONSE_MAX_BYTES,
	HTML_THEME_LIST_MAX_ITEMS,
	HTML_THEME_KINDS,
	HTML_THEME_ERROR_CODES,
	HTML_THEME_SOURCE_MAX_BYTES,
	HTML_THEME_REMOTE_LIST_MAX_ITEMS,
} from './values.js';
import type { HtmlThemeSummary, HtmlThemeRepositoryView, RemoteHtmlThemeSummary } from './model.js';
import type {
	HtmlThemeCreateRequest,
	HtmlThemeUpdateRequest,
	HtmlThemeDeleteRequest,
	HtmlThemeListResponse,
	HtmlThemeErrorResponse,
	HtmlThemeDeleteResponse,
	HtmlThemeRepositoryUpdateRequest,
	RemoteHtmlThemeListQuery,
	RemoteHtmlThemeContentQuery,
} from './http.js';

export function readHtmlThemeName(input: unknown): string {
	const name = text(input, HTML_THEME_NAME_MAX_BYTES);
	if (!HTML_THEME_NAME_PATTERN.test(name)) {
		throw new InvalidPayload();
	}
	return name;
}

export function readHtmlThemeContent(input: unknown): string {
	if (
		typeof input !== 'string' ||
		new TextEncoder().encode(input).byteLength > HTML_THEME_CONTENT_MAX_BYTES ||
		new TextDecoder().decode(new TextEncoder().encode(input)) !== input
	) {
		throw new InvalidPayload();
	}
	return input;
}

export function readHtmlThemeCreate(input: unknown): HtmlThemeCreateRequest {
	const value = record(input, ['name', 'content'], HTML_THEME_REQUEST_MAX_BYTES);
	return { name: readHtmlThemeName(value.name), content: readHtmlThemeContent(value.content) };
}

export function readHtmlThemeUpdate(input: unknown): HtmlThemeUpdateRequest {
	const value = record(input, ['expectedVersion', 'content'], HTML_THEME_REQUEST_MAX_BYTES);
	return {
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
		content: readHtmlThemeContent(value.content),
	};
}

export function readHtmlThemeDelete(input: unknown): HtmlThemeDeleteRequest {
	const value = record(input, ['expectedVersion']);
	return { expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1) };
}

export function readHtmlThemeSummary(input: unknown): HtmlThemeSummary {
	const value = record(input, ['name', 'type', 'version', 'updatedAt']);
	const type = HTML_THEME_KINDS.find((type) => type === value.type);
	if (!type) {
		throw new InvalidPayload();
	}
	return {
		name: readHtmlThemeName(value.name),
		type,
		version: integer(value.version, 1),
		updatedAt: integer(value.updatedAt),
	};
}

export function readHtmlThemeList(input: unknown): HtmlThemeListResponse {
	if (
		!Array.isArray(input) ||
		input.length > HTML_THEME_LIST_MAX_ITEMS ||
		new TextEncoder().encode(JSON.stringify(input)).byteLength > HTML_THEME_RESPONSE_MAX_BYTES
	) {
		throw new InvalidPayload();
	}
	const rows = input.map((row: unknown) => readHtmlThemeSummary(row));
	if (new Set(rows.map((row) => row.type + ':' + row.name)).size !== rows.length) {
		throw new InvalidPayload();
	}
	return rows;
}

export function readHtmlThemeError(input: unknown): HtmlThemeErrorResponse {
	const value = record(input, ['code']);
	const code = HTML_THEME_ERROR_CODES.find((code) => code === value.code);
	if (!code) {
		throw new InvalidPayload();
	}
	return { code };
}

export function readHtmlThemeDeleted(input: unknown): HtmlThemeDeleteResponse {
	const value = record(input, ['deleted']);
	if (value.deleted !== true) {
		throw new InvalidPayload();
	}
	return { deleted: true };
}

export function readHtmlThemeSource(input: unknown, host: 'github.com' | 'raw.githubusercontent.com'): string {
	const source = text(input, HTML_THEME_SOURCE_MAX_BYTES);
	let url: URL;
	try {
		url = new URL(source);
	} catch {
		throw new InvalidPayload();
	}
	if (
		url.protocol !== 'https:' ||
		url.hostname !== host ||
		url.port ||
		url.username ||
		url.password ||
		url.hash ||
		url.search
	) {
		throw new InvalidPayload();
	}
	return source;
}

export function readHtmlThemeRepository(input: unknown): HtmlThemeRepositoryView {
	const value = record(input, ['url', 'version']);
	return {
		url: value.url === null ? null : readHtmlThemeSource(value.url, 'github.com'),
		version: integer(value.version, 1),
	};
}

export function readHtmlThemeRepositoryUpdate(input: unknown): HtmlThemeRepositoryUpdateRequest {
	const value = record(input, ['url', 'expectedVersion']);
	return {
		url: value.url === null ? null : readHtmlThemeSource(value.url, 'github.com'),
		expectedVersion: integer(value.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
	};
}

export function readRemoteHtmlThemeListQuery(input: URLSearchParams): RemoteHtmlThemeListQuery {
	if ([...input.keys()].some((key) => key !== 'repoUrl') || input.getAll('repoUrl').length > 1) {
		throw new InvalidPayload();
	}
	const url = input.get('repoUrl');
	return { repoUrl: url === null ? null : readHtmlThemeSource(url, 'github.com') };
}

export function readRemoteHtmlThemeContentQuery(input: URLSearchParams): RemoteHtmlThemeContentQuery {
	if ([...input.keys()].some((key) => key !== 'fileUrl') || input.getAll('fileUrl').length !== 1) {
		throw new InvalidPayload();
	}
	return { fileUrl: readHtmlThemeSource(input.get('fileUrl'), 'raw.githubusercontent.com') };
}

export function readRemoteHtmlThemeList(input: unknown): RemoteHtmlThemeSummary[] {
	if (
		!Array.isArray(input) ||
		input.length > HTML_THEME_REMOTE_LIST_MAX_ITEMS ||
		new TextEncoder().encode(JSON.stringify(input)).byteLength > HTML_THEME_RESPONSE_MAX_BYTES
	) {
		throw new InvalidPayload();
	}
	const rows = input.map((row: unknown) => {
		const value = record(row, ['name', 'downloadUrl']);
		const name = readHtmlThemeName(value.name);
		const downloadUrl = readHtmlThemeSource(value.downloadUrl, 'raw.githubusercontent.com');
		try {
			if (decodeURIComponent(new URL(downloadUrl).pathname.split('/').at(-1) ?? '') !== name) {
				throw new InvalidPayload();
			}
		} catch {
			throw new InvalidPayload();
		}
		return { name, downloadUrl };
	});
	if (new Set(rows.map((row) => row.name)).size !== rows.length) {
		throw new InvalidPayload();
	}
	return rows;
}
