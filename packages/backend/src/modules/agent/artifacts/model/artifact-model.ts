import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { BlobStore } from '../../../../platform/blobs/blob-store.js';
import { BlobFailure } from '../../../../platform/blobs/blob-store.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure, ToolExecutionUnknown, ToolCleanupFailure } from '../../agent-failure.js';
import type {
	ArtifactStorage,
	StoredArtifactScope,
	StoredArtifact,
	StoredArtifactAuthorization,
	StoredArtifactFacts,
} from '../storage/artifact-storage.js';
import { ArtifactStorageRefusal } from '../storage/artifact-storage.js';
import type {
	ArtifactActor,
	ArtifactScope,
	ArtifactRecord,
	ArtifactFacts,
	ArtifactBegin,
	ArtifactQuery,
	ArtifactAttachment,
	ArtifactWriteFacts,
	ArtifactReadRange,
	ArtifactCleanupPlan,
	ArtifactStorageTotals,
} from './artifact-types.js';

export function artifactFromStorage(row: StoredArtifact): ArtifactRecord {
	return {
		id: row.id,
		appId: row.appId,
		name: row.name,
		mediaType: row.mediaType,
		kind: row.kind,
		sizeBytes: row.sizeBytes,
		sha256: row.sha256,
		status: row.status,
		retained: row.retained,
		version: row.version,
		createdAt: row.createdAt,
		readyAt: row.readyAt,
		expiresAt: row.expiresAt,
		deletedAt: row.deletedAt,
	};
}

export function artifactToStorage(value: ArtifactRecord): StoredArtifact {
	return {
		id: value.id,
		appId: value.appId,
		name: value.name,
		mediaType: value.mediaType,
		kind: value.kind,
		sizeBytes: value.sizeBytes,
		sha256: value.sha256,
		status: value.status,
		retained: value.retained,
		version: value.version,
		createdAt: value.createdAt,
		readyAt: value.readyAt,
		expiresAt: value.expiresAt,
		deletedAt: value.deletedAt,
	};
}

function facts(value: StoredArtifactFacts): ArtifactFacts {
	return {
		settingsVersion: value.settingsVersion,
		identityUserId: value.identityUserId,
		appExists: value.appExists,
		appEnabled: value.appEnabled,
		totalBytes: value.totalBytes,
		totalCount: value.totalCount,
	};
}

