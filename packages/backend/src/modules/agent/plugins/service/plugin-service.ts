import { agentPluginCapabilityReplyBytes } from '@nexus-terminal/shared/agent/plugins/runtime-codec';
import { pluginCallOwner } from '../plugin-caller-rules.js';
import type { PluginLifecycleFactory } from '../model/plugin-lifecycle-types.js';
import { readAgentPluginAppOutcome } from '@nexus-terminal/shared/agent/plugins/app-outcome';
import type { RunAppOutcome } from '../../runs/model/run-app-driver-types.js';
import type { PluginInstanceService } from './plugin-instance-service.js';
import type { PluginFrontendGrant } from '../model/plugin-types.js';
import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginInvocation,
	readAgentPluginRegistrations,
	pluginContractText,
} from '@nexus-terminal/shared/agent/plugins/registry-codec';
import { AGENT_PLUGIN_CALLABLE_KINDS } from '@nexus-terminal/shared/agent/plugins/registry';
import {
	toRegistryPage,
	toRegistryDescription,
	toRegistryBinding,
	fromRegistryDefinition,
} from '../registry/model/registry-protocol.js';
import type { RegistryResolvedCall, RegistryQuery } from '../registry/model/registry-types.js';
import type {
	PluginRunInvocation,
	PluginRegisteredInvocation,
	PluginCapabilitySource,
} from '../model/plugin-run-types.js';
import type { PluginCapabilityReply, PluginCapabilityRequest } from '../model/plugin-invocation-types.js';
import type { RunAppExecution } from '../../runs/model/run-app-execution-types.js';
import { AGENT_PLUGIN_SDK_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import type { ArtifactRecord } from '../../artifacts/model/artifact-types.js';

import type {
	PluginAppBinding,
	PluginCompositionCandidate,
	PluginPackageInstallation,
	PluginPackageUpdateFacts,
	PluginPackageUpdateDecision,
	PluginPackageUpdatePreparation,
	PluginPackageUpdateDependency,
} from '../model/plugin-composition-types.js';
import semver from 'semver';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import type { WorkspaceInput, WorkspaceResult, WorkspaceMutation } from '../../scope/model/workspace-types.js';
import type {
	PluginRuntimeObservation,
	PluginRuntimeAcknowledgement,
	PluginInstallationDirectory,
} from '../model/plugin-types.js';
import type {
	PluginDataSnapshot,
	PluginDataMigration,
	PluginDataMigrationResult,
} from '../model/plugin-migration-types.js';
import { parsePluginSkills } from '../plugin-skill-rules.js';
import { resolvePluginPackages, pluginExecutionDependencies } from '../plugin-app-composition-rules.js';

import { fromPluginSkillFiles } from '../model/plugin-model.js';
import type { PluginSkillInput } from '../model/plugin-skill-types.js';
import { validateAgentId } from '../../agent-validation.js';
import {
	AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	hasAgentPluginDataValueCapacity,
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
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	aggregateAgentFailures,
	isAgentDrainFailure,
} from '../../agent-failure.js';
import type { PluginModel } from '../model/plugin-model.js';
import type {
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

import type { PluginManifest } from '../model/plugin-types.js';

function invalidPluginInput(): never {
	throw new InvalidAgentPayload();
}

function identity(actor: PluginActor, userId: number | null): void {
	if (actor.userId !== userId) {
		throw new AgentFailure('unauthenticated');
	}
}

export class PluginService {
	appBindings(actor: PluginActor): Promise<PluginAppBinding[]> {
		return this.task(() => this.model.appBindings(actor));
	}

	packageDirectory(
		actor: PluginActor,
	): Promise<{ installations: PluginPackageInstallation[]; retainedPackageIds: string[] }> {
		return this.task(() => this.model.packageDirectory(actor));
	}

	packageRetainedData(actor: PluginActor): Promise<string[]> {
		return this.task(() => this.model.packageRetainedData(actor));
	}

	removePackage(
		actor: PluginActor,
		packageId: string,
		revision: number,
		clearData: boolean,
	): Promise<PluginPackageInstallation> {
		return this.task(async () => {
			const result = await this.model.removePackage(
				actor,
				packageId,
				revision,
				clearData,
				(userId, current, referenced, runtimeClosed, updatePending) => {
					identity(actor, userId);
					if (referenced || ((current.status === 'draining' || updatePending) && !clearData)) {
						throw new AgentFailure('version_conflict');
					}
					if (!runtimeClosed) {
						throw new AgentFailure('operation_unknown');
					}
				},
			);
			for (const [id, grant] of this.contentGrants) {
				if (grant.actor.userId === actor.userId && grant.packageId === packageId) {
					this.revokeFrontendGrant(id);
				}
			}
			return result;
		});
	}

	private admitPackageUpdate(
		actor: PluginActor,
		packageId: string,
		userId: number | null,
		facts: PluginPackageUpdateFacts,
	): PluginPackageUpdateDecision {
		identity(actor, userId);
		const next = facts.stage.manifest;
		const publisherKeyId = facts.stage.publisherKeyId;
		if (
			!next ||
			!publisherKeyId ||
			next.id !== packageId ||
			!facts.publisher ||
			facts.publisher.revokedAt !== null ||
			facts.current.package.publisherKeyId !== facts.stage.publisherKeyId ||
			facts.current.status === 'removed' ||
			(facts.stage.status !== 'verified' && facts.stage.status !== 'installed')
		) {
			throw new AgentFailure('version_conflict');
		}
		const compatibility = next.compatibility;
		if (
			(compatibility.backendSdk !== null && compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)) ||
			(compatibility.frontendSdk !== null && compatibility.frontendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)) ||
			!semver.satisfies(
				this.hostVersion,
				'>=' + compatibility.host.minVersion + ' <=' + compatibility.host.maxVersion,
			)
		) {
			throw new AgentFailure('version_conflict');
		}
		const candidates: PluginCompositionCandidate[] = facts.candidates.map((candidate) =>
			candidate.installation.package.packageId === packageId
				? {
						installation: {
							package: {
								packageId,
								version: next.version,
								packageHash: facts.stage.packageHash,
								publisherKeyId,
							},
							status: 'installed',
							revision: facts.current.revision,
							createdAt: facts.current.createdAt,
							updatedAt: facts.current.updatedAt,
						},
						manifest: next,
						publisher: facts.publisher,
					}
				: candidate,
		);
		const dependencies = new Map<string, PluginPackageUpdateDependency>();
		const bindings: PluginAppBinding[] = [];
		const impacts: PluginPackageUpdateDecision['impacts'] = [];
		for (const reference of facts.references) {
			const selected = resolvePluginPackages(
				reference.binding.app.packageId,
				candidates,
				reference.binding.selectedRootIds,
				reference.binding.ui?.packageId ?? null,
			);
			for (const candidate of selected) {
				if (candidate.installation.package.packageId !== packageId) {
					dependencies.set(candidate.installation.package.packageId, {
						package: candidate.installation.package,
						installationRevision: candidate.installation.revision,
					});
				}
			}
			const app = selected.find((item) => item.manifest.id === reference.binding.app.packageId);
			if (!app) {
				throw new AgentFailure('version_conflict');
			}
			// Code dependants must restart with their provider; optional consumers of
			// a runtime contract retain their App stack and receive stale bindings.
			const affected = new Set([packageId]);
			let changed = true;
			while (changed) {
				changed = false;
				for (const candidate of selected) {
					if (
						!affected.has(candidate.manifest.id) &&
						candidate.manifest.dependencies.some((edge) => affected.has(edge.packageId))
					) {
						affected.add(candidate.manifest.id);
						changed = true;
					}
				}
			}
			for (const previous of reference.binding.dependencies) {
				if (!selected.some((candidate) => candidate.manifest.id === previous.packageId)) {
					affected.add(previous.packageId);
				}
			}
			impacts.push({
				appId: reference.binding.appId,
				restartApp: affected.has(app.manifest.id),
				packageIds: [...affected],
			});
			bindings.push({
				appId: reference.binding.appId,
				executionRevision: reference.binding.executionRevision,
				uiRevision: reference.binding.uiRevision,
				app: app.installation.package,
				dependencies: pluginExecutionDependencies(
					selected,
					app.manifest.id,
					reference.binding.selectedRootIds,
					reference.binding.ui?.packageId ?? null,
				).map((item) => item.installation.package),
				selectedRootIds: reference.binding.selectedRootIds.map((id) => id),
				ui:
					selected.find((item) => item.manifest.id === reference.binding.ui?.packageId)?.installation
						.package ?? null,
			});
		}

		const uiOnly = (manifest: PluginManifest) =>
			manifest.backendEntry === null &&
			manifest.contributions.app === null &&
			!manifest.contributions.tools &&
			!manifest.contributions.services &&
			manifest.contributions.skills.length === 0 &&
			manifest.contributions.ui !== null;

		return {
			impacts,
			uiOnly:
				uiOnly(facts.previousManifest) &&
				uiOnly(next) &&
				facts.references.every(
					(reference) =>
						!reference.binding.dependencies.some((dependency) => dependency.packageId === packageId),
				),
			bindings,
			dependencies: [...dependencies.values()].sort((left, right) =>
				left.package.packageId.localeCompare(right.package.packageId),
			),
		};
	}

	cancelPackageUpdate(actor: PluginActor, packageId: string, revision: number): Promise<PluginPackageInstallation> {
		return this.task(async () => {
			const bindings = await this.model.appBindings(actor);
			const affected: string[] = [];
			for (const binding of bindings) {
				if (
					[binding.app, ...binding.dependencies, ...(binding.ui ? [binding.ui] : [])].some(
						(item) => item.packageId === packageId,
					)
				) {
					affected.push(binding.appId);
					await this.runtime.stopPackages(actor.userId, binding.appId, [packageId]);
				}
			}
			const result = await this.model.cancelPackageUpdate(actor, packageId, revision, (userId) =>
				identity(actor, userId),
			);
			for (const appId of affected) {
				await this.runtime.reconcile(actor.userId, appId);
			}
			return result;
		});
	}

	preparePackageUpdate(
		actor: PluginActor,
		packageId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
	): Promise<PluginPackageUpdatePreparation> {
		return this.task(async () => {
			const result = await this.model.updatePackage(
				actor,
				packageId,
				revision,
				stageId,
				stageVersion,
				'prepare',
				(userId, facts) => this.admitPackageUpdate(actor, packageId, userId, facts),
			);
			await this.drainPackageUpdate(actor.userId, result);
			return { installation: result.installation, dependencies: result.dependencies };
		});
	}

	updatePackage(
		actor: PluginActor,
		packageId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
		expectedDependencies: PluginPackageUpdateDependency[],
	): Promise<PluginPackageInstallation> {
		return this.task(async () => {
			const admit = (userId: number | null, facts: PluginPackageUpdateFacts) => {
				const decision = this.admitPackageUpdate(actor, packageId, userId, facts);
				if (
					expectedDependencies.length !== decision.dependencies.length ||
					!decision.dependencies.every((selected) =>
						expectedDependencies.some(
							(expected) =>
								expected.installationRevision === selected.installationRevision &&
								expected.package.packageId === selected.package.packageId &&
								expected.package.version === selected.package.version &&
								expected.package.packageHash === selected.package.packageHash &&
								expected.package.publisherKeyId === selected.package.publisherKeyId,
						),
					)
				) {
					throw new AgentFailure('version_conflict');
				}
				return decision;
			};

			const prepared = await this.model.updatePackage(
				actor,
				packageId,
				revision,
				stageId,
				stageVersion,
				'prepare',
				admit,
			);
			await this.drainPackageUpdate(actor.userId, prepared);
			try {
				const committed = await this.model.updatePackage(
					actor,
					packageId,
					prepared.installation.revision,
					stageId,
					stageVersion,
					'commit',
					admit,
				);
				if (!committed.uiOnly) {
					for (const appId of committed.appIds) {
						await this.runtime.reconcile(actor.userId, appId);
					}
				}
				return committed.installation;
			} finally {
				// A lost commit acknowledgement triggers re-authorization, never a fabricated successful update.
				for (const [id, grant] of this.contentGrants) {
					if (grant.actor.userId === actor.userId && prepared.appIds.includes(grant.appId)) {
						this.revokeFrontendGrant(id);
					}
				}
			}
		});
	}

	private async drainPackageUpdate(
		userId: number,
		update: import('../model/plugin-composition-types.js').PluginPackageUpdateResult,
	): Promise<void> {
		if (update.uiOnly) {
			return;
		}
		const results = await Promise.allSettled(
			update.impacts.map((impact) =>
				impact.restartApp
					? this.drainApp(userId, impact.appId)
					: this.runtime.stopPackages(userId, impact.appId, impact.packageIds),
			),
		);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw aggregateAgentFailures(failures, 'Package update drainage failed');
		}
	}

	packageInstallations(actor: PluginActor): Promise<PluginPackageInstallation[]> {
		return this.task(() => this.model.packageInstallations(actor));
	}

	installPackage(
		actor: PluginActor,
		stageId: string,
		stageVersion: number,
		options?: { expectedRevision: number | null },
	): Promise<PluginPackageInstallation> {
		return this.task(() =>
			this.model.installPackage(actor, stageId, stageVersion, (userId, staged, key, current, updatePending) => {
				identity(actor, userId);
				if (options && (current?.revision ?? null) !== options.expectedRevision) {
					throw new AgentFailure('version_conflict');
				}
				// Installation cannot cancel a prepared update or expose migrated data to
				// its old package. Cancellation and explicit clear-data removal own recovery.
				if (current?.status === 'draining' || updatePending) {
					throw new AgentFailure('version_conflict');
				}
				if (!key || key.revokedAt !== null || !staged.manifest) {
					throw new AgentFailure('forbidden');
				}
				if (staged.status !== 'verified' && staged.status !== 'installed') {
					throw new AgentFailure('version_conflict');
				}
				const compatibility = staged.manifest.compatibility;
				if (
					(compatibility.backendSdk !== null &&
						compatibility.backendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)) ||
					(compatibility.frontendSdk !== null &&
						compatibility.frontendSdk !== Number(AGENT_PLUGIN_SDK_VERSION)) ||
					!semver.satisfies(
						this.hostVersion,
						'>=' + compatibility.host.minVersion + ' <=' + compatibility.host.maxVersion,
					)
				) {
					throw new AgentFailure('version_conflict');
				}
				if (current && current.package.publisherKeyId !== staged.publisherKeyId) {
					throw new AgentFailure('version_conflict');
				}
			}),
		);
	}

	composeApp(
		actor: PluginActor,
		packageId: string,
		options: {
			enableWithDeclaredGrants: boolean;
			appId?: string;
			selectedRootIds?: string[];
			uiPackageId?: string | null;
			expectedBinding?: { executionRevision: number; uiRevision: number };
			expectedPackages?: import('../model/plugin-composition-types.js').PluginPackageReference[];
		} = { enableWithDeclaredGrants: false },
	): Promise<PluginAppBinding> {
		return this.task(async () => {
			const binding = await this.model.composeApp(
				actor,
				options.appId ?? randomUUID(),
				packageId,
				options.expectedBinding ?? null,
				(userId, candidates) => {
					identity(actor, userId);
					const selectedRootIds = options.selectedRootIds ?? [];
					const uiPackageId = options.uiPackageId ?? null;
					const selected = resolvePluginPackages(packageId, candidates, selectedRootIds, uiPackageId);
					const app = selected.find((item) => item.manifest.id === packageId);
					if (!app) {
						throw new AgentFailure('not_found');
					}
					const expected = options.expectedPackages;
					if (
						expected &&
						(expected.length !== selected.length ||
							!selected.every((candidate) =>
								expected.some(
									(reference) =>
										reference.packageId === candidate.installation.package.packageId &&
										reference.version === candidate.installation.package.version &&
										reference.packageHash === candidate.installation.package.packageHash &&
										reference.publisherKeyId === candidate.installation.package.publisherKeyId,
								),
							))
					) {
						throw new AgentFailure('version_conflict');
					}
					return {
						app: app.installation.package,
						dependencies: pluginExecutionDependencies(
							selected,
							app.manifest.id,
							selectedRootIds,
							uiPackageId,
						).map((item) => item.installation.package),
						selectedRootIds: selectedRootIds.map((id) => id),
						ui: selected.find((item) => item.manifest.id === uiPackageId)?.installation.package ?? null,
						initialization: {
							enabled: options.enableWithDeclaredGrants,
							grantedCapabilities: options.enableWithDeclaredGrants
								? [...new Set(selected.flatMap((item) => item.manifest.capabilities))]
								: null,
						},
					};
				},
			);
			for (const instance of await this.instances.list(actor.userId, binding.appId)) {
				this.instances.changed(actor.userId, binding.appId, instance.id);
			}
			return binding;
		});
	}

	dataSnapshot(actor: PluginActor, appId: string, namespace?: string): Promise<PluginDataSnapshot> {
		validateAgentId(appId);
		return this.task(async () => {
			const value = await this.model.dataSnapshot(
				actor,
				appId,
				(userId, current, runtimeClosed, upgradePending) =>
					this.admitMigration(actor, appId, userId, current, runtimeClosed, upgradePending),
				namespace,
			);
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
				new Set(input.items.map((item) => item.packageId + '\0' + item.key)).size !== input.items.length
			) {
				throw new AgentFailure('invalid_input');
			}
			for (const item of input.items) {
				if (
					!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/u.test(item.packageId) ||
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
						!hasAgentPluginDataValueCapacity(item.valueJson) ||
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
			try {
				return await this.model.migrateData(
					actor,
					appId,
					input,
					(userId, current, runtimeClosed, upgradePending) => {
						if (signal.aborted) {
							throw new AgentFailure('provider_unavailable');
						}
						this.admitMigration(actor, appId, userId, current, runtimeClosed, upgradePending);
					},
				);
			} finally {
				for (const [id, grant] of this.contentGrants) {
					if (grant.actor.userId === actor.userId && grant.appId === appId) {
						this.revokeFrontendGrant(id);
					}
				}
			}
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
		if (!upgradePending) {
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
	private assetLane: Promise<unknown> = Promise.resolve();
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private readonly grantListeners = new Map<string, Set<() => void>>();
	private readonly contentGrants = new Map<string, PluginFrontendGrant>();

	constructor(
		private readonly model: PluginModel,
		private readonly artifacts: ArtifactService,
		private readonly revoke: RevokeRuns,
		private readonly drain: DrainPluginRuns,
		private readonly intents: PluginIntentService,
		private readonly instances: PluginInstanceService,
		private readonly agentRpc: (
			access: PluginThreadAccess,
			input: WorkspaceInput,
			withMutation: WorkspaceMutation,
		) => Promise<WorkspaceResult>,
		private readonly uploadArtifact: (
			access: PluginThreadAccess,
			artifactId: string,
			expectedVersion: number,
			source: AsyncIterable<Uint8Array>,
			signal: AbortSignal,
			withMutation: WorkspaceMutation,
		) => Promise<ArtifactRecord>,
		private readonly hostVersion: string,
		lifecycle: PluginLifecycleFactory,
		private readonly logger?: Logger,
	) {
		this.runtime = new PluginRuntimeService(model, instances, lifecycle, logger);
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
			if (permission.purpose === 'settings') {
				const current = await this.readSettingsGrant(permission, grant);
				if (input.method === 'settings.read') {
					return { method: input.method, value: current };
				}
				if (input.method !== 'settings.write') {
					throw new AgentFailure('forbidden');
				}
				if (
					input.command.expectedPackageRevision !== permission.revision ||
					input.command.schemaRevision !== permission.schemaRevision
				) {
					throw new AgentFailure('version_conflict');
				}
				const result = await this.instances.write(
					{ kind: 'manual', actor: permission.actor },
					appId,
					permission.instanceId,
					input.command,
				);
				return { method: input.method, value: result.configuration };
			}
			if (input.method === 'settings.read' || input.method === 'settings.write') {
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
						input.method === 'agent.runs.resume' ||
						input.method === 'agent.runs.cancel' ||
						input.method === 'agent.subagents.cancel' ||
						input.method === 'agent.approvals.resolve' ||
						input.method === 'agent.memories.review' ||
						input.method === 'agent.artifacts.begin' ||
						input.method === 'agent.artifacts.retain' ||
						input.method === 'agent.artifacts.delete' ||
						input.method === 'agent.artifacts.attach'
					) {
						throw new AgentFailure('operation_unknown', { cause });
					}
					throw cause;
				}
				return value;
			}
			if (input.method === 'host.perform') {
				throw new AgentFailure('forbidden');
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
					value: await this.dataRead(actor, appId, input.key, validate, permission.packageId),
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
					permission.packageId,
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
		packageId?: string,
	): Promise<PluginData | null> {
		return this.model.readData(
			actor,
			appId,
			key,
			(userId, current, publisher, enabled) => {
				identity(actor, userId);
				authorizePluginContent(current, publisher, enabled);
				validate?.(current);
			},
			packageId,
		);
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
		packageId?: string,
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
			(current) => decidePluginData(input, current),
			packageId,
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
		for (const [id, grant] of this.contentGrants) {
			if (grant.actor.userId === userId && grant.appId === appId) {
				this.revokeFrontendGrant(id);
			}
		}
		return this.runtime.reconcile(userId, appId);
	}

	revokeRuntimes(userId: number | null, appId: string | null): Promise<void> {
		for (const [id, grant] of this.contentGrants) {
			if ((userId === null || grant.actor.userId === userId) && (appId === null || grant.appId === appId)) {
				this.revokeFrontendGrant(id);
			}
		}
		return this.runtime.revoke(userId, appId);
	}

	versions(actor: PluginActor): Promise<PluginVersion[]> {
		return this.task(() => this.model.versions(actor));
	}

	uploadFrontendArtifact(
		actor: PluginActor,
		appId: string,
		grant: string,
		artifactId: string,
		expectedVersion: number,
		source: AsyncIterable<Uint8Array>,
		requestSignal: AbortSignal,
	): Promise<ArtifactRecord> {
		return this.trackTask(
			async (signal) => {
				const access = await this.frontendAccess(actor, appId, grant);
				const permission = this.contentGrants.get(grant);
				if (!permission) {
					throw new AgentFailure('forbidden');
				}
				const combined = AbortSignal.any([signal, requestSignal]);
				const value = await this.uploadArtifact(access, artifactId, expectedVersion, source, combined, (work) =>
					this.model.withFrontendAdmission(
						actor,
						appId,
						(userId, current, key, enabled) => {
							identity(actor, userId);
							authorizePluginContent(current, key, enabled);
							access.assertCurrent();
							if (current.revision !== permission.revision || combined.aborted) {
								throw new AgentFailure('version_conflict');
							}
						},
						work,
					),
				);
				try {
					await this.frontendAccess(actor, appId, grant);
				} catch (cause) {
					throw new AgentFailure('operation_unknown', { cause });
				}
				return value;
			},
			undefined,
			true,
		);
	}

	watchFrontendGrant(actor: PluginActor, appId: string, grant: string, invalidated: () => void): () => void {
		const permission = this.contentGrants.get(grant);
		if (
			!permission ||
			permission.actor.userId !== actor.userId ||
			permission.actor.token !== actor.token ||
			permission.appId !== appId ||
			permission.expiresAt <= Date.now() ||
			this.closing
		) {
			invalidated();
			return () => undefined;
		}
		let listeners = this.grantListeners.get(grant);
		if (!listeners) {
			listeners = new Set();
			this.grantListeners.set(grant, listeners);
		}
		listeners.add(invalidated);
		return () => {
			listeners.delete(invalidated);
			if (listeners.size === 0 && this.grantListeners.get(grant) === listeners) {
				this.grantListeners.delete(grant);
			}
		};
	}

	private revokeFrontendGrant(id: string): void {
		this.contentGrants.delete(id);
		const listeners = this.grantListeners.get(id);
		this.grantListeners.delete(id);
		for (const listener of listeners ?? []) {
			try {
				listener();
			} catch (error) {
				logDiagnostic(this.logger, 'warn', 'PLUGIN_GRANT_LISTENER_FAILED', {}, error);
			}
		}
	}

	async frontendAccess(actor: PluginActor, appId: string, grant: string): Promise<PluginThreadAccess> {
		const permission = this.contentGrants.get(grant);
		if (
			!permission ||
			permission.purpose !== 'app' ||
			permission.appId !== appId ||
			permission.actor.userId !== actor.userId ||
			permission.actor.token !== actor.token ||
			permission.expiresAt <= Date.now()
		) {
			throw new AgentFailure('forbidden');
		}

		const assertCurrent = () => {
			if (this.closing || this.contentGrants.get(grant) !== permission || permission.expiresAt <= Date.now()) {
				throw new AgentFailure('forbidden');
			}
		};

		await this.model.authorizedInstallation(actor, appId, permission.version, (userId, current, key, enabled) => {
			identity(actor, userId);
			authorizePluginContent(current, key, enabled);
			assertCurrent();
			if (current.revision !== permission.revision) {
				throw new AgentFailure('version_conflict');
			}
		});
		assertCurrent();
		return {
			kind: 'plugin',
			userId: actor.userId,
			token: actor.token,
			appId,
			revision: permission.revision,
			expiresAt: permission.expiresAt,
			assertCurrent,
		};
	}

	descriptor(actor: PluginActor, appId: string): Promise<PluginFrontendDescriptor> {
		return this.task(async (signal) => {
			for (const [id, item] of this.contentGrants) {
				if (item.expiresAt <= Date.now()) {
					this.revokeFrontendGrant(id);
				}
			}
			const binding = await this.model.appBinding(actor, appId);
			const app = (await this.model.installations(actor)).find((item) => item.appId === appId);
			const ui = binding.ui;
			const installation =
				app && ui
					? {
							appId,
							definitionId: ui.packageId,
							version: ui.version,
							packageHash: ui.packageHash,
							publisherKeyId: ui.publisherKeyId,
							status: app.status,
							revision: binding.uiRevision,
							createdAt: app.createdAt,
							updatedAt: app.updatedAt,
						}
					: null;
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
				purpose: 'app',
				actor: { userId: actor.userId, token: actor.token },
				appId,
				packageId: installation.definitionId,
				version: installation.version,
				revision: installation.revision,
				expiresAt,
			});
			return {
				purpose: 'app',
				instanceId: appId,
				appId,
				version: installation.version,
				grant,
				entry: manifest.frontendEntry,
				expiresAt,
				package: {
					packageId: installation.definitionId,
					version: installation.version,
					packageHash: installation.packageHash,
					publisherKeyId: installation.publisherKeyId,
				},
				uiRevision: installation.revision,
			};
		});
	}

	/** Static settings are available even when App execution or this provider is disabled. */
	settingsDescriptor(actor: PluginActor, appId: string, instanceId: string): Promise<PluginFrontendDescriptor> {
		return this.task(async (signal) => {
			const source = await this.instances.read({ kind: 'manual', actor }, appId, instanceId);
			const settings = source.manifest.contributions.settings;
			if (!settings?.frontendEntry) {
				throw new AgentFailure('not_found');
			}
			signal.throwIfAborted();
			const grant = randomUUID();
			const expiresAt = Date.now() + 30 * 60000;
			this.contentGrants.set(grant, {
				purpose: 'settings',
				actor: { userId: actor.userId, token: actor.token },
				appId,
				instanceId,
				packageId: source.package.packageId,
				version: source.package.version,
				revision: source.packageRevision,
				schemaRevision: settings.schemaRevision,
				expiresAt,
			});
			return {
				purpose: 'settings',
				instanceId,
				appId,
				version: source.package.version,
				grant,
				entry: settings.frontendEntry,
				expiresAt,
				uiRevision: source.packageRevision,
				package: {
					packageId: source.package.packageId,
					version: source.package.version,
					packageHash: source.package.packageHash,
					publisherKeyId: source.package.publisherKeyId,
				},
			};
		});
	}

	private async readSettingsGrant(permission: PluginFrontendGrant, grant: string) {
		if (
			permission.purpose !== 'settings' ||
			this.closing ||
			permission.expiresAt <= Date.now() ||
			this.contentGrants.get(grant) !== permission
		) {
			throw new AgentFailure('forbidden');
		}
		const source = await this.instances.read(
			{ kind: 'manual', actor: permission.actor },
			permission.appId,
			permission.instanceId,
		);
		if (
			source.packageRevision !== permission.revision ||
			source.package.packageId !== permission.packageId ||
			source.package.version !== permission.version ||
			source.manifest.contributions.settings?.schemaRevision !== permission.schemaRevision
		) {
			throw new AgentFailure('version_conflict');
		}
		if (this.closing || permission.expiresAt <= Date.now() || this.contentGrants.get(grant) !== permission) {
			throw new AgentFailure('forbidden');
		}
		return source;
	}

	asset(
		appId: string,
		version: string,
		grant: string,
		path: string,
		deliver: (content: PluginContent, signal: AbortSignal) => Promise<void>,
		requestSignal?: AbortSignal,
	): Promise<void> {
		const permission = this.contentGrants.get(grant);
		if (
			!permission ||
			permission.appId !== appId ||
			permission.version !== version ||
			permission.expiresAt <= Date.now()
		) {
			return Promise.reject(new AgentFailure('forbidden'));
		}
		if (
			!path.startsWith('frontend/') ||
			path.split('/').some((part) => !part || part.startsWith('.') || !/^[A-Za-z0-9_.-]{1,255}$/u.test(part))
		) {
			return Promise.reject(new AgentFailure('invalid_input'));
		}
		if (requestSignal?.aborted) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		// Asset bursts are reads, not management commands. Serializing their package
		// decoding preserves the existing single-reader memory bound without rejecting
		// a page because it contains more files than the management admission budget.
		const task = this.trackTask(
			async (ownerSignal) => {
				const signal = requestSignal ? AbortSignal.any([ownerSignal, requestSignal]) : ownerSignal;
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				if (this.contentGrants.get(grant) !== permission || permission.expiresAt <= Date.now()) {
					throw new AgentFailure('forbidden');
				}
				if (permission.purpose === 'settings') {
					await this.readSettingsGrant(permission, grant);
				}
				const content = await this.model.asset(
					permission.actor,
					appId,
					version,
					path,
					signal,
					(userId, current, key, enabled) => {
						identity(permission.actor, userId);
						authorizePluginContent(current, key, permission.purpose === 'settings' || enabled);
						if (
							this.contentGrants.get(grant) !== permission ||
							current.revision !== permission.revision ||
							permission.expiresAt <= Date.now()
						) {
							throw new AgentFailure('version_conflict');
						}
					},
					(manifest) => {
						const entry =
							permission.purpose === 'settings'
								? manifest.contributions.settings?.frontendEntry
								: manifest.frontendEntry;
						if (!entry?.startsWith('frontend/') || manifest.backendEntry === path) {
							throw new AgentFailure('forbidden');
						}
					},
					permission.purpose === 'settings' ? permission.instanceId : undefined,
				);
				if (content.bytes.byteLength > AGENT_PLUGIN_MAX_ASSET_BYTES) {
					throw new AgentFailure('limit_exceeded');
				}
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				if (permission.purpose === 'settings') {
					await this.readSettingsGrant(permission, grant);
				}
				await deliver({ bytes: content.bytes, sha256: content.sha256 }, signal);
			},
			this.assetLane,
			true,
		);
		this.assetLane = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}

	private async drainApp(userId: number, appId: string): Promise<void> {
		// Accepted Runs keep their exact implementation until the Run owner confirms real completion.
		await this.drain(userId, appId);
		await this.runtime.stop(userId, appId);
	}

	remove(actor: PluginActor, appId: string, revision: number): Promise<PluginInstallation> {
		return this.task(async () => {
			const current = await this.model.beginRetirement(actor, appId, revision, null, (userId, value) => {
				identity(actor, userId);
				if (value.status === 'removed') {
					throw new AgentFailure('version_conflict');
				}
			});
			for (const [id, grant] of this.contentGrants) {
				if (grant.actor.userId === actor.userId && grant.appId === appId) {
					this.revokeFrontendGrant(id);
				}
			}
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
		const task = this.trackTask(work, this.lane);
		this.lane = task.then(
			() => undefined,
			() => undefined,
		);
		return task;
	}

	private trackTask<T>(
		work: (signal: AbortSignal) => Promise<T>,
		predecessor?: Promise<unknown>,
		runRead = false,
	): Promise<T> {
		if (this.closing) {
			return Promise.reject(new AgentFailure('provider_unavailable'));
		}
		const deadline = runRead ? this.stop.signal : AbortSignal.any([this.stop.signal, AbortSignal.timeout(60000)]);
		const task = (predecessor ?? Promise.resolve()).then(() => {
			if (this.closing || deadline.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			return work(deadline);
		});
		this.pending.add(task);

		const untrack = () => {
			this.pending.delete(task);
		};

		void task.then(untrack, (error) => {
			logDiagnostic(this.logger, 'warn', 'PLUGIN_OPERATION_FAILED', {}, error);
			untrack();
			if (
				isAgentDrainFailure(error) &&
				!(error instanceof ToolExecutionUnknown && !(error instanceof ToolCleanupFailure))
			) {
				this.failures.push(error);
				this.quiesce();
			}
		});
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
		if (startRuntimes) {
			for (const target of await this.model.runtimeTargets()) {
				await this.runtime.reconcile(target.userId, target.appId);
			}
		}
	}

	stages(actor: PluginActor): Promise<PluginStage[]> {
		return this.task(() => this.model.stages(actor));
	}

	installationDirectory(actor: PluginActor): Promise<PluginInstallationDirectory> {
		return this.task(() => this.model.installationDirectory(actor));
	}

	installations(actor: PluginActor): Promise<PluginInstallation[]> {
		return this.task(() => this.model.installations(actor));
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
				(userId, existing) => {
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
				},
			);
		});
	}

	revokePublisher(actor: PluginActor, keyId: string, version: number): Promise<PluginPublisher> {
		return this.task(async () => {
			const result = await this.model.revokePublisher(actor, keyId, version, (userId) => identity(actor, userId));
			for (const [id, grant] of this.contentGrants) {
				if (grant.actor.userId === actor.userId && result.appIds.includes(grant.appId)) {
					this.revokeFrontendGrant(id);
				}
			}
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
		expected: { packageId: string; version: string; publisherKeyId: string },
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
				inspected.manifest.id !== expected.packageId ||
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

	async runRegisteredApp(input: PluginRunInvocation): Promise<RunAppOutcome> {
		await input.assertCurrent();
		const binding = await this.model.runtimeBinding(input.scope.userId, input.scope.appId);
		if (
			binding.app.packageId !== input.execution.package.packageId ||
			binding.app.version !== input.execution.package.version ||
			binding.app.packageHash !== input.execution.package.packageHash ||
			binding.app.publisherKeyId !== input.execution.package.publisherKeyId
		) {
			throw new AgentFailure('version_conflict');
		}
		const references = [binding.app, ...binding.dependencies];
		const packages = references.filter(
			(reference, index) => references.findIndex((value) => value.packageId === reference.packageId) === index,
		);
		const logicalInstances = (await this.instances.list(input.scope.userId, input.scope.appId)).filter(
			(item) => item.enabled && packages.some((reference) => reference.packageId === item.packageId),
		);
		const started = await Promise.allSettled(
			logicalInstances.map((item) =>
				this.runtime.start(input.scope.userId, input.scope.appId, input.signal, item.packageId, item.id),
			),
		);
		for (const required of [input.execution.package, ...input.execution.codeDependencies]) {
			if (
				!packages.some(
					(reference) =>
						reference.packageId === required.packageId &&
						reference.packageHash === required.packageHash &&
						reference.publisherKeyId === required.publisherKeyId &&
						reference.version === required.version,
				)
			) {
				throw new AgentFailure('version_conflict');
			}
			const indexes = logicalInstances.flatMap((item, index) =>
				item.packageId === required.packageId &&
				(required.packageId !== input.execution.package.packageId || item.id === input.scope.appId)
					? [index]
					: [],
			);
			if (!indexes.some((index) => started[index]?.status === 'fulfilled')) {
				const refusal = indexes.map((index) => started[index]).find((result) => result?.status === 'rejected');
				throw refusal?.status === 'rejected' ? refusal.reason : new AgentFailure('version_conflict');
			}
		}

		await input.assertCurrent();
		const root = await this.model.packageSource(
			input.scope.userId,
			input.scope.appId,
			input.signal,
			authorizePluginContent,
			input.execution.package.packageId,
		);
		const ownerId = input.scope.runId + ':app-entry';
		const selectedPackageIds = [binding.app.packageId, ...binding.selectedRootIds];
		const allowedPackageIds = packages.map((reference) => reference.packageId);
		const caller = await this.runtime.directoryCaller(
			input.scope,
			ownerId,
			allowedPackageIds,
			root.manifest.capabilities,
			input.signal,
			selectedPackageIds,
			await input.visibleToolKeys(),
		);
		let cursor: string | null = null;
		let appEntry: string | null = null;
		do {
			const page = this.runtime.discover(caller, { kind: 'app', contract: null, apiVersion: null, cursor });
			for (const entry of page.entries) {
				if (
					entry.instanceId === input.scope.appId &&
					entry.package.packageId === input.execution.package.packageId &&
					entry.key === input.execution.handler
				) {
					if (appEntry !== null) {
						throw new AgentFailure('version_conflict');
					}
					appEntry = entry.id;
				}
			}
			cursor = page.nextCursor;
		} while (cursor !== null);
		if (appEntry === null) {
			throw new AgentFailure('provider_unavailable');
		}
		const bound = this.runtime.bind(caller, appEntry);
		const resolved = this.runtime.resolve(caller, bound.id, input.inputJson);
		const bindingOwners = new Set([ownerId]);
		const appSource: PluginCapabilitySource = {
			packageRevision: resolved.provider.packageRevision,
			ancestors: [],
			instanceId: resolved.provider.instanceId,
			generation: resolved.provider.generation,
			packageId: resolved.provider.package.packageId,
			operationId: null,
			configurationRevision: resolved.provider.configurationRevision,
			capabilities: root.manifest.capabilities.map((capability) => capability),
			pure: false,
		};
		const context: PluginRegisteredInvocation = {
			catalogSource: appSource,
			bindingOwners,
			scope: { kind: 'run', runId: input.scope.runId, operationId: null, deadlineUnixMs: input.deadlineUnixMs },
			source: appSource,
			allowedPackageIds,
			selectedPackageIds,
		};
		try {
			const raw: unknown = JSON.parse(
				await this.runtime.invokeCallable(resolved, context.scope, input.signal, (request, signal) =>
					this.registeredCapability(input, context, request, signal),
				),
			);
			const result = readAgentPluginAppOutcome(raw);
			if (result.kind === 'suspend') {
				return {
					kind: 'suspend',
					checkpointVersion: result.checkpointVersion,
					inputRequest: {
						id: result.inputRequest.id,
						sha256: result.inputRequest.sha256,
						sizeBytes: result.inputRequest.sizeBytes,
						mediaType: result.inputRequest.mediaType,
					},
				};
			}
			return {
				kind: 'complete',
				outputs: result.outputs.map((item) => ({
					id: item.id,
					sha256: item.sha256,
					sizeBytes: item.sizeBytes,
					mediaType: item.mediaType,
				})),
			};
		} finally {
			for (const id of bindingOwners) {
				this.runtime.releaseBindings({ userId: input.scope.userId, appId: input.scope.appId, ownerId: id });
			}
		}
	}

	private async registeredCapability(
		run: PluginRunInvocation,
		context: PluginRegisteredInvocation,
		request: PluginCapabilityRequest,
		signal: AbortSignal,
	): Promise<PluginCapabilityReply> {
		try {
			// An accepted handler may close only its original transport after cancellation.
			if (request.method === 'transport.session.close') {
				return await run.capability(request, context.source, signal);
			}
			signal.throwIfAborted();
			await run.assertCurrent();
			const ownerId = pluginCallOwner(run.scope.runId, context.source.instanceId, context.source.operationId);
			context.bindingOwners.add(ownerId);

			// Optional roots are live composition, whereas the App implementation was frozen at Run creation.
			const directoryCaller = async (metadata = false) => {
				const currentBinding = await this.model.runtimeBinding(run.scope.userId, run.scope.appId);
				return this.runtime.directoryCaller(
					run.scope,
					ownerId,
					[currentBinding.app.packageId, ...currentBinding.dependencies.map((item) => item.packageId)],
					await run.visibleCapabilities(metadata ? context.catalogSource : context.source),
					signal,
					[currentBinding.app.packageId, ...currentBinding.selectedRootIds],
					await run.visibleToolKeys(),
				);
			};

			const input: unknown = JSON.parse(request.inputJson);
			if (request.method === 'registry.wait') {
				const revision = agentInteger(agentRecord(input, ['revision']).revision);
				const current = await this.runtime.waitDirectory(run.scope, revision, signal);
				await run.assertCurrent();
				return { ok: true, valueJson: JSON.stringify({ revision: current }) };
			}
			if (request.method === 'registry.replace') {
				const definitions = readAgentPluginRegistrations(agentRecord(input, ['definitions']).definitions);
				const revision = await this.runtime.replaceRegistrations(
					run.scope,
					context.source.instanceId,
					context.source.generation,
					definitions.map(fromRegistryDefinition),
				);
				return { ok: true, valueJson: JSON.stringify({ revision }) };
			}
			if (request.method === 'registry.emit') {
				const value = agentRecord(input, ['key', 'cursor', 'payloadJson']);
				const event = await this.runtime.emitEvent(
					run.scope,
					context.source.instanceId,
					context.source.generation,
					{
						key: pluginContractText(value.key),
						cursor: value.cursor === null ? null : pluginContractText(value.cursor),
						payloadJson: typeof value.payloadJson === 'string' ? value.payloadJson : invalidPluginInput(),
					},
				);
				return { ok: true, valueJson: JSON.stringify(event) };
			}
			if (request.method === 'registry.eventWait') {
				const value = agentRecord(input, ['entryId', 'afterRevision']);
				const event = await this.runtime.waitEvent(
					await directoryCaller(true),
					readAgentId(value.entryId),
					agentInteger(value.afterRevision),
					signal,
				);
				await run.assertCurrent();
				// Recheck current visibility after the asynchronous subscription wakes.
				const liveBinding = await this.model.runtimeBinding(run.scope.userId, run.scope.appId);
				const latest = await this.runtime.directoryCaller(
					run.scope,
					ownerId,
					[liveBinding.app.packageId, ...liveBinding.dependencies.map((item) => item.packageId)],
					await run.visibleCapabilities(context.catalogSource),
					signal,
					[liveBinding.app.packageId, ...liveBinding.selectedRootIds],
					await run.visibleToolKeys(),
				);
				this.runtime.describe(latest, readAgentId(value.entryId));
				return {
					ok: true,
					valueJson: JSON.stringify({
						instanceId: event.instanceId,
						generation: event.generation,
						key: event.key,
						revision: event.revision,
						cursor: event.cursor,
						payloadJson: event.payloadJson,
					}),
				};
			}

			if (request.method === 'registry.discover') {
				const row = agentRecord(input, ['contract', 'apiVersion', 'kind', 'cursor']);
				const kind =
					row.kind === null || row.kind === 'event'
						? row.kind
						: AGENT_PLUGIN_CALLABLE_KINDS.find((kind) => kind === row.kind);
				if (
					kind === undefined ||
					(row.contract !== null && typeof row.contract !== 'string') ||
					(row.cursor !== null && typeof row.cursor !== 'string')
				) {
					throw new InvalidAgentPayload();
				}
				const query: RegistryQuery = {
					contract: row.contract,
					apiVersion: row.apiVersion === null ? null : agentInteger(row.apiVersion, 1),
					kind,
					cursor: row.cursor,
				};
				return {
					ok: true,
					valueJson: JSON.stringify(
						toRegistryPage(this.runtime.discover(await directoryCaller(true), query)),
					),
				};
			}
			if (request.method === 'registry.describe' || request.method === 'registry.bind') {
				const entryId = readAgentId(agentRecord(input, ['entryId']).entryId);
				const caller = await directoryCaller(true);
				return {
					ok: true,
					valueJson: JSON.stringify(
						request.method === 'registry.describe'
							? toRegistryDescription(this.runtime.describe(caller, entryId))
							: toRegistryBinding(this.runtime.bind(caller, entryId)),
					),
				};
			}
			if (request.method !== 'registry.invoke') {
				return run.capability(request, context.source, signal);
			}
			const invocation = readAgentPluginInvocation(input);
			// Do not resolve a handle before the Operation owner has checked its original receipt.
			const requestHash = createHash('sha256')
				.update(JSON.stringify([invocation.bindingId, invocation.argumentsJson]))
				.digest('hex');
			const outcome = await run.operation({
				intent: {
					scope: {
						userId: run.scope.userId,
						appId: run.scope.appId,
						runId: run.scope.runId,
						executionGeneration: run.scope.executionGeneration,
					},
					parentId: context.source.operationId,
					callerId: ownerId,
					operationKey: invocation.operationKey,
					requestHash,
				},
				signal,

				prepare: async () => {
					const call = this.runtime.resolve(
						await directoryCaller(),
						invocation.bindingId,
						invocation.argumentsJson,
					);
					if (call.definition.kind === 'app') {
						throw new AgentFailure('forbidden');
					}
					return {
						record: call.definition.kind === 'tool' || call.definition.execution === 'managed',
						kind: call.definition.kind === 'tool' ? 'tool' : 'effect',
						label: call.definition.key,
						bindingJson: JSON.stringify({
							kind: 'registry',
							binding: toRegistryBinding(call.binding),
							package: {
								packageId: call.provider.package.packageId,
								version: call.provider.package.version,
								packageHash: call.provider.package.packageHash,
								publisherKeyId: call.provider.package.publisherKeyId,
							},
							key: call.definition.key,
							summary: call.definition.summary,
							contract: call.definition.contract,
							apiVersion: call.definition.apiVersion,
							capabilities: call.definition.capabilities.map((value) => value),
						}),
						argumentsJson: call.argumentsJson,
						mayHaveExternalEffect: false,

						validate: async () => {
							await run.assertCurrent();
							const live = await this.model.runtimeBinding(run.scope.userId, run.scope.appId);
							const current = await this.runtime.directoryCaller(
								run.scope,
								ownerId,
								[live.app.packageId, ...live.dependencies.map((item) => item.packageId)],
								await run.visibleCapabilities(context.source),
								signal,
								[live.app.packageId, ...live.selectedRootIds],
								await run.visibleToolKeys(),
							);
							this.runtime.resolve(current, invocation.bindingId, invocation.argumentsJson);
						},

						authorize: async () => {
							const proof = await run.authorize(context.source);
							return {
								policyRevision: proof.policyRevision,
								policyExecutionVersion: proof.policyExecutionVersion,
								denylistRevision: proof.denylistRevision,
								settingsVersion: proof.settingsVersion,
								instance: {
									id: call.provider.instanceId,
									packageId: call.provider.package.packageId,
									generation: call.provider.generation,
									configurationRevision: call.provider.configurationRevision,
									packageRevision: call.provider.packageRevision,
								},
								ancestors: [
									...proof.ancestors,
									{
										id: proof.instance.id,
										packageId: proof.instance.packageId,
										generation: proof.instance.generation,
										configurationRevision: proof.instance.configurationRevision,
										packageRevision: proof.instance.packageRevision,
									},
								],
								provider: null,
								target: null,
								modelReservation: null,
								approval: null,
							};
						},

						execute: (operation, childSignal) =>
							this.invokeRegisteredChild(
								run,
								context,
								call,
								operation?.id ?? context.source.operationId,
								childSignal,
							),
					};
				},
			});
			if (outcome.kind === 'ephemeral') {
				return {
					ok: true,
					valueJson: JSON.stringify({ kind: 'completed', operationId: null, resultJson: outcome.resultJson }),
				};
			}
			const receipt = outcome.receipt;
			const result =
				receipt.state === 'completed'
					? { kind: 'completed', operationId: receipt.id, resultJson: receipt.resultJson }
					: receipt.state === 'cancelled' || receipt.state === 'unknown'
						? {
								kind: 'interrupted',
								operationId: receipt.id,
								reason: receipt.state === 'cancelled' ? 'cancelled' : 'effect_unknown',
							}
						: { kind: 'rejected', code: receipt.failureCode ?? 'active_run_conflict' };
			return { ok: true, valueJson: JSON.stringify(result) };
		} catch (error) {
			// A schema refusal is a known, undispatched call result. Let an App
			// correct the proposal without turning it into a failed capability RPC.
			if (
				request.method === 'registry.invoke' &&
				error instanceof AgentFailure &&
				error.code === 'invalid_input'
			) {
				return { ok: true, valueJson: JSON.stringify({ kind: 'rejected', code: error.code }) };
			}
			if (error instanceof InvalidAgentPayload || error instanceof SyntaxError) {
				return { ok: false, code: 'invalid_input' };
			}
			if (error instanceof AgentFailure && !isAgentDrainFailure(error)) {
				return { ok: false, code: error.code };
			}
			throw error;
		}
	}

	subscribeCapabilities(scope: { userId: number; appId: string }, notify: () => void): () => void {
		return this.runtime.subscribeDirectory(scope, notify);
	}

	releaseResources(scope: { userId: number; appId: string; runId: string }): Promise<void> {
		return this.runtime.releaseResources(scope);
	}

	subscribeRuntimeRetirement(
		observer: (scope: import('../model/plugin-types.js').PluginRuntimeRetirementScope) => Promise<void>,
	): () => void {
		return this.runtime.subscribeRetirement(observer);
	}

	assertRunSource(scope: { userId: number; appId: string }, source: PluginCapabilitySource): Promise<void> {
		return this.runtime.assertSource(scope, source.instanceId, source.generation);
	}

	async modelToolBindings(
		scope: { userId: number; appId: string; runId: string },
		source: PluginCapabilitySource,
		tools: readonly { name: string; bindingId: string }[],
		signal: AbortSignal,
		toolKeys: readonly string[] | null,
	): Promise<import('../../providers/model/model-invocation-types.js').ModelInvocationTool[]> {
		const binding = await this.model.runtimeBinding(scope.userId, scope.appId);
		const caller = await this.runtime.directoryCaller(
			scope,
			pluginCallOwner(scope.runId, source.instanceId, source.operationId),
			[binding.app.packageId, ...binding.dependencies.map((item) => item.packageId)],
			source.capabilities,
			signal,
			[binding.app.packageId, ...binding.selectedRootIds],
			toolKeys,
		);
		return tools.map((tool) => {
			const bound = this.runtime.describeBinding(caller, tool.bindingId);
			if (bound.definition.kind !== 'tool') {
				throw new AgentFailure('forbidden');
			}
			return {
				name: tool.name,
				bindingId: tool.bindingId,
				description: bound.definition.instructions.trim()
					? bound.definition.instructions
					: bound.definition.summary,
				inputSchemaJson: bound.definition.inputSchemaJson,
			};
		});
	}

	async availableToolKeys(
		scope: { userId: number; appId: string; runId: string },
		source: PluginCapabilitySource,
		capabilities: readonly import('@nexus-terminal/shared/agent/governance/values').AgentCapability[],
		signal: AbortSignal,
	): Promise<string[]> {
		await this.assertRunSource(scope, source);
		const binding = await this.model.runtimeBinding(scope.userId, scope.appId);
		const app = await this.model.packageSource(
			scope.userId,
			scope.appId,
			signal,
			authorizePluginContent,
			binding.app.packageId,
		);
		const caller = await this.runtime.directoryCaller(
			scope,
			pluginCallOwner(scope.runId, source.instanceId, source.operationId),
			[binding.app.packageId, ...binding.dependencies.map((item) => item.packageId)],
			app.manifest.capabilities.filter((capability) => capabilities.includes(capability)),
			signal,
			[binding.app.packageId, ...binding.selectedRootIds],
		);
		const result: string[] = [];
		let cursor: string | null = null;
		do {
			const page = this.runtime.discover(caller, { kind: 'tool', contract: null, apiVersion: null, cursor });
			result.push(...page.entries.filter((entry) => !entry.tags.includes('root-only')).map((entry) => entry.key));
			cursor = page.nextCursor;
		} while (cursor !== null);
		await this.assertRunSource(scope, source);
		signal.throwIfAborted();
		return result;
	}

	private async invokeRegisteredChild(
		run: PluginRunInvocation,
		parent: PluginRegisteredInvocation,
		call: RegistryResolvedCall,
		operationId: string | null,
		signal: AbortSignal,
	): Promise<string> {
		const capabilities = call.provider.capabilities.filter((capability) =>
			parent.source.capabilities.includes(capability),
		);
		const context: PluginRegisteredInvocation = {
			catalogSource: parent.catalogSource,
			bindingOwners: parent.bindingOwners,
			scope: { kind: 'run', runId: run.scope.runId, operationId, deadlineUnixMs: run.deadlineUnixMs },
			source: {
				packageRevision: call.provider.packageRevision,
				ancestors: [
					...parent.source.ancestors.map((item) => ({
						instanceId: item.instanceId,
						packageId: item.packageId,
						generation: item.generation,
						configurationRevision: item.configurationRevision,
						packageRevision: item.packageRevision,
					})),
					{
						instanceId: parent.source.instanceId,
						packageId: parent.source.packageId,
						generation: parent.source.generation,
						configurationRevision: parent.source.configurationRevision,
						packageRevision: parent.source.packageRevision,
					},
				],
				instanceId: call.provider.instanceId,
				generation: call.provider.generation,
				packageId: call.provider.package.packageId,
				operationId,
				configurationRevision: call.provider.configurationRevision,
				capabilities,
				pure: parent.source.pure || call.definition.execution === 'pure',
			},
			allowedPackageIds: parent.allowedPackageIds,
			selectedPackageIds: parent.selectedPackageIds,
		};
		return this.runtime.invokeCallable(call, context.scope, signal, (request, childSignal) =>
			this.registeredCapability(run, context, request, childSignal),
		);
	}

	resolveAppExecution(
		scope: { userId: number; appId: string },
		signal: AbortSignal,
	): Promise<Extract<RunAppExecution, { kind: 'plugin' }>> {
		return this.trackTask(
			async (ownerSignal) => {
				const execution = await this.model.appExecutionBinding(scope.userId, scope.appId, false);
				if (ownerSignal.aborted || signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				return execution;
			},
			undefined,
			true,
		);
	}

	private async skillCatalogs(
		scope: { userId: number; appId: string },
		signal: AbortSignal,
	): Promise<import('../model/plugin-skill-types.js').PluginSkillCatalog[]> {
		const binding = await this.model.runtimeBinding(scope.userId, scope.appId);
		const references = [
			binding.app,
			...binding.dependencies.filter((item) => binding.selectedRootIds.includes(item.packageId)),
		];
		const catalogs: import('../model/plugin-skill-types.js').PluginSkillCatalog[] = [];
		for (const reference of references) {
			const source = await this.model.packageSource(
				scope.userId,
				scope.appId,
				signal,
				authorizePluginContent,
				reference.packageId,
			);
			catalogs.push({
				packageId: reference.packageId,
				revision: source.installation.revision,
				skills: parsePluginSkills(
					fromPluginSkillFiles(source.files, source.manifest.contributions.skills),
					reference.version,
				),
			});
		}
		return catalogs;
	}

	private async assertSkillCatalog(
		scope: { userId: number; appId: string },
		revision: number,
		signal: AbortSignal,
		packageId: string,
	): Promise<void> {
		const binding = await this.model.runtimeBinding(scope.userId, scope.appId);
		if (binding.app.packageId !== packageId && !binding.selectedRootIds.includes(packageId)) {
			throw new AgentFailure('forbidden');
		}
		const current = await this.model.runtimeInstallation(
			scope.userId,
			scope.appId,
			authorizePluginContent,
			packageId,
		);
		if (current.revision !== revision || signal.aborted) {
			throw new AgentFailure('version_conflict');
		}
	}

	performSkill(
		scope: { userId: number; appId: string },
		input: PluginSkillInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<import('../model/plugin-skill-types.js').PluginSkillResult> {
		// Run reads cannot queue behind management operations that wait for those Runs to drain.
		return this.trackTask(async (ownerSignal) => {
			const combined = AbortSignal.any([ownerSignal, signal]);
			await validate();
			combined.throwIfAborted();
			let catalogs: import('../model/plugin-skill-types.js').PluginSkillCatalog[];
			try {
				catalogs = await this.skillCatalogs(scope, combined);
			} catch (error) {
				if (!(error instanceof AgentFailure && error.code === 'not_found')) {
					throw error;
				}
				await validate();
				combined.throwIfAborted();
				if (input.action === 'read') {
					throw new AgentFailure('not_found');
				}
				if (input.offset !== 0) {
					throw new AgentFailure('invalid_input');
				}
				return {
					operation: 'skills.catalog',
					value: {
						items: [],
						nextOffset: null,
						catalogSha256: createHash('sha256').update('[]').digest('hex'),
					},
				};
			}
			const skills = catalogs.flatMap((catalog) => catalog.skills);
			await validate();
			for (const catalog of catalogs) {
				await this.assertSkillCatalog(scope, catalog.revision, combined, catalog.packageId);
			}

			combined.throwIfAborted();
			if (input.action === 'read') {
				const candidates = skills.filter((item) => item.name === input.name);
				if (candidates.length > 1) {
					throw new AgentFailure('version_conflict');
				}
				const skill = candidates[0];
				if (!skill) {
					throw new AgentFailure('not_found');
				}
				if (skill.version !== input.version || skill.sha256 !== input.sha256) {
					throw new AgentFailure('version_conflict');
				}
				return {
					operation: 'skills.read',
					value: {
						name: skill.name,
						description: skill.description,
						version: skill.version,
						sha256: skill.sha256,
						body: skill.body,
					},
				};
			}
			if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > skills.length) {
				throw new AgentFailure('invalid_input');
			}
			const candidates = skills.map((skill) => ({
				name: skill.name,
				description: skill.description,
				version: skill.version,
				sha256: skill.sha256,
			}));
			const catalogSha256 = createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
			const items: typeof candidates = [];
			for (const candidate of candidates.slice(input.offset)) {
				const nextOffset =
					input.offset + items.length + 1 < candidates.length ? input.offset + items.length + 1 : null;
				const page = { items: [...items, candidate], nextOffset, catalogSha256 };
				const response = { operation: 'skills.catalog', value: page };
				if (agentPluginCapabilityReplyBytes(response) > AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES) {
					if (items.length === 0) {
						throw new AgentFailure('limit_exceeded');
					}
					break;
				}
				items.push(candidate);
			}
			return {
				operation: 'skills.catalog',
				value: {
					items,
					nextOffset: input.offset + items.length < candidates.length ? input.offset + items.length : null,
					catalogSha256,
				},
			};
		});
	}

	quiesce(): void {
		this.closing = true;
		this.runtime.quiesce();
		for (const id of this.contentGrants.keys()) {
			this.revokeFrontendGrant(id);
		}
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
