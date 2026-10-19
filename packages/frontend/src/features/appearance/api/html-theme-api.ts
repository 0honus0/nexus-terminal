import {
	readHtmlThemeName,
	readHtmlThemeContent,
	readHtmlThemeCreate,
	readHtmlThemeUpdate,
	readHtmlThemeDelete,
	readHtmlThemeSummary,
	readHtmlThemeList,
	readHtmlThemeError,
	readHtmlThemeDeleted,
	readHtmlThemeRepository,
	readHtmlThemeRepositoryUpdate,
	readRemoteHtmlThemeListQuery,
	readRemoteHtmlThemeContentQuery,
	readRemoteHtmlThemeList,
} from '@nexus-terminal/shared/preferences/html-themes/http-codec';
import {
	HTML_THEME_REQUEST_MAX_BYTES,
	HTML_THEME_RESPONSE_MAX_BYTES,
	HTML_THEME_CONTENT_MAX_BYTES,
} from '@nexus-terminal/shared/preferences/html-themes/values';
import { requestAppearance, requestAppearanceBytes } from './appearance-request';
import { fromLocalHtml, fromRemoteHtml, fromRepository } from '../model/appearance-mapper';
import { AppearanceRequestFailure } from '../model/appearance-failure';
import type { LocalHtmlTheme, RemoteHtmlTheme, HtmlRepository } from '../model/appearance-types';

const path = '/appearance/html-presets';
const protocol = {
	maxRequestBytes: HTML_THEME_REQUEST_MAX_BYTES,
	maxResponseBytes: HTML_THEME_RESPONSE_MAX_BYTES,
	decodeError: readHtmlThemeError,
};

function validate<T>(read: () => T): T {
	try {
		return read();
	} catch (cause) {
		throw new AppearanceRequestFailure('invalid_input', 'not_dispatched', { cause });
	}
}

async function text(path: string, signal?: AbortSignal): Promise<string> {
	const result = await requestAppearanceBytes({
		method: 'GET',
		path,
		maxRequestBytes: HTML_THEME_REQUEST_MAX_BYTES,
		maxResponseBytes: HTML_THEME_CONTENT_MAX_BYTES,
		maxErrorBytes: HTML_THEME_REQUEST_MAX_BYTES,
		decodeError: readHtmlThemeError,
		signal,
	});
	try {
		if (
			result.status !== 200 ||
			!result.contentType ||
			!/^text\/plain(?:\s*;\s*charset=utf-8)?$/iu.test(result.contentType)
		) {
			throw new Error('Invalid HTML content response');
		}
		return readHtmlThemeContent(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes));
	} catch (cause) {
		throw new AppearanceRequestFailure('protocol_failure', 'unknown', { cause });
	}
}

export const htmlThemeApi = {
	async list(signal?: AbortSignal): Promise<LocalHtmlTheme[]> {
		return (
			await requestAppearance({
				...protocol,
				method: 'GET',
				path: path + '/local',
				decode: readHtmlThemeList,
				signal,
			})
		).map(fromLocalHtml);
	},

	async read(name: string, signal?: AbortSignal): Promise<string> {
		return text(path + '/local/' + encodeURIComponent(validate(() => readHtmlThemeName(name))), signal);
	},

	async create(name: string, content: string, signal?: AbortSignal): Promise<LocalHtmlTheme> {
		const command = validate(() => readHtmlThemeCreate({ name, content }));
		return requestAppearance({
			...protocol,
			method: 'POST',
			path: path + '/local',
			status: 201,

			input: () => command,

			decode: (raw) => {
				const result = readHtmlThemeSummary(raw);
				if (result.type !== 'custom' || result.name !== command.name) {
					throw new Error('Unrelated HTML creation');
				}
				return fromLocalHtml(result);
			},

			signal,
		});
	},

	async update(original: LocalHtmlTheme, content: string, signal?: AbortSignal): Promise<LocalHtmlTheme> {
		const name = validate(() => readHtmlThemeName(original.name));
		return requestAppearance({
			...protocol,
			method: 'PUT',
			path: path + '/local/' + encodeURIComponent(name),

			input: () => readHtmlThemeUpdate({ expectedVersion: original.version, content }),

			decode: (raw) => {
				const result = readHtmlThemeSummary(raw);
				if (result.type !== 'custom' || result.name !== name || result.version <= original.version) {
					throw new Error('Unrelated HTML update');
				}
				return fromLocalHtml(result);
			},

			signal,
		});
	},

	async remove(original: LocalHtmlTheme, signal?: AbortSignal): Promise<void> {
		const name = validate(() => readHtmlThemeName(original.name));
		await requestAppearance({
			...protocol,
			method: 'DELETE',
			path: path + '/local/' + encodeURIComponent(name),

			input: () => readHtmlThemeDelete({ expectedVersion: original.version }),

			decode: readHtmlThemeDeleted,
			signal,
		});
	},

	async repository(signal?: AbortSignal): Promise<HtmlRepository> {
		return fromRepository(
			await requestAppearance({
				...protocol,
				method: 'GET',
				path: path + '/remote/repository-url',
				decode: readHtmlThemeRepository,
				signal,
			}),
		);
	},

	async updateRepository(url: string | null, expectedVersion: number, signal?: AbortSignal): Promise<HtmlRepository> {
		const command = validate(() => readHtmlThemeRepositoryUpdate({ url, expectedVersion }));
		return requestAppearance({
			...protocol,
			method: 'PUT',
			path: path + '/remote/repository-url',

			input: () => command,

			decode: (raw) => {
				const result = readHtmlThemeRepository(raw);
				if (result.version !== expectedVersion + 1 || result.url !== command.url) {
					throw new Error('Unrelated repository revision');
				}
				return fromRepository(result);
			},

			signal,
		});
	},

	async listRemote(repoUrl: string, signal?: AbortSignal): Promise<RemoteHtmlTheme[]> {
		const query = new URLSearchParams({ repoUrl });
		validate(() => readRemoteHtmlThemeListQuery(query));
		return (
			await requestAppearance({
				...protocol,
				method: 'GET',
				path: path + '/remote/list?' + query,
				decode: readRemoteHtmlThemeList,
				signal,
			})
		).map(fromRemoteHtml);
	},

	async readRemote(fileUrl: string, signal?: AbortSignal): Promise<string> {
		const query = new URLSearchParams({ fileUrl });
		validate(() => readRemoteHtmlThemeContentQuery(query));
		return text(path + '/remote/content?' + query, signal);
	},
};
