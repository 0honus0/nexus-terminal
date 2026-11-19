import type { LogApi } from '../../log/browser/log-api.js';
import type { BrowserPluginTarget, PluginBackendState } from '../../plugin/plugin-api.browser.js';
import {
	PluginRuntimeListSchema,
	PluginRuntimeStateTopic,
	type PluginRuntimeInfo,
} from '../../plugin/plugin-state-types.js';
import type { StateClient } from '../../state/browser/state-api.js';
import {
	MarketplacePreloginSchema,
	marketplaceFrontendBase,
	marketplacePreloginPath,
} from '../marketplace-http-types.js';
import { CodedError } from '../../utils/error.js';
import {
	MarketplaceFrontendsSchema,
	MarketplaceFrontendsTopic,
	type MarketplaceFrontend,
} from '../marketplace-types.js';

interface FrontendSourceOptions {
	readonly log: Pick<LogApi, 'report'>;
	readonly sync: (targets: readonly BrowserPluginTarget[]) => Promise<void>;
	readonly loadEntry: (href: string, signal: AbortSignal) => Promise<unknown>;
}

interface EntryLoader {
	readonly href: string;
	readonly load: NonNullable<BrowserPluginTarget['load']>;
}

const pending: PluginBackendState = Object.freeze({ runtime: 'starting', readiness: { state: 'pending' } as const });

/** 安装清单决定代码入口，运行快照只决定有后端插件的服务准入。 */
export class MarketplaceFrontendSource {
	readonly #sync: FrontendSourceOptions['sync'];
	readonly #log: FrontendSourceOptions['log'];
	readonly #loadEntry: FrontendSourceOptions['loadEntry'];
	#installed: readonly MarketplaceFrontend[] = [];
	#runtime = new Map<string, PluginBackendState & Pick<PluginRuntimeInfo, 'version'>>();
	#loaders = new Map<string, EntryLoader>();

	constructor({ log, sync, loadEntry }: FrontendSourceOptions) {
		this.#sync = sync;
		this.#log = log;
		this.#loadEntry = loadEntry;
	}

	connect(state: Pick<StateClient, 'subscribe'>): void {
		state.subscribe(MarketplaceFrontendsTopic, MarketplaceFrontendsSchema, {
			updated: (value) => {
				this.#installed = value;
				void this.#reconcile();
			},

			unconfirmed: (reason) => {
				if (reason === 'unavailable') this.#installed = [];
				this.#runtime.clear();
				void this.#reconcile();
			},
		});
		state.subscribe(PluginRuntimeStateTopic, PluginRuntimeListSchema, {
			updated: (value) => {
				this.#runtime = new Map(value.map((entry) => [entry.pluginId, entry]));
				void this.#reconcile();
			},

			unconfirmed: () => {
				this.#runtime.clear();
				void this.#reconcile();
			},
		});
	}

	/** 匿名阶段使用当前允许的公开清单及其依赖状态。 */
	async refreshPrelogin(signal: AbortSignal): Promise<void> {
		const response = await fetch(`/api${marketplacePreloginPath}`, { signal });
		if (!response.ok) {
			await response.body?.cancel();
			throw new CodedError('MARKETPLACE_PRELOGIN_READ_FAILED');
		}
		const { items } = MarketplacePreloginSchema.parse(await response.json());
		signal.throwIfAborted();
		this.#installed = items;
		this.#runtime = new Map(
			items.flatMap(({ pluginId, version, backend }) => (backend ? [[pluginId, { ...backend, version }]] : [])),
		);
		await this.#reconcile();
	}

	/** 撤销会话后移除所有已交付的入口。短暂断网仍保留页面和组件实例。 */
	reset(): Promise<void> {
		this.#installed = [];
		this.#runtime.clear();
		return this.#reconcile();
	}

	#reconcile(): Promise<void> {
		const loaders = new Map<string, EntryLoader>();
		const targets: BrowserPluginTarget[] = [];
		for (const { pluginId, version, dependsOn, entryURL, hasBackend } of this.#installed) {
			const backend = this.#runtime.get(pluginId);
			if (entryURL) {
				const url = URL.parse(entryURL, location.origin);
				const prefix = `${marketplaceFrontendBase}/${encodeURIComponent(pluginId)}/`;
				if (
					!url ||
					url.origin !== location.origin ||
					!url.pathname.startsWith(prefix) ||
					url.search ||
					url.hash
				) {
					this.#log.report({
						source: 'marketplace',
						level: 'warn',
						code: 'MARKETPLACE_FRONTEND_ENTRY_INVALID',
						pluginId,
					});
					continue;
				}
				const href = url.href;
				const previous = this.#loaders.get(pluginId);
				const entry =
					previous?.href === href
						? previous
						: {
								href,

								load: (signal: AbortSignal) => this.#loadEntry(href, signal),
							};
				loaders.set(pluginId, entry);
			}
			targets.push({
				id: pluginId,
				version,
				dependsOn,
				enabled: true,
				load: loaders.get(pluginId)?.load,
				backend: hasBackend ? (backend?.version === version ? backend : pending) : null,
			});
		}
		this.#loaders = loaders;
		return this.#sync(targets).catch(() =>
			this.#log.report({
				source: 'marketplace',
				level: 'error',
				code: 'MARKETPLACE_FRONTENDS_SYNC_FAILED',
			}),
		);
	}
}
