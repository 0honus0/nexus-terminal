import type { PluginRuntimeObservation, PluginRuntimeAcknowledgement } from './plugin-types.js';
import type { PluginDataSnapshot, PluginDataMigration, PluginDataMigrationResult } from './plugin-migration-types.js';
import type { PluginRuntimeLease } from './plugin-types.js';
import { intentToStorage } from './plugin-intent-model.js';
import { artifactToStorage } from '../../artifacts/model/artifact-model.js';
import type { PluginBackendRuntime, PluginRuntimeReply } from '../storage/plugin-runtime.js';
import { ModuleRuntimeFailure } from '../../../../platform/isolation/module-runtime.js';
import type { DecodedPluginPackage } from '../storage/plugin-package.js';
import type { StoredPluginContentSource } from '../storage/plugin-storage.js';
import type { PluginPackageSource, PluginRuntimeInstance, PluginRpcInput, PluginRpcResult } from './plugin-types.js';
import type { PluginSdkAssets } from '../storage/plugin-sdk-assets.js';
import { createHash } from 'node:crypto';
import { MAX_PLUGIN_SKILL_DOCUMENTS, MAX_PLUGIN_SKILL_BYTES } from '../plugin-skill-rules.js';
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
	StoredPluginManifest,
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

function manifest(value: StoredPluginManifest): PluginManifest {
	return {
		schemaVersion: 1,
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		sdkVersion: value.sdkVersion,
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
	};
}