function scope(value: ArtifactScope): StoredArtifactScope {
	return { userId: value.userId, appId: value.appId };
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof ArtifactStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

function blobFailure(error: unknown): AgentFailure {
	if (error instanceof BlobFailure) {
		if (error.kind === 'aborted') {
			return new AgentFailure('provider_unavailable', { cause: error });
		}
		if (error.kind === 'cleanup_failed') {
			return new ToolCleanupFailure({ cause: error });
		}
		return error.kind === 'io_unknown'
			? new ToolExecutionUnknown({ cause: error })
			: new AgentFailure(
					error.kind === 'limit_exceeded'
						? 'limit_exceeded'
						: error.kind === 'conflict'
							? 'version_conflict'
							: error.kind === 'not_found'
								? 'not_found'
								: 'storage_unavailable',
					{ cause: error },
				);
	}
	return new AgentFailure('internal_failure', { cause: error });
}

export class ArtifactModel {
	async recovery(): Promise<{ userId: number; record: ArtifactRecord }[]> {
		return (await storage(() => this.storage.recovery())).map((value) => ({
			userId: value.userId,
			record: artifactFromStorage(value.record),
		}));
	}

	async getAccessible(
		actor: ArtifactActor,
		id: string,
		admit: (value: ArtifactFacts) => void,
		decide: (row: ArtifactRecord, enabled: boolean) => void,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() =>
				this.storage.getAccessible(
					scope(actor),
					this.auth(actor),
					id,
					(value) => admit(facts(value)),
					(row, enabled) => decide(artifactFromStorage(row), enabled),
				),
			),
		);
	}

	constructor(
		private readonly storage: ArtifactStorage,
		private readonly blobs: BlobStore,
		private readonly tokens: SessionTokens,
	) {}

	private auth(actor: ArtifactActor): StoredArtifactAuthorization {
		return actor.kind === 'session'
			? { kind: 'session', digest: this.tokens.digest(actor.token) }
			: { kind: 'tool', runId: actor.runId, operationId: actor.operationId, operationHash: actor.operationHash };
	}

	async freeBytes(): Promise<number> {
		try {
			return await this.blobs.freeBytes();
		} catch (error) {
			throw blobFailure(error);
		}
	}

	async create(
		actor: ArtifactActor,
		id: string,
		input: ArtifactBegin,
		kind: ArtifactRecord['kind'],
		expiresAt: number,
		now: number,
		admit: (value: ArtifactFacts) => void,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() =>
				this.storage.create(
					scope(actor),
					this.auth(actor),
					{
						id,
						name: input.name,
						mediaType: input.mediaType,
						kind,
						sizeBytes: input.declaredBytes,
						expiresAt,
						now,
					},
					(value) => admit(facts(value)),
				),
			),
		);
	}

	async get(owner: ArtifactScope, id: string): Promise<ArtifactRecord | null> {
		const value = await storage(() => this.storage.get(scope(owner), id));
		return value === null ? null : artifactFromStorage(value);
	}

	async list(userId: number, query: ArtifactQuery): Promise<ArtifactRecord[]> {
		return (
			await storage(() =>
				this.storage.list(userId, {
					appId: query.appId,
					retained: query.retained,
					kind: query.kind,
					q: query.q,
					offset: query.offset,
					limit: query.limit,
				}),
			)
		).map(artifactFromStorage);
	}

	async summary(userId: number, now: number, limitBytes: number): Promise<ArtifactStorageTotals> {
		const value = await storage(() => this.storage.summary(userId, now));
		return {
			totalBytes: value.totalBytes,
			retainedBytes: value.retainedBytes,
			protectedBytes: value.protectedBytes,
			reclaimableBytes: value.reclaimableBytes,
			stagingBytes: value.stagingBytes,
			unavailableBytes: value.unavailableBytes,
			reservedBytes: value.reservedBytes,
			limitBytes,
		};
	}

	async mutate(
		actor: ArtifactActor,
		id: string,
		version: number,
		clock: () => number,
		kind: 'upload' | 'retain' | 'delete',
		retained: boolean | null,
		admit: (value: ArtifactFacts) => void,
		decide: (row: ArtifactRecord, references: number, now: number) => void,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() =>
				this.storage.mutate(
					scope(actor),
					this.auth(actor),
					id,
					version,
					clock,
					{ kind, retained },
					(value) => admit(facts(value)),
					(row, references, now) => decide(artifactFromStorage(row), references, now),
				),
			),
		);
	}

	async settle(
		owner: ArtifactScope,
		id: string,
		version: number,
		status: 'ready' | 'deleted' | 'unavailable',
		sha256: string | null,
		now: number,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() => this.storage.settle(scope(owner), id, version, status, sha256, now)),
		);
	}

	async write(
		id: string,
		source: AsyncIterable<Uint8Array>,
		bytes: number,
		signal: AbortSignal,
	): Promise<ArtifactWriteFacts> {
		try {
			const value = await this.blobs.write(id, source, bytes, signal);
			return { bytes: value.bytes, sha256: value.sha256 };
		} catch (error) {
			throw blobFailure(error);
		}
	}

	async *read(id: string, range: ArtifactReadRange, signal: AbortSignal): AsyncIterable<Uint8Array> {
		try {
			for await (const bytes of this.blobs.read(
				id,
				{ start: range.start, endInclusive: range.endInclusive },
				signal,
			)) {
				yield Uint8Array.from(bytes);
			}
		} catch (error) {
			throw blobFailure(error);
		}
	}

	async remove(id: string): Promise<void> {
		try {
			await this.blobs.remove(id);
		} catch (error) {
			throw blobFailure(error);
		}
	}

	async attach(
		actor: ArtifactActor,
		id: string,
		input: ArtifactAttachment,
		clock: () => number,
		admit: (value: ArtifactFacts) => void,
		decide: (row: ArtifactRecord, enabled: boolean, now: number) => void,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() =>
				this.storage.attach(
					scope(actor),
					this.auth(actor),
					id,
					input.expectedVersion,
					{ targetAppId: input.targetAppId, threadId: input.threadId, runId: input.runId },
					clock,
					(value) => admit(facts(value)),
					(row, enabled, now) => decide(artifactFromStorage(row), enabled, now),
				),
			),
		);
	}

	async detach(
		actor: ArtifactActor,
		id: string,
		version: number,
		threadId: string,
		now: number,
		admit: (value: ArtifactFacts) => void,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() =>
				this.storage.detach(scope(actor), this.auth(actor), id, version, threadId, now, (value) =>
					admit(facts(value)),
				),
			),
		);
	}

	async previewCleanup(
		actor: ArtifactActor,
		id: string,
		ttlMs: number,
		clock: () => number,
		admit: (identity: number | null, confirmations: number) => void,
		limit: number,
	): Promise<ArtifactCleanupPlan> {
		const value = await storage(() =>
			this.storage.previewCleanup(
				actor.userId,
				this.auth(actor),
				id,
				ttlMs,
				clock,
				(identity, confirmations) => admit(identity, confirmations),
				limit,
			),
		);
		return {
			id: value.id,
			expiresAt: value.expiresAt,
			items: value.items.map(artifactFromStorage),
			protectedCount: value.protectedCount,
		};
	}

	async claimCleanup(
		actor: ArtifactActor,
		id: string,
		clock: () => number,
		admit: (identity: number | null) => void,
		decide: (row: ArtifactRecord, references: number, now: number) => void,
	): Promise<ArtifactRecord[]> {
		return (
			await storage(() =>
				this.storage.claimCleanup(actor.userId, this.auth(actor), id, clock, admit, (row, references, now) =>
					decide(artifactFromStorage(row), references, now),
				),
			)
		).map(artifactFromStorage);
	}
}
