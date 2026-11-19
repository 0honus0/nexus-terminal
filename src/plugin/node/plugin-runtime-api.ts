import { alg } from '@dagrejs/graphlib';
import pTimeout from 'p-timeout';
import semver from 'semver';
import type { AuthApi } from '../../auth/node/auth-api.js';
import type { BackupDataApi } from '../../backup/node/backup-data-api.js';
import type { DatabaseApi } from '../../database/node/database-api.js';
import type { LogApi } from '../../log/node/log-api.js';
import type { StateApi, StatePublisherApi } from '../../state/node/state-api.js';
import { CodedError } from '../../utils/error.js';
import type { PluginAppApi, PluginContextApi, PluginModuleApi } from '../plugin-api.node.js';
import type { PluginAppService } from '../plugin-app.js';
import {
	buildPluginDependencyGraph,
	PluginDependencies,
	type PluginDependencyOwner,
	type PluginIdentity,
} from '../plugin-dependencies.js';
import { PluginScope, type PluginScopeApi } from '../plugin-api.js';
import {
	PluginRuntimeListSchema,
	PluginRuntimeStateTopic,
	type PluginReadiness,
	type PluginRuntimeInfo,
} from '../plugin-state-types.js';
import {
	checkPluginEntries,
	loadPlugin,
	readPluginPackage,
	readPluginSource,
	type PluginSource,
} from './plugin-loader.js';

/** 按安装记录校验本地包，才能将其加入运行时。 */
export interface InstalledPluginTarget {
	readonly pluginId: string;
	readonly version: string;
	readonly directory: string;
}

export interface InstalledPluginStartFailure {
	readonly stage: 'load' | 'activate';
	readonly cause: unknown;
}

/** 由宿主随应用交付，并通过同一个运行时激活。 */
export interface BuiltinPlugin extends PluginModuleApi {
	readonly id: string;
	readonly version: string;
	readonly dependsOn?: Readonly<Record<string, string>>;
}

/** 本体对 Node 插件运行时的管理入口。 */
export interface PluginRuntimeApi {
	startBuiltins(plugins: readonly BuiltinPlugin[]): Promise<void>;
	/** 等待当前可激活的插件，依赖阻塞的插件保留在启动队列中。 */
	start(directories: readonly string[]): Promise<void>;
	startInstalled(
		targets: readonly InstalledPluginTarget[],
	): Promise<ReadonlyMap<string, InstalledPluginStartFailure>>;
	prepareInstalled(target: InstalledPluginTarget, signal: AbortSignal): Promise<void>;
	getInstalled(target: InstalledPluginTarget): PluginRuntimeInfo | undefined;
	removeInstalled(target: InstalledPluginTarget): Promise<void>;
	stop(pluginId: string): Promise<void>;
	reload(pluginId: string): Promise<void>;
	list(): readonly PluginRuntimeInfo[];
	get(pluginId: string): PluginRuntimeInfo | undefined;
	close(): Promise<void>;
}

/** 运行时使用的宿主接口。插件能力由 app.bind 按每次激活另外交付。 */
interface PluginRuntimeServices {
	readonly auth: Pick<AuthApi, 'bindMethods'>;
	readonly database: Pick<DatabaseApi, 'migratePlugin'>;
	readonly log: Pick<LogApi, 'report'>;
	readonly state: Pick<StateApi, 'register'>;
}

interface PluginRuntimeOptions {
	readonly app: Pick<PluginAppService<PluginAppApi>, 'bind'>;
	readonly backupData?: Pick<BackupDataApi, 'register'>;
	readonly services: {
		get<K extends keyof PluginRuntimeServices>(key: K): PluginRuntimeServices[K];
	};
}

/** 一次实际激活，持有这次入口执行、绑定上下文和停用任务。 */
interface PluginInstance {
	readonly owner: PluginDependencyOwner;
	readonly context: PluginContextApi;
	readonly activation: Promise<PluginModuleApi>;
	readonly record: PluginRecord;
	activeModule?: PluginModuleApi;
	stopping?: Promise<void>;
}

/** 同一个插件 ID 的运行记录。关闭实例后仍保留来源和失败信息，供查询及重载。 */
interface PluginRecordState {
	readonly failures: Set<'PLUGIN_DEPENDENCY_CYCLE' | 'PLUGIN_START_FAILED' | 'PLUGIN_STOP_FAILED'>;
	waiting?: PluginStartRequest;
	instance?: PluginInstance;
	reload?: PluginReload;
}