function toManifest(value: PluginManifest): StoredPluginManifest {
	return {
		schemaVersion: 1,
		id: value.id,
		version: value.version,
		displayName: value.displayName,
		sdkVersion: value.sdkVersion,
		capabilities: value.capabilities.map((item) => item),
		intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
		frontendEntry: value.frontendEntry,
		backendEntry: value.backendEntry,
	};
}

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
		manifest: value.manifest === null ? null : manifest(value.manifest),
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
	async dataSnapshot(
		actor: PluginActor,
		appId: string,
		admit: (
			identity: number | null,
			current: PluginInstallation,
			runtimeClosed: boolean,
			upgradePending: boolean,
		) => void,
	): Promise<PluginDataSnapshot> {
		const value = await storage(() =>
			this.storage.dataSnapshot(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				(userId, current, runtimeClosed, upgradePending) =>
					admit(userId, installation(current), runtimeClosed, upgradePending),
			),
		);
		return { appId: value.appId, revision: value.revision, items: value.items.map(data) };
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
		admitCapacity: (keys: number, bytes: number) => void,
	): Promise<PluginDataMigrationResult> {
		const items = input.items
			.map((item) => ({ key: item.key, expectedVersion: item.expectedVersion, valueJson: item.valueJson }))
			.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
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
				admitCapacity,
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
	): Promise<PluginData | null> {
		const value = await storage(() =>
			this.storage.readData(
				actor.userId,
				this.tokens.digest(actor.token),
				appId,
				key,
				(userId, current, key, enabled) =>
					admit(userId, installation(current), key === null ? null : publisher(key), enabled),
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
		decide: (current: PluginData | null, keyCount: number, dataBytes: number) => void,
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
					(current, keyCount, dataBytes) =>
						decide(current === null ? null : data(current), keyCount, dataBytes),
				),
			),
		);
	}

	async versions(actor: PluginActor): Promise<PluginVersion[]> {
		return (await storage(() => this.storage.versions(actor.userId))).map((value) => ({
			manifest: manifest(value.manifest),
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
		return manifest(source.stage.manifest);
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
				),
			);

		const source = await read();
		const decoded = await this.decodeSource(source, signal);
		select(manifest(decoded.manifest));
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
					instanceId: lease.instanceId,
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
					instanceId: lease.instanceId,
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
	): Promise<PluginInstallation> {
		const source = await storage(() =>
			this.storage.runtimeContent(userId, appId, (current, key, enabled) =>
				admit(installation(current), key === null ? null : publisher(key), enabled),
			),
		);
		return installation(source.installation);
	}

	async packageSource(
		userId: number,
		appId: string,
		signal: AbortSignal,
		admit: (current: PluginInstallation, key: PluginPublisher | null, enabled: boolean) => void,
	): Promise<PluginPackageSource> {
		const source = await storage(() =>
			this.storage.runtimeContent(userId, appId, (current, key, enabled) =>
				admit(installation(current), key === null ? null : publisher(key), enabled),
			),
		);
		const decoded = await this.decodeSource(source, signal);
		const latest = await this.runtimeInstallation(userId, appId, admit);
		if (latest.revision !== source.installation.revision) {
			throw new AgentFailure('version_conflict');
		}
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		return {
			installation: installation(source.installation),
			manifest: manifest(decoded.manifest),
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
			documents: fromPluginSkillFiles(source.files),
		};
	}

	async runtimeReadData(
		userId: number,
		appId: string,
		key: string,
		admit: (current: PluginInstallation, publisher: PluginPublisher | null, enabled: boolean) => void,
	): Promise<PluginData | null> {
		const result = await storage(() =>
			this.storage.runtimeReadData(userId, appId, key, (current, key, enabled) =>
				admit(installation(current), key === null ? null : publisher(key), enabled),
			),
		);
		return result === null ? null : data(result);
	}

	async runtimeMutateData(
		userId: number,
		appId: string,
		input: PluginDataMutation,
		admit: (current: PluginInstallation, publisher: PluginPublisher | null, enabled: boolean) => void,
		decide: (current: PluginData | null, keyCount: number, dataBytes: number) => void,
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
				(current, keys, dataBytes) => decide(current === null ? null : data(current), keys, dataBytes),
			),
		);
		return data(result);
	}

	async openRuntime(
		source: PluginPackageSource,
		host: (input: PluginRpcInput) => Promise<PluginRpcResult>,
	): Promise<PluginRuntimeInstance> {
		const entry = source.manifest.backendEntry;
		if (entry === null) {
			throw new AgentFailure('not_found');
		}
		let instance;
		try {
			instance = await this.runtime.open({
				appId: source.installation.appId,
				definitionId: source.installation.definitionId,
				version: source.installation.version,
				revision: source.installation.revision,
				entry,
				files: source.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),

				host: async (request) => {
					let input: PluginRpcInput;
					if (request.method === 'host.appInfo') {
						input = { method: request.method };
					} else if (request.method === 'intents.create') {
						const value = request.input;
						input = {
							method: request.method,
							input: {
								operationId: value.operationId,
								receiverAppId: value.receiverAppId,
								intentId: value.intentId,
								inputJson: value.inputJson,
								artifactIds: value.artifactIds.map((id) => id),
								confirmed: value.confirmed,
							},
						};
					} else if (request.method === 'intents.listReceived') {
						input = { method: request.method, limit: request.limit };
					} else if (request.method === 'intents.revoke') {
						input = { method: request.method, receiptId: request.receiptId };
					} else if (request.method === 'intents.artifacts.get') {
						input = {
							method: request.method,
							receiptId: request.receiptId,
							artifactId: request.artifactId,
						};
					} else if (request.method === 'intents.artifacts.readRange') {
						input = {
							method: request.method,
							receiptId: request.receiptId,
							artifactId: request.artifactId,
							start: request.start,
							endInclusive: request.endInclusive,
						};
					} else if (request.method === 'storage.get') {
						input = { method: request.method, key: request.key };
					} else if (request.method === 'storage.delete') {
						input = {
							method: request.method,
							key: request.key,
							expectedVersion: request.expectedVersion,
							operationId: request.operationId,
						};
					} else {
						input = {
							method: request.method,
							key: request.key,
							expectedVersion: request.expectedVersion,
							operationId: request.operationId,
							valueJson: request.valueJson,
						};
					}
					try {
						const result = await host(input);
						if (result.method === 'intents.create') {
							return { ok: true, method: result.method, value: intentToStorage(result.value) };
						}
						if (result.method === 'intents.listReceived') {
							return { ok: true, method: result.method, value: result.value.map(intentToStorage) };
						}
						if (result.method === 'intents.revoke') {
							return { ok: true, method: result.method, value: { revoked: true } };
						}
						if (result.method === 'intents.artifacts.get') {
							return { ok: true, method: result.method, value: artifactToStorage(result.value) };
						}
						if (result.method === 'intents.artifacts.readRange') {
							const value = result.value;
							return {
								ok: true,
								method: result.method,
								value: {
									receiptId: value.receiptId,
									artifactId: value.artifactId,
									start: value.start,
									endInclusive: value.endInclusive,
									bytes: value.bytes.slice(),
								},
							};
						}
						if (result.method === 'host.appInfo') {
							return { ok: true, method: result.method, value: toInstallation(result.value) };
						}
						if (result.method === 'storage.get') {
							return {
								ok: true,
								method: result.method,
								value: result.value === null ? null : toData(result.value),
							};
						}
						return { ok: true, method: result.method, value: toData(result.value) };
					} catch (error) {
						if (error instanceof AgentFailure) {
							const reply: PluginRuntimeReply = { ok: false, code: error.code };
							return reply;
						}
						throw error;
					}
				},
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

			activate: () => call(() => owned.activate()),

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

	async install(
		actor: PluginActor,
		stageId: string,
		version: number,
		appId: string,
		admit: (
			identity: number | null,
			stage: PluginStage,
			publisher: PluginPublisher | null,
			current: PluginInstallation | null,
		) => void,
	): Promise<PluginInstallation> {
		return installation(
			await storage(() =>
				this.storage.install(
					actor.userId,
					this.tokens.digest(actor.token),
					stageId,
					version,
					appId,
					Date.now(),
					(userId, row, key, current) =>
						admit(
							userId,
							stage(row),
							key === null ? null : publisher(key),
							current === null ? null : installation(current),
						),
				),
			),
		);
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
				manifest: manifest(decoded.manifest),
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
		validateSkills(fromPluginSkillFiles(decoded.files), decoded.manifest.version);
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
							manifest: toManifest(manifest(decoded.manifest)),
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

function toData(value: PluginData): StoredPluginData {
	return { key: value.key, version: value.version, valueJson: value.valueJson, updatedAt: value.updatedAt };
}

function toInstallation(value: PluginInstallation): StoredPluginInstallation {
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
	if (error instanceof ModuleRuntimeFailure) {
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
): PluginSkillDocument[] {
	const selected = files.filter((file) => file.path.startsWith('skills/'));
	if (selected.length > MAX_PLUGIN_SKILL_DOCUMENTS) {
		throw new AgentFailure('limit_exceeded');
	}
	return selected.map((file) => {
		if (file.bytes.byteLength > MAX_PLUGIN_SKILL_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
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
