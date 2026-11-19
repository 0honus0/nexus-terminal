import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { contentType } from 'mime-types';
import pLimit from 'p-limit';
import satisfies from 'semver/functions/satisfies.js';
import type { AuthApi } from '../../auth/node/auth-api.js';
import { HttpFailure, type HttpApi, type HttpHostRoute } from '../../http/node/http-api.js';
import type { HttpStreamRoute } from '../../http/node/http-plugin-api.js';
import type { PluginLogApi } from '../../log/log-plugin-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { inspectPluginPackage, type PluginRuntimeApi } from '../../plugin/plugin-api.node.js';
import type { PluginStateApi, StatePublisherApi } from '../../state/node/state-plugin-api.js';
import {
	marketplaceFrontendBase,
	marketplaceFrontendPath,
	marketplacePreloginPath,
	MarketplaceFrontendAssetParamsSchema,
	MarketplacePreloginSchema,
} from '../marketplace-http-types.js';
import {
	MarketplaceFrontendsSchema,
	MarketplaceFrontendsTopic,
	type MarketplaceFrontend,
} from '../marketplace-types.js';
import type { InstalledPlugin } from './marketplace-storage.js';
import { z } from 'zod';

const empty = z.strictObject({});

const extensions = new Set([
	'.js',
	'.mjs',
	'.css',
	'.json',
	'.wasm',
	'.woff',
	'.woff2',
	'.ttf',
	'.otf',
	'.png',
	'.jpg',
	'.jpeg',
	'.webp',
	'.avif',
	'.gif',
	'.ico',
	'.svg',
	'.mp3',
	'.ogg',
	'.mp4',
	'.webm',
]);

interface Assets {
	readonly root: string;
	readonly revision: string;
	readonly controller: AbortController;
	readonly entry: string;
	readonly singleFile: boolean;
}

interface Frontend {
	readonly manifest: MarketplaceFrontend;
	readonly target: InstalledPlugin;
	readonly assets?: Assets;
}

interface FrontendServices {
	readonly state: PluginStateApi;
	readonly log: PluginLogApi;
	readonly auth: Pick<AuthApi, 'loginProviders'>;
	readonly runtime: Pick<PluginRuntimeApi, 'getInstalled'>;
}

function inside(root: string, file: string): boolean {
	const path = relative(root, file);
	return path !== '' && !isAbsolute(path) && path.split(sep).every((part) => !part.startsWith('.'));
}

async function prepare(record: InstalledPlugin, reload: boolean): Promise<Frontend> {
	const { package: manifest } = await inspectPluginPackage(record.directory, record);
	const { frontend, backend } = manifest.nexus.entry;
	const identity = {
		pluginId: record.pluginId,
		version: record.version,
		dependsOn: manifest.nexus.dependsOn ?? {},
		hasBackend: backend !== undefined,
	};
	// 仅后端的包也参与浏览器依赖判断，不交付代码入口。
	if (!frontend) return { target: record, manifest: { ...identity, entryURL: null } };

	const entryPath = resolve(record.directory, frontend);
	const entry = basename(entryPath);
	const root = await realpath(dirname(entryPath));
	const entryFile = await realpath(entryPath);
	if (
		(root !== record.directory && !inside(record.directory, root)) ||
		!inside(root, entryFile) ||
		!inside(record.directory, entryFile) ||
		!['.js', '.mjs'].includes(extname(entry).toLowerCase())
	)
		throw new HttpFailure(404, 'MARKETPLACE_FRONTEND_NOT_FOUND');

	// 根目录入口只交付入口本身。带后端的包须把浏览器资源放在独立目录才可发布相对资源。
	const backendFile = backend && (await realpath(resolve(record.directory, backend)));
	if (backendFile === entryFile) throw new HttpFailure(404, 'MARKETPLACE_FRONTEND_NOT_FOUND');
	const singleFile = root === record.directory || !!(backendFile && inside(root, backendFile));
	// 安装目录与版本标识已交付的产物。同一修订下的文件保持不变。
	const revision = createHash('sha256')
		.update(
			JSON.stringify([
				record.pluginId,
				record.version,
				record.directory,
				frontend,
				...(reload ? [randomUUID()] : []),
			]),
		)
		.digest('hex');
	return {
		target: record,
		assets: { root, entry, singleFile, revision, controller: new AbortController() },
		manifest: {
			...identity,
			entryURL: `${marketplaceFrontendBase}/${encodeURIComponent(record.pluginId)}/${revision}/${encodeURIComponent(entry)}`,
		},
	};
}

/** 市场拥有当前安装修订的资源准入和清单。HTTP 和状态主题共用这份登记。 */
export class MarketplaceFrontends {
	readonly #entries = new Map<string, Frontend>();
	readonly #publisher: StatePublisherApi<MarketplaceFrontend[]>;
	readonly #scope: PluginScopeApi;
	readonly #log: PluginLogApi;
	readonly #auth: FrontendServices['auth'];
	readonly #runtime: FrontendServices['runtime'];

