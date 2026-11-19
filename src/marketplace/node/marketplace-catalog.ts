import { randomUUID } from 'node:crypto';
import { prerelease, valid } from 'semver';
import { z } from 'zod';
import { HttpFailure, type HttpRoute, type PluginHttpApi } from '../../http/node/http-plugin-api.js';
import {
	MarketplaceCatalogQuerySchema,
	MarketplaceRepositorySchema,
	MarketplaceRepositoryUrlSchema,
	RepositoryCatalogSchema,
	type MarketplaceCatalogPlugin,
	type MarketplaceCatalogQuery,
	type MarketplaceRepository,
	type RepositoryCatalog,
} from '../marketplace-catalog-types.js';
import {
	MarketplaceAddRepositorySchema,
	MarketplaceCatalogListSchema,
	MarketplaceRepositoryListSchema,
	MarketplaceRepositoryParamsSchema,
	MarketplaceUpdateRepositorySchema,
} from '../marketplace-http-types.js';
import type { MarketplaceStorage } from './marketplace-storage.js';

const empty = z.strictObject({});
const catalogTimeout = 15000;

/** 市场内置的官方仓库完整目录地址。 */
const officialRepositoryUrls: readonly string[] = [];

type Change = <Result>(operation: () => Promise<Result>) => Promise<Result>;

function validateCatalog(input: unknown): RepositoryCatalog {
	const result = RepositoryCatalogSchema.safeParse(input);
	if (!result.success) throw new HttpFailure(502, 'MARKETPLACE_REPOSITORY_CATALOG_INVALID');

	const names = new Set<string>();
	for (const { id, versions } of result.data) {
		if (names.has(id)) throw new HttpFailure(502, 'MARKETPLACE_REPOSITORY_CATALOG_INVALID');
		names.add(id);

		const published = new Set<string>();
		for (const { package: manifest } of versions) {
			const version = valid(manifest.version);
			if (manifest.name !== id || !version || published.has(version))
				throw new HttpFailure(502, 'MARKETPLACE_REPOSITORY_CATALOG_INVALID');
			published.add(version);
		}
	}
	return result.data;
}

function repositoryHttpCode(status: number): string {
	switch (status) {
		case 401:
		case 403:
			return 'MARKETPLACE_REPOSITORY_ACCESS_DENIED';
		case 404:
		case 410:
			return 'MARKETPLACE_REPOSITORY_CATALOG_NOT_FOUND';
		case 429:
			return 'MARKETPLACE_REPOSITORY_RATE_LIMITED';
		default:
			return status >= 500 ? 'MARKETPLACE_REPOSITORY_SERVICE_UNAVAILABLE' : 'MARKETPLACE_REPOSITORY_HTTP_FAILED';
	}
}

async function fetchCatalog(url: string, signal: AbortSignal): Promise<RepositoryCatalog> {
	const timeout = AbortSignal.timeout(catalogTimeout);
	let data: unknown;
	try {
		// 仓库请求只带目录 URL 和取消信号，宿主会话停留在本地 HTTP 边界。
		const response = await fetch(url, { signal: AbortSignal.any([signal, timeout]) });
		if (!response.ok) {
			await response.body?.cancel();
			throw new HttpFailure(502, repositoryHttpCode(response.status));
		}
		data = await response.json();
	} catch (cause) {
		signal.throwIfAborted();
		if (timeout.aborted) throw new HttpFailure(504, 'MARKETPLACE_REPOSITORY_FETCH_TIMEOUT');
		if (cause instanceof HttpFailure) throw cause;
		if (cause instanceof SyntaxError) throw new HttpFailure(502, 'MARKETPLACE_REPOSITORY_CATALOG_INVALID');
		throw new HttpFailure(502, 'MARKETPLACE_REPOSITORY_FETCH_FAILED');
	}

	signal.throwIfAborted();
	return validateCatalog(data);
}

/** 管理仓库配置和目录缓存。刷新成功后一次提交，筛选和安装计划只读缓存。 */
export class MarketplaceCatalog {
	readonly #storage: MarketplaceStorage;
	readonly #change: Change;

	constructor(storage: MarketplaceStorage, change: Change) {
		this.#storage = storage;
		this.#change = change;
	}

