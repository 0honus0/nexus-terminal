import type { PluginInstanceService } from './plugin-instance-service.js';
import type { PluginLifecycleFactory } from '../model/plugin-lifecycle-types.js';
import { AGENT_PLUGIN_INSTANCE_PREPARE_KEY } from '@nexus-terminal/shared/agent/plugins/runtime';
import { agentRecord, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginRegistrations } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import { fromRegistryDefinition } from '../registry/model/registry-protocol.js';
import { RegistryModel } from '../registry/model/registry-model.js';
import type {
	RegistryCaller,
	RegistryQuery,
	RegistryPage,
	RegistryDescription,
	RegistryBinding,
	RegistryResolvedCall,
	RegistryScope,
	RegistryDefinition,
	RegistryEventValue,
} from '../registry/model/registry-types.js';
import type {
	PluginCallableInput,
	PluginCapabilityRequest,
	PluginCapabilityReply,
} from '../model/plugin-invocation-types.js';

import { PluginSourceInvocationFailure } from '../model/plugin-invocation-failure.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import { randomUUID } from 'node:crypto';

import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	aggregateAgentFailures,
	isAgentDrainFailure,
} from '../../agent-failure.js';
import type { PluginModel } from '../model/plugin-model.js';
import type { PluginRuntimeOwner } from '../model/plugin-types.js';
import { authorizePluginContent } from './plugin-rules.js';

interface RuntimeConstruction {
	logicalInstanceId: string;
	packageId: string | undefined;
	userId: number;
	appId: string;
	promise: Promise<void>;
	stop: AbortController;
	shutdown: Promise<void> | null;
	binding: { owner: PluginRuntimeOwner | null };
}

export class PluginRuntimeService {
	private readonly retirementObservers = new Set<
		(scope: import('../model/plugin-types.js').PluginRuntimeRetirementScope) => Promise<void>
	>();
	private readonly registry = new RegistryModel((error) =>
		logDiagnostic(this.logger, 'error', 'PLUGIN_REGISTRY_OBSERVER_FAILED', {}, error),
	);
	private readonly starts = new Map<string, RuntimeConstruction>();
	private readonly preparations = new WeakMap<PluginRuntimeOwner, { promise: Promise<void>; repeat: boolean }>();
	private readonly owners = new Map<string, PluginRuntimeOwner>();
	private readonly pending = new Set<Promise<unknown>>();
	private readonly runParticipants = new Map<string, Set<PluginRuntimeOwner>>();
	private readonly resourceClosings = new Map<string, Promise<void>>();
	private readonly stopSignal = new AbortController();
	private closing = false;
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;
	private readonly unsubscribeInstances: () => void;

	subscribeRetirement(
		observer: (scope: import('../model/plugin-types.js').PluginRuntimeRetirementScope) => Promise<void>,
	): () => void {
		this.retirementObservers.add(observer);
		return () => {
			this.retirementObservers.delete(observer);
		};
	}

	constructor(
		private readonly model: PluginModel,
		private readonly instances: PluginInstanceService,
		private readonly lifecycle: PluginLifecycleFactory,
		private readonly logger?: Logger,
	) {
		this.unsubscribeInstances = instances.subscribe((scope) => {
			this.registry.invalidate({ userId: scope.userId, appId: scope.appId });
			const task = this.track(async () => {
				const owners = [...this.owners.values()].filter(
					(owner) =>
						owner.userId === scope.userId &&
						owner.appId === scope.appId &&
						owner.logicalInstanceId === scope.instanceId,
				);
				for (const owner of owners) {
					try {
						await this.validateInstance(owner);
					} catch (error) {
						if (!(
							error instanceof AgentFailure &&
							['version_conflict', 'not_found', 'forbidden'].includes(error.code)
						)) {
							throw error;
						}
						const construction = this.starts.get(owner.runtimeKey);
						if (construction?.binding.owner === owner) {
							// Concurrent Run startup must await this captured construction's
							// replacement instead of inheriting its activation refusal.
							await this.stopInstance(scope.userId, scope.appId, scope.instanceId);
						} else {
							await this.closeBoundOwner(owner);
						}
					}
				}
				let logical;
				try {
					logical = await this.instances.source(scope.userId, scope.appId, scope.instanceId);
				} catch (error) {
					if (
						error instanceof AgentFailure &&
						['version_conflict', 'not_found', 'forbidden'].includes(error.code)
					) {
						return;
					}
					throw error;
				}
				if (logical.instance.enabled) {
					try {
						await this.start(
							scope.userId,
							scope.appId,
							this.stopSignal.signal,
							logical.instance.packageId,
							logical.instance.id,
						);
					} catch (error) {
						if (!(
							error instanceof AgentFailure &&
							['version_conflict', 'not_found', 'forbidden'].includes(error.code)
						)) {
							throw error;
						}
					}
				}
			});
			void task.catch((error: unknown) =>
				logDiagnostic(this.logger, 'warn', 'PLUGIN_INSTANCE_RECONCILE_FAILED', scope, error),
			);
		});
	}

