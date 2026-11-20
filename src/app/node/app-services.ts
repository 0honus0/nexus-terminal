import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Level } from 'pino';
import { AuthApi } from '../../auth/node/auth-api.js';
import { CryptoApi } from '../../crypto/node/crypto-api.js';
import { DatabaseApi } from '../../database/node/database-api.js';
import { HttpApi } from '../../http/node/http-api.js';
import { LogApi, LogWriter } from '../../log/node/log-api.js';
import type { PluginCapabilities } from '../../plugin/plugin-api.node.js';
import { StateApi } from '../../state/node/state-api.js';
import { CodedError } from '../../utils/error.js';
import { WsApi } from '../../ws/node/ws-api.js';

interface AppServicesOptions {
	readonly dataDirectory: string;
	readonly logLevel?: Level;
	readonly httpPort?: number;
	readonly httpTrustLoopbackProxy?: boolean;
}

interface ServiceLifecycle {
	initialize(signal: AbortSignal): void | Promise<void>;
	close(): void | Promise<void>;
}

/** 生命周期决定何时可调用宿主 API，plugin 决定是否纳入插件绑定名单。 */
type ServiceRegistration = (
	| { readonly lifecycle: 'always'; readonly api: object }
	| { readonly lifecycle: 'managed'; readonly api: ServiceLifecycle }
) & { readonly plugin?: true };

type ServiceState = { status: 'pending' | 'ready' } | { status: 'failed'; cause: unknown };

interface ManagedService {
	readonly controller: AbortController;
	readonly hooks: ServiceLifecycle;
	state: ServiceState;
}

/** 构造时显式传入依赖。登记顺序决定初始化和逆序关闭的顺序。 */
function registerServices(directory: string, logLevel: Level, httpPort: number, httpTrustLoopbackProxy: boolean) {
	const log = new LogApi(new LogWriter({ level: logLevel }));
	const database = new DatabaseApi({ directory });
	const crypto = new CryptoApi({ directory, services: { log } });
	const auth = new AuthApi({ services: { database, crypto } });
	const http = new HttpApi({ port: httpPort, trustLoopbackProxy: httpTrustLoopbackProxy, services: { log, auth } });
	const ws = new WsApi({ services: { http, auth, log } });
	const state = new StateApi({ services: { ws } });

	// 认证路由在监听前登记，会话仍由宿主共享给 HTTP 和 WS。
	auth.register(http);

	// prettier-ignore
	return {
		log:      { api: log,      lifecycle: 'always',  plugin: true },
		database: { api: database, lifecycle: 'managed', plugin: true },
		crypto:   { api: crypto,   lifecycle: 'managed', plugin: true },
		auth:     { api: auth,     lifecycle: 'managed' },
		http:     { api: http,     lifecycle: 'managed', plugin: true },
		ws:       { api: ws,       lifecycle: 'managed', plugin: true },
		state:    { api: state,    lifecycle: 'managed', plugin: true },
	} as const satisfies Record<string, ServiceRegistration>;
}

type AppServiceMap = ReturnType<typeof registerServices>;

/** 调用方拿到业务 API，初始化和关闭由 AppServices 统一调用。 */
type AppServiceApis = {
	[K in keyof AppServiceMap]: Omit<AppServiceMap[K]['api'], keyof ServiceLifecycle>;
};

/** 从登记表保留 plugin: true 条目的键与 API 类型。 */
type RegisteredPluginCapabilities = {
	[K in keyof AppServiceMap as AppServiceMap[K] extends { plugin: true } ? K : never]: AppServiceMap[K]['api'];
};

function selectPluginCapabilities(services: AppServiceMap): PluginCapabilities {
	const entries = Object.entries(services).flatMap(([key, service]) =>
		'plugin' in service && service.plugin ? [[key, service.api] as const] : [],
	);
	// Object.fromEntries 丢失了键与 API 的对应关系，这里用相同筛选规则推导的类型恢复它。
	const capabilities = Object.fromEntries(entries) as RegisteredPluginCapabilities;
	// 前半段检查缺项和 bind 返回值，后半段拒绝插件契约以外的键。
	return capabilities satisfies PluginCapabilities &
		Record<Exclude<keyof RegisteredPluginCapabilities, keyof PluginCapabilities>, never>;
}

/** App 启动时从同一张登记表取得宿主服务与插件能力名单。 */
export function assembleAppServices({
	dataDirectory,
	logLevel = 'info',
	httpPort = 0,
	httpTrustLoopbackProxy = false,
}: AppServicesOptions) {
	const directory = resolve(dataDirectory);
	const registrations = registerServices(directory, logLevel, httpPort, httpTrustLoopbackProxy);
	return {
		services: new AppServices(directory, registrations),
		pluginCapabilities: selectPluginCapabilities(registrations),
	};
}