type BuiltinPluginRecord = PluginRecordState & {
	readonly builtin: BuiltinPlugin;
	readonly installed?: never;
	readonly source: PluginIdentity & { readonly authMethods: false };
};

type PluginRecord =
	| BuiltinPluginRecord
	| (PluginRecordState &
			PluginBatchTarget & {
				readonly builtin?: never;
				source: PluginSource;
			});

interface PluginBatchTarget {
	readonly directory: string;
	readonly installed?: InstalledPluginTarget;
}

interface PluginBatchFailure extends InstalledPluginStartFailure {
	readonly pluginId?: string;
}

/** 等待依赖满足的启动请求，同时记录本次尝试的失败原因。 */
interface PluginStartRequest {
	readonly record: PluginRecord;
	failure?: { cause: unknown };
}

/** 并发重载复用同一个任务，停用可以取消其中尚未完成的步骤。 */
interface PluginReload {
	readonly controller: AbortController;
	readonly pending: Promise<void>;
}

const activationTimeout = 30_000;

const pendingReadiness: PluginReadiness = Object.freeze({ state: 'pending' });

function matchesInstallation(record: PluginRecord, target: InstalledPluginTarget): boolean {
	return record.installed?.directory === target.directory && record.installed.version === target.version;
}

/** 运行内置及本地 Node 插件。每个启用实例拥有独立作用域和已绑定的宿主能力。 */
export class PluginRuntime implements PluginRuntimeApi {
	readonly #app: PluginRuntimeOptions['app'];
	readonly #backupData: PluginRuntimeOptions['backupData'];
	readonly #auth: PluginRuntimeServices['auth'];
	readonly #database: PluginRuntimeServices['database'];
	readonly #log: PluginRuntimeServices['log'];
	readonly #state: PluginRuntimeServices['state'];
	readonly #records = new Map<string, PluginRecord>();
	// 关闭时等待已受理的清单读取与重载，避免迟到的任务重新交付实例。
	readonly #pending = new Set<Promise<unknown>>();
	readonly #dependencies: PluginDependencies;
	readonly #runtimeScope: PluginScope;
	readonly #publisher: StatePublisherApi<readonly PluginRuntimeInfo[]>;
	// 清单或队列成员变化时重算拓扑。每轮选取仍检查当前实例状态。
	#activationOrder: readonly PluginIdentity[] | undefined;
	#activating: Promise<void> | undefined;
	#closing: Promise<void> | undefined;