	async directoryCaller(
		scope: RegistryScope,
		ownerId: string,
		packageIds: readonly string[],
		capabilities: RegistryCaller['capabilities'],
		signal: AbortSignal,
		selectedPackageIds: readonly string[] = packageIds,
		toolKeys: readonly string[] | null = null,
	): Promise<RegistryCaller> {
		const instances: string[] = [];
		const tools: string[] = [];
		for (const owner of this.owners.values()) {
			if (
				owner.userId !== scope.userId ||
				owner.appId !== scope.appId ||
				!packageIds.includes(owner.packageId) ||
				owner.closing ||
				!owner.withdrawRegistrations
			) {
				continue;
			}
			try {
				await this.model.runtimeInstallation(
					scope.userId,
					scope.appId,
					(current, publisher, enabled) => {
						authorizePluginContent(current, publisher, enabled);
						if (current.revision !== owner.revision) {
							throw new AgentFailure('version_conflict');
						}
					},
					owner.packageId,
				);
			} catch (error) {
				if (
					error instanceof AgentFailure &&
					(error.code === 'not_found' || error.code === 'version_conflict' || error.code === 'forbidden')
				) {
					owner.withdrawRegistrations?.();
					owner.withdrawRegistrations = null;
					continue;
				}
				throw error;
			}
			if (signal.aborted || this.closing || owner.closing || owner.stop.signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			const logical = await this.instances.source(scope.userId, scope.appId, owner.logicalInstanceId);
			if (!logical.instance.enabled || logical.configuration.revision !== owner.configurationRevision) {
				continue;
			}
			instances.push(owner.logicalInstanceId);
			if (logical.instance.selected && selectedPackageIds.includes(owner.packageId)) {
				tools.push(owner.logicalInstanceId);
			}
		}
		return {
			userId: scope.userId,
			appId: scope.appId,
			ownerId,
			visibleInstanceIds: instances,
			visibleToolInstanceIds: tools,
			visibleToolKeys: toolKeys === null ? null : toolKeys.map((key) => key),
			capabilities: capabilities.map((value) => value),
		};
	}

	discover(caller: RegistryCaller, query: RegistryQuery): RegistryPage {
		return this.registry.discover(caller, query);
	}

	describe(caller: RegistryCaller, entryId: string): RegistryDescription {
		return this.registry.describe(caller, entryId);
	}

	describeBinding(caller: RegistryCaller, bindingId: string) {
		return this.registry.describeBinding(caller, bindingId);
	}

	bind(caller: RegistryCaller, entryId: string): RegistryBinding {
		return this.registry.bind(caller, entryId);
	}

	releaseBindings(caller: RegistryScope & { ownerId: string }): void {
		this.registry.release(caller);
	}

	subscribeDirectory(scope: RegistryScope, notify: () => void): () => void {
		return this.registry.subscribe(scope, notify);
	}

	waitDirectory(scope: RegistryScope, revision: number, signal: AbortSignal): Promise<number> {
		return this.registry.wait(scope, revision, signal);
	}

	waitEvent(
		caller: RegistryCaller,
		entryId: string,
		afterRevision: number,
		signal: AbortSignal,
	): Promise<RegistryEventValue> {
		return this.registry.waitEvent(caller, entryId, afterRevision, signal);
	}

	private async registeredProvider(scope: RegistryScope, instanceId: string, generation: string) {
		const owner = [...this.owners.values()].find(
			(item) =>
				item.userId === scope.userId &&
				item.appId === scope.appId &&
				item.logicalInstanceId === instanceId &&
				item.generation === generation,
		);
		if (!owner || owner.closing || !owner.withdrawRegistrations) {
			throw new AgentFailure('version_conflict');
		}
		await this.model.runtimeInstallation(
			scope.userId,
			scope.appId,
			(current, publisher, enabled) => {
				authorizePluginContent(current, publisher, enabled);
				if (current.revision !== owner.revision) {
					throw new AgentFailure('version_conflict');
				}
			},
			owner.packageId,
		);
		if (owner.closing || this.closing || owner.stop.signal.aborted || !owner.withdrawRegistrations) {
			throw new AgentFailure('provider_unavailable');
		}
		await this.validateInstance(owner);
		return { owner, provider: this.registry.providerOf(scope, instanceId, generation) };
	}

	async assertSource(scope: RegistryScope, instanceId: string, generation: string): Promise<void> {
		await this.registeredProvider(scope, instanceId, generation);
	}

	async replaceRegistrations(
		scope: RegistryScope,
		instanceId: string,
		generation: string,
		definitions: RegistryDefinition[],
	): Promise<number> {
		const { owner, provider } = await this.registeredProvider(scope, instanceId, generation);
		owner.withdrawRegistrations = this.registry.publish(provider, definitions, generation);
		return this.registry.revision(scope);
	}

	async emitEvent(
		scope: RegistryScope,
		instanceId: string,
		generation: string,
		input: { key: string; cursor: string | null; payloadJson: string },
	): Promise<RegistryEventValue> {
		const { provider } = await this.registeredProvider(scope, instanceId, generation);
		return this.registry.publishEvent(provider, input);
	}

	resolve(caller: RegistryCaller, bindingId: string, argumentsJson: string): RegistryResolvedCall {
		return this.registry.resolve(caller, bindingId, argumentsJson);
	}

	invokeCallable(
		resolved: RegistryResolvedCall,
		scope: PluginCallableInput['scope'],
		signal: AbortSignal,
		bridge: (request: PluginCapabilityRequest, signal: AbortSignal) => Promise<PluginCapabilityReply>,
	): Promise<string> {
		return this.track(async () => {
			if (scope.kind === 'run') {
				await this.resourceClosings.get(scope.runId);
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable', { cause: signal.reason });
				}
			}
			const target = resolved.provider;
			const owner = [...this.owners.values()].find(
				(owner) =>
					owner.logicalInstanceId === target.instanceId &&
					owner.generation === target.generation &&
					owner.userId === target.userId &&
					owner.appId === target.appId,
			);
			if (
				!owner ||
				owner.closing ||
				!owner.instance ||
				owner.configurationRevision !== target.configurationRevision
			) {
				throw new AgentFailure('version_conflict');
			}
			const instance = owner.instance;
			if (scope.kind === 'run') {
				const participants = this.runParticipants.get(scope.runId) ?? new Set();
				participants.add(owner);
				this.runParticipants.set(scope.runId, participants);
			}
			const invocationStop = new AbortController();
			const combined = AbortSignal.any([
				signal,
				owner.stop.signal,
				this.stopSignal.signal,
				invocationStop.signal,
			]);

			const validate = async (): Promise<void> => {
				if (
					combined.aborted ||
					owner.closing ||
					this.owners.get(owner.runtimeKey) !== owner ||
					owner.instance !== instance ||
					Date.now() >= scope.deadlineUnixMs
				) {
					throw new AgentFailure('provider_unavailable');
				}
				await this.model.runtimeInstallation(
					owner.userId,
					owner.appId,
					(current, publisher, enabled) => {
						authorizePluginContent(current, publisher, enabled);
						if (current.revision !== owner.revision) {
							throw new AgentFailure('version_conflict');
						}
					},
					owner.packageId,
				);
				await this.validateInstance(owner);
				if (combined.aborted || owner.closing || owner.instance !== instance) {
					throw new AgentFailure('provider_unavailable');
				}
			};

			const task = Promise.resolve().then(async () => {
				await validate();
				let accepting = true;
				const pending = new Set<Promise<unknown>>();
				const failures: unknown[] = [];
				let value: string | undefined;
				let failed = false;
				let failure: unknown;
				try {
					value = await instance.invokeCallable(
						{ key: resolved.definition.key, argumentsJson: resolved.argumentsJson, scope },
						combined,
						Math.max(1, scope.deadlineUnixMs - Date.now()),
						(request) => {
							if (!accepting) {
								return Promise.resolve({ ok: false, code: 'forbidden' });
							}
							const accepted = Promise.resolve().then(async () => {
								if (request.method !== 'transport.session.close') {
									await validate();
								}
								return bridge({ method: request.method, inputJson: request.inputJson }, combined);
							});
							pending.add(accepted);
							void accepted.then(
								() => pending.delete(accepted),
								(error: unknown) => {
									pending.delete(accepted);
									if (
										!(combined.aborted && error === combined.reason) &&
										isAgentDrainFailure(error)
									) {
										failures.push(error);
									}
								},
							);
							return accepted;
						},
					);
				} catch (error) {
					failed = true;
					failure = error;
				}
				accepting = false;
				invocationStop.abort();
				while (pending.size) {
					await Promise.allSettled([...pending]);
				}
				if (failed) {
					failures.push(
						combined.aborted && failure === combined.reason
							? new AgentFailure('provider_unavailable', { cause: failure })
							: failure,
					);
				}
				if (failures.length === 1) {
					throw failures[0];
				}
				if (failures.length > 1) {
					throw new AggregateError(failures, 'Plugin call or accepted child effect failed');
				}
				if (value === undefined) {
					throw new AgentFailure('internal_failure');
				}
				return resolved.validateResult(value);
			});
			owner.pending.add(task);
			try {
				return await task;
			} finally {
				owner.pending.delete(task);
			}
		});
	}

