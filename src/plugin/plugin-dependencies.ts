import { Graph, alg, type Label } from '@dagrejs/graphlib';
import semver from 'semver';
import { CodedError } from '../utils/error.js';
import type { PluginScopeApi } from './plugin-api.js';
import { PluginScope } from './plugin-api.js';
import { PluginServiceSelectionSchema, type PluginServiceSelection } from './plugin-service-types.js';
import { PluginReadinessUpdateSchema, type PluginReadiness, type PluginRuntimeIssue } from './plugin-state-types.js';

export interface PluginIdentity {
	readonly id: string;
	readonly version: string;
	readonly dependsOn: Readonly<Record<string, string>>;
}

interface ServiceRegistration {
	readonly ownerId: string;
	readonly value: unknown;
	readonly isCurrent: () => boolean;
}

interface DependencyScope extends PluginScopeApi {
	readonly plugin: Readonly<Record<string, unknown>>;
	provide(name: string, value: unknown): () => void;
}

type Cleanup = Parameters<PluginScopeApi['onDispose']>[0];

type Setup = (scope: DependencyScope) => void | Cleanup | Promise<void | Cleanup>;

/** 一次实际交付的服务绑定，依赖恢复会创建新的绑定和子作用域。 */
interface ServiceBinding {
	readonly services: readonly ServiceRegistration[];
	readonly scope: PluginScope;
	readonly setup: Promise<void>;
	invalid: boolean;
	stopping?: Promise<void>;
}

/** ctx.use() 的登记会跨服务变化保留，并记住最近一次失败的服务组合。 */
interface ServiceUse {
	readonly selection: PluginServiceSelection;
	readonly setup: Setup;
	removed: boolean;
	binding?: ServiceBinding;
	failed?: readonly ServiceRegistration[];
}

export interface PluginDependencyOwner extends PluginIdentity {
	readonly scope: PluginScope;
	readonly canProvide: () => boolean;
	readonly services: Map<string, ServiceRegistration>;
	readonly uses: Set<ServiceUse>;
	state: 'starting' | 'running' | 'stopping';
	readiness: PluginReadiness;
}

interface PluginOwnerTopology {
	readonly graph: Graph<Label, PluginDependencyOwner>;
	readonly startOrder: readonly PluginDependencyOwner[];
	readonly stopOrder: readonly PluginDependencyOwner[];
}

type ReportFailure = (
	id: string,
	code: 'PLUGIN_DEPENDENCY_SETUP_FAILED' | 'PLUGIN_DEPENDENCY_CLEANUP_FAILED',
	cause: unknown,
) => void;

type CreateScope = (report: (cause: unknown) => void) => PluginScope;

/** 边从提供方指向消费者。调用方决定哪些包参与当前计划。 */
export function buildPluginDependencyGraph<Plugin extends Pick<PluginIdentity, 'id' | 'dependsOn'>>(
	plugins: Iterable<Plugin>,
): Graph<Label, Plugin> {
	const graph = new Graph<Label, Plugin>({ directed: true });
	for (const plugin of plugins) graph.setNode(plugin.id, plugin);
	for (const id of graph.nodes()) {
		for (const dependency of Object.keys(graph.node(id).dependsOn)) {
			if (graph.hasNode(dependency)) graph.setEdge(dependency, id);
		}
	}
	return graph;
}

/**
 * 管理插件间的 provide/use。入口成功后实例进入 running，服务交付还要检查
 * 提供方 readiness、版本与传递依赖。每次交付都拥有单独的清理作用域。
 */
export class PluginDependencies {
	readonly #owners = new Map<string, PluginDependencyOwner>();
	readonly #report: ReportFailure;
	readonly #onChange: () => void;
	readonly #createScope: CreateScope;
	#topology: PluginOwnerTopology | undefined;
	#pending: Promise<void> | undefined;
	#changed = false;

	constructor(
		report: ReportFailure,
		onChange: () => void,
		createScope: CreateScope = (report) => new PluginScope(report),
	) {
		this.#report = report;
		this.#onChange = onChange;
		this.#createScope = createScope;
	}

