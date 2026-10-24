import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import type { WorkspaceInput, WorkspaceResult, WorkspaceMutation } from '../../scope/model/workspace-types.js';
import type { PluginRuntimeObservation, PluginRuntimeAcknowledgement } from '../model/plugin-types.js';
import type {
	PluginDataSnapshot,
	PluginDataMigration,
	PluginDataMigrationResult,
} from '../model/plugin-migration-types.js';
import { parsePluginSkills } from '../plugin-skill-rules.js';
import type { PluginSkillInput } from '../model/plugin-skill-types.js';
import { validateAgentId } from '../../agent-validation.js';
import {
	AGENT_PLUGIN_MAX_MIGRATION_KEYS,
	AGENT_PLUGIN_MAX_DATA_VALUE_BYTES,
	AGENT_PLUGIN_MAX_DATA_KEY_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { isPluginIntentRpc } from './plugin-intent-service.js';
import type { PluginIntentService } from './plugin-intent-service.js';
import type { PluginIntentActor } from '../model/plugin-intent-types.js';
import { PluginRuntimeService } from './plugin-runtime-service.js';
import { authorizePluginContent, decidePluginData } from './plugin-rules.js';
import type { RevokeRuns } from '../../runs/model/run-types.js';
import { randomUUID, createHash } from 'node:crypto';
import {
	AGENT_PLUGIN_MAX_ARCHIVE_BYTES,
	AGENT_PLUGIN_MAX_ASSET_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { AgentFailure, aggregateAgentFailures, isAgentDrainFailure } from '../../agent-failure.js';
import type { PluginModel } from '../model/plugin-model.js';
import type {
	PluginRpcInput,
	PluginRpcResult,
	PluginDataPurge,
	PluginData,
	PluginDataMutation,
	PluginActor,
	PluginPublisher,
	PluginStage,
	PluginInstallation,
	DrainPluginRuns,
	PluginVersion,
	PluginContent,
	PluginFrontendDescriptor,
} from '../model/plugin-types.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { PluginThreadAccess } from '../../scope/model/thread-types.js';
import type { PluginFrontendInput, PluginFrontendResult } from '../model/plugin-agent-types.js';
import { isPluginAgentInput } from '../model/plugin-agent-types.js';

function identity(actor: PluginActor, userId: number | null): void {
	if (actor.userId !== userId) {
		throw new AgentFailure('unauthenticated');
	}
}

export class PluginService {
	dataSnapshot(actor: PluginActor, appId: string): Promise<PluginDataSnapshot> {
		validateAgentId(appId);
		return this.task(async () => {
			const value = await this.model.dataSnapshot(
				actor,
				appId,
				(userId, current, runtimeClosed, upgradePending) =>
					this.admitMigration(actor, appId, userId, current, runtimeClosed, upgradePending),
			);
			if (value.items.length > AGENT_PLUGIN_MAX_MIGRATION_KEYS) {
				throw new AgentFailure('limit_exceeded');
			}
			return value;
		});
	}

	migrateData(
		actor: PluginActor,
		appId: string,
		produce: (signal: AbortSignal) => Promise<PluginDataMigration>,
	): Promise<PluginDataMigrationResult> {
		validateAgentId(appId);
		return this.task(async (signal) => {
			const input = await produce(signal);
			validateAgentId(input.operationId);
			if (
				signal.aborted ||
				!Number.isSafeInteger(input.expectedRevision) ||
				input.expectedRevision < 1 ||
				input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
				input.items.length > AGENT_PLUGIN_MAX_MIGRATION_KEYS ||
				new Set(input.items.map((item) => item.key)).size !== input.items.length
			) {
				throw new AgentFailure('invalid_input');
			}
			for (const item of input.items) {
				if (
					!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(item.key) ||
					Buffer.byteLength(item.key, 'utf8') > AGENT_PLUGIN_MAX_DATA_KEY_BYTES ||
					!Number.isSafeInteger(item.expectedVersion) ||
					item.expectedVersion < 0 ||
					item.expectedVersion >= Number.MAX_SAFE_INTEGER
				) {
					throw new AgentFailure('invalid_input');
				}
				if (item.valueJson !== null) {
					if (
						Buffer.byteLength(item.valueJson, 'utf8') > AGENT_PLUGIN_MAX_DATA_VALUE_BYTES ||
						Buffer.from(item.valueJson, 'utf8').toString('utf8') !== item.valueJson
					) {
						throw new AgentFailure('invalid_input');
					}
					try {
						JSON.parse(item.valueJson);
					} catch (cause) {
						throw new AgentFailure('invalid_input', { cause });
					}
				}
			}
			return this.model.migrateData(
				actor,
				appId,
				input,
				(userId, current, runtimeClosed, upgradePending) => {
					if (signal.aborted) {
						throw new AgentFailure('provider_unavailable');
					}
					this.admitMigration(actor, appId, userId, current, runtimeClosed, upgradePending);
				},
				(keys, bytes) => {
					if (keys > AGENT_PLUGIN_MAX_MIGRATION_KEYS || bytes > 8 * 1024 * 1024) {
						throw new AgentFailure('limit_exceeded');
					}
				},
			);
		});
	}

	private admitMigration(
		actor: PluginActor,
		appId: string,
		userId: number | null,
		current: PluginInstallation,
		runtimeClosed: boolean,
		upgradePending: boolean,
	): void {
		identity(actor, userId);
		if (current.status !== 'draining' || !upgradePending) {
			throw new AgentFailure('version_conflict');
		}
		if (!runtimeClosed || this.runtime.hasBoundInstance(actor.userId, appId)) {
			throw new AgentFailure('operation_unknown');
		}
	}

	private readonly runtime: PluginRuntimeService;
	private readonly pending = new Set<Promise<unknown>>();
	private readonly failures: unknown[] = [];
	private readonly stop = new AbortController();
	private lane: Promise<unknown> = Promise.resolve();
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private readonly contentGrants = new Map<
		string,
		{ actor: PluginActor; appId: string; version: string; revision: number; expiresAt: number }
	>();

	constructor(
		private readonly model: PluginModel,
		private readonly artifacts: ArtifactService,
		private readonly revoke: RevokeRuns,
		private readonly drain: DrainPluginRuns,
		private readonly intents: PluginIntentService,
		private readonly agentRpc: (
			access: PluginThreadAccess,
			input: WorkspaceInput,
			withMutation: WorkspaceMutation,
		) => Promise<WorkspaceResult>,
		private readonly logger?: Logger,
	) {
		this.runtime = new PluginRuntimeService(model, intents, logger);
	}

	runtimeObservation(
		actor: PluginActor,
		appId: string,
		instanceId: string | null = null,
	): Promise<PluginRuntimeObservation | null> {
		return this.task(() =>
			this.model.observeRuntime(actor, appId, (userId) => identity(actor, userId), instanceId),
		);
	}

	acknowledgeRuntime(
		actor: PluginActor,
		appId: string,
		input: PluginRuntimeAcknowledgement,
	): Promise<PluginRuntimeObservation> {
		return this.task(() => {
			if (input.confirmed !== true || this.runtime.hasBoundInstance(actor.userId, appId)) {
				throw new AgentFailure('version_conflict');
			}
			return this.model.acknowledgeRuntime(actor, appId, input, (userId, current) => {
				identity(actor, userId);
				if (current.revision !== input.expectedRevision || this.runtime.hasBoundInstance(actor.userId, appId)) {
					throw new AgentFailure('version_conflict');
				}
			});
		});
	}

	sdkAsset(path: string, deliver: (content: PluginContent, signal: AbortSignal) => Promise<void>): Promise<void> {
		return this.task(async (signal) => {
			const content = await this.model.sdkAsset(path);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			await deliver({ bytes: content.bytes, sha256: content.sha256 }, signal);
		});
	}

	rpc(
		actor: PluginActor,
		appId: string,
		produce: (signal: AbortSignal) => Promise<{ grant: string; input: PluginFrontendInput }>,
	): Promise<PluginFrontendResult> {
		return this.task(async (signal) => {
			const { grant, input } = await produce(signal);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			const permission = this.contentGrants.get(grant);
			if (
				!permission ||
				permission.appId !== appId ||
				permission.actor.userId !== actor.userId ||
				permission.actor.token !== actor.token ||
				permission.expiresAt <= Date.now()
			) {
				throw new AgentFailure('forbidden');
			}

			const validate = (current: PluginInstallation) => {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				if (current.revision !== permission.revision || permission.expiresAt <= Date.now()) {
					throw new AgentFailure('version_conflict');
				}
			};

			const current = await this.model.authorizedInstallation(
				actor,
				appId,
				permission.version,
				(userId, current, publisher, enabled) => {
					identity(actor, userId);
					authorizePluginContent(current, publisher, enabled);
					validate(current);
				},
			);
			const intentActor: PluginIntentActor = {
				userId: actor.userId,
				token: actor.token,
				appId,
				authorization: { kind: 'frontend', revision: permission.revision, expiresAt: permission.expiresAt },
			};
			if (isPluginAgentInput(input)) {
				const value = await this.agentRpc(
					{
						kind: 'plugin',
						userId: actor.userId,
						token: actor.token,
						appId,
						revision: permission.revision,
						expiresAt: permission.expiresAt,

						assertCurrent: () => {
							if (
								signal.aborted ||
								this.contentGrants.get(grant) !== permission ||
								permission.expiresAt <= Date.now()
							) {
								throw new AgentFailure('forbidden');
							}
						},
					},
					input,
					(work) =>
						this.model.withFrontendAdmission(
							actor,
							appId,
							(userId, current, publisher, enabled) => {
								identity(actor, userId);
								authorizePluginContent(current, publisher, enabled);
								validate(current);
							},
							work,
						),
				);
				try {
					await this.model.authorizedInstallation(
						actor,
						appId,
						permission.version,
						(userId, current, publisher, enabled) => {
							identity(actor, userId);
							authorizePluginContent(current, publisher, enabled);
							validate(current);
						},
					);
				} catch (cause) {
					if (
						input.method === 'agent.threads.create' ||
						input.method === 'agent.threads.rename' ||
						input.method === 'agent.threads.delete' ||
						input.method === 'agent.runs.create' ||
						input.method === 'agent.runs.appendInput' ||
						input.method === 'agent.runs.cancel' ||
						input.method === 'agent.subagents.cancel' ||
						input.method === 'agent.approvals.resolve'
					) {
						throw new AgentFailure('operation_unknown', { cause });
					}
					throw cause;
				}
				return value;
			}
			if (isPluginIntentRpc(input)) {
				return this.intents.rpc(intentActor, input, signal);
			}
			if (input.method === 'host.appInfo') {
				return { method: input.method, value: current };
			}
			if (input.method === 'storage.get') {
				return {
					method: input.method,
					value: await this.dataRead(actor, appId, input.key, validate),
				};
			}
			return {
				method: input.method,
				value: await this.dataWrite(
					actor,
					appId,
					{
						key: input.key,
						expectedRevision: permission.revision,
						expectedVersion: input.expectedVersion,
						operationId: input.operationId,
						valueJson: input.method === 'storage.put' ? input.valueJson : null,
					},
					validate,
				),
			};
		});
	}

	readData(actor: PluginActor, appId: string, key: string): Promise<PluginData | null> {
		return this.task(() => this.dataRead(actor, appId, key));
	}

	private dataRead(
		actor: PluginActor,
		appId: string,
		key: string,
		validate?: (current: PluginInstallation) => void,
	): Promise<PluginData | null> {
		return this.model.readData(actor, appId, key, (userId, current, publisher, enabled) => {
			identity(actor, userId);
			authorizePluginContent(current, publisher, enabled);
			validate?.(current);
		});
	}

	mutateData(
		actor: PluginActor,
		appId: string,
		produce: (signal: AbortSignal) => Promise<PluginDataMutation>,
	): Promise<PluginData> {
		return this.task(async (signal) => {
			const input = await produce(signal);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return this.dataWrite(actor, appId, input, () => {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
			});
		});
	}

	private dataWrite(
		actor: PluginActor,
		appId: string,
		input: PluginDataMutation,
		validate?: (current: PluginInstallation) => void,
	): Promise<PluginData> {
		return this.model.mutateData(
			actor,
			appId,
			input,
			(userId, current, publisher, enabled) => {
				identity(actor, userId);
				authorizePluginContent(current, publisher, enabled);
				validate?.(current);
				if (current.revision !== input.expectedRevision) {
					throw new AgentFailure('version_conflict');
				}
			},
			(current, keyCount, dataBytes) => decidePluginData(input, current, keyCount, dataBytes),
		);
	}

	purgeData(actor: PluginActor, appId: string, revision: number, operationId: string): Promise<PluginDataPurge> {
		return this.task(() =>
			this.model.purgeData(
				actor,
				appId,
				revision,
				operationId,
				(userId, current) => {
					identity(actor, userId);
					if (current.status !== 'removed') {
						throw new AgentFailure('version_conflict');
					}
				},
				(currentRevision) => {
					if (currentRevision !== revision) {
						throw new AgentFailure('version_conflict');
					}
				},
			),
		);
	}

	reconcileApp(userId: number, appId: string): Promise<void> {
		return this.runtime.reconcile(userId, appId);
	}

	revokeRuntimes(userId: number | null, appId: string | null): Promise<void> {
		return this.runtime.revoke(userId, appId);
	}

	versions(actor: PluginActor): Promise<PluginVersion[]> {
		return this.task(() => this.model.versions(actor));
	}

	descriptor(actor: PluginActor, appId: string): Promise<PluginFrontendDescriptor> {
		return this.task(async (signal) => {
			for (const [id, item] of this.contentGrants) {
				if (item.expiresAt <= Date.now()) {
					this.contentGrants.delete(id);
				}
			}
			if (this.contentGrants.size >= 128) {
				throw new AgentFailure('limit_exceeded');
			}
			const installation = (await this.model.installations(actor)).find((item) => item.appId === appId);
			if (!installation) {
				throw new AgentFailure('not_found');
			}
			const manifest = await this.model.frontend(
				actor,
				appId,
				installation.version,
				(userId, current, key, enabled) => {
					identity(actor, userId);
					authorizePluginContent(current, key, enabled);
					if (current.revision !== installation.revision) {
						throw new AgentFailure('version_conflict');
					}
				},
			);
			if (!manifest.frontendEntry || !manifest.frontendEntry.startsWith('frontend/')) {
				throw new AgentFailure('not_found');
			}
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			const grant = randomUUID(),
				expiresAt = Date.now() + 30 * 60000;
			this.contentGrants.set(grant, {
				actor: { userId: actor.userId, token: actor.token },
				appId,
				version: installation.version,
				revision: installation.revision,
				expiresAt,
			});
			return { appId, version: installation.version, grant, entry: manifest.frontendEntry, expiresAt };
		});
	}

	asset(
		appId: string,
		version: string,
		grant: string,
		path: string,
		deliver: (content: PluginContent, signal: AbortSignal) => Promise<void>,
	): Promise<void> {
		return this.task(async (signal) => {
			const permission = this.contentGrants.get(grant);
			if (
				!permission ||
				permission.appId !== appId ||
				permission.version !== version ||
				permission.expiresAt <= Date.now()
			) {
				throw new AgentFailure('forbidden');
			}
			if (
				!path.startsWith('frontend/') ||
				path.split('/').some((part) => !part || part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
			) {
				throw new AgentFailure('invalid_input');
			}
			const content = await this.model.asset(
				permission.actor,
				appId,
				version,
				path,
				signal,
				(userId, current, key, enabled) => {
					identity(permission.actor, userId);
					authorizePluginContent(current, key, enabled);
					if (current.revision !== permission.revision || permission.expiresAt <= Date.now()) {
						throw new AgentFailure('version_conflict');
					}
				},
				(manifest) => {
					if (!manifest.frontendEntry?.startsWith('frontend/') || manifest.backendEntry === path) {
						throw new AgentFailure('forbidden');
					}
				},
			);
			if (content.bytes.byteLength > AGENT_PLUGIN_MAX_ASSET_BYTES) {
				throw new AgentFailure('limit_exceeded');
			}
			await deliver({ bytes: content.bytes, sha256: content.sha256 }, signal);
		});
	}

	prepareUpgrade(
		actor: PluginActor,
		appId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
	): Promise<PluginInstallation> {
		return this.task(() => this.prepareUpgradeOwner(actor, appId, revision, stageId, stageVersion));
	}

	private async prepareUpgradeOwner(
		actor: PluginActor,
		appId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
	): Promise<PluginInstallation> {
		const current = await this.model.beginRetirement(
			actor,
			appId,
			revision,
			{ stageId, version: stageVersion },
			(userId, current, replacement, key) => {
				identity(actor, userId);
				if (
					current.status === 'removed' ||
					!replacement?.manifest ||
					replacement.manifest.id !== current.definitionId ||
					replacement.version !== stageVersion ||
					(replacement.status !== 'verified' && replacement.status !== 'installed') ||
					replacement.manifest.version === current.version
				) {
					throw new AgentFailure('version_conflict');
				}
				if (!key || key.revokedAt !== null) {
					throw new AgentFailure('forbidden');
				}
			},
		);
		await this.drainApp(actor.userId, appId);
		return current;
	}

	private async drainApp(userId: number, appId: string): Promise<void> {
		const outcomes = await Promise.allSettled([
			Promise.resolve().then(() => this.drain(userId, appId)),
			Promise.resolve().then(() => this.runtime.stop(userId, appId)),
		]);
		const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
		if (failures.length) {
			throw aggregateAgentFailures(failures, 'Plugin Run and runtime drainage failed');
		}
	}

	upgrade(
		actor: PluginActor,
		appId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
	): Promise<PluginInstallation> {
		return this.task(async () => {
			await this.prepareUpgradeOwner(actor, appId, revision, stageId, stageVersion);
			return this.model.install(actor, stageId, stageVersion, appId, (userId, staged, key, current) => {
				identity(actor, userId);
				if (!key || key.revokedAt !== null) {
					throw new AgentFailure('forbidden');
				}
				if (
					(staged.status !== 'verified' && staged.status !== 'installed') ||
					!current ||
					current.appId !== appId ||
					current.status !== 'draining' ||
					staged.manifest?.id !== current.definitionId
				) {
					throw new AgentFailure('version_conflict');
				}
			});
		});
	}

	remove(actor: PluginActor, appId: string, revision: number): Promise<PluginInstallation> {
		return this.task(async () => {
			const current = await this.model.beginRetirement(actor, appId, revision, null, (userId, value) => {
				identity(actor, userId);
				if (value.status === 'removed') {
					throw new AgentFailure('version_conflict');
				}
			});
			await this.drainApp(actor.userId, appId);
			return this.model.finishRemoval(actor, appId, current.revision, (userId) => identity(actor, userId));
		});
	}

	cancelRetirement(actor: PluginActor, appId: string, revision: number): Promise<PluginInstallation> {
		return this.task(() =>
			this.model.cancelRetirement(actor, appId, revision, (userId, key, dataMigrated) => {
				identity(actor, userId);
				if (dataMigrated) {
					throw new AgentFailure('version_conflict');
				}
				if (!key || key.revokedAt !== null) {
					throw new AgentFailure('forbidden');
				}
			}),
		);
	}

	private task<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		return this.trackTask(work, this.lane);
	}

	private trackTask<T>(work: (signal: AbortSignal) => Promise<T>, predecessor?: Promise<unknown>): Promise<T> {
		if (this.closing || this.pending.size >= 8) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const deadline = AbortSignal.any([this.stop.signal, AbortSignal.timeout(60000)]);
		const task = (predecessor ?? Promise.resolve()).then(() => {
			if (this.closing || deadline.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return work(deadline);
		});
		if (predecessor) {
			this.lane = task.then(
				() => undefined,
				() => undefined,
			);
		}
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			(error) => {
				logDiagnostic(this.logger, 'warn', 'PLUGIN_OPERATION_FAILED', {}, error);
				this.pending.delete(task);
				if (isAgentDrainFailure(error)) {
					this.failures.push(error);
					this.quiesce();
				}
			},
		);
		return task;
	}

	async initialize(startRuntimes: boolean): Promise<void> {
		await this.model.recoverRuntimes();
		const items = await this.model.recovery();
		logDiagnostic(this.logger, 'info', 'PLUGIN_RECOVERY_STARTED', { stages: items.length, startRuntimes });
		for (const item of items) {
			await this.model.recoverStage(
				item,
				AbortSignal.any([this.stop.signal, AbortSignal.timeout(60000)]),
				(exists, valid) => (exists && valid ? 'staged' : 'failed'),
			);
		}
		if (!startRuntimes) {
			return;
		}
		for (const target of await this.model.runtimeTargets()) {
			await this.runtime.start(
				target.userId,
				target.appId,
				AbortSignal.any([this.stop.signal, AbortSignal.timeout(60000)]),
			);
		}
	}

	stages(actor: PluginActor): Promise<PluginStage[]> {
		return this.task(() => this.model.stages(actor));
	}

	installations(actor: PluginActor): Promise<PluginInstallation[]> {
		return this.task(() => this.model.installations(actor));
	}

	install(actor: PluginActor, stageId: string, version: number): Promise<PluginInstallation> {
		return this.task(() =>
			this.model.install(actor, stageId, version, randomUUID(), (userId, stage, publisher, current) => {
				identity(actor, userId);
				if (!publisher || publisher.revokedAt !== null) {
					throw new AgentFailure('forbidden');
				}
				if (stage.status !== 'verified' && stage.status !== 'installed') {
					throw new AgentFailure('version_conflict');
				}
				if (
					current &&
					current.status !== 'removed' &&
					!(
						current.status === 'installed' &&
						current.version === stage.manifest?.version &&
						current.packageHash === stage.packageHash
					)
				) {
					throw new AgentFailure('version_conflict');
				}
			}),
		);
	}

	publishers(actor: PluginActor): Promise<PluginPublisher[]> {
		return this.task(() => this.model.publishers(actor));
	}

	putPublisher(actor: PluginActor, label: string, publicKeyPem: string): Promise<PluginPublisher> {
		return this.task(() => {
			const normalized = this.model.normalizeKey(publicKeyPem);
			return this.model.putPublisher(
				actor,
				{ keyId: normalized.keyId, publicKeyPem: normalized.publicKeyPem, label },
				(userId, existing, count) => {
					identity(actor, userId);
					if (existing?.revokedAt !== null && existing !== null) {
						throw new AgentFailure('version_conflict');
					}
					if (
						existing !== null &&
						(existing.label !== label || existing.publicKeyPem !== normalized.publicKeyPem)
					) {
						throw new AgentFailure('version_conflict');
					}
					if (existing === null && count >= 256) {
						throw new AgentFailure('limit_exceeded');
					}
				},
			);
		});
	}

	revokePublisher(actor: PluginActor, keyId: string, version: number): Promise<PluginPublisher> {
		return this.task(async () => {
			const result = await this.model.revokePublisher(actor, keyId, version, (userId) => identity(actor, userId));
			const results = await Promise.allSettled(
				result.appIds.flatMap((appId) => [
					Promise.resolve().then(() => this.revoke({ userId: actor.userId, appId, uncertain: false })),
					Promise.resolve().then(() => this.runtime.stop(actor.userId, appId)),
				]),
			);
			const failures = results.flatMap((item) => (item.status === 'rejected' ? [item.reason] : []));
			if (failures.length) {
				throw aggregateAgentFailures(failures, 'Publisher revoked; Run cleanup unconfirmed');
			}
			return result.publisher;
		});
	}

	getStage(actor: PluginActor, id: string): Promise<PluginStage> {
		return this.task(() => this.model.getStage(actor, id));
	}

	stagePackage(
		actor: PluginActor,
		expected: { appId: string; version: string; publisherKeyId: string },
		produce: (signal: AbortSignal) => Promise<Uint8Array>,
	): Promise<PluginStage> {
		return this.task(async (signal) => {
			const bytes = await produce(signal);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			if (bytes.byteLength < 1 || bytes.byteLength > AGENT_PLUGIN_MAX_ARCHIVE_BYTES) {
				throw new AgentFailure('limit_exceeded');
			}
			const inspected = await this.model.inspectPackage(actor, bytes);
			if (
				!inspected.signatureValid ||
				inspected.publisherKeyId !== expected.publisherKeyId ||
				inspected.manifest.id !== expected.appId ||
				inspected.manifest.version !== expected.version
			) {
				throw new AgentFailure('forbidden');
			}
			const reusable = await this.model.reusableStage(actor, bytes, signal, (userId, current, publisher) => {
				identity(actor, userId);
				if (current !== null && (!publisher || publisher.revokedAt !== null)) {
					throw new AgentFailure('forbidden');
				}
			});
			if (reusable !== null) {
				return reusable;
			}
			await this.model.pruneStages(actor, 127, (userId) => identity(actor, userId));
			const staged = await this.model.stage(actor, randomUUID(), bytes, signal, (userId) =>
				identity(actor, userId),
			);
			return this.model.verify(
				actor,
				staged.id,
				staged.version,
				signal,
				(userId, current, publisher, valid) => {
					identity(actor, userId);
					if (current.status !== 'staged') {
						throw new AgentFailure('version_conflict');
					}
					if (!publisher || publisher.revokedAt !== null || !valid) {
						throw new AgentFailure('forbidden');
					}
				},
				parsePluginSkills,
			);
		});
	}

	stage(
		actor: PluginActor,
		input: { artifactAppId: string; artifactId: string; expectedVersion: number },
	): Promise<PluginStage> {
		return this.task(async (signal) => {
			const scope = { userId: actor.userId, appId: input.artifactAppId };
			const artifact = await this.artifacts.get(scope, input.artifactId);
			if (!artifact) {
				throw new AgentFailure('not_found');
			}
			if (artifact.version !== input.expectedVersion || artifact.status !== 'ready') {
				throw new AgentFailure('version_conflict');
			}
			if (artifact.sizeBytes < 1 || artifact.sizeBytes > AGENT_PLUGIN_MAX_ARCHIVE_BYTES) {
				throw new AgentFailure('limit_exceeded');
			}
			const chunks: Uint8Array[] = [];
			let count = 0;
			for await (const chunk of this.artifacts.read(
				{ kind: 'session', userId: actor.userId, token: actor.token, appId: input.artifactAppId },
				input.artifactId,
				artifact.version,
				{ start: 0, endInclusive: artifact.sizeBytes - 1 },
				signal,
			)) {
				count += chunk.byteLength;
				if (count > artifact.sizeBytes) {
					throw new AgentFailure('limit_exceeded');
				}
				chunks.push(chunk);
			}
			const latest = await this.artifacts.get(scope, input.artifactId);
			if (
				count !== artifact.sizeBytes ||
				latest?.version !== artifact.version ||
				latest.status !== 'ready' ||
				latest.sha256 !== artifact.sha256
			) {
				throw new AgentFailure('version_conflict');
			}
			const bytes = Buffer.concat(chunks, count);
			if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
				throw new AgentFailure('version_conflict');
			}
			await this.model.pruneStages(actor, 127, (userId) => identity(actor, userId));
			return this.model.stage(actor, randomUUID(), bytes, signal, (userId) => identity(actor, userId));
		});
	}

	verify(actor: PluginActor, id: string, version: number): Promise<PluginStage> {
		return this.task((signal) =>
			this.model.verify(
				actor,
				id,
				version,
				signal,
				(userId, current, publisher, signatureValid) => {
					identity(actor, userId);
					if (current.status !== 'staged' && current.status !== 'verified') {
						throw new AgentFailure('version_conflict');
					}
					if (!publisher || publisher.revokedAt !== null || !signatureValid) {
						throw new AgentFailure('forbidden');
					}
				},
				parsePluginSkills,
			),
		);
	}

	performSkill(
		scope: { userId: number; appId: string },
		input: PluginSkillInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		// Run reads cannot queue behind management operations that wait for those Runs to drain.
		return this.trackTask(async (ownerSignal) => {
			const combined = AbortSignal.any([ownerSignal, signal]);
			await validate();
			combined.throwIfAborted();
			let source;
			try {
				source = await this.model.skillDocuments(scope.userId, scope.appId, combined, authorizePluginContent);
			} catch (error) {
				if (!(error instanceof AgentFailure && error.code === 'not_found')) {
					throw error;
				}
				await validate();
				combined.throwIfAborted();
				if (input.action === 'read') {
					throw new AgentFailure('not_found');
				}
				return JSON.stringify({ matches: [], untrusted: true });
			}
			const skills = parsePluginSkills(source.documents, source.version);
			await validate();
			const current = await this.model.runtimeInstallation(scope.userId, scope.appId, authorizePluginContent);
			if (current.revision !== source.revision) {
				throw new AgentFailure('version_conflict');
			}
			combined.throwIfAborted();
			if (input.action === 'read') {
				const skill = skills.find((item) => item.name === input.name);
				if (!skill) {
					throw new AgentFailure('not_found');
				}
				if (skill.version !== input.version || skill.sha256 !== input.sha256) {
					throw new AgentFailure('version_conflict');
				}
				return JSON.stringify({
					name: skill.name,
					description: skill.description,
					version: skill.version,
					sha256: skill.sha256,
					body: skill.body,
					untrusted: true,
				});
			}
			const terms = [...new Set(input.query.toLocaleLowerCase('en-US').split(/\s+/u).filter(Boolean))].slice(
				0,
				32,
			);
			const matches = skills
				.map((skill) => ({
					skill,
					score: terms.filter((term) =>
						(skill.name + ' ' + skill.description).toLocaleLowerCase('en-US').includes(term),
					).length,
				}))
				.filter((item) => item.score > 0)
				.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
				.slice(0, input.limit)
				.map(({ skill }) => ({
					name: skill.name,
					description: skill.description,
					version: skill.version,
					sha256: skill.sha256,
				}));
			return JSON.stringify({ matches, untrusted: true });
		});
	}

	quiesce(): void {
		this.closing = true;
		this.runtime.quiesce();
		this.contentGrants.clear();
		this.stop.abort();
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled([...this.pending]);
			// Each admitted task records its drainage failure once before its settlement observer runs.
			const failures = this.failures.slice();
			try {
				await this.runtime.close();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				throw new AggregateError(failures, 'Plugin owner failed to drain');
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
