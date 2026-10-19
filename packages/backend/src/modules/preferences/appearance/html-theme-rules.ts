import {
	HTML_THEME_NAME_PATTERN,
	HTML_THEME_NAME_MAX_BYTES,
	HTML_THEME_CONTENT_MAX_BYTES,
	HTML_THEME_REMOTE_LIST_MAX_ITEMS,
	HTML_THEME_SOURCE_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/html-themes/values';
import { HtmlThemeFailure } from '../html-theme-failure.js';
import type {
	HtmlThemeInput,
	HtmlThemeWriteFacts,
	HtmlThemeRepository,
	HtmlThemeDirectoryEntry,
	RemoteHtmlThemeListing,
} from './model/html-theme-types.js';

export const MAX_CUSTOM_HTML_THEMES = 2048;

export function validateHtmlThemeName(name: string): void {
	if (
		!name.trim() ||
		!HTML_THEME_NAME_PATTERN.test(name) ||
		Buffer.byteLength(name) > HTML_THEME_NAME_MAX_BYTES ||
		Buffer.from(name).toString('utf8') !== name
	) {
		throw new HtmlThemeFailure('invalid_input');
	}
}

export function validateHtmlThemeInput(input: HtmlThemeInput): void {
	validateHtmlThemeName(input.name);
	if (Buffer.byteLength(input.content) > HTML_THEME_CONTENT_MAX_BYTES) {
		throw new HtmlThemeFailure('limit_exceeded');
	}
	if (Buffer.from(input.content).toString('utf8') !== input.content) {
		throw new HtmlThemeFailure('invalid_input');
	}
}

export function admitHtmlThemeMutation(facts: HtmlThemeWriteFacts, expectedVersion: number | null): void {
	if (expectedVersion === null) {
		if (facts.current !== null) {
			throw new HtmlThemeFailure('name_conflict');
		}
		if (facts.count >= MAX_CUSTOM_HTML_THEMES) {
			throw new HtmlThemeFailure('limit_exceeded');
		}
		return;
	}
	if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
		throw new HtmlThemeFailure('invalid_input');
	}
	if (facts.current === null) {
		throw new HtmlThemeFailure('not_found');
	}
	if (facts.current.version !== expectedVersion) {
		throw new HtmlThemeFailure('version_conflict');
	}
}

export function parseHtmlThemeRepository(source: string): HtmlThemeRepository {
	try {
		const url = new URL(source);
		if (
			url.protocol !== 'https:' ||
			url.hostname !== 'github.com' ||
			url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			throw new Error('Invalid source origin');
		}
		const segments = url.pathname.replace(/\/$/u, '').split('/').slice(1).map(decodeURIComponent);
		const owner = segments[0];
		const repository = segments[1]?.replace(/\.git$/iu, '');
		if (
			!owner ||
			!repository ||
			!/^[A-Za-z0-9_.-]+$/u.test(owner) ||
			!/^[A-Za-z0-9_.-]+$/u.test(repository) ||
			owner === '.' ||
			owner === '..' ||
			repository === '.' ||
			repository === '..'
		) {
			throw new Error('Invalid repository');
		}
		if (segments.length === 2) {
			return { owner, repository, ref: 'HEAD', path: '' };
		}
		const ref = segments[3];
		const paths = segments.slice(4);
		if (
			segments[2] !== 'tree' ||
			!ref ||
			/[\0\r\n]/u.test(ref) ||
			paths.some((part) => !part || part === '.' || part === '..' || /[\0\r\n\\]/u.test(part))
		) {
			throw new Error('Invalid repository path');
		}
		return { owner, repository, ref, path: paths.join('/') };
	} catch (cause) {
		throw new HtmlThemeFailure('source_invalid', { cause });
	}
}

export function validateRawHtmlThemeUrl(source: string): void {
	try {
		const url = new URL(source);
		if (
			url.protocol !== 'https:' ||
			url.hostname !== 'raw.githubusercontent.com' ||
			url.port ||
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			!decodeURIComponent(url.pathname).endsWith('.html')
		) {
			throw new Error('Invalid raw HTML source');
		}
	} catch (cause) {
		throw new HtmlThemeFailure('source_invalid', { cause });
	}
}

export function projectRemoteHtmlThemes(entries: HtmlThemeDirectoryEntry[]): RemoteHtmlThemeListing[] {
	if (entries.length > HTML_THEME_REMOTE_LIST_MAX_ITEMS) {
		throw new HtmlThemeFailure('limit_exceeded');
	}
	const result: RemoteHtmlThemeListing[] = [];
	for (const entry of entries) {
		if (!entry.regularFile || !entry.name.endsWith('.html')) {
			continue;
		}
		validateHtmlThemeName(entry.name);
		if (entry.url === null) {
			throw new HtmlThemeFailure('source_unavailable');
		}
		validateRawHtmlThemeUrl(entry.url);
		if (
			Buffer.byteLength(entry.url) > HTML_THEME_SOURCE_MAX_BYTES ||
			decodeURIComponent(new URL(entry.url).pathname.split('/').at(-1) ?? '') !== entry.name
		) {
			throw new HtmlThemeFailure('source_invalid');
		}
		result.push({ name: entry.name, downloadUrl: entry.url });
	}
	return result;
}