	/** Releases local protocol caches after Host I/O closes, also on idle expiry. Never activates a provider. */
	releaseResources(scope: { userId: number; appId: string; runId: string }): Promise<void> {
		const original = this.resourceClosings.get(scope.runId);
		if (original) {
			return original;
		}
		const task = this.track(async () => {
			const participants = this.runParticipants.get(scope.runId);
			if (!participants) {
				return;
			}
			const outcomes = await Promise.allSettled(
				[...participants].map((owner) =>
					Promise.resolve().then(async () => {
						if (owner.userId !== scope.userId || owner.appId !== scope.appId) {
							throw new AgentFailure('forbidden');
						}
						if (owner.closing) {
							await owner.closePromise;
							return;
						}
						const instance = owner.instance;
						if (!instance) {
							return;
						}
						const task = instance.releaseResources(scope.runId, Date.now() + 15000);
						owner.pending.add(task);
						try {
							await task;
						} finally {
							owner.pending.delete(task);
						}
					}),
				),
			);
			const failures = outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			if (failures.length) {
				throw aggregateAgentFailures(failures, 'Plugin Run resources did not settle');
			}
			this.runParticipants.delete(scope.runId);
		}, true);
		this.resourceClosings.set(scope.runId, task);
		void task.then(
			() => {
				if (this.resourceClosings.get(scope.runId) === task) {
					this.resourceClosings.delete(scope.runId);
				}
			},
			() => undefined,
		);
		return task;
	}