	register(
		{ id, version, dependsOn }: PluginIdentity,
		scope: PluginScope,
		canProvide = () => true,
	): PluginDependencyOwner {
		if (this.#owners.has(id)) throw new CodedError('PLUGIN_DUPLICATE_ID');
		const owner: PluginDependencyOwner = {
			id,
			version,
			dependsOn,
			scope,
			canProvide,
			services: new Map(),
			uses: new Set(),
			state: 'starting',
			readiness: Object.freeze({ state: 'pending' }),
		};
		this.#owners.set(id, owner);
		this.#topology = undefined;
		try {
			this.#ownerTopology();
		} catch (cause) {
			this.#owners.delete(id);
			throw cause;
		}
		return owner;
	}

	activate(owner: PluginDependencyOwner): void {
		owner.state = 'running';
		this.refresh();
	}

	setReadiness(owner: PluginDependencyOwner, update: unknown): void {
		this.#assertOwnerOpen(owner);
		const parsed = PluginReadinessUpdateSchema.safeParse(update);
		if (!parsed.success) throw new CodedError('PLUGIN_READINESS_INVALID', { cause: parsed.error });
		this.#assertOwnerOpen(owner);
		owner.readiness = parsed.data;
		this.refresh();
	}

	issues(
		{ id, dependsOn }: PluginIdentity,
		knownVersion: (pluginId: string) => string | undefined,
	): PluginRuntimeIssue[] {
		const issues = Object.entries(dependsOn).flatMap(([pluginId, required]): PluginRuntimeIssue[] => {
			const provider = this.#owners.get(pluginId);
			const actual = provider?.version ?? knownVersion(pluginId);
			if (actual && !semver.satisfies(actual, required)) {
				return [{ code: 'PLUGIN_DEPENDENCY_VERSION_MISMATCH', pluginId, required, actual }];
			}
			if (!provider || provider.state === 'stopping')
				return [{ code: 'PLUGIN_DEPENDENCY_NOT_RUNNING', pluginId }];
			if (!this.#isAvailable(pluginId, required)) return [{ code: 'PLUGIN_DEPENDENCY_NOT_READY', pluginId }];
			return [];
		});
		const owner = this.#owners.get(id);
		if (owner && [...owner.uses].some((use) => use.failed && sameServices(this.#resolve(owner, use), use.failed))) {
			issues.push({ code: 'PLUGIN_DEPENDENCY_SETUP_FAILED', pluginId: id });
		}
		return issues;
	}

	markStopping(owner: PluginDependencyOwner): void {
		owner.state = 'stopping';
	}

	async drain(owner: PluginDependencyOwner): Promise<void> {
		this.#invalidateBindings();
		// 显式停用只等待自己的绑定及受影响的下游，其他分支由日常协调处理。
		const affected = new Set(alg.preorder(this.#ownerTopology().graph, [owner.id]));
		const failures: unknown[] = [];
		await this.#drainInvalid(failures, (consumer, binding) => {
			return consumer === owner || binding.services.some((service) => affected.has(service.ownerId));
		});
		this.refresh();
		if (failures.length) throw new AggregateError(failures, 'PLUGIN_DEPENDENCY_CLEANUP_FAILED');
	}

	remove(owner: PluginDependencyOwner): void {
		this.#owners.delete(owner.id);
		this.#topology = undefined;
		owner.services.clear();
		owner.uses.clear();
	}

	stopOrder(): readonly PluginDependencyOwner[] {
		return this.#ownerTopology().stopOrder;
	}

	/** 服务随登记作用域撤销。根插件或某次依赖绑定都能提供服务。 */
	provide(
		owner: PluginDependencyOwner,
		scope: PluginScope,
		name: string,
		value: unknown,
		isCurrent = () => !scope.signal.aborted,
	): () => void {
		this.#assertOwnerOpen(owner);
		if (!isCurrent()) throw new CodedError('PLUGIN_CONTEXT_EXPIRED');
		if (typeof name !== 'string' || !name) throw new CodedError('PLUGIN_SERVICE_NAME_INVALID');
		if (owner.services.has(name)) throw new CodedError('PLUGIN_SERVICE_DUPLICATE');
		const registration: ServiceRegistration = { ownerId: owner.id, value, isCurrent };
		owner.services.set(name, registration);

		const revoke = () => {
			if (owner.services.get(name) !== registration) return;
			owner.services.delete(name);
			untrack();
			this.refresh();
		};

		const untrack = scope.onDispose(revoke);
		this.refresh();
		return revoke;
	}

	/** 登记消费者的需求。等协调任务拿到整组服务后再运行 setup。 */
	use(owner: PluginDependencyOwner, selection: PluginServiceSelection, setup: Setup): () => void {
		this.#assertOwnerOpen(owner);
		const parsed = PluginServiceSelectionSchema.safeParse(selection);
		if (!parsed.success) throw new CodedError('PLUGIN_SERVICE_SELECTION_INVALID', { cause: parsed.error });
		if (typeof setup !== 'function') throw new CodedError('PLUGIN_SERVICE_SETUP_INVALID');
		for (const [providerId] of Object.values(parsed.data)) {
			if (!Object.hasOwn(owner.dependsOn, providerId)) throw new CodedError('PLUGIN_DEPENDENCY_UNDECLARED');
		}
		this.#assertOwnerOpen(owner);
		const use: ServiceUse = { selection: parsed.data, setup, removed: false };
		owner.uses.add(use);
		this.refresh();

		return () => {
			if (use.removed) return;
			use.removed = true;
			this.refresh();
		};
	}

	#reconcile(): Promise<void> {
		// 同步标记失效的绑定，再异步清理。服务很快恢复时，旧句柄也保持失效。
		this.#invalidateBindings();
		this.#changed = true;
		return (this.#pending ??= Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			try {
				while (this.#changed) {
					this.#changed = false;
					// 清理等待期间可能再次收到变更，由同一个协调任务继续处理。
					await this.#drainInvalid(failures);
					this.#bindAvailable();
				}
			} finally {
				this.#pending = undefined;
			}
			if (failures.length) throw new AggregateError(failures, 'PLUGIN_DEPENDENCY_CLEANUP_FAILED');
		}));
	}