	constructor({ app, services, backupData }: PluginRuntimeOptions) {
		this.#app = app;
		this.#backupData = backupData;
		// 宿主服务就绪后取用一次。激活和停用直接使用保存的接口。
		this.#auth = services.get('auth');
		this.#database = services.get('database');
		this.#log = services.get('log');
		this.#state = services.get('state');
		this.#dependencies = new PluginDependencies(
			(id, code, cause) => this.#reportFailure(id, code, cause),
			() => this.#publish(),
		);
		// 整个运行时持有一份状态主题，单个插件停用只更新快照。
		this.#runtimeScope = new PluginScope((cause) =>
			this.#reportFailure(undefined, 'PLUGIN_RUNTIME_CLEANUP_FAILED', cause),
		);
		this.#publisher = this.#state.register({
			...PluginRuntimeStateTopic,
			schema: PluginRuntimeListSchema,
			initial: this.list(),
			lifetime: this.#runtimeScope,
		});
	}

	startBuiltins(plugins: readonly BuiltinPlugin[]): Promise<void> {
		return this.#track(this.#startBuiltins(plugins));
	}

	start(directories: readonly string[]): Promise<void> {
		const targets = [...new Set(directories)].map((directory) => ({ directory }));
		return this.#track(
			this.#readBatch(targets).then(({ accepted, failures }) => {
				// 开发入口沿用批次语义。市场入口单独读取每个安装包的失败。
				if (accepted || failures.length === 0) return;
				if (failures.length === 1) throw failures[0].cause;
				throw new AggregateError(
					failures.map(({ cause }) => cause),
					'PLUGIN_BATCH_START_FAILED',
				);
			}),
		);
	}

	startInstalled(
		targets: readonly InstalledPluginTarget[],
	): Promise<ReadonlyMap<string, InstalledPluginStartFailure>> {
		return this.#track(
			this.#readBatch(targets.map((installed) => ({ directory: installed.directory, installed }))).then(
				({ failures }) =>
					new Map(
						failures.flatMap(({ pluginId, stage, cause }) =>
							pluginId === undefined ? [] : [[pluginId, { stage, cause }]],
						),
					),
			),
		);
	}

	/** 恢复使用同一套迁移与备份声明登记。这里没有运行实例，也不会调用 activate。 */
	prepareInstalled(target: InstalledPluginTarget, signal: AbortSignal): Promise<void> {
		return this.#track(this.#prepareInstalled(target, signal));
	}

	async #prepareInstalled(target: InstalledPluginTarget, signal: AbortSignal): Promise<void> {
		this.#assertOpen();
		signal.throwIfAborted();
		const scope = new PluginScope((cause) => this.#reportFailure(target.pluginId, 'PLUGIN_CLEANUP_FAILED', cause));
		const preparation: PluginScopeApi = {
			signal: AbortSignal.any([scope.signal, signal]),

			onDispose: (cleanup) => scope.onDispose(cleanup),
		};
		try {
			const local = await readPluginPackage(target.directory, target);
			preparation.signal.throwIfAborted();
			if (!local.package.nexus.entry.backend) return;
			const source = await readPluginSource(local);
			const module = await pTimeout(loadPlugin(source, preparation), {
				milliseconds: activationTimeout,
				signal: preparation.signal,
				message: new CodedError('PLUGIN_ACTIVATION_TIMEOUT'),
			});
			await this.#prepareStorage(target.pluginId, target.version, module, preparation);
		} finally {
			await scope.close();
		}
	}

	getInstalled(target: InstalledPluginTarget): PluginRuntimeInfo | undefined {
		const record = this.#records.get(target.pluginId);
		if (record && matchesInstallation(record, target)) return this.#snapshot(record);
	}

	stop(pluginId: string): Promise<void> {
		const record = this.#records.get(pluginId);
		if (!record) return Promise.resolve();
		if (record.builtin) return Promise.reject(new CodedError('PLUGIN_BUILTIN_MANAGED_BY_HOST'));
		record.reload?.controller.abort(new CodedError('PLUGIN_CONTEXT_EXPIRED'));
		if (this.#cancelWaiting(record)) this.#publish();
		return record.instance ? this.#stop(record.instance) : Promise.resolve();
	}

	async removeInstalled(target: InstalledPluginTarget): Promise<void> {
		const record = this.#records.get(target.pluginId);
		if (!record) return;
		if (!matchesInstallation(record, target)) throw new CodedError('PLUGIN_INSTALLED_IDENTITY_MISMATCH');
		await this.stop(target.pluginId);
		if (this.#records.get(target.pluginId) !== record || record.instance || record.waiting || record.reload)
			throw new CodedError('PLUGIN_ALREADY_STARTED');
		this.#records.delete(target.pluginId);
		this.#activationOrder = undefined;
		this.#publish();
	}

	reload(pluginId: string): Promise<void> {
		if (this.#closing) return Promise.reject(new CodedError('PLUGIN_RUNTIME_CLOSED'));
		const record = this.#records.get(pluginId);
		if (!record) return Promise.reject(new CodedError('PLUGIN_RUNTIME_NOT_FOUND'));
		if (record.builtin) return Promise.reject(new CodedError('PLUGIN_BUILTIN_MANAGED_BY_HOST'));
		if (record.reload) return record.reload.pending;
		const controller = new AbortController();
		const pending = Promise.resolve()
			.then(async () => {
				controller.signal.throwIfAborted();
				this.#cancelWaiting(record);
				if (record.instance) await this.#stop(record.instance);
				this.#assertOpen();
				controller.signal.throwIfAborted();
				const target = await readPluginPackage(record.directory, record.installed);
				const source = await readPluginSource(target);
				// 读取清单期间可能收到停用或关停，只有仍有效的重载才能重新排队。
				this.#assertOpen();
				controller.signal.throwIfAborted();
				if (source.id !== pluginId) throw new CodedError('PLUGIN_RELOAD_ID_CHANGED');
				record.source = source;
				record.failures.clear();
				const request = this.#enqueue(record);
				this.#publish();
				await this.#scheduleActivations();
				controller.signal.throwIfAborted();
				if (request.failure) throw request.failure.cause;
			})
			.finally(() => {
				record.reload = undefined;
			});
		record.reload = { controller, pending };
		return this.#track(pending);
	}

	get(pluginId: string): PluginRuntimeInfo | undefined {
		const record = this.#records.get(pluginId);
		return record && this.#snapshot(record);
	}

	list(): readonly PluginRuntimeInfo[] {
		return Object.freeze([...this.#records.values()].map((record) => this.#snapshot(record)));
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		const owners = this.#dependencies.stopOrder();
		this.#closing = Promise.resolve().then(() => this.#close(owners));
		// 同步封住启动队列，运行中的实例随后按依赖停止顺序清理。
		for (const record of this.#records.values()) {
			this.#cancelWaiting(record);
			record.reload?.controller.abort(new CodedError('PLUGIN_CONTEXT_EXPIRED'));
		}
		for (const owner of owners) {
			this.#dependencies.markStopping(owner);
			if (!this.#records.get(owner.id)?.instance?.activeModule) owner.scope.abort();
		}
		return this.#closing;
	}

	#track<Result>(pending: Promise<Result>): Promise<Result> {
		this.#pending.add(pending);

		const untrack = () => this.#pending.delete(pending);

		void pending.then(untrack, untrack);
		return pending;
	}

	async #startBuiltins(plugins: readonly BuiltinPlugin[]): Promise<void> {
		this.#assertOpen();
		if (!plugins.length) return;

		const records = new Map<string, BuiltinPluginRecord>();
		for (const builtin of plugins) {
			const { id, version, dependsOn = {} } = builtin;
			if (records.has(id) || this.#records.has(id)) throw new CodedError('PLUGIN_DUPLICATE_ID');
			records.set(id, { builtin, source: { id, version, dependsOn, authMethods: false }, failures: new Set() });
		}

		const requests = [...records.values()].map((record) => ({
			record,
			request: this.#enqueue(record),
		}));
		this.#publish();
		await this.#scheduleActivations();
		this.#assertOpen();

		// 内置入口使用同一激活队列，启动阶段要求每个入口完成激活。
		for (const { record, request } of requests) {
			if (request.failure) throw request.failure.cause;
			if (!record.instance?.activeModule) throw new CodedError('PLUGIN_BUILTIN_DEPENDENCY_BLOCKED');
		}
	}

	async #readBatch(
		targets: readonly PluginBatchTarget[],
	): Promise<{ accepted: boolean; failures: PluginBatchFailure[] }> {
		this.#assertOpen();
		const loaded = await Promise.allSettled(
			targets.map(async (target): Promise<{ id: string; record?: PluginRecord }> => {
				const pkg = await readPluginPackage(target.directory, target.installed);
				if (target.installed && !pkg.package.nexus.entry.backend) {
					// 纯前端包仍是有效的安装记录，Node 不为它创建实例。
					await checkPluginEntries(pkg);
					return { id: pkg.pluginId };
				}
				const source = await readPluginSource(pkg);
				return { id: source.id, record: { ...target, source, failures: new Set() } };
			}),
		);
		// 清单读取并行执行，完成后才接受仍有效的启动请求。
		this.#assertOpen();

		const failures: PluginBatchFailure[] = [];
		const records = new Map<string, PluginRecord | undefined>();
		const seen = new Set<string>();
		let accepted = false;
		for (const [index, result] of loaded.entries()) {
			if (result.status === 'rejected') {
				const pluginId = targets[index].installed?.pluginId;
				failures.push({ pluginId, stage: 'load', cause: result.reason });
				this.#reportFailure(pluginId, 'PLUGIN_START_FAILED', result.reason);
				continue;
			}
			const { id, record } = result.value;
			if (seen.has(id)) {
				if (records.delete(id)) {
					const cause = new CodedError('PLUGIN_DUPLICATE_ID');
					failures.push({ pluginId: id, stage: 'load', cause });
					this.#reportFailure(id, 'PLUGIN_START_FAILED', cause);
				}
				continue;
			}
			seen.add(id);
			const existing = this.#records.get(id);
			if (existing?.builtin) {
				const cause = new CodedError('PLUGIN_BUILTIN_ID_RESERVED');
				failures.push({ pluginId: id, stage: 'load', cause });
				this.#reportFailure(id, 'PLUGIN_START_FAILED', cause);
				continue;
			}
			if (existing?.instance || existing?.waiting || existing?.reload) {
				if (record?.installed && matchesInstallation(existing, record.installed)) {
					accepted = true;
					continue;
				}
				const cause = new CodedError('PLUGIN_ALREADY_STARTED');
				failures.push({ pluginId: id, stage: 'load', cause });
				this.#reportFailure(id, 'PLUGIN_START_FAILED', cause);
				continue;
			}
			records.set(id, record);
		}

		const requests: PluginStartRequest[] = [];
		for (const record of records.values()) {
			if (record) requests.push(this.#enqueue(record));
			else accepted = true;
		}
		if (requests.length > 0) {
			this.#publish();
			await this.#scheduleActivations();
			this.#assertOpen();
		}
		for (const { record, failure } of requests) {
			if (failure) failures.push({ pluginId: record.source.id, stage: 'activate', cause: failure.cause });
			else accepted = true;
		}
		return { accepted, failures };
	}

	#enqueue(record: PluginRecord): PluginStartRequest {
		const request: PluginStartRequest = { record };
		this.#records.set(record.source.id, record);
		record.waiting = request;
		this.#activationOrder = undefined;
		return request;
	}

	#cancelWaiting(record: PluginRecord): boolean {
		if (!record.waiting) return false;
		record.waiting = undefined;
		this.#activationOrder = undefined;
		return true;
	}

	#scheduleActivations(): Promise<void> {
		// 多个启动或重载请求共用一个激活循环，避免同时启动同一个依赖分支。
		return (this.#activating ??= Promise.resolve().then(() => this.#activateWaiting()));
	}

	async #activateWaiting(): Promise<void> {
		try {
			while (!this.#closing) {
				const next = this.#nextActivation();
				if (!next) break;
				// 候选从等待转入实例，仍留在同一张依赖图中。
				next.record.waiting = undefined;
				try {
					await this.#startInstance(next.record);
				} catch (cause) {
					next.failure = { cause };
					this.#activationOrder = undefined;
				}
			}
		} finally {
			this.#activating = undefined;
		}
	}

	#nextActivation(): PluginStartRequest | undefined {
		const order = (this.#activationOrder ??= this.#orderActivations());
		const available = new Map<string, string>();
		// 拓扑可以复用，每次等待结束后都要重新检查实例状态。
		for (const { id, version, dependsOn } of order) {
			const satisfied = Object.entries(dependsOn).every(([provider, range]) => {
				const actual = available.get(provider);
				return actual !== undefined && semver.satisfies(actual, range);
			});
			if (!satisfied) continue;
			const record = this.#records.get(id);
			if (record?.waiting) return record.waiting;
			// 这里只要求入口成功。业务 ready 继续由 provide/use 协调。
			if (record?.instance?.owner.state === 'running') available.set(id, version);
		}
	}

	#orderActivations(): readonly PluginIdentity[] {
		const sources = [...this.#records.values()]
			.filter(({ waiting, instance }) => waiting || instance)
			.map(({ source }) => source);
		const graph = buildPluginDependencyGraph(sources);
		const cycles = alg.findCycles(graph);
		// 拒绝环内请求。下游仍受缺少提供方的约束，其余分支可以继续启动。
		for (const cycle of cycles) {
			for (const id of cycle) {
				const request = this.#records.get(id)?.waiting;
				if (request) {
					const cause = new CodedError('PLUGIN_DEPENDENCY_CYCLE');
					request.record.failures.add(cause.code);
					request.failure = { cause };
					request.record.waiting = undefined;
					this.#reportFailure(id, 'PLUGIN_START_FAILED', cause);
				}
				graph.removeNode(id);
			}
		}
		if (cycles.length > 0) this.#publish();
		return alg.topsort(graph).map((id) => graph.node(id));
	}

	async #startInstance(record: PluginRecord): Promise<void> {
		this.#assertOpen();
		const { source } = record;
		const { id } = source;

		const scope = new PluginScope((cause) => this.#reportFailure(id, 'PLUGIN_CLEANUP_FAILED', cause));
		let prepared;
		try {
			prepared = this.#prepareContext(source, scope);
		} catch (cause) {
			// bind 中途失败时，先前登记的资源仍归这个实例统一回收。
			const closing = scope.close();
			record.failures.add(
				cause instanceof CodedError && cause.code === 'PLUGIN_DEPENDENCY_CYCLE'
					? 'PLUGIN_DEPENDENCY_CYCLE'
					: 'PLUGIN_START_FAILED',
			);
			this.#reportFailure(id, 'PLUGIN_START_FAILED', cause);
			this.#publish();
			await closing.catch((cleanup) => this.#reportFailure(id, 'PLUGIN_CLEANUP_FAILED', cleanup));
			throw cause;
		}
		const { owner, context } = prepared;

		// 超时限制宿主等待入口；在途代码依赖 scope.signal 协作取消。
		const activation = pTimeout(
			Promise.resolve().then(() => this.#activate(record, context)),
			{
				milliseconds: activationTimeout,
				signal: scope.signal,
				message: new CodedError('PLUGIN_ACTIVATION_TIMEOUT'),
			},
		);
		const instance: PluginInstance = { owner, context, activation, record };
		record.instance = instance;
		this.#publish();

		try {
			const module = await activation;
			scope.signal.throwIfAborted();
			if (owner.state === 'stopping') throw new CodedError('PLUGIN_CONTEXT_EXPIRED');
			instance.activeModule = module;
			this.#dependencies.activate(owner);
			this.#log.report({ source: 'plugin.runtime', level: 'info', code: 'PLUGIN_STARTED', pluginId: id });
		} catch (cause) {
			if (owner.state !== 'stopping') {
				record.failures.add('PLUGIN_START_FAILED');
				this.#reportFailure(id, 'PLUGIN_START_FAILED', cause);
			}
			try {
				await this.#stop(instance);
			} catch (cleanup) {
				throw new AggregateError([cause, cleanup], 'PLUGIN_START_AND_CLEANUP_FAILED');
			}
			throw cause;
		}
	}

	#prepareContext(source: PluginRecord['source'], scope: PluginScope) {
		const { id } = source;
		// 先注入宿主 API，再为 provide/use 登记插件身份。两者共享一次激活的作用域。
		const app = this.#app.bind(id, scope);
		const owner = this.#dependencies.register(source, scope);
		const context: PluginContextApi = {
			app,

			...(source.authMethods && {
				authMethods: this.#auth.bindMethods(id, scope, () =>
					owner.state === 'running' ? owner.readiness : undefined,
				),
			}),

			self: {
				id,
				readiness: {
					get value() {
						return owner.readiness;
					},

					set: (update) => this.#dependencies.setReadiness(owner, update),
				},
			},

			signal: scope.signal,

			onDispose: (cleanup) => scope.onDispose(cleanup),

			provide: (name: string, value: unknown) => this.#dependencies.provide(owner, scope, name, value),

			use: (selection, setup) =>
				this.#dependencies.use(owner, selection, setup as Parameters<PluginDependencies['use']>[2]),
		};
		return { owner, context };
	}

	async #activate(record: PluginRecord, context: PluginContextApi): Promise<PluginModuleApi> {
		context.signal.throwIfAborted();
		const module = record.builtin ? record.builtin : await loadPlugin(record.source, context);
		context.signal.throwIfAborted();
		await this.#prepareStorage(record.source.id, record.source.version, module, context);
		await module.activate(context);
		// 取消后插件仍可通过 onDispose 交付迟到的资源，实例不会标记为已启动。
		context.signal.throwIfAborted();
		return module;
	}

	async #prepareStorage(id: string, version: string, module: PluginModuleApi, scope: PluginScopeApi): Promise<void> {
		scope.signal.throwIfAborted();
		const pending = (async () => {
			if (module.migrations) await this.#database.migratePlugin(id, module.migrations, scope.signal);
			scope.signal.throwIfAborted();
			await this.#backupData?.register(id, version, module.backup, scope.signal);
		})();
		// 停用和启动超时也要等待迁移收尾，避免下一实例与其重叠。
		const unregister = scope.onDispose(async () => {
			await pending.catch(() => undefined);
		});
		try {
			await pending;
			scope.signal.throwIfAborted();
		} finally {
			unregister();
		}
	}

	#stop(instance: PluginInstance): Promise<void> {
		if (instance.stopping) return instance.stopping;
		this.#dependencies.markStopping(instance.owner);
		const dependents = this.#dependencies.drain(instance.owner);
		instance.stopping = this.#finishStop(instance, dependents).finally(() => {
			this.#dependencies.remove(instance.owner);
			instance.record.instance = undefined;
			this.#activationOrder = undefined;
			this.#publish();
		});
		// 激活中的提供方还没有可用服务，可以立即取消入口加载。
		if (!instance.activeModule) instance.owner.scope.abort();
		this.#publish();
		return instance.stopping;
	}

	async #finishStop(instance: PluginInstance, dependents: Promise<void>): Promise<void> {
		const { id, scope } = instance.owner;
		const failures: unknown[] = [];
		try {
			await dependents;
		} catch (cause) {
			failures.push(cause);
		}
		// 下游依赖作用域先清理，提供方自己的已绑定能力随后随根作用域撤销。
		scope.abort();
		await this.#dispose(instance, failures);
		if (failures.length > 0) {
			instance.record.failures.add('PLUGIN_STOP_FAILED');
			const error = new AggregateError(failures, 'PLUGIN_STOP_FAILED');
			this.#reportFailure(id, 'PLUGIN_STOP_FAILED', error);
			throw error;
		}
		if (instance.activeModule)
			this.#log.report({ source: 'plugin.runtime', level: 'info', code: 'PLUGIN_STOPPED', pluginId: id });
	}

	async #dispose({ owner, context, activation, activeModule }: PluginInstance, failures: unknown[]): Promise<void> {
		await activation.catch(() => undefined);
		try {
			// 只对激活成功并发布的模块调用停用钩子。失败和取消也要关闭作用域。
			await activeModule?.deactivate?.(context);
		} catch (cause) {
			failures.push(cause);
		}
		try {
			// 即使 deactivate 失败，也要排空绑定能力和插件自己登记的清理。
			await owner.scope.close();
		} catch (cause) {
			failures.push(cause);
		}
	}

	async #close(owners: readonly PluginDependencyOwner[]): Promise<void> {
		const failures: unknown[] = [];
		for (const { id } of owners) {
			const instance = this.#records.get(id)?.instance;
			if (!instance) continue;
			try {
				await this.#stop(instance);
			} catch (cause) {
				failures.push(cause);
			}
		}
		await Promise.allSettled(this.#pending);
		// 插件终态发布完成后撤销运行时主题。共享 StateApi 仍可服务其他主题。
		try {
			await this.#runtimeScope.close();
		} catch (cause) {
			failures.push(cause);
		}
		if (failures.length > 0) throw new AggregateError(failures, 'PLUGIN_RUNTIME_CLOSE_FAILED');
	}

	#snapshot(record: PluginRecord): PluginRuntimeInfo {
		const { id, version } = record.source;
		const owner = record.instance?.owner;
		const issues = this.#dependencies.issues(
			record.source,
			(pluginId) => this.#records.get(pluginId)?.source.version,
		);
		for (const code of record.failures) issues.push({ pluginId: id, code });
		return Object.freeze({
			pluginId: id,
			version,
			runtime: owner?.state ?? (record.failures.size ? 'failed' : 'stopped'),
			readiness: owner?.readiness ?? pendingReadiness,
			issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
		});
	}

	#publish(): void {
		if (this.#runtimeScope.signal.aborted) return;
		try {
			// 入口阶段和依赖就绪变化共用这份快照，版本及补丁由 StateApi 计算。
			this.#publisher.publish(this.list());
		} catch (cause) {
			this.#reportFailure(undefined, 'PLUGIN_RUNTIME_STATE_PUBLISH_FAILED', cause);
		}
	}

	#assertOpen(): void {
		if (this.#closing) throw new CodedError('PLUGIN_RUNTIME_CLOSED');
	}

	#reportFailure(pluginId: string | undefined, code: string, cause: unknown): void {
		this.#log.report({ source: 'plugin.runtime', level: 'error', code, pluginId, cause });
	}
}