	hasBoundInstance(userId: number, appId: string): boolean {
		return [...this.owners.values(), ...this.starts.values()].some(
			(item) => item.userId === userId && item.appId === appId,
		);
	}

	async start(
		userId: number,
		appId: string,
		signal: AbortSignal,
		packageId?: string,
		logicalInstanceId?: string,
	): Promise<void> {
		const candidates = (await this.instances.list(userId, appId)).filter(
			(item) =>
				item.enabled &&
				(packageId === undefined || item.packageId === packageId) &&
				(logicalInstanceId === undefined || item.id === logicalInstanceId),
		);
		if (candidates.length !== 1) {
			throw new AgentFailure('version_conflict');
		}
		const logical = candidates[0];
		packageId = logical.packageId;
		logicalInstanceId = logical.id;
		if (this.closing || signal.aborted) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const key = userId + ':' + appId + ':' + logicalInstanceId;
		const existing = this.starts.get(key);
		if (existing) {
			return this.awaitConstruction(existing, signal);
		}
		const stop = new AbortController();
		const lifetime = AbortSignal.any([this.stopSignal.signal, stop.signal, AbortSignal.timeout(60000)]);
		const binding: { owner: PluginRuntimeOwner | null } = { owner: null };
		const promise = this.track(() =>
			this.startInstance(userId, appId, lifetime, binding, logical.id, logical.packageId),
		);
		const construction: RuntimeConstruction = {
			userId,
			appId,
			packageId,
			logicalInstanceId: logical.id,
			promise,
			stop,
			shutdown: null,
			binding,
		};
		this.starts.set(key, construction);
		void promise.then(
			() => {
				if (!construction.shutdown && this.starts.get(key) === construction) {
					this.starts.delete(key);
				}
			},
			() => {
				if (!construction.shutdown && this.starts.get(key) === construction) {
					this.starts.delete(key);
				}
			},
		);
		return this.awaitConstruction(construction, signal);
	}