	/** 服务、就绪状态或宿主准入条件变化后，重新检查现有及等待中的绑定。 */
	refresh(): void {
		// 每个失败已按消费者记录；显式停用还会收到汇总错误。
		void this.#reconcile().catch(() => undefined);
		this.#onChange();
	}

	#invalidateBindings(): void {
		for (const owner of this.stopOrder()) {
			for (const use of owner.uses) {
				if (use.failed && !this.#resolve(owner, use)) use.failed = undefined;
				if (use.binding && !this.#isCurrent(owner, use, use.binding)) use.binding.invalid = true;
			}
		}
	}

	async #drainInvalid(
		failures: unknown[],
		includes: (owner: PluginDependencyOwner, binding: ServiceBinding) => boolean = () => true,
	): Promise<void> {
		// 等待清理时依赖可能变化。每次重新从最末的消费者开始查找。
		let invalid = this.#findInvalidBinding(includes);
		while (invalid) {
			const { owner, use, binding } = invalid;
			try {
				await this.#closeBinding(owner, use, binding);
			} catch (cause) {
				failures.push(cause);
			}
			invalid = this.#findInvalidBinding(includes);
		}
	}

	#closeBinding(owner: PluginDependencyOwner, use: ServiceUse, binding: ServiceBinding): Promise<void> {
		return (binding.stopping ??= Promise.resolve()
			.then(async () => {
				binding.scope.abort();
				// setup 可能仍在异步创建资源，等它交回清理函数再释放子作用域。
				await binding.setup;
				await binding.scope.close();
			})
			.catch((cause: unknown) => {
				this.#report(owner.id, 'PLUGIN_DEPENDENCY_CLEANUP_FAILED', cause);
				throw cause;
			})
			.finally(() => {
				use.binding = undefined;
			}));
	}

	#bindAvailable(): void {
		for (const owner of this.#ownerTopology().startOrder) {
			for (const use of owner.uses) {
				if (use.removed) {
					if (!use.binding) owner.uses.delete(use);
					continue;
				}
				const services = this.#resolve(owner, use);
				if (!services) use.failed = undefined;
				else if (!use.binding && !sameServices(use.failed, services)) this.#bind(owner, use, services);
			}
		}
	}

	#findInvalidBinding(
		includes: (owner: PluginDependencyOwner, binding: ServiceBinding) => boolean,
	): { owner: PluginDependencyOwner; use: ServiceUse; binding: ServiceBinding } | undefined {
		for (const owner of this.stopOrder()) {
			for (const use of [...owner.uses].reverse()) {
				const binding = use.binding;
				if (binding && includes(owner, binding) && !this.#isCurrent(owner, use, binding)) {
					return { owner, use, binding };
				}
			}
		}
	}

	#bind(owner: PluginDependencyOwner, use: ServiceUse, services: readonly ServiceRegistration[]): void {
		const scope = this.#createScope((cause) => this.#report(owner.id, 'PLUGIN_DEPENDENCY_CLEANUP_FAILED', cause));

		const isCurrent = () => this.#isCurrent(owner, use, binding);

		const guard = () => {
			if (!isCurrent()) throw new CodedError('PLUGIN_SERVICE_EXPIRED');
		};

		// 推迟到绑定写入 use.binding 后运行，setup 和服务访问共用同一有效性检查。
		const setup = Promise.resolve()
			.then(async () => {
				if (!isCurrent()) return;
				const plugin = Object.freeze(
					Object.fromEntries(
						Object.keys(use.selection).map((alias, index) => [
							alias,
							bindService(services[index].value, guard),
						]),
					),
				);
				const context: DependencyScope = {
					plugin,
					signal: scope.signal,

					provide: (name: string, value: unknown) => this.provide(owner, scope, name, value, isCurrent),

					onDispose: (cleanup) => scope.onDispose(cleanup),
				};
				const cleanup = await scope.run(() => use.setup(context));
				if (typeof cleanup === 'function') scope.onDispose(cleanup);
			})
			.catch((cause: unknown) => {
				if (!isCurrent()) return;
				// 同一组服务失败后等待依赖变化，避免协调任务立即重试同一个回调。
				use.failed = services;
				this.#report(owner.id, 'PLUGIN_DEPENDENCY_SETUP_FAILED', cause);
				this.refresh();
			});
		const binding: ServiceBinding = { scope, services, setup, invalid: false };
		use.binding = binding;
	}

	#isCurrent(owner: PluginDependencyOwner, use: ServiceUse, binding: ServiceBinding): boolean {
		return (
			use.binding === binding &&
			!binding.invalid &&
			!binding.scope.signal.aborted &&
			!sameServices(use.failed, binding.services) &&
			sameServices(this.#resolve(owner, use), binding.services)
		);
	}

	#resolve(owner: PluginDependencyOwner, use: ServiceUse): ServiceRegistration[] | undefined {
		if (use.removed || owner.state !== 'running' || owner.scope.signal.aborted) return;
		const services: ServiceRegistration[] = [];
		for (const [id, name] of Object.values(use.selection)) {
			const provider = this.#owners.get(id);
			const registration = provider?.services.get(name);
			if (!provider || !registration || !this.#isAvailable(id, owner.dependsOn[id]) || !registration.isCurrent())
				return;
			services.push(registration);
		}
		return services;
	}

	#isAvailable(id: string, range: string): boolean {
		const provider = this.#owners.get(id);
		return (
			!!provider &&
			provider.state === 'running' &&
			provider.readiness.state === 'ready' &&
			provider.canProvide() &&
			!provider.scope.signal.aborted &&
			semver.satisfies(provider.version, range) &&
			Object.entries(provider.dependsOn).every(([dependency, required]) =>
				this.#isAvailable(dependency, required),
			)
		);
	}

	#ownerTopology(): PluginOwnerTopology {
		if (this.#topology) return this.#topology;
		// 服务登记和 readiness 只改变可用性，实例加入或离开时才重算拓扑。
		const graph = buildPluginDependencyGraph(this.#owners.values());
		try {
			const startOrder = alg.topsort(graph).map((id) => graph.node(id));
			return (this.#topology = { graph, startOrder, stopOrder: startOrder.toReversed() });
		} catch (cause) {
			if (cause instanceof alg.CycleException) throw new CodedError('PLUGIN_DEPENDENCY_CYCLE', { cause });
			throw cause;
		}
	}

	#assertOwnerOpen(owner: PluginDependencyOwner): void {
		if (owner.state === 'stopping' || owner.scope.signal.aborted) throw new CodedError('PLUGIN_CONTEXT_EXPIRED');
	}
}

