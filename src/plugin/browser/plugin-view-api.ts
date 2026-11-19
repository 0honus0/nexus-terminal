import { createHooks } from 'hookable';
import pTimeout from 'p-timeout';
import { defineComponent, h, onBeforeUnmount, onErrorCaptured, ref, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LogApi } from '../../log/browser/log-api.js';
import { PluginScope, type PluginScopeApi } from '../plugin-api.js';
import type { PluginComponentEntry } from './plugin-contributions.js';

export interface PluginViewCloseEvent {
	readonly signal: AbortSignal;
	readonly defaultPrevented: boolean;
	preventDefault(): void;
}

/** 关闭检查属于本次挂载。停用插件或退出会话时，宿主可以直接撤销视图。 */
export interface PluginViewApi extends PluginScopeApi {
	onBeforeClose(check: (event: PluginViewCloseEvent) => void | Promise<void>): () => void;
	requestClose(): Promise<boolean>;
}

type CloseHooks = { beforeClose(event: PluginViewCloseEvent): void | Promise<void> };

/** 视图继承插件贡献的生命周期，单个视图关闭时只回收自己的资源。 */
export class PluginViewScope implements PluginViewApi {
	readonly #scope: PluginScope;
	readonly api: PluginViewApi;
	readonly #hooks = createHooks<CloseHooks>();
	readonly #onClosed: (forced: boolean) => void;
	#untrack: (() => void) | undefined;
	#checking: Promise<boolean> | undefined;
	#closing: Promise<void> | undefined;
	#revision = 0;

	constructor(entry: PluginComponentEntry, log: Pick<LogApi, 'report'>, onClosed: (forced: boolean) => void) {
		this.#scope = new PluginScope(() => {
			log.report({
				source: 'plugin.view',
				level: 'error',
				code: 'PLUGIN_VIEW_CLEANUP_FAILED',
				pluginId: entry.context.self.id,
			});
		});
		const { signal } = this.#scope;
		this.api = Object.freeze({
			signal,
			onDispose: this.onDispose.bind(this),
			onBeforeClose: this.onBeforeClose.bind(this),
			requestClose: this.requestClose.bind(this),
		});
		this.#onClosed = onClosed;
		this.#untrack = entry.lifetime.onDispose(() => this.close());
		if (entry.lifetime.signal.aborted) this.#scope.abort();
		else
			entry.lifetime.signal.addEventListener('abort', () => this.#scope.abort(), {
				once: true,
				signal: this.signal,
			});
	}

	get signal(): AbortSignal {
		return this.#scope.signal;
	}

	onDispose(cleanup: Parameters<PluginViewApi['onDispose']>[0]): () => void {
		return this.#scope.onDispose(cleanup);
	}

	onBeforeClose(check: CloseHooks['beforeClose']): () => void {
		this.signal.throwIfAborted();
		this.#revision++;
		return this.#hooks.hook('beforeClose', (event) => {
			if (!event.signal.aborted && !event.defaultPrevented) return check(event);
		});
	}

	requestClose(): Promise<boolean> {
		if (this.signal.aborted) return Promise.resolve(true);
		return (this.#checking ??= Promise.resolve()
			.then(() => this.#check())
			.finally(() => (this.#checking = undefined)));
	}

	async #check(): Promise<boolean> {
		if (this.signal.aborted) return true;
		const revision = this.#revision;
		let prevented = false;
		const event: PluginViewCloseEvent = {
			signal: this.signal,

			get defaultPrevented() {
				return prevented;
			},

			preventDefault() {
				prevented = true;
			},
		};
		try {
			await pTimeout(this.#hooks.callHook('beforeClose', event), { milliseconds: Infinity, signal: this.signal });
		} catch (cause) {
			if (this.signal.aborted) return true;
			throw cause;
		}
		if (this.signal.aborted) return true;
		// 等待过程中加入的检查留到下一次关闭，不重复执行本轮已经完成的确认。
		if (prevented || revision !== this.#revision) return false;
		await this.close(false);
		return true;
	}

	close(forced = true): Promise<void> {
		if (this.#closing) return this.#closing;
		// 先撤销输入和清理资源，再由宿主决定是否保留退出动画。
		const closing = (this.#closing = this.#scope.close().finally(() => this.#untrack?.()));
		this.#hooks.removeAllHooks();
		this.#onClosed(forced);
		return closing;
	}
}

/** 应用窗口可交付已装配的视图，小组件由渲染边界创建自己的作用域。 */
export const PluginView = defineComponent({
	name: 'PluginView',
	props: {
		entry: { type: Object as PropType<PluginComponentEntry>, required: true },
		log: { type: Object as PropType<Pick<LogApi, 'report'>>, required: true },
		scope: { type: Object as PropType<PluginViewScope> },
		api: { type: Object as PropType<PluginViewApi> },
	},

	setup({ entry, log, scope, api }) {
		const { t } = useI18n({ useScope: 'global' });
		const failed = ref(false);
		const closed = ref(false);
		const view = scope ?? new PluginViewScope(entry, log, () => (closed.value = true));
		const available = !view.signal.aborted;

		function closeView(): void {
			void view.close().catch(() => {
				log.report({
					source: 'plugin.view',
					level: 'error',
					code: 'PLUGIN_VIEW_CLEANUP_FAILED',
					pluginId: entry.context.self.id,
				});
			});
		}

		onBeforeUnmount(closeView);
		onErrorCaptured(() => {
			failed.value = true;
			log.report({
				source: 'plugin.view',
				level: 'error',
				code: 'PLUGIN_VIEW_FAILED',
				pluginId: entry.context.self.id,
			});
			closeView();
			return false;
		});
		return () => {
			if (failed.value) return h('p', { role: 'status' }, t('componentUnavailable'));
			if (available && !closed.value)
				return h(entry.component, { context: entry.context, view: api ?? view.api });
			return null;
		};
	},
});
