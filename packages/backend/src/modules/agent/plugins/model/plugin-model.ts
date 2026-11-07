import { fromRegistryDefinition } from '../registry/model/registry-protocol.js';

import { PluginCallableRefusal } from '../storage/plugin-runtime.js';
import { PluginSourceInvocationFailure } from './plugin-invocation-failure.js';

import type {
	PluginAppBinding,
	PluginPackageInstallation,
	PluginCompositionCandidate,
	PluginCompositionDecision,
	PluginPackageUpdateFacts,
	PluginPackageUpdateResult,
	PluginPackageUpdateDecision,
} from './plugin-composition-types.js';
import {
	fromPluginPackageInstallation,
	fromPluginAppBinding,
	toPluginPackageReference,
} from './plugin-composition-model.js';
import { fromStoredPluginManifest, toStoredPluginManifest } from './plugin-manifest-model.js';
import type { PluginRuntimeObservation, PluginRuntimeAcknowledgement } from './plugin-types.js';
import type { PluginInstallationDirectory } from './plugin-types.js';
import type { PluginDataSnapshot, PluginDataMigration, PluginDataMigrationResult } from './plugin-migration-types.js';
import type { PluginRuntimeLease } from './plugin-types.js';

import type { PluginBackendRuntime } from '../storage/plugin-runtime.js';
import { ModuleRuntimeFailure } from '../../../../platform/isolation/module-runtime.js';
import type { DecodedPluginPackage } from '../storage/plugin-package.js';
import type { StoredPluginContentSource } from '../storage/plugin-storage.js';
import type { PluginPackageSource, PluginRuntimeInstance } from './plugin-types.js';
import type { PluginSdkAssets } from '../storage/plugin-sdk-assets.js';
import { createHash } from 'node:crypto';
import type { PluginSkillDocument } from './plugin-skill-types.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { BlobStore } from '../../../../platform/blobs/blob-store.js';
import { BlobFailure } from '../../../../platform/blobs/blob-store.js';
import type { PackageSignature } from '../../../../platform/packages/package-reader.js';
import type { PluginPackageDecoder } from '../storage/plugin-package.js';
import { AgentFailure, AgentResourceFenced, ToolCleanupFailure, aggregateAgentFailures } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type {
	StoredPluginData,
	PluginStorage,
	StoredPluginStage,
	StoredPluginPublisher,
	StoredPluginInstallation,
} from '../storage/plugin-storage.js';
import { PluginStorageRefusal, PluginRuntimeFenceRefusal } from '../storage/plugin-storage.js';
import type {
	PluginDataPurge,
	PluginData,
	PluginDataMutation,
	PluginActor,
	PluginPublisher,
	PluginManifest,
	PluginStage,
	PluginRecovery,
	PluginInstallation,
	PluginVersion,
	PluginContent,
} from './plugin-types.js';

function publisher(value: StoredPluginPublisher): PluginPublisher {
	return {
		keyId: value.keyId,
		publicKeyPem: value.publicKeyPem,
		label: value.label,
		version: value.version,
		createdAt: value.createdAt,
		revokedAt: value.revokedAt,
	};
}

