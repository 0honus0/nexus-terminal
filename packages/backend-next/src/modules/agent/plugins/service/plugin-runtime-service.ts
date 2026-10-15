import { randomUUID } from 'node:crypto';
import { isPluginIntentRpc } from './plugin-intent-service.js';
import type { PluginIntentService } from './plugin-intent-service.js';
import type { PluginIntentActor } from '../model/plugin-intent-types.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { AgentFailure, isAgentDrainFailure } from '../../agent-failure.js';
import type { PluginModel } from '../model/plugin-model.js';
import type {
	PluginRuntimeOwner,
	PluginRpcInput,
	PluginRpcResult,
	PluginDataMutation,
	PluginInstallation,
	PluginPublisher,
} from '../model/plugin-types.js';
import { authorizePluginContent, decidePluginData } from './plugin-rules.js';

interface RuntimeConstruction {
	userId: number;
	appId: string;
	promise: Promise<void>;
	stop: AbortController;
	shutdown: Promise<void> | null;
	binding: { owner: PluginRuntimeOwner | null };
}

export class PluginRuntimeService {
	private readonly starts = new Map<string, RuntimeConstruction>();
	private readonly owners = new Map<string, PluginRuntimeOwner>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly stopSignal = new AbortController();
	private closing = false;
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: PluginModel,
		private readonly intents: PluginIntentService,
	) {}

	hasBoundInstance(userId: number, appId: string): boolean {
		const key = userId + ':' + appId;
		return this.owners.has(key) || this.starts.has(key);
	}

	start(userId: number, appId: string, signal: AbortSignal): Promise<void> {
		if (this.closing || signal.aborted) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const key = userId + ':' + appId;
		const existing = this.starts.get(key);
		if (existing) {
			if (existing.shutdown || existing.stop.signal.aborted) {
				return Promise.reject(new AgentFailure('provider_unavailable'));
			}
			return existing.promise.then(() => {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
			});
		}
		if (this.starts.size >= 2) {
			return Promise.reject(new AgentFailure('limit_exceeded'));
		}
		const stop = new AbortController();
		const lifetime = AbortSignal.any([this.stopSignal.signal, stop.signal, AbortSignal.timeout(60000)]);
		const binding: { owner: PluginRuntimeOwner | null } = { owner: null };
		const promise = this.track(() => this.startInstance(userId, appId, lifetime, binding));
		const construction: RuntimeConstruction = { userId, appId, promise, stop, shutdown: null, binding };
		this.starts.set(key, construction);
		void promise.then(
			() => {
				if (this.starts.get(key) === construction) {
					this.starts.delete(key);
				}
			},
			() => {
				if (this.starts.get(key) === construction) {
					this.starts.delete(key);
				}
			},
		);
		// Caller cancellation never tears down a shared construction. The owner still waits for its actual settlement.
		return promise.then(() => {
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
		});
	}

	private async startInstance(
		userId: number,
		appId: string,
		signal: AbortSignal,
		binding: { owner: PluginRuntimeOwner | null },
	): Promise<void> {
		const key = userId + ':' + appId;
		if (this.closing) {
			throw new AgentFailure('provider_unavailable');
		}
		const source = await this.model.packageSource(userId, appId, signal, (current, publisher, enabled) =>
			authorizePluginContent(current, publisher, enabled),
		);
		if (this.closing || signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const existing = this.owners.get(key);
		if (existing) {
			if (existing.revision === source.installation.revision && !existing.closing) {
				return;
			}
			await this.closeBoundOwner(existing);
		}
		if (source.manifest.backendEntry === null) {
			return;
		}
		if (this.owners.size >= 32) {
			throw new AgentFailure('limit_exceeded');
		}
		const instanceId = randomUUID();
		await this.model.reserveRuntime(
			{ userId, appId, instanceId, revision: source.installation.revision },
			(current, key, enabled, retained) => {
				if (retained >= 4096) {
					throw new AgentFailure('limit_exceeded');
				}
				authorizePluginContent(current, key, enabled);
				if (this.closing || signal.aborted || current.revision !== source.installation.revision) {
					throw new AgentFailure('version_conflict');
				}
			},
		);
		const owner: PluginRuntimeOwner = {
			instanceId,
			userId,
			appId,
			revision: source.installation.revision,
			instance: null,
			opening: null,
			observation: null,
			closePromise: null,
			closing: false,
			stop: new AbortController(),
			pending: new Set(),
			failures: [],
		};
		this.owners.set(key, owner);
		binding.owner = owner;
		try {
			if (this.closing || signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			owner.opening = this.model.openRuntime(source, (input) => this.host(owner, input));
			owner.instance = await owner.opening;
			this.observe(owner);
			if (this.closing || signal.aborted || owner.closing) {
				throw new AgentFailure('provider_unavailable');
			}
			await this.model.runtimeInstallation(userId, appId, (current, publisher, enabled) => {
				authorizePluginContent(current, publisher, enabled);
				if (current.revision !== owner.revision) {
					throw new AgentFailure('version_conflict');
				}
			});
			if (this.closing || signal.aborted || owner.closing) {
				throw new AgentFailure('provider_unavailable');
			}
			await owner.instance.activate();
			if (!(await owner.instance.health())) {
				throw new AgentFailure('provider_unavailable');
			}
			if (this.closing || signal.aborted || owner.closing) {
				throw new AgentFailure('provider_unavailable');
			}
			await this.model.runtimeInstallation(userId, appId, (current, publisher, enabled) => {
				authorizePluginContent(current, publisher, enabled);
				if (current.revision !== owner.revision) {
					throw new AgentFailure('version_conflict');
				}
			});
			await this.model.settleRuntime(owner, 'active');
		} catch (error) {
			try {
				await this.closeBoundOwner(owner);
			} catch (cleanup) {
				throw new AgentFailure('operation_unknown', {
					cause: new AggregateError([error, cleanup], 'Plugin activation and cleanup failed'),
				});
			}
			throw error;
		}
	}

	private observe(owner: PluginRuntimeOwner): void {
		const instance = owner.instance;
		if (!instance) {
			throw new AgentFailure('internal_failure');
		}

		const retire = (error: unknown) => {
			if (owner.closing) {
				return;
			}
			owner.failures.push(error);
			// Bind cleanup to this instance, even if a subsequent construction uses the same App.
			void this.closeBoundOwner(owner).catch((failure) => {
				this.failures.record(failure);
				this.quiesce();
			});
		};

		owner.observation = instance.exited.then(() => retire(new AgentFailure('operation_unknown')), retire);
	}

	private host(owner: PluginRuntimeOwner, input: PluginRpcInput): Promise<PluginRpcResult> {
		const { userId, appId } = owner;
		const key = userId + ':' + appId;

		if (owner.closing || this.closing || this.owners.get(key) !== owner) {
			throw new AgentFailure('provider_unavailable');
		}

		const validate = (current: PluginInstallation, publisher: PluginPublisher | null, enabled: boolean) => {
			authorizePluginContent(current, publisher, enabled);
			if (owner.closing || this.closing || current.revision !== owner.revision) {
				throw new AgentFailure('version_conflict');
			}
		};

		const intentActor: PluginIntentActor = {
			userId,
			appId,
			authorization: {
				kind: 'runtime',
				revision: owner.revision,

				validate: () => {
					if (owner.closing || this.closing || this.owners.get(key) !== owner) {
						throw new AgentFailure('provider_unavailable');
					}
				},
			},
		};
		const work = Promise.resolve().then(async (): Promise<PluginRpcResult> => {
			if (isPluginIntentRpc(input)) {
				return this.intents.rpc(intentActor, input, owner.stop.signal);
			}
			if (input.method === 'host.appInfo') {
				return {
					method: input.method,
					value: await this.model.runtimeInstallation(userId, appId, validate),
				};
			}
			if (input.method === 'storage.get') {
				return {
					method: input.method,
					value: await this.model.runtimeReadData(userId, appId, input.key, validate),
				};
			}
			const mutation: PluginDataMutation = {
				expectedRevision: owner.revision,
				key: input.key,
				expectedVersion: input.expectedVersion,
				operationId: input.operationId,
				valueJson: input.method === 'storage.put' ? input.valueJson : null,
			};
			return {
				method: input.method,
				value: await this.model.runtimeMutateData(
					userId,
					appId,
					mutation,
					validate,
					(current, keys, operations, bytes, resultBytes) =>
						decidePluginData(mutation, current, keys, operations, bytes, resultBytes),
				),
			};
		});
		owner.pending.add(work);
		void work.then(
			() => owner.pending.delete(work),
			(error) => {
				owner.pending.delete(work);
				if (isAgentDrainFailure(error)) {
					owner.failures.push(error);
					owner.closing = true;
					void this.stop(userId, appId).catch((failure) => {
						this.failures.record(failure);
						this.quiesce();
					});
				}
			},
		);
		return work;
	}

	stop(userId: number, appId: string): Promise<void> {
		const key = userId + ':' + appId;
		const captured = this.owners.get(key);
		const construction = this.starts.get(key);
		if (!construction) {
			return this.closeOwner(userId, appId).then(() => this.model.assertRuntimeClosed(userId, appId));
		}
		construction.stop.abort();
		construction.shutdown ??= Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			try {
				await construction.promise;
			} catch (error) {
				if (isAgentDrainFailure(error)) {
					failures.push(error);
				}
			}
			const targets = new Set<PluginRuntimeOwner>();
			if (captured) {
				targets.add(captured);
			}
			if (construction.binding.owner) {
				targets.add(construction.binding.owner);
			}
			const closed = await Promise.allSettled([...targets].map((owner) => this.closeBoundOwner(owner)));
			failures.push(...closed.flatMap((item) => (item.status === 'rejected' ? [item.reason] : [])));
			if (failures.length) {
				throw new AgentFailure('operation_unknown', {
					cause: new AggregateError(failures, 'Plugin construction and retirement failed'),
				});
			}
		});
		return construction.shutdown;
	}

	private closeOwner(userId: number, appId: string): Promise<void> {
		const owner = this.owners.get(userId + ':' + appId);
		if (!owner) {
			return Promise.resolve();
		}
		return this.closeBoundOwner(owner);
	}

	private closeBoundOwner(owner: PluginRuntimeOwner): Promise<void> {
		owner.closing = true;
		owner.stop.abort();
		owner.closePromise ??= Promise.resolve().then(() => this.closeRuntime(owner));
		return owner.closePromise;
	}

	private async closeRuntime(owner: PluginRuntimeOwner): Promise<void> {
		const failures: unknown[] = [];
		let closed = false;
		if (owner.opening) {
			try {
				owner.instance = await owner.opening;
			} catch (error) {
				if (isAgentDrainFailure(error)) {
					failures.push(error);
				}
			}
		}
		if (owner.instance) {
			try {
				await owner.instance.quiesce(Date.now() + 15000);
			} catch (error) {
				failures.push(error);
			}
			try {
				await owner.instance.close();
				closed = true;
			} catch (error) {
				failures.push(error);
			}
		}
		if (closed && owner.observation) {
			await owner.observation;
		}
		await Promise.allSettled([...owner.pending]);
		// Host task observers record failures once, including those arriving during drainage.
		failures.push(...owner.failures);
		try {
			await this.model.settleRuntime(owner, failures.length ? 'unknown' : 'closed');
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) {
			throw new AgentFailure('operation_unknown', {
				cause: new AggregateError(failures, 'Plugin runtime drain unconfirmed'),
			});
		}
		const key = owner.userId + ':' + owner.appId;
		if (this.owners.get(key) === owner) {
			this.owners.delete(key);
		}
	}

	reconcile(userId: number, appId: string): Promise<void> {
		const signal = AbortSignal.any([this.stopSignal.signal, AbortSignal.timeout(60000)]);
		return this.track(async () => {
			const targets = await this.model.runtimeTargets();
			if (targets.some((item) => item.userId === userId && item.appId === appId)) {
				await this.start(userId, appId, signal);
			} else {
				await this.stop(userId, appId);
			}
		});
	}

	async revoke(userId: number | null, appId: string | null): Promise<void> {
		const targets = new Map<string, { userId: number; appId: string }>();
		for (const item of [...this.starts.values(), ...this.owners.values()]) {
			if ((userId === null || item.userId === userId) && (appId === null || item.appId === appId)) {
				targets.set(item.userId + ':' + item.appId, { userId: item.userId, appId: item.appId });
			}
		}
		// Capture each original construction/instance before awaiting any shutdown.
		const results = await Promise.allSettled(
			[...targets.values()].map((item) => this.stop(item.userId, item.appId)),
		);
		const failures = results.flatMap((item) => (item.status === 'rejected' ? [item.reason] : []));
		if (failures.length) {
			throw new AgentFailure('operation_unknown', {
				cause: new AggregateError(failures, 'Plugin runtime revocation failed'),
			});
		}
	}

	private track<T>(work: () => Promise<T>): Promise<T> {
		if (this.closing || this.pending.size >= 32) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const task = Promise.resolve().then(work);
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			(error) => {
				this.pending.delete(task);
				if (isAgentDrainFailure(error)) {
					this.failures.record(error);
					this.quiesce();
				}
			},
		);
		return task;
	}

	quiesce(): void {
		this.closing = true;
		this.stopSignal.abort();
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(async () => {
			const failures: unknown[] = [];
			await Promise.allSettled([...this.pending]);
			try {
				await this.revoke(null, null);
			} catch (error) {
				failures.push(error);
			}
			failures.push(...this.failures.errors());
			if (failures.length) {
				throw new AgentFailure('operation_unknown', {
					cause: new AggregateError(failures, 'Plugin runtime owner shutdown failed'),
				});
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
