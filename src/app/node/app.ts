import { SettingsPlugin } from '../../settings/node/settings-plugin-api.js';
import { BackupDataApi } from '../../backup/node/backup-data-api.js';
import { BackupPlugin } from '../../backup/node/backup-plugin-api.js';
import { resolve } from 'node:path';
import type { Level } from 'pino';
import type { LogApi } from '../../log/node/log-api.js';
import { MarketplacePlugin } from '../../marketplace/node/marketplace-plugin-api.js';
import {
	PluginAppService,
	PluginRuntime,
	type BuiltinPlugin,
	type PluginCapabilities,
} from '../../plugin/plugin-api.node.js';
import { CodedError } from '../../utils/error.js';
import { assembleAppServices, type AppServices } from './app-services.js';

export interface AppOptions {
	readonly dataDirectory: string;
	readonly logLevel?: Level;

	/** 省略或传入 0 时，由系统分配监听端口。 */
	readonly httpPort?: number;

	/** 仅在回环代理已重写转发头时启用。 */
	readonly httpTrustLoopbackProxy?: boolean;
}

interface AppPlugins {
	readonly runtime: PluginRuntime;
	readonly builtins: readonly BuiltinPlugin[];
	readonly installedSources: readonly { restoreInstalledPlugins(): Promise<void> }[];
}

/** App 管理宿主服务与 Node 插件运行时的生命周期。 */
export class App {
	/** 本体模块通过登记表取用已就绪的服务。 */
	readonly services: Pick<AppServices, 'get'>;
	readonly #services: AppServices;
	readonly #log: Pick<LogApi, 'report'>;
	readonly #directory: string;
	readonly #controller = new AbortController();

	// 只在装配运行时时使用。插件入口收到的是按实例绑定后的 ctx.app。
	readonly #pluginCapabilities: PluginCapabilities;

	#plugins: AppPlugins | undefined;

	// 同一次启动供所有调用方等待。失败原因保留下来，阻止 App 在回滚后继续接收工作。
	#starting: Promise<void> | undefined;
	#startingBuiltins: Promise<void> | undefined;
	#restoringInstalled: Promise<void> | undefined;
	#startupFailure: { cause: unknown } | undefined;

	// 第一次关闭请求决定取消原因和关闭任务，后续 close() 复用它们。
	#closing: { reason: Error; pending: Promise<void> } | undefined;

	constructor(options: AppOptions) {
		const { services, pluginCapabilities } = assembleAppServices(options);

		this.#directory = resolve(options.dataDirectory);
		this.#services = services;
		this.#log = services.get('log');
		this.services = Object.freeze({ get: services.get.bind(services) });
		this.#pluginCapabilities = pluginCapabilities;
	}