	constructor(scope: PluginScopeApi, services: FrontendServices) {
		this.#scope = scope;
		this.#log = services.log;
		this.#auth = services.auth;
		this.#runtime = services.runtime;
		this.#publisher = services.state.register({
			name: MarketplaceFrontendsTopic.name,
			schema: MarketplaceFrontendsSchema,
			initial: [],
		});
	}

	register(http: Pick<HttpApi, 'register'>): void {
		http.register([
			{
				method: 'get',
				path: marketplacePreloginPath,
				input: empty,
				output: MarketplacePreloginSchema,
				lifetime: this.#scope,
				policy: { access: 'public' },
				handler: this.#prelogin,
			},
			{
				method: 'get',
				path: `${marketplaceFrontendPath}/:pluginId/:revision/*asset`,
				input: MarketplaceFrontendAssetParamsSchema,
				lifetime: this.#scope,
				policy: {
					allowAnonymous: ({ params: { pluginId, revision } }) =>
						typeof pluginId === 'string' &&
						typeof revision === 'string' &&
						this.#entries.get(pluginId)?.assets?.revision === revision &&
						this.#publicPlugins().has(pluginId),
				},
				handler: this.#serve,
			},
		] as const);
	}

	/** 安装记录由市场串行提交；同批次读取完成后一次发布。 */
	async load(records: readonly InstalledPlugin[], reload = false): Promise<readonly string[]> {
		if (!records.length) return [];
		const { signal } = this.#scope;
		const limit = pLimit(8);
		const frontends = await Promise.all(
			records.map((record) =>
				limit(async () => {
					if (signal.aborted) return;
					try {
						return await prepare(record, reload);
					} catch {
						if (!signal.aborted)
							this.#log.report({
								level: 'warn',
								code: 'MARKETPLACE_FRONTEND_INVALID',
								params: { pluginId: record.pluginId },
							});
					}
				}),
			),
		);
		signal.throwIfAborted();
		const failed: string[] = [];
		for (const [index, frontend] of frontends.entries()) {
			const id = records[index].pluginId;
			if (frontend && isDeepStrictEqual(this.#entries.get(id)?.manifest, frontend.manifest)) continue;
			this.#withdraw(id);
			if (frontend) this.#entries.set(id, frontend);
			else failed.push(id);
		}
		this.#publish();
		return failed;
	}

	remove(pluginId: string): void {
		if (this.#withdraw(pluginId)) this.#publish();
	}

	#withdraw(pluginId: string): boolean {
		const entry = this.#entries.get(pluginId);
		if (!entry) return false;
		this.#entries.delete(pluginId);
		entry.assets?.controller.abort();
		return true;
	}

	#publish(): void {
		this.#publisher.publish(
			[...this.#entries.values()]
				.map(({ manifest }) => manifest)
				.sort((left, right) => left.pluginId.localeCompare(right.pluginId)),
		);
	}

	/** 每次请求重算公开闭包，只从仍在提供登录方式的已安装前端开始。 */
	#publicPlugins(): Set<string> {
		const available = new Set<string>();
		const pending = this.#auth.loginProviders().filter((id) => this.#entries.get(id)?.assets);
		while (pending.length) {
			const id = pending.pop()!;
			const entry = this.#entries.get(id);
			if (!entry || available.has(id)) continue;
			available.add(id);
			for (const [dependency, range] of Object.entries(entry.manifest.dependsOn)) {
				const target = this.#entries.get(dependency);
				if (target && satisfies(target.manifest.version, range)) pending.push(dependency);
			}
		}
		return available;
	}

	readonly #prelogin: HttpHostRoute<typeof empty, typeof MarketplacePreloginSchema>['handler'] = () => ({
		items: [...this.#publicPlugins()].map((id) => {
			const { manifest, target } = this.#entries.get(id)!;
			const backend = manifest.hasBackend ? this.#runtime.getInstalled(target) : undefined;
			return {
				...manifest,
				backend: backend ? { runtime: backend.runtime, readiness: backend.readiness } : null,
			};
		}),
	});

	readonly #serve: HttpStreamRoute<typeof MarketplaceFrontendAssetParamsSchema>['handler'] = async (
		{ pluginId, revision, asset },
		context,
	) => {
		const entry = this.#entries.get(pluginId)?.assets;
		const extension = extname(asset.at(-1)!).toLowerCase();
		const mime = extensions.has(extension) && contentType(extension);
		if (
			!entry ||
			entry.revision !== revision ||
			!mime ||
			(entry.singleFile && (asset.length !== 1 || asset[0] !== entry.entry))
		)
			throw new HttpFailure(404, 'MARKETPLACE_FRONTEND_NOT_FOUND');

		const signal = AbortSignal.any([this.#scope.signal, context.signal, entry.controller.signal]);
		try {
			const file = await realpath(resolve(entry.root, ...asset));
			signal.throwIfAborted();
			if (!inside(entry.root, file) || extname(file).toLowerCase() !== extension)
				throw new HttpFailure(404, 'MARKETPLACE_FRONTEND_NOT_FOUND');

			// 已验证路径后以文件句柄完成 stat 和读取，停用时中断仍在发送的资源。
			await using handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
			const info = await handle.stat();
			signal.throwIfAborted();
			if (!info.isFile()) throw new HttpFailure(404, 'MARKETPLACE_FRONTEND_NOT_FOUND');
			await context.reply({
				headers: {
					'content-type': mime,
					'content-length': info.size,
					'cache-control': 'private, no-store',
					// 作为文档直接访问的资源（例如 SVG）处于沙箱；ESM/CSS 按正常子资源加载。
					'content-security-policy': "sandbox; default-src 'none'",
				},
				body: context.method === 'HEAD' ? undefined : handle.createReadStream({ autoClose: false, signal }),
			});
		} catch (cause) {
			context.signal.throwIfAborted();
			const code = (cause as NodeJS.ErrnoException | undefined)?.code;
			if (entry.controller.signal.aborted || (code && ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES'].includes(code)))
				throw new HttpFailure(404, 'MARKETPLACE_FRONTEND_NOT_FOUND');
			throw cause;
		}
	};
}