function sameServices(
	current: readonly ServiceRegistration[] | undefined,
	expected: readonly ServiceRegistration[],
): boolean {
	return current?.length === expected.length && expected.every((service, index) => service === current[index]);
}

/** 每次访问已绑定的 API 都复核作用域。方法返回的资源句柄由服务和调用方管理。 */
function bindService(value: unknown, guard: () => void): unknown {
	const cache = new WeakMap<object, object>();

	const bind = (member: unknown, receiver?: object): unknown => {
		if (typeof member === 'function') {
			return new Proxy(member, {
				apply(target, thisArg, args) {
					guard();
					return Reflect.apply(target, receiver ?? thisArg, args);
				},

				construct(target, args, newTarget) {
					guard();
					return Reflect.construct(target, args, newTarget);
				},
			});
		}
		if (!member || typeof member !== 'object') return member;
		const existing = cache.get(member);
		if (existing) return existing;
		const proxy = new Proxy(Object.create(null) as object, {
			get(_target, key) {
				guard();
				return bind(Reflect.get(member, key, member), member);
			},

			set(_target, key, replacement) {
				guard();
				return Reflect.set(member, key, replacement, member);
			},

			has(_target, key) {
				guard();
				return Reflect.has(member, key);
			},

			ownKeys() {
				guard();
				return Reflect.ownKeys(member);
			},

			getOwnPropertyDescriptor(_target, key) {
				guard();
				const descriptor = Reflect.getOwnPropertyDescriptor(member, key);
				if (!descriptor) return;
				return {
					configurable: true,
					enumerable: descriptor.enumerable,

					get: () => {
						guard();
						return bind(Reflect.get(member, key, member), member);
					},
				};
			},
		});
		cache.set(member, proxy);
		return proxy;
	};

	return bind(value);
}