/** 管理宿主服务的初始化和可用状态。 */
export class AppServices {
	readonly #directory: string;
	// 按键关联各自的业务接口。生命周期和就绪状态另存于 #managed。
	readonly #services: { readonly [K in keyof AppServiceApis]: { readonly api: AppServiceApis[K] } };
	readonly #managed = new Map<string, ManagedService>();
	#initializing: AbortController | undefined;
	#initialization: Promise<void> | undefined;
	#starting: Promise<void> | undefined;
	#closing: { reason: unknown; pending: Promise<void> } | undefined;

	constructor(directory: string, registrations: AppServiceMap) {
		this.#directory = directory;
		this.#services = registrations;
		for (const [key, { api, lifecycle }] of Object.entries(registrations)) {
			if (lifecycle !== 'managed') continue;
			// 每个服务有独立信号，关闭时仍可使用尚未关闭的依赖。
			this.#managed.set(key, {
				controller: new AbortController(),
				hooks: api,
				state: { status: 'pending' },
			});
		}
	}

	/** 托管服务就绪后才可取用。日志等 always 条目在启动和关闭期间也可访问。 */
	get<K extends keyof AppServiceMap>(key: K): AppServiceApis[K] {
		const { api } = this.#services[key];
		const lifecycle = this.#managed.get(key);
		if (lifecycle) {
			const { state } = lifecycle;
			if (state.status === 'failed') throw new CodedError('SERVICE_FAILED', { cause: state.cause });
			this.#assertOpen();
			if (state.status !== 'ready') throw new CodedError('SERVICE_NOT_READY');
		}
		return api;
	}

	initialize(): Promise<void> {
		this.#assertOpen();
		if (!this.#starting) {
			// 启动调用方等待失败后的回滚。关闭过程只等待底层初始化任务，避免互相等待。
			this.#initialization = this.#initialize();
			this.#starting = this.#initialization.catch(async (cause: unknown) => {
				await this.close(cause);
				throw cause;
			});
		}
		return this.#starting;
	}

	close(reason: unknown = new CodedError('SERVICE_CLOSED')): Promise<void> {
		return (this.#closing ??= { reason, pending: Promise.resolve().then(() => this.#close(reason)) }).pending;
	}

	async #initialize(): Promise<void> {
		// 数据库和密钥共用数据目录，先准备目录再启动服务。
		await mkdir(this.#directory, { recursive: true, mode: 0o700 });
		// 目录创建期间也可能收到关停请求。
		this.#assertOpen();

		// 按登记顺序逐个启动。例如 Auth 初始化时要读取数据库。
		for (const lifecycle of this.#managed.values()) {
			// 关停时先取消当前启动步骤，已就绪的依赖按逆序关闭时再取消。
			this.#initializing = lifecycle.controller;
			try {
				await lifecycle.hooks.initialize(lifecycle.controller.signal);
				// initialize 等待期间可能收到关停请求。迟到的成功结果不能再对外标记就绪。
				this.#assertOpen();
				lifecycle.state = { status: 'ready' };
			} catch (cause) {
				// 保留真实启动失败供 get() 诊断。关停期间由关闭流程处理取消。
				if (!this.#closing) lifecycle.state = { status: 'failed', cause };
				throw cause;
			} finally {
				this.#initializing = undefined;
			}
		}
	}

	async #close(reason: unknown): Promise<void> {
		this.#initializing?.abort(reason);
		// 等待在途初始化收尾，然后再销毁资源。
		const failures: unknown[] = [];
		try {
			await this.#initialization;
		} catch (cause) {
			failures.push(cause);
		}
		const startupFailureCount = failures.length;
		// 未就绪的服务也可能在构造时分配资源。逆序关闭让下游有机会用完上游依赖。
		for (const lifecycle of [...this.#managed.values()].reverse()) {
			lifecycle.controller.abort(reason);
			try {
				await lifecycle.hooks.close();
			} catch (cause) {
				failures.push(cause);
			}
		}
		// 启动错误由 initialize() 传播。清理也失败时，把两个阶段的错误一起报告。
		if (failures.length > startupFailureCount) {
			throw new AggregateError(failures, 'SERVICES_CLOSE_FAILED');
		}
	}

	#assertOpen(): void {
		if (this.#closing) {
			throw new CodedError('SERVICE_CLOSED', { cause: this.#closing.reason });
		}
	}
}
