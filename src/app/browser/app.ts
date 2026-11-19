import { WindowLauncher } from '../../window/browser/window-plugin-api.js';
import { shallowRef, watch, type WatchHandle } from 'vue';
import { AuthApi } from '../../auth/browser/auth-api.js';
import { LogApi, LogWriter } from '../../log/browser/log-api.js';
import { MarketplaceFrontendSource } from '../../marketplace/browser/marketplace-frontend-api.js';
import { PluginAppService, PluginRuntime } from '../../plugin/plugin-api.browser.js';
import { HttpClientService } from '../../http/browser/http-plugin-client-api.js';
import { StateClientService } from '../../state/browser/state-plugin-client-api.js';
import { TaskService } from '../../task/browser/task-plugin-api.js';
import { WsClientService } from '../../ws/browser/ws-plugin-client-api.js';
import { StateClient } from '../../state/browser/state-api.js';

/** 浏览器本体负责装配。各插件只取得绑定到当前实例的 ctx.app。 */
export class App {
	readonly log = new LogApi(new LogWriter());
	readonly #controller = new AbortController();
	readonly auth = new AuthApi(this.#controller.signal, this.log);
	readonly windows = new WindowLauncher();
	readonly #plugins = new PluginRuntime({
		app: new PluginAppService({
			http: new HttpClientService(),
			log: this.log,
			state: new StateClientService(() => this.#state.value, this.log),
			tasks: new TaskService(this.log),
			ws: new WsClientService(),
			windows: this.windows,
		}),
		services: { log: this.log },
	});
	readonly #source = new MarketplaceFrontendSource({
		log: this.log,

		sync: (targets) => this.#plugins.sync(targets),

		loadEntry: async (href, signal) => {
			await this.#prepareImports();
			signal.throwIfAborted();
			return import(/* @vite-ignore */ href);
		},
	});
	#imports: Promise<void> | undefined;
	#stopAuth: WatchHandle | undefined;
	#phase: AbortController | undefined;
	readonly #state = shallowRef<StateClient>();

	get contributions() {
		return this.#plugins.contributions;
	}

	get state(): Pick<StateClient, 'subscribe'> | undefined {
		return this.#state.value;
	}

	/** 认证状态决定插件清单来源。登录前后的同一修订可以复用加载器与实例。 */
	start(): Promise<void> {
		this.#controller.signal.throwIfAborted();
		this.#stopAuth ??= watch(
			() => {
				const state = this.auth.state.value;
				return state && (state.account?.id ?? null);
			},
			(account, previous) => {
				if (account !== undefined) this.#enter(account, previous === 'owner');
			},
			{ immediate: true, flush: 'sync' },
		);
		return this.auth.refresh();
	}

	close(): Promise<void> {
		this.#controller.abort();
		this.#stopAuth?.();
		this.#phase?.abort();
		this.#state.value?.close();
		return this.#plugins.close();
	}

	/** 和登录请求或状态订阅并行，实际入口加载时统一等待共享模块。 */
	preparePlugins(): void {
		if (!this.#controller.signal.aborted) void this.#prepareImports().catch(() => undefined);
	}

	#prepareImports(): Promise<void> {
		return (this.#imports ??= import('./plugin-imports.js')
			.then(({ installPluginImports }) => {
				this.#controller.signal.throwIfAborted();
				installPluginImports();
			})
			.catch((cause: unknown) => {
				this.#imports = undefined;
				throw cause;
			}));
	}

	#enter(account: 'owner' | null, wasAuthenticated: boolean): void {
		this.#phase?.abort();
		this.#phase = new AbortController();
		this.#state.value?.close();
		this.#state.value = undefined;
		if (account) {
			this.preparePlugins();
			this.#connect();
		} else void this.#startPrelogin(this.#phase.signal, wasAuthenticated);
	}

	#connect(): void {
		let state: StateClient | undefined;
		try {
			const client = new StateClient({
				log: this.log,

				onSessionExpired: () => void this.#recoverSession(client),
			});
			state = client;
			this.#source.connect(client);
			this.#state.value = client;
			client.open();
		} catch {
			this.#state.value = undefined;
			state?.close();
			this.log.report({ source: 'app', level: 'error', code: 'APP_INSTALLED_PLUGINS_FAILED' });
		}
	}

	async #recoverSession(client: StateClient): Promise<void> {
		const signal = this.#phase?.signal;
		if (!signal || signal.aborted || this.#state.value !== client) return;
		try {
			await this.auth.reconcileSession(signal);
			if (!signal.aborted && this.#state.value === client && this.auth.state.value?.account) this.#connect();
		} catch {
			if (!signal.aborted && this.#state.value === client) this.auth.expire();
		}
	}

	async #startPrelogin(signal: AbortSignal, reset: boolean): Promise<void> {
		// 退出会话先清理旧实例。登录时由会话快照接管，已加载的公开实例继续使用。
		if (reset) await this.#source.reset();
		if (signal.aborted) return;

		let timer: ReturnType<typeof setTimeout> | undefined;
		signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

		const refresh = async () => {
			const results = await Promise.allSettled([this.auth.refresh(signal), this.#source.refreshPrelogin(signal)]);
			if (signal.aborted) return;
			if (results.some(({ status }) => status === 'rejected'))
				this.log.report({ source: 'app', level: 'warn', code: 'APP_PRELOGIN_REFRESH_FAILED' });
			timer = setTimeout(() => void refresh(), 3000);
		};

		await refresh();
	}
}