function stage(value: StoredPluginStage): PluginStage {
	return {
		id: value.id,
		packageHash: value.packageHash,
		sizeBytes: value.sizeBytes,
		status: value.status,
		version: value.version,
		publisherKeyId: value.publisherKeyId,
		manifest: value.manifest === null ? null : fromStoredPluginManifest(value.manifest),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof PluginRuntimeFenceRefusal) {
				throw new AgentResourceFenced({ cause: error });
			}
			if (error instanceof PluginStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

function blobFailure(error: unknown): never {
	if (error instanceof BlobFailure) {
		if (error.kind === 'aborted') {
			throw new AgentFailure('provider_unavailable', { cause: error });
		}
		if (error.kind === 'cleanup_failed') {
			throw new ToolCleanupFailure({ cause: error });
		}
		throw new AgentFailure(
			error.kind === 'io_unknown'
				? 'operation_unknown'
				: error.kind === 'limit_exceeded'
					? 'limit_exceeded'
					: 'storage_unavailable',
			{ cause: error },
		);
	}
	throw new AgentFailure('internal_failure', { cause: error });
}

function data(value: StoredPluginData): PluginData {
	return { key: value.key, version: value.version, valueJson: value.valueJson, updatedAt: value.updatedAt };
}

export class PluginModel {
	async cancelPackageUpdate(
		actor: PluginActor,
		packageId: string,
		revision: number,
		admit: (identity: number | null, current: PluginPackageInstallation) => void,
	): Promise<PluginPackageInstallation> {
		return fromPluginPackageInstallation(
			await storage(() =>
				this.storage.cancelPackageUpdate(
					actor.userId,
					this.tokens.digest(actor.token),
					packageId,
					revision,
					Date.now(),
					(userId, current) => admit(userId, fromPluginPackageInstallation(current)),
				),
			),
		);
	}

	async packageDirectory(
		actor: PluginActor,
	): Promise<{ installations: PluginPackageInstallation[]; retainedPackageIds: string[] }> {
		const value = await storage(() => this.storage.packageDirectory(actor.userId));
		return {
			installations: value.installations.map(fromPluginPackageInstallation),
			retainedPackageIds: value.retainedPackageIds.map((id) => id),
		};
	}

	async appBindings(actor: PluginActor): Promise<PluginAppBinding[]> {
		return (await storage(() => this.storage.appBindings(actor.userId))).map(fromPluginAppBinding);
	}

	packageRetainedData(actor: PluginActor): Promise<string[]> {
		return storage(() => this.storage.packageRetainedData(actor.userId));
	}

	async removePackage(
		actor: PluginActor,
		packageId: string,
		revision: number,
		clearData: boolean,
		admit: (
			identity: number | null,
			current: PluginPackageInstallation,
			referenced: boolean,
			runtimeClosed: boolean,
			updatePending: boolean,
		) => void,
	): Promise<PluginPackageInstallation> {
		return fromPluginPackageInstallation(
			await storage(() =>
				this.storage.removePackage(
					actor.userId,
					this.tokens.digest(actor.token),
					packageId,
					revision,
					clearData,
					Date.now(),
					(userId, current, referenced, runtimeClosed, updatePending) =>
						admit(userId, fromPluginPackageInstallation(current), referenced, runtimeClosed, updatePending),
				),
			),
		);
	}

	async updatePackage(
		actor: PluginActor,
		packageId: string,
		revision: number,
		stageId: string,
		stageVersion: number,
		phase: 'prepare' | 'commit',
		admit: (identity: number | null, facts: PluginPackageUpdateFacts) => PluginPackageUpdateDecision,
	): Promise<PluginPackageUpdateResult> {
		const value = await storage(() =>
			this.storage.updatePackage(
				actor.userId,
				this.tokens.digest(actor.token),
				packageId,
				revision,
				stageId,
				stageVersion,
				Date.now(),
				phase,
				(userId, facts) => {
					const decision = admit(userId, {
						candidates: facts.candidates.map((candidate) => ({
							installation: fromPluginPackageInstallation(candidate.installation),
							manifest: fromStoredPluginManifest(candidate.manifest),
							publisher: candidate.publisher ? publisher(candidate.publisher) : null,
						})),
						current: fromPluginPackageInstallation(facts.current),
						previousManifest: fromStoredPluginManifest(facts.previousManifest),
						stage: stage(facts.stage),
						publisher: facts.publisher ? publisher(facts.publisher) : null,
						references: facts.references.map((reference) => ({
							binding: fromPluginAppBinding(reference.binding),
							manifest: fromStoredPluginManifest(reference.manifest),
						})),
					});
					return {
						uiOnly: decision.uiOnly,
						impacts: decision.impacts.map((impact) => ({
							appId: impact.appId,
							restartApp: impact.restartApp,
							packageIds: impact.packageIds.map((id) => id),
						})),
						dependencies: decision.dependencies.map((item) => ({
							package: toPluginPackageReference(item.package),
							installationRevision: item.installationRevision,
						})),
						bindings: decision.bindings.map((binding) => ({
							appId: binding.appId,
							executionRevision: binding.executionRevision,
							uiRevision: binding.uiRevision,
							app: toPluginPackageReference(binding.app),
							dependencies: binding.dependencies.map(toPluginPackageReference),
							selectedRootIds: binding.selectedRootIds.map((id) => id),
							ui: binding.ui ? toPluginPackageReference(binding.ui) : null,
						})),
					};
				},
			),
		);
		return {
			dependencies: value.dependencies.map((item) => ({
				package: {
					packageId: item.package.packageId,
					version: item.package.version,
					packageHash: item.package.packageHash,
					publisherKeyId: item.package.publisherKeyId,
				},
				installationRevision: item.installationRevision,
			})),
			installation: fromPluginPackageInstallation(value.installation),
			uiOnly: value.uiOnly,
			appIds: value.appIds.map((appId) => appId),
			impacts: value.impacts.map((impact) => ({
				appId: impact.appId,
				restartApp: impact.restartApp,
				packageIds: impact.packageIds.map((id) => id),
			})),
		};
	}

	async packageInstallations(actor: PluginActor): Promise<PluginPackageInstallation[]> {
		return (await storage(() => this.storage.packageInstallations(actor.userId))).map(
			fromPluginPackageInstallation,
		);
	}

	async installPackage(
		actor: PluginActor,
		stageId: string,
		stageVersion: number,
		admit: (
			userId: number | null,
			staged: PluginStage,
			key: PluginPublisher | null,
			current: PluginPackageInstallation | null,
			updatePending: boolean,
		) => void,
	): Promise<PluginPackageInstallation> {
		return fromPluginPackageInstallation(
			await storage(() =>
				this.storage.installPackage(
					actor.userId,
					this.tokens.digest(actor.token),
					stageId,
					stageVersion,
					Date.now(),
					(userId, staged, key, current, updatePending) =>
						admit(
							userId,
							stage(staged),
							key ? publisher(key) : null,
							current ? fromPluginPackageInstallation(current) : null,
							updatePending,
						),
				),
			),
		);
	}

	async composeApp(
		actor: PluginActor,
		appId: string,
		packageId: string,
		expectedBinding: { executionRevision: number; uiRevision: number } | null,
		admit: (userId: number | null, candidates: PluginCompositionCandidate[]) => PluginCompositionDecision,
	): Promise<PluginAppBinding> {
		return fromPluginAppBinding(
			await storage(() =>
				this.storage.composeApp(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					packageId,
					expectedBinding === null
						? null
						: {
								executionRevision: expectedBinding.executionRevision,
								uiRevision: expectedBinding.uiRevision,
							},
					Date.now(),
					(userId, candidates) => {
						const decision = admit(
							userId,
							candidates.map((candidate) => ({
								installation: fromPluginPackageInstallation(candidate.installation),
								manifest: fromStoredPluginManifest(candidate.manifest),
								publisher: candidate.publisher ? publisher(candidate.publisher) : null,
							})),
						);
						return {
							app: toPluginPackageReference(decision.app),
							dependencies: decision.dependencies.map(toPluginPackageReference),
							selectedRootIds: decision.selectedRootIds.map((id) => id),
							ui: decision.ui ? toPluginPackageReference(decision.ui) : null,
							initialization: {
								enabled: decision.initialization.enabled,
								grantedCapabilities:
									decision.initialization.grantedCapabilities?.map((value) => value) ?? null,
							},
						};
					},
				),
			),
		);
	}

	async runtimeBinding(userId: number, appId: string): Promise<PluginAppBinding> {
		return fromPluginAppBinding(await storage(() => this.storage.appBinding(userId, appId)));
	}

	async appExecutionBinding(
		userId: number,
		appId: string,
		allowDraining: boolean,
	): Promise<Extract<import('../../runs/model/run-app-execution-types.js').RunAppExecution, { kind: 'plugin' }>> {
		const value = await storage(() => this.storage.appExecutionBinding(userId, appId, allowDraining));
		if (!value) {
			throw new AgentFailure('version_conflict');
		}
		return {
			kind: 'plugin',
			package: {
				packageId: value.package.packageId,
				version: value.package.version,
				packageHash: value.package.packageHash,
				publisherKeyId: value.package.publisherKeyId,
			},
			codeDependencies: value.codeDependencies.map((dependency) => ({
				packageId: dependency.packageId,
				version: dependency.version,
				packageHash: dependency.packageHash,
				publisherKeyId: dependency.publisherKeyId,
			})),
			handler: value.handler,
		};
	}

	async appBinding(actor: PluginActor, appId: string): Promise<PluginAppBinding> {
		return fromPluginAppBinding(await storage(() => this.storage.appBinding(actor.userId, appId)));
	}

	async dataSnapshot(
		actor: PluginActor,
		appId: string,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
		namespace?: string,
	): Promise<PluginDataSnapshot> {
		const value = await storage(() =>
			this.storage.dataSnapshot(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				(userId, current, runtimeClosed, upgradePending) =>
					admit(userId, installation(current), runtimeClosed, upgradePending),
				namespace,
			),
		);
		return {
			appId: value.appId,
			revision: value.revision,
			items: value.items.map((item) => ({
				packageId: item.packageId,
				key: item.key,
				version: item.version,
				valueJson: item.valueJson,
				updatedAt: item.updatedAt,
			})),
		};
	}

	async migrateData(
		actor: PluginActor,
		appId: string,
		input: PluginDataMigration,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
	): Promise<PluginDataMigrationResult> {
		const items = input.items
			.map((item) => ({
				packageId: item.packageId,
				key: item.key,
				expectedVersion: item.expectedVersion,
				valueJson: item.valueJson,
			}))
			.sort((left, right) =>
				(left.packageId + '\0' + left.key).localeCompare(right.packageId + '\0' + right.key),
			);
		const requestHash = createHash('sha256')
			.update(JSON.stringify({ appId, expectedRevision: input.expectedRevision, items }))
			.digest('hex');
		const value = await storage(() =>
			this.storage.migrateData(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				{
					expectedRevision: input.expectedRevision,
					operationId: input.operationId,
					requestHash,
					now: Date.now(),
					items,
				},
				(userId, current, runtimeClosed, upgradePending) =>
					admit(userId, installation(current), runtimeClosed, upgradePending),
			),
		);
		return {
			appId: value.appId,
			operationId: value.operationId,
			revision: value.revision,
			changedKeys: value.changedKeys,
			updatedAt: value.updatedAt,
		};
	}

	withFrontendAdmission<T>(
		actor: PluginActor,
		appId: string,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			publisher: PluginPublisher | null,
			enabled: boolean,
		) => void,
		work: () => Promise<T>,
	): Promise<T> {
		return storage(() =>
			this.storage.withFrontendAdmission(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				(userId, current, key, enabled) =>
					admit(userId, installation(current), key === null ? null : publisher(key), enabled),
				work,
			),
		);
	}

	async authorizedInstallation(
		actor: PluginActor,
		appId: string,
		version: string,
		admit: (
			userId: number | null,
			current: PluginInstallation,
			key: PluginPublisher | null,
			enabled: boolean,
		) => void,
	): Promise<PluginInstallation> {
		const source = await storage(() =>
			this.storage.content(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				version,
				(userId, current, key, enabled) =>
					admit(userId, installation(current), key === null ? null : publisher(key), enabled),
			),
		);
		return installation(source.installation);
	}

	async purgeData(
		actor: PluginActor,
		appId: string,
		revision: number,
		operationId: string,
		admit: (userId: number | null, current: PluginInstallation) => void,
		decide: (currentRevision: number) => void,
	): Promise<PluginDataPurge> {
		const result = await storage(() =>
			this.storage.purgeData(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				revision,
				operationId,
				Date.now(),
				(userId, current) => admit(userId, installation(current)),
				decide,
			),
		);
		return { revision: result.revision, deletedKeys: result.deletedKeys, updatedAt: result.updatedAt };
	}

	async sdkAsset(path: string): Promise<PluginContent> {
		try {
			const bytes = await this.sdk.read(path);
			if (bytes === null) {
				throw new AgentFailure('not_found');
			}
			return { bytes: bytes.slice(), sha256: createHash('sha256').update(bytes).digest('hex') };
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			throw new AgentFailure('provider_unavailable', { cause: error });
		}
	}

	async readData(
		actor: PluginActor,
		appId: string,
		key: string,
		admit: (
			userId: number | null,
			current: PluginInstallation,
			publisher: PluginPublisher | null,
			enabled: boolean,
		) => void,
		packageId?: string,
	): Promise<PluginData | null> {
		const value = await storage(() =>
			this.storage.readData(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				key,
				(userId, current, key, enabled) =>
					admit(userId, installation(current), key === null ? null : publisher(key), enabled),
				packageId,
			),
		);
		return value === null ? null : data(value);
	}

	async mutateData(
		actor: PluginActor,
		appId: string,
		input: PluginDataMutation,
		admit: (
			userId: number | null,
			current: PluginInstallation,
			publisher: PluginPublisher | null,
			enabled: boolean,
		) => void,
		decide: (current: PluginData | null) => void,
		packageId?: string,
	): Promise<PluginData> {
		const contentHash = createHash('sha256')
			.update(JSON.stringify([input.expectedRevision, input.key, input.expectedVersion, input.valueJson]))
			.digest('hex');
		return data(
			await storage(() =>
				this.storage.mutateData(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					{
						operationId: input.operationId,
						contentHash,
						key: input.key,
						valueJson: input.valueJson,
						now: Date.now(),
					},
					(userId, current, key, enabled) =>
						admit(userId, installation(current), key === null ? null : publisher(key), enabled),
					(current) => decide(current === null ? null : data(current)),
					packageId,
				),
			),
		);
	}

	async versions(actor: PluginActor): Promise<PluginVersion[]> {
		return (await storage(() => this.storage.versions(actor.userId))).map((value) => ({
			manifest: fromStoredPluginManifest(value.manifest),
			packageHash: value.packageHash,
			publisherKeyId: value.publisherKeyId,
		}));
	}

	async frontend(
		actor: PluginActor,
		appId: string,
		version: string,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			key: PluginPublisher | null,
			enabled: boolean,
		) => void,
	): Promise<PluginManifest> {
		const source = await storage(() =>
			this.storage.content(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				version,
				(userId, current, key, enabled) => {
					admit(userId, installation(current), key === null ? null : publisher(key), enabled);
				},
			),
		);
		if (!source.stage.manifest) {
			throw new AgentFailure('storage_unavailable');
		}
		return fromStoredPluginManifest(source.stage.manifest);
	}

	async asset(
		actor: PluginActor,
		appId: string,
		version: string,
		path: string,
		signal: AbortSignal,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			key: PluginPublisher | null,
			enabled: boolean,
		) => void,
		select: (value: PluginManifest) => void,
		settingsInstanceId?: string,
	): Promise<PluginContent> {
		const read = () =>
			storage(() =>
				this.storage.content(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					version,
					(userId, current, key, enabled) => {
						admit(userId, installation(current), key === null ? null : publisher(key), enabled);
					},
					settingsInstanceId,
				),
			);

		const source = await read();
		const decoded = await this.decodeSource(source, signal);
		select(fromStoredPluginManifest(decoded.manifest));
		const file = decoded.files.find((item) => item.path === path);
		if (!file) {
			throw new AgentFailure('not_found');
		}
		const latest = await read();
		if (latest.installation.revision !== source.installation.revision) {
			throw new AgentFailure('version_conflict');
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		return { bytes: file.bytes.slice(), sha256: file.sha256 };
	}

	private async decodeSource(source: StoredPluginContentSource, signal: AbortSignal): Promise<DecodedPluginPackage> {
		const chunks: Uint8Array[] = [];
		let count = 0;
		try {
			for await (const chunk of this.blobs.read(
				source.stage.id,
				{ start: 0, endInclusive: source.stage.sizeBytes - 1 },
				signal,
			)) {
				count += chunk.byteLength;
				if (count > source.stage.sizeBytes) {
					throw new AgentFailure('limit_exceeded');
				}
				chunks.push(chunk);
			}
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			blobFailure(error);
		}
		const bytes = Buffer.concat(chunks, count);
		if (
			count !== source.stage.sizeBytes ||
			createHash('sha256').update(bytes).digest('hex') !== source.installation.packageHash
		) {
			throw new AgentFailure('storage_unavailable');
		}
		let decoded: import('../storage/plugin-package.js').DecodedPluginPackage;
		try {
			decoded = await this.packages.decode(bytes, (key) =>
				key === source.installation.publisherKeyId ? source.publicKeyPem : null,
			);
		} catch (cause) {
			throw new AgentFailure('storage_unavailable', { cause });
		}
		if (
			!decoded.signatureValid ||
			decoded.manifest.id !== source.installation.definitionId ||
			decoded.manifest.version !== source.installation.version
		) {
			throw new AgentFailure('storage_unavailable');
		}
		return decoded;
	}

	assertRuntimeClosed(userId: number, appId: string): Promise<void> {
		return storage(() => this.storage.assertRuntimeClosed(userId, appId));
	}

	async observeRuntime(
		actor: PluginActor,
		appId: string,
		admit: (identity: number | null) => void,
		instanceId: string | null,
	): Promise<PluginRuntimeObservation | null> {
		const value = await storage(() =>
			this.storage.observeRuntime(actor.userId, this.tokens.digest(actor.token), appId, admit, instanceId),
		);
		return value === null
			? null
			: {
					appId: value.appId,
					instanceId: value.instanceId,
					revision: value.revision,
					state: value.state,
					updatedAt: value.updatedAt,
					unknownAt: value.unknownAt,
					acknowledgedAt: value.acknowledgedAt,
				};
	}

	async acknowledgeRuntime(
		actor: PluginActor,
		appId: string,
		input: PluginRuntimeAcknowledgement,
		admit: (identity: number | null, installation: PluginInstallation) => void,
	): Promise<PluginRuntimeObservation> {
		const value = await storage(() =>
			this.storage.acknowledgeRuntime(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				input.instanceId,
				input.instanceRevision,
				Date.now(),
				(identity, current) => admit(identity, installation(current)),
			),
		);
		return {
			appId: value.appId,
			instanceId: value.instanceId,
			revision: value.revision,
			state: value.state,
			updatedAt: value.updatedAt,
			unknownAt: value.unknownAt,
			acknowledgedAt: value.acknowledgedAt,
		};
	}

	async recoverRuntimes(): Promise<void> {
		try {
			await this.runtime.recover();
		} catch (error) {
			runtimeFailure(error);
		}
		await storage(() => this.storage.recoverRuntimes(Date.now()));
	}

	async reserveRuntime(
		lease: PluginRuntimeLease,
		historyLimit: number,
		admit: (current: PluginInstallation, publisher: PluginPublisher | null, enabled: boolean) => void,
	): Promise<void> {
		await storage(() =>
			this.storage.reserveRuntime(
				{
					userId: lease.userId,
					appId: lease.appId,
					packageId: lease.packageId,
					instanceId: lease.instanceId,
					logicalInstanceId: lease.logicalInstanceId,
					generation: lease.generation,
					configurationRevision: lease.configurationRevision,
					revision: lease.revision,
					now: Date.now(),
				},
				historyLimit,
				(current, key, enabled) => admit(installation(current), key === null ? null : publisher(key), enabled),
			),
		);
	}

	async settleRuntime(lease: PluginRuntimeLease, state: 'active' | 'closed' | 'unknown'): Promise<void> {
		await storage(() =>
			this.storage.settleRuntime(
				{
					userId: lease.userId,
					appId: lease.appId,
					packageId: lease.packageId,
					instanceId: lease.instanceId,
					logicalInstanceId: lease.logicalInstanceId,
					generation: lease.generation,
					configurationRevision: lease.configurationRevision,
					revision: lease.revision,
					now: Date.now(),
				},
				state,
			),
		);
	}

	async runtimeTargets(): Promise<{ userId: number; appId: string }[]> {
		return (await storage(() => this.storage.runtimeTargets())).map((item) => ({
			userId: item.userId,
			appId: item.appId,
		}));
	}

	async runtimeInstallation(
		userId: number,
		appId: string,
		admit: (current: PluginInstallation, key: PluginPublisher | null, enabled: boolean) => void,
		packageId?: string,
	): Promise<PluginInstallation> {
		const source = await storage(() =>
			this.storage.runtimeContent(
				userId,
				appId,
				(current, key, enabled) => admit(installation(current), key === null ? null : publisher(key), enabled),
				packageId,
			),
		);
		return installation(source.installation);
	}

	async packageSource(
		userId: number,
		appId: string,
		signal: AbortSignal,
		admit: (current: PluginInstallation, key: PluginPublisher | null, enabled: boolean) => void,
		packageId?: string,
	): Promise<PluginPackageSource> {
		const source = await storage(() =>
			this.storage.runtimeContent(
				userId,
				appId,
				(current, key, enabled) => admit(installation(current), key === null ? null : publisher(key), enabled),
				packageId,
			),
		);
		const decoded = await this.decodeSource(source, signal);
		const latest = await this.runtimeInstallation(userId, appId, admit, packageId);
		if (latest.revision !== source.installation.revision) {
			throw new AgentFailure('version_conflict');
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		return {
			installation: installation(source.installation),
			manifest: fromStoredPluginManifest(decoded.manifest),
			files: decoded.files.map((file) => ({ path: file.path, bytes: file.bytes.slice(), sha256: file.sha256 })),
		};
	}

	async skillDocuments(
		userId: number,
		appId: string,
		signal: AbortSignal,
		admit: (current: PluginInstallation, key: PluginPublisher | null, enabled: boolean) => void,
	): Promise<{ version: string; revision: number; documents: PluginSkillDocument[] }> {
		const source = await this.packageSource(userId, appId, signal, admit);
		return {
			version: source.manifest.version,
			revision: source.installation.revision,
			documents: fromPluginSkillFiles(source.files, source.manifest.contributions.skills),
		};
	}

	async runtimeReadData(
		userId: number,
		appId: string,
		key: string,
		admit: (current: PluginInstallation, publisher: PluginPublisher | null, enabled: boolean) => void,
		packageId?: string,
	): Promise<PluginData | null> {
		const result = await storage(() =>
			this.storage.runtimeReadData(
				userId,
				appId,
				key,
				(current, key, enabled) => admit(installation(current), key === null ? null : publisher(key), enabled),
				packageId,
			),
		);
		return result === null ? null : data(result);
	}

	async runtimeMutateData(
		userId: number,
		appId: string,
		input: PluginDataMutation,
		admit: (current: PluginInstallation, publisher: PluginPublisher | null, enabled: boolean) => void,
		decide: (current: PluginData | null) => void,
		packageId?: string,
	): Promise<PluginData> {
		const contentHash = createHash('sha256')
			.update(JSON.stringify([input.expectedRevision, input.key, input.expectedVersion, input.valueJson]))
			.digest('hex');
		const result = await storage(() =>
			this.storage.runtimeMutateData(
				userId,
				appId,
				{
					operationId: input.operationId,
					contentHash,
					key: input.key,
					valueJson: input.valueJson,
					now: Date.now(),
				},
				(current, key, enabled) => admit(installation(current), key === null ? null : publisher(key), enabled),
				(current) => decide(current === null ? null : data(current)),
				packageId,
			),
		);
		return data(result);
	}

	async openRuntime(
		source: PluginPackageSource,
		lifecycle: { instanceId: string; generation: string; configurationRevision: number },
	): Promise<PluginRuntimeInstance> {
		const entry = source.manifest.backendEntry;
		if (entry === null) {
			throw new AgentFailure('not_found');
		}
		let instance;
		try {
			instance = await this.runtime.open({
				appId: source.installation.appId,
				instanceId: lifecycle.instanceId,
				generation: lifecycle.generation,
				configurationRevision: lifecycle.configurationRevision,
				definitionId: source.installation.definitionId,
				packageHash: source.installation.packageHash,
				publisherKeyId: source.installation.publisherKeyId,
				version: source.installation.version,
				entry,
				files: source.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
			});
		} catch (error) {
			runtimeFailure(error);
		}
		const owned = instance;

		const call = async <T>(work: () => Promise<T>): Promise<T> => {
			try {
				return await work();
			} catch (error) {
				runtimeFailure(error);
			}
		};

		const exited = call(() => owned.exited);
		void exited.catch(() => undefined);
		return {
			exited,

			activate: async () => (await call(() => owned.activate())).map(fromRegistryDefinition),

			releaseResources: (runId, deadlineUnixMs) => call(() => owned.releaseResources(runId, deadlineUnixMs)),

			invokeCallable: (input, signal, timeoutMs, dispatch) =>
				call(() =>
					owned.invokeCallable(
						{
							key: input.key,
							argumentsJson: input.argumentsJson,
							scope:
								input.scope.kind === 'run'
									? {
											kind: 'run',
											runId: input.scope.runId,
											operationId: input.scope.operationId,
											deadlineUnixMs: input.scope.deadlineUnixMs,
										}
									: { kind: input.scope.kind, deadlineUnixMs: input.scope.deadlineUnixMs },
						},
						signal,
						timeoutMs,
						async (request) => {
							const response = await dispatch({ method: request.method, inputJson: request.inputJson });
							return response.ok
								? { ok: true, valueJson: response.valueJson }
								: { ok: false, code: response.code };
						},
					),
				),

			health: () => call(() => owned.health()),

			quiesce: (deadline) => call(() => owned.quiesce(deadline)),

			close: () => call(() => owned.close()),
		};
	}

	async beginRetirement(
		actor: PluginActor,
		appId: string,
		revision: number,
		replacement: { stageId: string; version: number } | null,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			replacement: PluginStage | null,
			publisher: PluginPublisher | null,
		) => void,
	): Promise<PluginInstallation> {
		return installation(
			await storage(() =>
				this.storage.beginRetirement(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					revision,
					replacement?.stageId ?? null,
					replacement?.version ?? null,
					Date.now(),
					(userId, current, row, key) =>
						admit(
							userId,
							installation(current),
							row === null ? null : stage(row),
							key === null ? null : publisher(key),
						),
				),
			),
		);
	}

	async finishRemoval(
		actor: PluginActor,
		appId: string,
		revision: number,
		admit: (identity: number | null) => void,
	): Promise<PluginInstallation> {
		return installation(
			await storage(() =>
				this.storage.finishRemoval(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					revision,
					Date.now(),
					admit,
				),
			),
		);
	}

	async cancelRetirement(
		actor: PluginActor,
		appId: string,
		revision: number,
		admit: (identity: number | null, publisher: PluginPublisher | null, dataMigrated: boolean) => void,
	): Promise<PluginInstallation> {
		return installation(
			await storage(() =>
				this.storage.cancelRetirement(
					actor.userId,
					this.tokens.digest(actor.token),
					appId,
					revision,
					Date.now(),
					(userId, key, dataMigrated) => admit(userId, key === null ? null : publisher(key), dataMigrated),
				),
			),
		);
	}

	async installations(actor: PluginActor): Promise<PluginInstallation[]> {
		return (await storage(() => this.storage.installations(actor.userId))).map(installation);
	}

	async installationDirectory(actor: PluginActor): Promise<PluginInstallationDirectory> {
		const directory = await storage(() => this.storage.installationDirectory(actor.userId));
		return {
			installations: directory.installations.map(installation),
			retainedAppIds: directory.retainedAppIds.map((id) => id),
		};
	}

	async stages(actor: PluginActor): Promise<PluginStage[]> {
		return (await storage(() => this.storage.stages(actor.userId))).map(stage);
	}

	async recovery(): Promise<PluginRecovery[]> {
		return (await storage(() => this.storage.recovery())).map((item) => ({
			userId: item.userId,
			stage: stage(item.stage),
		}));
	}

	async recoverStage(
		item: PluginRecovery,
		signal: AbortSignal,
		decide: (exists: boolean, valid: boolean) => 'staged' | 'failed',
	): Promise<void> {
		let exists = true,
			valid = false;
		const hash = createHash('sha256');
		let count = 0;
		try {
			for await (const chunk of this.blobs.read(
				item.stage.id,
				{ start: 0, endInclusive: item.stage.sizeBytes - 1 },
				signal,
			)) {
				count += chunk.byteLength;
				if (count > item.stage.sizeBytes) {
					throw new AgentFailure('limit_exceeded');
				}
				hash.update(chunk);
			}
			valid = count === item.stage.sizeBytes && hash.digest('hex') === item.stage.packageHash;
		} catch (error) {
			if (error instanceof BlobFailure && error.kind === 'not_found') {
				exists = false;
			} else {
				blobFailure(error);
			}
		}
		const status = decide(exists, valid);
		await storage(() =>
			this.storage.recoverStage(item.userId, item.stage.id, item.stage.version, status, Date.now()),
		);
	}

	constructor(
		private readonly storage: PluginStorage,
		private readonly tokens: SessionTokens,
		private readonly blobs: BlobStore,
		private readonly signature: PackageSignature,
		private readonly packages: PluginPackageDecoder,
		private readonly sdk: PluginSdkAssets,
		private readonly runtime: PluginBackendRuntime,
	) {}

	async publishers(actor: PluginActor): Promise<PluginPublisher[]> {
		return (await storage(() => this.storage.publishers(actor.userId))).map(publisher);
	}

	normalizeKey(publicKeyPem: string): { keyId: string; publicKeyPem: string } {
		try {
			const value = this.signature.normalize(publicKeyPem);
			return { keyId: value.id, publicKeyPem: value.publicKeyPem };
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}
	}

	async putPublisher(
		actor: PluginActor,
		input: { keyId: string; publicKeyPem: string; label: string },
		admit: (identity: number | null, existing: PluginPublisher | null, count: number) => void,
	): Promise<PluginPublisher> {
		return publisher(
			await storage(() =>
				this.storage.putPublisher(
					actor.userId,
					this.tokens.digest(actor.token),
					{
						keyId: input.keyId,
						publicKeyPem: input.publicKeyPem,
						label: input.label,
						version: 1,
						createdAt: Date.now(),
						revokedAt: null,
					},
					(identity, existing, count) =>
						admit(identity, existing === null ? null : publisher(existing), count),
				),
			),
		);
	}

	async revokePublisher(
		actor: PluginActor,
		keyId: string,
		version: number,
		admit: (identity: number | null) => void,
	): Promise<{ publisher: PluginPublisher; appIds: string[] }> {
		const value = await storage(() =>
			this.storage.revokePublisher(
				actor.userId,
				this.tokens.digest(actor.token),
				keyId,
				version,
				Date.now(),
				admit,
			),
		);
		return { publisher: publisher(value.publisher), appIds: value.appIds.map((id) => id) };
	}

	async getStage(actor: PluginActor, id: string): Promise<PluginStage> {
		const value = await storage(() => this.storage.getStage(actor.userId, id));
		if (!value) {
			throw new AgentFailure('not_found');
		}
		return stage(value);
	}

	async reusableStage(
		actor: PluginActor,
		bytes: Uint8Array,
		signal: AbortSignal,
		admit: (identity: number | null, current: PluginStage | null, publisher: PluginPublisher | null) => void,
	): Promise<PluginStage | null> {
		const hash = createHash('sha256').update(bytes).digest('hex');

		const find = () =>
			storage(() =>
				this.storage.reusableStage(
					actor.userId,
					this.tokens.digest(actor.token),
					hash,
					(identity, current, key) =>
						admit(identity, current === null ? null : stage(current), key === null ? null : publisher(key)),
				),
			);

		const current = await find();
		if (current === null) {
			return null;
		}
		const digest = createHash('sha256');
		let count = 0;
		try {
			if ((await this.blobs.size(current.id)) !== current.sizeBytes) {
				throw new AgentFailure('version_conflict');
			}
			for await (const chunk of this.blobs.read(
				current.id,
				{ start: 0, endInclusive: current.sizeBytes - 1 },
				signal,
			)) {
				count += chunk.byteLength;
				if (count > current.sizeBytes) {
					throw new AgentFailure('version_conflict');
				}
				digest.update(chunk);
			}
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			blobFailure(error);
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		if (count !== bytes.byteLength || digest.digest('hex') !== hash) {
			throw new AgentFailure('version_conflict');
		}
		const latest = await find();
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		if (latest?.id !== current.id || latest.version !== current.version) {
			throw new AgentFailure('version_conflict');
		}
		return stage(latest);
	}

	async pruneStages(actor: PluginActor, retain: number, admit: (identity: number | null) => void): Promise<void> {
		const records = await storage(() =>
			this.storage.claimStageCleanup(actor.userId, this.tokens.digest(actor.token), retain, admit),
		);
		const failures: unknown[] = [];
		for (const record of records) {
			try {
				try {
					await this.blobs.remove(record.id);
				} catch (error) {
					if (!(error instanceof BlobFailure && error.kind === 'not_found')) {
						blobFailure(error);
					}
				}
				await storage(() => this.storage.finishStageCleanup(actor.userId, record.id, record.version));
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) {
			throw aggregateAgentFailures(failures, 'Plugin stage cleanup failed');
		}
	}

	async stage(
		actor: PluginActor,
		id: string,
		bytes: Uint8Array,
		signal: AbortSignal,
		admit: (identity: number | null) => void,
	): Promise<PluginStage> {
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const hash = createHash('sha256').update(bytes).digest('hex'),
			now = Date.now();
		const staged = await storage(() =>
			this.storage.createStage(
				actor.userId,
				this.tokens.digest(actor.token),
				{
					id,
					packageHash: hash,
					sizeBytes: bytes.byteLength,
					status: 'staging',
					version: 1,
					publisherKeyId: null,
					manifest: null,
					createdAt: now,
					updatedAt: now,
				},
				(identity) => {
					if (signal.aborted) {
						throw new AgentFailure('provider_unavailable');
					}
					admit(identity);
				},
			),
		);

		async function* source(): AsyncIterable<Uint8Array> {
			yield bytes;
		}

		try {
			const written = await this.blobs.write(id, source(), bytes.byteLength, signal);
			if (written.sha256 !== hash || written.bytes !== bytes.byteLength) {
				throw new AgentFailure('operation_unknown');
			}
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			blobFailure(error);
		}
		return stage(
			await storage(() =>
				this.storage.updateStage(
					actor.userId,
					this.tokens.digest(actor.token),
					id,
					staged.version,
					Date.now(),
					(identity, current) => {
						admit(identity);
						if (current.status !== 'staging') {
							throw new AgentFailure('version_conflict');
						}
						return { status: 'staged', manifest: null, publisherKeyId: null };
					},
				),
			),
		);
	}

	async inspectPackage(
		actor: PluginActor,
		bytes: Uint8Array,
	): Promise<{ manifest: PluginManifest; publisherKeyId: string; signatureValid: boolean }> {
		const keys = await this.publishers(actor);
		try {
			const decoded = await this.packages.decode(
				bytes,
				(id) => keys.find((key) => key.keyId === id && key.revokedAt === null)?.publicKeyPem ?? null,
			);
			return {
				manifest: fromStoredPluginManifest(decoded.manifest),
				publisherKeyId: decoded.publisherKeyId,
				signatureValid: decoded.signatureValid,
			};
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}
	}

	async verify(
		actor: PluginActor,
		id: string,
		version: number,
		signal: AbortSignal,
		admit: (
			identity: number | null,
			current: PluginStage,
			publisher: PluginPublisher | null,
			signatureValid: boolean,
		) => void,
		validateSkills: (documents: PluginSkillDocument[], version: string) => void,
	): Promise<PluginStage> {
		const current = await this.getStage(actor, id);
		if (current.version !== version) {
			throw new AgentFailure('version_conflict');
		}
		const chunks: Uint8Array[] = [];
		let count = 0;
		try {
			for await (const chunk of this.blobs.read(id, { start: 0, endInclusive: current.sizeBytes - 1 }, signal)) {
				count += chunk.byteLength;
				if (count > current.sizeBytes) {
					throw new AgentFailure('limit_exceeded');
				}
				chunks.push(chunk);
			}
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			blobFailure(error);
		}
		const bytes = Buffer.concat(chunks, count);
		if (count !== current.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== current.packageHash) {
			throw new AgentFailure('version_conflict');
		}
		const keys = await this.publishers(actor);
		let decoded: import('../storage/plugin-package.js').DecodedPluginPackage;
		try {
			decoded = await this.packages.decode(
				bytes,
				(keyId) => keys.find((key) => key.keyId === keyId && key.revokedAt === null)?.publicKeyPem ?? null,
			);
		} catch (error) {
			throw new AgentFailure('invalid_input', { cause: error });
		}
		validateSkills(
			fromPluginSkillFiles(decoded.files, decoded.manifest.contributions.skills),
			decoded.manifest.version,
		);
		return stage(
			await storage(() =>
				this.storage.updateStage(
					actor.userId,
					this.tokens.digest(actor.token),
					id,
					version,
					Date.now(),
					(identity, row, publishers) => {
						const key = publishers.find((key) => key.keyId === decoded.publisherKeyId) ?? null;
						admit(identity, stage(row), key === null ? null : publisher(key), decoded.signatureValid);
						return {
							status: 'verified',
							manifest: toStoredPluginManifest(fromStoredPluginManifest(decoded.manifest)),
							publisherKeyId: decoded.publisherKeyId,
						};
					},
				),
			),
		);
	}
}

function installation(value: StoredPluginInstallation): PluginInstallation {
	return {
		appId: value.appId,
		definitionId: value.definitionId,
		version: value.version,
		packageHash: value.packageHash,
		publisherKeyId: value.publisherKeyId,
		status: value.status,
		revision: value.revision,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function runtimeFailure(error: unknown): never {
	if (error instanceof PluginCallableRefusal) {
		// A plugin can report its own uncertain outcome; Host callback and cleanup failures
		// retain their original evidence independently of this untrusted declaration.
		if (error.code === 'operation_unknown') {
			throw new AgentResourceFenced({ cause: error });
		}
		throw new AgentFailure(error.code, { cause: error });
	}
	if (error instanceof ModuleRuntimeFailure) {
		if (error.kind === 'source_failed') {
			throw new PluginSourceInvocationFailure({ cause: error });
		}
		if (error.kind === 'cleanup_failed') {
			throw new ToolCleanupFailure({ cause: error });
		}
		throw new AgentFailure(error.kind === 'execution_unknown' ? 'operation_unknown' : 'provider_unavailable', {
			cause: error,
		});
	}
	throw new AgentFailure('internal_failure', { cause: error });
}

export function fromPluginSkillFiles(
	files: { path: string; bytes: Uint8Array; sha256: string }[],
	declarations: readonly { path: string }[],
): PluginSkillDocument[] {
	const selected = declarations.map((declaration) => {
		const file = files.find((file) => file.path === declaration.path);
		if (!file) {
			throw new AgentFailure('invalid_input');
		}
		return file;
	});
	return selected.map((file) => {
		try {
			return {
				path: file.path,
				content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes),
				sha256: file.sha256,
			};
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}
	});
}
