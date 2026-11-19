import { alg } from '@dagrejs/graphlib';
import pTimeout from 'p-timeout';
import { shallowRef } from 'vue';
import type { LogApi } from '../../log/browser/log-api.js';
import { CodedError } from '../../utils/error.js';
import type { PluginAppApi, PluginBackendState, PluginContextApi, PluginModuleApi } from '../plugin-api.browser.js';
import type { PluginAppService } from '../plugin-app.js';
import {
	buildPluginDependencyGraph,
	PluginDependencies,
	type PluginDependencyOwner,
	type PluginIdentity,
} from '../plugin-dependencies.js';
import { PluginScope } from '../plugin-api.js';
import { PluginReadinessSchema } from '../plugin-state-types.js';
import {
	PluginContributionRegistry,
	PluginContributionBatch,
	type PluginContributionList,
} from './plugin-contributions.js';
import { BrowserPluginScope } from './plugin-scope.js';

/** 宿主提供稳定的入口加载器。更新后端状态时复用加载器，版本变化时交付新的入口。 */
export interface BrowserPluginTarget extends PluginIdentity {
	readonly enabled: boolean;
	/** 只有后端入口的依赖仍参与就绪判断。 */
	readonly load?: (signal: AbortSignal) => Promise<unknown>;
	readonly backend?: PluginBackendState | null;
}

interface PluginRuntimeOptions {
	readonly app: Pick<PluginAppService<PluginAppApi>, 'bind'>;
	readonly services: { readonly log: Pick<LogApi, 'report'> };
}

interface Instance {
	readonly scope: BrowserPluginScope;
	readonly views: PluginScope;
	readonly owner: PluginDependencyOwner;
	readonly context: PluginContextApi;
	module?: PluginModuleApi;
	stopping?: Promise<void>;
}

interface PluginRecord {
	readonly target: BrowserPluginTarget;
	activation?: Promise<void>;
	instance?: Instance;
	failure?: 'PLUGIN_DEPENDENCY_CYCLE' | 'PLUGIN_START_FAILED' | 'PLUGIN_STOP_FAILED';
}

interface TargetPlan {
	readonly byId: ReadonlyMap<string, BrowserPluginTarget>;
	readonly order: readonly BrowserPluginTarget[];
	readonly cyclic: ReadonlySet<string>;
}

const activationTimeout = 15_000;

const pendingReadiness = Object.freeze({ state: 'pending' } as const);

const emptyTargets = { byId: new Map(), order: [], cyclic: new Set() } satisfies TargetPlan;

function sameEntry(left: BrowserPluginTarget, right: BrowserPluginTarget): boolean {
	return (
		left.version === right.version &&
		left.load === right.load &&
		Object.keys(left.dependsOn).length === Object.keys(right.dependsOn).length &&
		Object.entries(left.dependsOn).every(
			([id, range]) => Object.hasOwn(right.dependsOn, id) && right.dependsOn[id] === range,
		)
	);
}

function checkModule(input: unknown): PluginModuleApi {
	if (typeof input !== 'object' || input === null || !('activate' in input) || typeof input.activate !== 'function')
		throw new CodedError('PLUGIN_MODULE_ACTIVATE_MISSING');
	if ('deactivate' in input && input.deactivate !== undefined && typeof input.deactivate !== 'function')
		throw new CodedError('PLUGIN_MODULE_INVALID');
	return input as PluginModuleApi;
}

/** 每批清单只计算一次排序，更新与取消共用该批目标。 */
function planTargets(byId: ReadonlyMap<string, BrowserPluginTarget>): TargetPlan {
	const graph = buildPluginDependencyGraph([...byId.values()].filter((target) => target.enabled));
	const cyclic = new Set(alg.findCycles(graph).flat());
	for (const id of cyclic) graph.removeNode(id);
	return { byId, cyclic, order: alg.topsort(graph).map((id) => graph.node(id)) };
}

/** 管理当前浏览器的插件实例、依赖服务和组件贡献。 */
export class PluginRuntime {
	readonly #app: PluginRuntimeOptions['app'];
	readonly #log: PluginRuntimeOptions['services']['log'];
	readonly #records = new Map<string, PluginRecord>();
	readonly #contributions = new PluginContributionRegistry();
	readonly #dependencies: PluginDependencies;
	readonly #targets = shallowRef<TargetPlan>(emptyTargets);
	#queue: Promise<unknown> = Promise.resolve();
	#closing: Promise<void> | undefined;