	private async awaitConstruction(construction: RuntimeConstruction, signal: AbortSignal): Promise<void> {
		// Caller cancellation never tears down a shared construction. The original
		// caller and later joiners both await its actual settlement and retirement.
		try {
			await construction.promise;
		} catch (error) {
			if (!construction.shutdown) {
				throw error;
			}
		}
		if (construction.shutdown) {
			// Only a confirmed replacement can reopen under freshly read authority;
			// unknown cleanup rejects here before any new activation or invocation.
			await construction.shutdown;
			return this.start(
				construction.userId,
				construction.appId,
				signal,
				construction.packageId,
				construction.logicalInstanceId,
			);
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
	}

	private async startInstance(
		userId: number,
		appId: string,
		signal: AbortSignal,
		binding: { owner: PluginRuntimeOwner | null },
		logicalInstanceId: string,
		packageId: string,
	): Promise<void> {
		const key = userId + ':' + appId + ':' + logicalInstanceId;
		if (this.closing) {
			throw new AgentFailure('provider_unavailable');
		}
		const logical = await this.instances.source(userId, appId, logicalInstanceId);
		if (!logical.instance.enabled || logical.instance.packageId !== packageId) {
			throw new AgentFailure('forbidden');
		}
		const source = await this.model.packageSource(
			userId,
			appId,
			signal,
			(current, publisher, enabled) => authorizePluginContent(current, publisher, enabled),
			packageId,
		);
		if (this.closing || signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const existing = this.owners.get(key);
		if (existing) {
			if (
				existing.revision === source.installation.revision &&
				existing.configurationRevision === logical.configuration.revision &&
				!existing.closing
			) {
				return;
			}
			await this.closeBoundOwner(existing);
		}
		if (source.manifest.backendEntry === null) {
			return;
		}
		const instanceId = randomUUID();
		const owner: PluginRuntimeOwner = {
			runtimeKey: key,
			logicalInstanceId,
			configurationRevision: logical.configuration.revision,
			generation: randomUUID(),
			withdrawRegistrations: null,
			packageId: source.installation.definitionId,
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
		// Persist the exact incarnation before creating its isolated process.
		{
			await this.model.reserveRuntime(
				{
					userId,
					appId,
					packageId: source.installation.definitionId,
					instanceId,
					logicalInstanceId,
					generation: owner.generation,
					configurationRevision: owner.configurationRevision,
					revision: source.installation.revision,
				},
				128,
				(current, key, enabled) => {
					authorizePluginContent(current, key, enabled);
					if (this.closing || signal.aborted || current.revision !== source.installation.revision) {
						throw new AgentFailure('version_conflict');
					}
				},
			);
			this.owners.set(key, owner);
			binding.owner = owner;
			logDiagnostic(this.logger, 'info', 'PLUGIN_RUNTIME_RESERVED', {
				appId,
				instanceId,
				revision: owner.revision,
			});
		}
		try {
			if (this.closing || signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			owner.opening = this.model.openRuntime(source, {
				instanceId: owner.logicalInstanceId,
				generation: owner.generation,
				configurationRevision: owner.configurationRevision,
			});
			owner.instance = await owner.opening;
			this.observe(owner);
			if (this.closing || signal.aborted || owner.closing) {
				throw new AgentFailure('provider_unavailable');
			}
			await this.model.runtimeInstallation(
				userId,
				appId,
				(current, publisher, enabled) => {
					authorizePluginContent(current, publisher, enabled);
					if (current.revision !== owner.revision) {
						throw new AgentFailure('version_conflict');
					}
				},
				packageId,
			);
			if (this.closing || signal.aborted || owner.closing) {
				throw new AgentFailure('provider_unavailable');
			}
			const registrations = await owner.instance.activate();
			if (!(await owner.instance.health())) {
				throw new AgentFailure('provider_unavailable');
			}
			if (this.closing || signal.aborted || owner.closing) {
				throw new AgentFailure('provider_unavailable');
			}
			await this.model.runtimeInstallation(
				userId,
				appId,
				(current, publisher, enabled) => {
					authorizePluginContent(current, publisher, enabled);
					if (current.revision !== owner.revision) {
						throw new AgentFailure('version_conflict');
					}
				},
				packageId,
			);
			await this.validateInstance(owner);
			await this.model.settleRuntime(owner, 'active');
			if (this.closing || signal.aborted || owner.closing || this.owners.get(key) !== owner) {
				throw new AgentFailure('version_conflict');
			}
			owner.withdrawRegistrations = this.registry.publish(
				{
					userId,
					appId,
					packageRevision: owner.revision,
					instanceId: owner.logicalInstanceId,
					generation: owner.generation,
					configurationRevision: owner.configurationRevision,
					package: {
						packageId: source.installation.definitionId,
						version: source.installation.version,
						packageHash: source.installation.packageHash,
						publisherKeyId: source.installation.publisherKeyId,
					},
					namespaces: source.manifest.namespaces.map((namespace) => namespace),
					appEntry: source.manifest.contributions.app?.entry ?? null,
					tools: source.manifest.contributions.tools,
					services: source.manifest.contributions.services,
					capabilities: source.manifest.capabilities.map((value) => value),
				},
				registrations,
				null,
			);
			await this.prepareOptionalContributions(owner, source.manifest, signal);
			logDiagnostic(this.logger, 'info', 'PLUGIN_RUNTIME_ACTIVE', {
				appId,
				instanceId,
				revision: owner.revision,
			});
		} catch (error) {
			logDiagnostic(this.logger, 'warn', 'PLUGIN_RUNTIME_ACTIVATION_FAILED', { appId, instanceId }, error);
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

	private prepareOptionalContributions(
		owner: PluginRuntimeOwner,
		manifest: import('../model/plugin-types.js').PluginManifest,
		signal: AbortSignal,
	): Promise<void> {
		const current = this.preparations.get(owner);
		if (current) {
			current.repeat = true;
			return current.promise;
		}
		const preparation = { promise: Promise.resolve(), repeat: false };
		preparation.promise = Promise.resolve().then(async () => {
			do {
				preparation.repeat = false;
				if (owner.closing || this.closing || this.owners.get(owner.runtimeKey) !== owner) {
					return;
				}
				try {
					await this.prepareInstance(owner, manifest, signal);
				} catch (error) {
					if (isAgentDrainFailure(error) && !(error instanceof PluginSourceInvocationFailure)) {
						throw error;
					}
					// Optional discovery failure leaves static services and their settings available.
					logDiagnostic(
						this.logger,
						'warn',
						'PLUGIN_INSTANCE_PREPARATION_FAILED',
						{
							appId: owner.appId,
							instanceId: owner.logicalInstanceId,
							generation: owner.generation,
						},
						error,
					);
				}
			} while (preparation.repeat);
		});
		this.preparations.set(owner, preparation);
		// Track invocation, post-await validation and lease cleanup as one owned task.
		owner.pending.add(preparation.promise);

		const release = () => {
			owner.pending.delete(preparation.promise);
			if (this.preparations.get(owner) === preparation) {
				this.preparations.delete(owner);
			}
		};

		void preparation.promise.then(release, (error: unknown) => {
			if (isAgentDrainFailure(error)) {
				owner.failures.push(error);
			}
			release();
		});
		return preparation.promise;
	}

	private async prepareInstance(
		owner: PluginRuntimeOwner,
		manifest: import('../model/plugin-types.js').PluginManifest,
		startup: AbortSignal,
	): Promise<void> {
		const instance = owner.instance;
		if (!instance) {
			throw new AgentFailure('internal_failure');
		}
		const signal = AbortSignal.any([startup, owner.stop.signal, this.stopSignal.signal]);

		const validate = async () => {
			signal.throwIfAborted();
			await this.registeredProvider(owner, owner.logicalInstanceId, owner.generation);
			signal.throwIfAborted();
		};

		const lease = this.lifecycle.open({
			userId: owner.userId,
			appId: owner.appId,
			instanceId: owner.logicalInstanceId,
			generation: owner.generation,
			configurationRevision: owner.configurationRevision,
			manifest,
			signal,
			validate,
		});
		const task = instance.invokeCallable(
			{
				key: AGENT_PLUGIN_INSTANCE_PREPARE_KEY,
				argumentsJson: '{}',
				scope: { kind: 'lifecycle', deadlineUnixMs: Date.now() + 60000 },
			},
			signal,
			60000,
			async (request) => {
				try {
					if (request.method === 'transport.session.close') {
						return lease.call(request);
					}
					await validate();
					if (request.method === 'registry.replace') {
						const definitions = readAgentPluginRegistrations(
							agentRecord(JSON.parse(request.inputJson), ['definitions']).definitions,
						);
						const revision = await this.replaceRegistrations(
							owner,
							owner.logicalInstanceId,
							owner.generation,
							definitions.map(fromRegistryDefinition),
						);
						return { ok: true, valueJson: JSON.stringify({ revision }) };
					}
					return lease.call(request);
				} catch (error) {
					if (error instanceof InvalidAgentPayload || error instanceof SyntaxError) {
						return { ok: false, code: 'invalid_input' };
					}
					if (error instanceof AgentFailure && !isAgentDrainFailure(error)) {
						return { ok: false, code: error.code };
					}
					throw error;
				}
			},
		);
		let failure: unknown;
		let failed = false;
		try {
			if ((await task) !== 'null') {
				throw new AgentFailure('invalid_input');
			}
			await validate();
		} catch (error) {
			failed = true;
			failure = error;
		}
		try {
			await lease.close();
		} catch (cleanup) {
			throw aggregateAgentFailures(failed ? [failure, cleanup] : [cleanup], 'Plugin preparation cleanup failed');
		}
		if (failed) {
			throw failure;
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
			logDiagnostic(
				this.logger,
				'error',
				'PLUGIN_RUNTIME_EXITED',
				{ appId: owner.appId, instanceId: owner.instanceId },
				error,
			);
			if (!(error instanceof PluginSourceInvocationFailure)) {
				owner.failures.push(error);
			}
			// Bind cleanup to this instance, even if a subsequent construction uses the same App.
			void this.closeBoundOwner(owner).catch((failure) => {
				this.failures.record(failure);
				this.quiesce();
			});
		};

		owner.observation = instance.exited.then(() => retire(new AgentFailure('operation_unknown')), retire);
	}

	async stop(userId: number, appId: string): Promise<void> {
		const ids = new Set(
			[...this.starts.values(), ...this.owners.values()]
				.filter((item) => item.userId === userId && item.appId === appId)
				.map((item) => item.logicalInstanceId),
		);
		const outcomes = await Promise.allSettled([...ids].map((id) => this.stopInstance(userId, appId, id)));
		const failures = outcomes.flatMap((value) => (value.status === 'rejected' ? [value.reason] : []));
		if (failures.length) {
			throw aggregateAgentFailures(failures, 'Plugin instance drainage failed');
		}
		await this.model.assertRuntimeClosed(userId, appId);
	}

	async stopPackages(userId: number, appId: string, packageIds: readonly string[]): Promise<void> {
		const ids = new Set(
			[...this.starts.values(), ...this.owners.values()]
				.filter(
					(owner) =>
						owner.userId === userId &&
						owner.appId === appId &&
						owner.packageId !== undefined &&
						packageIds.includes(owner.packageId),
				)
				.map((owner) => owner.logicalInstanceId),
		);
		// Begin every original owner's close before waiting, including mutual callers.
		const results = await Promise.allSettled([...ids].map((id) => this.stopInstance(userId, appId, id)));
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw aggregateAgentFailures(failures, 'Provider drainage failed');
		}
	}

	private stopInstance(userId: number, appId: string, logicalInstanceId: string): Promise<void> {
		const key = userId + ':' + appId + ':' + logicalInstanceId;
		const captured = this.owners.get(key);
		const construction = this.starts.get(key);
		if (!construction) {
			return captured ? this.closeBoundOwner(captured) : Promise.resolve();
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
			if (this.starts.get(key) === construction) {
				this.starts.delete(key);
			}
		});
		return construction.shutdown;
	}

	private async validateInstance(owner: PluginRuntimeOwner): Promise<void> {
		const logical = await this.instances.source(owner.userId, owner.appId, owner.logicalInstanceId);
		if (
			!logical.instance.enabled ||
			logical.packageRevision !== owner.revision ||
			logical.configuration.revision !== owner.configurationRevision
		) {
			throw new AgentFailure('version_conflict');
		}
	}

	private closeBoundOwner(owner: PluginRuntimeOwner): Promise<void> {
		if (owner.closePromise) {
			return owner.closePromise;
		}
		owner.closePromise = Promise.resolve().then(() => this.closeRuntime(owner));
		owner.closing = true;
		owner.withdrawRegistrations?.();
		owner.withdrawRegistrations = null;
		owner.stop.abort();
		return owner.closePromise;
	}

	private async closeRuntime(owner: PluginRuntimeOwner): Promise<void> {
		logDiagnostic(this.logger, 'info', 'PLUGIN_RUNTIME_CLOSING', {
			appId: owner.appId,
			instanceId: owner.instanceId,
		});
		const failures: unknown[] = [];
		let closed = false;
		const scope = {
			userId: owner.userId,
			appId: owner.appId,
			instanceId: owner.logicalInstanceId,
			generation: owner.generation,
		};
		const drained = await Promise.allSettled(
			[...this.retirementObservers].map((observer) => Promise.resolve().then(() => observer(scope))),
		);
		failures.push(...drained.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
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
				if (!(error instanceof PluginSourceInvocationFailure)) {
					failures.push(error);
				}
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
			logDiagnostic(
				this.logger,
				'error',
				'PLUGIN_RUNTIME_CLOSE_FAILED',
				{ appId: owner.appId, instanceId: owner.instanceId },
				new AggregateError(failures),
			);
			throw new AgentFailure('operation_unknown', {
				cause: new AggregateError(failures, 'Plugin runtime drain unconfirmed'),
			});
		}
		logDiagnostic(this.logger, 'info', 'PLUGIN_RUNTIME_CLOSED', {
			appId: owner.appId,
			instanceId: owner.instanceId,
		});
		const key = owner.runtimeKey;
		if (this.owners.get(key) === owner) {
			this.owners.delete(key);
		}
		for (const [runId, participants] of this.runParticipants) {
			participants.delete(owner);
			if (participants.size === 0) {
				this.runParticipants.delete(runId);
			}
		}
	}

	reconcile(userId: number, appId: string): Promise<void> {
		return this.track(async () => {
			for (const owner of this.owners.values()) {
				if (owner.userId !== userId || owner.appId !== appId) {
					continue;
				}
				try {
					await this.model.runtimeInstallation(userId, appId, authorizePluginContent, owner.packageId);
				} catch (error) {
					await this.closeBoundOwner(owner);
					if (!(
						error instanceof AgentFailure &&
						(error.code === 'forbidden' || error.code === 'not_found' || error.code === 'version_conflict')
					)) {
						throw error;
					}
				}
			}
			for (const logical of await this.instances.list(userId, appId)) {
				if (!logical.enabled) {
					continue;
				}
				try {
					const existing = this.owners.get(userId + ':' + appId + ':' + logical.id);
					await this.start(userId, appId, this.stopSignal.signal, logical.packageId, logical.id);
					if (existing && !existing.closing && this.owners.get(existing.runtimeKey) === existing) {
						const source = await this.model.packageSource(
							userId,
							appId,
							this.stopSignal.signal,
							authorizePluginContent,
							logical.packageId,
						);
						await this.prepareOptionalContributions(existing, source.manifest, this.stopSignal.signal);
					}
				} catch (error) {
					if (isAgentDrainFailure(error)) {
						throw error;
					}
					logDiagnostic(
						this.logger,
						'warn',
						'PLUGIN_INSTANCE_RECONCILE_FAILED',
						{ appId, instanceId: logical.id },
						error,
					);
				}
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
			throw aggregateAgentFailures(failures, 'Plugin runtime revocation failed');
		}
	}

	private track<T>(work: () => Promise<T>, cleanup = false): Promise<T> {
		if (this.closing && !cleanup) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const task = Promise.resolve().then(work);
		this.pending.add(task);

		const untrack = () => {
			this.pending.delete(task);
		};

		void task.then(untrack, (error) => {
			untrack();
			if (
				isAgentDrainFailure(error) &&
				!(error instanceof ToolExecutionUnknown && !(error instanceof ToolCleanupFailure))
			) {
				this.failures.record(error);
				this.quiesce();
			}
		});
		return task;
	}

	quiesce(): void {
		this.closing = true;
		this.unsubscribeInstances();
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