	register(http: PluginHttpApi): void {
		http.register([
			{
				method: 'get',
				path: '/repositories',
				input: empty,
				output: MarketplaceRepositoryListSchema,

				handler: async () => ({ items: await this.#repositories() }),
			},
			{
				method: 'post',
				path: '/repositories',
				input: MarketplaceAddRepositorySchema,
				output: MarketplaceRepositorySchema,
				status: 201,
				handler: this.#addRepository,
			},
			{
				method: 'patch',
				path: '/repositories/:repositoryId',
				input: MarketplaceUpdateRepositorySchema,
				output: MarketplaceRepositorySchema,
				handler: this.#updateRepository,
			},
			{
				method: 'delete',
				path: '/repositories/:repositoryId',
				input: MarketplaceRepositoryParamsSchema,
				output: empty,
				status: 204,
				handler: this.#removeRepository,
			},
			{
				method: 'post',
				path: '/repositories/:repositoryId/refresh',
				input: MarketplaceRepositoryParamsSchema,
				output: empty,
				status: 204,
				handler: this.#refreshRepository,
			},
			{
				method: 'get',
				path: '/plugins',
				input: MarketplaceCatalogQuerySchema,
				output: MarketplaceCatalogListSchema,
				handler: this.#listPlugins,
			},
		]);
	}

	readonly #addRepository: HttpRoute<
		typeof MarketplaceAddRepositorySchema,
		typeof MarketplaceRepositorySchema
	>['handler'] = ({ url }, signal) => this.#change(() => this.#add(url, signal));

	readonly #updateRepository: HttpRoute<
		typeof MarketplaceUpdateRepositorySchema,
		typeof MarketplaceRepositorySchema
	>['handler'] = ({ repositoryId, url, label }, signal) =>
		this.#change(() => this.#update(repositoryId, url, label, signal));

	readonly #removeRepository: HttpRoute<typeof MarketplaceRepositoryParamsSchema, typeof empty>['handler'] = async (
		{ repositoryId },
		signal,
	) => {
		await this.#change(() => {
			signal.throwIfAborted();
			return this.#storage.removeRepository(repositoryId);
		});
		return {};
	};

	readonly #refreshRepository: HttpRoute<typeof MarketplaceRepositoryParamsSchema, typeof empty>['handler'] = async (
		{ repositoryId },
		signal,
	) => {
		await this.#change(() => this.#refresh(repositoryId, signal));
		return {};
	};

	readonly #listPlugins: HttpRoute<
		typeof MarketplaceCatalogQuerySchema,
		typeof MarketplaceCatalogListSchema
	>['handler'] = async (query) => ({ items: await this.#search(query) });

	/** 归属来自数据库记录；同名同版本的不同来源在合并后仍是独立候选。 */
	async snapshot(): Promise<{ repositories: MarketplaceRepository[]; catalog: MarketplaceCatalogPlugin[] }> {
		const rows = await this.#storage.readCatalog();
		const items = new Map<string, MarketplaceCatalogPlugin['versions']>();
		for (const { repository, catalog } of rows) {
			for (const { id, versions } of catalog) {
				const merged = items.get(id) ?? [];
				for (const version of versions) merged.push({ ...version, repositoryId: repository.id });
				items.set(id, merged);
			}
		}
		return {
			repositories: rows.map(({ repository }) => this.#view(repository)),
			catalog: [...items].sort(([a], [b]) => a.localeCompare(b)).map(([id, versions]) => ({ id, versions })),
		};
	}

	async #search({ kind, keyword, release }: MarketplaceCatalogQuery): Promise<MarketplaceCatalogPlugin[]> {
		const term = keyword?.trim().toLowerCase();
		const { catalog } = await this.snapshot();
		return catalog
			.map(({ id, versions }) => ({
				id,
				versions: versions.filter(({ package: manifest }) => {
					if (kind && manifest.nexus.kind !== kind) return false;
					if (release && release !== 'all' && (release === 'prerelease') !== !!prerelease(manifest.version))
						return false;
					if (!term) return true;
					return [
						manifest.name,
						manifest.description,
						...Object.values(manifest.nexus.i18n ?? {}).map(({ description }) => description),
					]
						.join(' ')
						.toLowerCase()
						.includes(term);
				}),
			}))
			.filter(({ versions }) => versions.length > 0);
	}

	async #repositories(): Promise<MarketplaceRepository[]> {
		return (await this.#storage.listRepositories()).map((repository) => this.#view(repository));
	}

	async #add(address: string, signal: AbortSignal): Promise<MarketplaceRepository> {
		signal.throwIfAborted();
		const url = this.#normalize(address);
		const records = await this.#repositories();
		if (records.some((record) => record.url === url))
			throw new HttpFailure(409, 'MARKETPLACE_REPOSITORY_ALREADY_EXISTS');

		const repository = { id: randomUUID(), url, label: new URL(url).hostname };
		const catalog = await fetchCatalog(url, signal);
		signal.throwIfAborted();
		await this.#storage.addRepository(repository, catalog);
		return this.#view(repository);
	}

	async #update(id: string, address: string, label: string, signal: AbortSignal): Promise<MarketplaceRepository> {
		signal.throwIfAborted();
		const url = this.#normalize(address);
		const records = await this.#repositories();
		const previous = records.find((record) => record.id === id);
		if (!previous) throw new HttpFailure(404, 'MARKETPLACE_REPOSITORY_NOT_FOUND');
		if (records.some((record) => record.id !== id && record.url === url))
			throw new HttpFailure(409, 'MARKETPLACE_REPOSITORY_ALREADY_EXISTS');

		const repository = { id, url, label };
		signal.throwIfAborted();
		await this.#storage.updateRepository(repository, previous.url === url ? undefined : []);
		return this.#view(repository);
	}

	async #refresh(id: string, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const record = (await this.#storage.listRepositories()).find((repository) => repository.id === id);
		if (!record) throw new HttpFailure(404, 'MARKETPLACE_REPOSITORY_NOT_FOUND');

		// 请求断开或 App 关闭后，迟到的目录不能覆盖上次成功的缓存。
		const catalog = await fetchCatalog(record.url, signal);
		signal.throwIfAborted();
		await this.#storage.updateRepository(record, catalog);
	}

	#normalize(address: string): string {
		return new URL(MarketplaceRepositoryUrlSchema.parse(address)).href;
	}

	#view(repository: Omit<MarketplaceRepository, 'official'>): MarketplaceRepository {
		return { ...repository, official: officialRepositoryUrls.includes(repository.url) };
	}
}
