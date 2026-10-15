import { FetchFailure, type BoundedFetch } from '../../../../../platform/network/bounded-fetch.js';
import { HTML_THEME_CONTENT_MAX_BYTES } from '@nexus-terminal/shared/preferences/html-themes/values';
import type { HtmlThemeCatalog, CatalogRepository, CatalogEntry } from '../../storage/html-theme-catalog.js';
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

function decodeDirectory(bytes: Uint8Array): CatalogEntry[] {
	const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	if (!Array.isArray(input) || input.length > 1000) {
		throw new FetchFailure('unavailable');
	}
	const entries: CatalogEntry[] = [];
	const names = new Set<string>();
	for (const item of input) {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) {
			throw new FetchFailure('unavailable');
		}
		const fields: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(item)) {
			fields[key] = value;
		}
		if (
			!['file', 'dir', 'symlink', 'submodule'].includes(typeof fields.type === 'string' ? fields.type : '') ||
			typeof fields.name !== 'string' ||
			!fields.name ||
			Buffer.byteLength(fields.name) > 8192 ||
			Buffer.from(fields.name).toString('utf8') !== fields.name ||
			names.has(fields.name) ||
			(fields.download_url !== null &&
				(typeof fields.download_url !== 'string' || Buffer.byteLength(fields.download_url) > 8192))
		) {
			throw new FetchFailure('unavailable');
		}
		names.add(fields.name);
		entries.push({
			name: fields.name,
			regularFile: fields.type === 'file',
			url: fields.download_url,
		});
	}
	return entries;
}

export class GithubHtmlThemeCatalog implements HtmlThemeCatalog {
	constructor(
		private readonly network: BoundedFetch,
		private readonly token: string | null,
	) {}

	async list(repository: CatalogRepository, signal: AbortSignal): Promise<CatalogEntry[]> {
		const suffix = repository.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
		const url = new URL(
			'https://api.github.com/repos/' +
				encodeURIComponent(repository.owner) +
				'/' +
				encodeURIComponent(repository.repository) +
				'/contents' +
				(suffix ? '/' + suffix : ''),
		);
		url.searchParams.set('ref', repository.ref);
		const headers: Record<string, string> = {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'nexus-terminal',
		};
		if (this.token) {
			headers.Authorization = 'Bearer ' + this.token;
		}
		const response = await this.network.get({ url: url.href, headers, maxBytes: MAX_CATALOG_BYTES, signal });
		if (response.status !== 200) {
			throw new FetchFailure('unavailable');
		}
		try {
			return decodeDirectory(response.bytes);
		} catch (cause) {
			if (cause instanceof FetchFailure) {
				throw cause;
			}
			throw new FetchFailure('unavailable', { cause });
		}
	}

	async read(url: string, signal: AbortSignal): Promise<string> {
		const response = await this.network.get({
			url,
			headers: { Accept: 'text/html, text/plain' },
			maxBytes: HTML_THEME_CONTENT_MAX_BYTES,
			signal,
		});
		if (response.status !== 200) {
			throw new FetchFailure('unavailable');
		}
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(response.bytes);
		} catch (cause) {
			throw new FetchFailure('unavailable', { cause });
		}
	}
}