	constructor({ app, services: { log } }: PluginRuntimeOptions) {
		this.#app = app;
		this.#log = log;
		this.#dependencies = new PluginDependencies(
			(id, code) => this.#report(code, id),
			() => {},
			(report) => new BrowserPluginScope(report),
		);
	}

	get contributions(): PluginContributionList {
		return this.#contributions.entries;
	}

	/** 清单变化立即取消过期实例。结构队列只等待停用，入口在独立任务中初始化。 */
	async sync(targets: readonly BrowserPluginTarget[]): Promise<void> {
		this.#assertOpen();
		const next = new Map<string, BrowserPluginTarget>();
		for (const target of targets) {
			if (next.has(target.id)) throw new CodedError('PLUGIN_DUPLICATE_ID');
			const { backend } = target;
			next.set(target.id, {
				...target,
				dependsOn: Object.freeze({ ...target.dependsOn }),
				backend:
					backend &&
					Object.freeze({
						runtime: backend.runtime,
						readiness: PluginReadinessSchema.parse(backend.readiness),
					}),
			});
		}
		const plan = planTargets(next);
		this.#targets.value = plan;
		for (const { target, instance } of this.#records.values()) {
			if (this.#closing || this.#targets.value !== plan) return;
			const replacement = next.get(target.id);
			if (instance && (!replacement?.enabled || !sameEntry(target, replacement) || plan.cyclic.has(target.id)))
				this.#cancel(instance);
		}
		this.#dependencies.refresh();

		const activations = await this.#enqueue(() => this.#reconcile(plan));
		await Promise.all(activations);
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		// 先保存同一次关闭任务，再取消实例，防止取消回调重新提交命令。
		this.#closing = this.#enqueue(() => this.#close());
		for (const { instance } of this.#records.values()) if (instance) this.#cancel(instance);
		return this.#closing;
	}

	#enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
		const pending = this.#queue.then(operation);
		this.#queue = pending.catch(() => undefined);
		return pending;
	}

	async #reconcile(plan: TargetPlan): Promise<Promise<void>[]> {
		if (this.#closing || this.#targets.value !== plan) return [];
		for (const owner of this.#dependencies.stopOrder()) {
			const record = this.#records.get(owner.id);
			if (record?.instance?.scope.signal.aborted) await this.#stop(record).catch(() => undefined);
		}
		if (this.#closing || this.#targets.value !== plan) return [];

		const { byId, cyclic, order } = plan;
		for (const [id, record] of this.#records) {
			const target = byId.get(id);
			const canRetry =
				!record.instance &&
				(!record.failure || (record.failure === 'PLUGIN_DEPENDENCY_CYCLE' && !cyclic.has(id)));
			if (target?.enabled && sameEntry(record.target, target) && !canRetry) continue;

			// 绑定失败时可能还在释放已取得的宿主资源，重建实例前先等待回滚。
			await record.activation;
			this.#records.delete(id);
		}
		if (this.#closing || this.#targets.value !== plan) return [];
		for (const id of cyclic) {
			if (this.#records.get(id)?.failure !== 'PLUGIN_DEPENDENCY_CYCLE') {
				this.#records.set(id, { target: byId.get(id)!, failure: 'PLUGIN_DEPENDENCY_CYCLE' });
				this.#report('PLUGIN_DEPENDENCY_CYCLE', id);
			}
		}

		// 依赖未就绪时也可以初始化页面。服务准入由共用依赖协调器决定。
		const activations: Promise<void>[] = [];
		for (const target of order) {
			if (this.#closing || this.#targets.value !== plan) break;
			const record = this.#records.get(target.id) ?? this.#start(target);
			if (record.activation) activations.push(record.activation);
		}
		return activations;
	}

	#start(target: BrowserPluginTarget): PluginRecord {
		const record: PluginRecord = { target };
		this.#records.set(target.id, record);
		const scope = new BrowserPluginScope(() => this.#report('PLUGIN_CLEANUP_FAILED', target.id));
		const views = new PluginScope(() => this.#report('PLUGIN_VIEW_CLEANUP_FAILED', target.id));
		const batch = new PluginContributionBatch();

		const backend = () => this.#targets.value.byId.get(target.id)?.backend ?? null;

		try {
			const app = this.#app.bind(target.id, scope);
			this.#assertOpen();
			const owner = this.#dependencies.register(target, scope, () => {
				const state = backend();
				return state === null || (state.runtime === 'running' && state.readiness.state === 'ready');
			});
			const readiness = shallowRef(owner.readiness);
			const dependencies = this.#dependencies;
			const context: PluginContextApi = {
				app,
				signal: scope.signal,
				self: {
					id: target.id,

					get backend() {
						scope.signal.throwIfAborted();
						return backend();
					},

					readiness: {
						get value() {
							scope.signal.throwIfAborted();
							return readiness.value;
						},

						set(update) {
							dependencies.setReadiness(owner, update);
							readiness.value = owner.readiness;
						},
					},
				},

				onDispose: (cleanup) => scope.onDispose(cleanup),

				provide: (name: string, value: unknown) => dependencies.provide(owner, scope, name, value),

				use: (selection, setup) =>
					dependencies.use(owner, selection, setup as Parameters<PluginDependencies['use']>[2]),

				contribute: (declarations) => {
					scope.signal.throwIfAborted();
					if (owner.state !== 'starting') throw new CodedError('PLUGIN_CONTRIBUTIONS_ACTIVATION_ONLY');
					batch.add(declarations, scope.signal);
				},
			};
			const instance: Instance = { context, scope, views, owner };
			record.instance = instance;
			record.activation = Promise.resolve().then(() => this.#activate(record, instance, batch));
		} catch {
			record.failure = 'PLUGIN_START_FAILED';
			this.#report(record.failure, target.id);
			record.activation = scope.close().catch(() => this.#report('PLUGIN_CLEANUP_FAILED', target.id));
		}
		return record;
	}

	async #activate(record: PluginRecord, instance: Instance, batch: PluginContributionBatch): Promise<void> {
		const { target } = record;
		const { scope, views, context, owner } = instance;
		try {
			const load = target.load;
			scope.signal.throwIfAborted();
			if (!load) {
				context.self.readiness.set({ state: 'ready' });
				this.#dependencies.activate(owner);
				return;
			}
			const module = await pTimeout(
				Promise.resolve().then(async () => {
					scope.signal.throwIfAborted();
					const loaded = await load(scope.signal);
					scope.signal.throwIfAborted();
					const module = checkModule(loaded);
					await scope.run(() => module.activate(context));
					return module;
				}),
				{
					milliseconds: activationTimeout,
					signal: scope.signal,
					message: new CodedError('PLUGIN_ACTIVATION_TIMEOUT'),
				},
			);
			scope.signal.throwIfAborted();
			instance.module = module;
			this.#contributions.publish(batch, context, views);
			scope.signal.throwIfAborted();
			this.#dependencies.activate(owner);
		} catch {
			if (scope.signal.aborted) return;
			record.failure = 'PLUGIN_START_FAILED';
			this.#report(record.failure, target.id);
			await this.#stop(record).catch(() => undefined);
		}
	}

	#cancel({ owner, scope, views }: Instance): void {
		this.#dependencies.markStopping(owner);
		scope.abort();
		views.abort();
	}

	#stop(record: PluginRecord): Promise<void> {
		const instance = record.instance;
		if (!instance) return Promise.resolve();
		if (instance.stopping) return instance.stopping;
		instance.stopping = Promise.resolve().then(async () => {
			const { owner, module, context, scope, views } = instance;
			const failures: unknown[] = [];
			// 先排空下游依赖与已撤销的组件，再通知插件停用并释放根资源。
			for (const close of [
				() => this.#dependencies.drain(owner),
				() => views.close(),
				() => module?.deactivate?.(context),
				() => scope.close(),
			]) {
				try {
					await close();
				} catch (cause) {
					failures.push(cause);
				}
			}
			this.#dependencies.remove(owner);
			record.instance = undefined;
			if (failures.length) {
				record.failure ??= 'PLUGIN_STOP_FAILED';
				this.#report('PLUGIN_STOP_FAILED', owner.id);
				throw new AggregateError(failures, 'PLUGIN_STOP_FAILED');
			}
		});
		this.#cancel(instance);
		return instance.stopping;
	}

	async #close(): Promise<void> {
		const failures: unknown[] = [];
		for (const owner of this.#dependencies.stopOrder()) {
			try {
				const record = this.#records.get(owner.id);
				if (record) await this.#stop(record);
			} catch (cause) {
				failures.push(cause);
			}
		}
		this.#targets.value = emptyTargets;
		await Promise.allSettled([...this.#records.values()].map(({ activation }) => activation));
		this.#records.clear();
		if (failures.length) throw new AggregateError(failures, 'PLUGIN_RUNTIME_CLOSE_FAILED');
	}

	#assertOpen(): void {
		if (this.#closing) throw new CodedError('PLUGIN_RUNTIME_CLOSED');
	}

	#report(code: string, pluginId: string): void {
		this.#log.report({ source: 'plugin.runtime', level: 'error', code, pluginId });
	}
}