	/** 等待宿主服务和运行时就绪。重复调用共享启动任务，关闭时也用它等待启动收尾。 */
	initialize(): Promise<void> {
		this.#assertOpen();

		return (this.#starting ??= this.#initialize());
	}

	/** 迁移并激活宿主登记的内置插件。同一次启动供所有调用方等待。 */
	async startBuiltinPlugins(): Promise<void> {
		this.#assertOpen();
		const plugins = this.#plugins;
		if (!plugins) throw new CodedError('SERVICE_NOT_READY');

		return (this.#startingBuiltins ??= plugins.runtime
			.startBuiltins(plugins.builtins)
			.catch((cause: unknown) => this.#failStartup(cause, 'APP_BUILTIN_PLUGINS_START_FAILED')));
	}

	/** 每次宿主启动恢复一次已启用的安装记录，再加载显式传入的开发目录。 */
	async startExternalPlugins(developmentDirectories: readonly string[] = []): Promise<void> {
		this.#assertOpen();
		const plugins = this.#plugins;
		if (!plugins || !this.#startingBuiltins) throw new CodedError('SERVICE_NOT_READY');

		await this.#startingBuiltins;
		this.#assertOpen();
		await (this.#restoringInstalled ??= this.#restoreInstalledPlugins(plugins.installedSources).catch(
			(cause: unknown) => this.#failStartup(cause, 'APP_INSTALLED_PLUGINS_RESTORE_FAILED'),
		));
		this.#assertOpen();
		if (!developmentDirectories.length) return;

		try {
			await plugins.runtime.start(developmentDirectories);
		} catch (cause) {
			this.#throwIfShuttingDown(cause);
			throw cause;
		}
	}

	/** 先等待插件运行时关闭，再释放宿主服务。 */
	close(reason: Error = new CodedError('APP_CLOSED')): Promise<void> {
		return (this.#closing ??= { reason, pending: Promise.resolve().then(() => this.#close(reason)) }).pending;
	}

	/** 同一组件可以参与多个启动阶段，宿主显式登记它在哪些阶段运行。 */
	#registerPlugins(runtime: PluginRuntime, backupData: BackupDataApi): AppPlugins {
		const marketplace = new MarketplacePlugin({
			directory: resolve(this.#directory, 'plugin-packages'),
			services: { runtime, auth: this.services.get('auth'), hostHttp: this.services.get('http'), backupData },
		});
		return {
			runtime,
			builtins: [marketplace, new SettingsPlugin(backupData), new BackupPlugin(backupData, marketplace)],
			installedSources: [marketplace],
		};
	}

	async #restoreInstalledPlugins(sources: AppPlugins['installedSources']): Promise<void> {
		// 来源按登记顺序交付安装记录，等待每批处理完成后再接受下一批。
		for (const source of sources) {
			this.#assertOpen();
			await source.restoreInstalledPlugins();
		}
	}

	async #initialize(): Promise<void> {
		try {
			this.#log.report({ source: 'app', level: 'info', code: 'APP_INITIALIZING' });
			await this.#services.initialize();

			// 服务初始化期间可能收到关停请求。创建运行时前复查 App 是否仍可用。
			this.#assertOpen();

			const backupData = new BackupDataApi({
				database: this.services.get('database'),
				crypto: this.services.get('crypto'),
			});
			await backupData.initialize(this.#controller.signal);
			this.#assertOpen();
			const runtime = new PluginRuntime({
				app: new PluginAppService(this.#pluginCapabilities),
				services: this.services,
				backupData,
			});
			this.#plugins = this.#registerPlugins(runtime, backupData);

			this.#log.report({ source: 'app', level: 'info', code: 'APP_INITIALIZED' });
		} catch (cause) {
			return this.#failStartup(cause, 'APP_INITIALIZE_FAILED');
		}
	}

	async #failStartup(cause: unknown, code: string): Promise<never> {
		this.#throwIfShuttingDown(cause);
		this.#log.report({ source: 'app', level: 'error', code });
		this.#startupFailure = { cause };

		// 插件仍可能持有服务资源，先清理运行时再关闭宿主服务。
		const failures = await this.#closePlugins();
		try {
			await this.#services.close(cause);
		} catch (cleanup) {
			if (cleanup !== cause) failures.push(cleanup);
		}

		if (failures.length) throw new AggregateError([cause, ...failures], code);
		throw cause;
	}

	async #close(reason: Error): Promise<void> {
		this.#controller.abort(reason);
		const failures = await this.#closePlugins();

		this.#log.report({ source: 'app', level: 'info', code: 'APP_STOPPING' });

		try {
			await this.#services.close(reason);

			// 宿主关闭会取消在途初始化。启动结果归 initialize() 的调用方，关闭只等它收尾。
			await this.#starting?.catch(() => undefined);

			this.#log.report({ source: 'app', level: 'info', code: 'APP_STOPPED' });
		} catch (cause) {
			failures.push(cause);
		}

		// 两个阶段都尝试清理后，再把失败交给关闭调用方。
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'APP_CLOSE_FAILED');
	}

	async #closePlugins(): Promise<unknown[]> {
		try {
			await this.#plugins?.runtime.close();
			return [];
		} catch (cause) {
			return [cause];
		}
	}

	#assertOpen(): void {
		if (this.#closing) throw this.#closing.reason;
		if (this.#startupFailure) throw this.#startupFailure.cause;
	}

	#throwIfShuttingDown(cause: unknown): void {
		// 将服务和插件运行时包装的关停错误还原成入口的取消原因。
		const closing = this.#closing;
		if (
			closing &&
			(cause === closing.reason ||
				(cause instanceof CodedError &&
					(cause.cause === closing.reason ||
						cause.code === 'PLUGIN_RUNTIME_CLOSED' ||
						cause.code === 'PLUGIN_CONTEXT_EXPIRED')))
		) {
			throw closing.reason;
		}
	}
}
