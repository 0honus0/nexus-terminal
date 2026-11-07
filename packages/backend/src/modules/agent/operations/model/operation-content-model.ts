import { randomUUID } from 'node:crypto';
import { AgentFailure } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { OperationContentRefusal } from '../storage/operation-content-storage.js';
import type {
	OperationContentStorage,
	StoredContentScope,
	StoredContentWriteScope,
	StoredContentDraft,
} from '../storage/operation-content-storage.js';
import type {
	OperationContentScope,
	OperationContentWriteScope,
	OperationContentDraft,
	OperationContentChunk,
} from './operation-content-types.js';

function scope(value: OperationContentScope): StoredContentScope {
	return { userId: value.userId, appId: value.appId, runId: value.runId };
}

function writeScope(value: OperationContentWriteScope): StoredContentWriteScope {
	return {
		userId: value.userId,
		appId: value.appId,
		runId: value.runId,
		executionGeneration: value.executionGeneration,
		operationId: value.operationId,
	};
}

function draft(value: StoredContentDraft): OperationContentDraft {
	return {
		id: value.id,
		runId: value.runId,
		ownerId: value.ownerId,
		key: value.key,
		mediaType: value.mediaType,
		chunks: value.chunks,
		sealed: value.sealed,
		sha256: value.sha256,
		sizeBytes: value.sizeBytes,
	};
}

export class OperationContentModel {
	constructor(private readonly storage: OperationContentStorage) {}

	private work<T>(work: () => Promise<T>): Promise<T> {
		return agentStorage(async () => {
			try {
				return await work();
			} catch (error) {
				if (error instanceof OperationContentRefusal) {
					throw new AgentFailure(error.code, { cause: error });
				}
				throw error;
			}
		});
	}

	async exports(value: OperationContentScope): Promise<{
		kind: 'complete' | 'suspend';
		references: import('./operation-content-types.js').OperationContentReference[];
	} | null> {
		const row = await this.work(() => this.storage.exports(scope(value)));
		return row === null
			? null
			: {
					kind: row.kind,
					references: row.references.map((ref) => ({
						id: ref.id,
						sha256: ref.sha256,
						sizeBytes: ref.sizeBytes,
						mediaType: ref.mediaType,
					})),
				};
	}

	async open(
		value: OperationContentWriteScope,
		ownerId: string,
		key: string,
		mediaType: string,
	): Promise<OperationContentDraft> {
		return draft(
			await this.work(() => this.storage.open(writeScope(value), ownerId, key, mediaType, randomUUID())),
		);
	}

	async get(value: OperationContentScope, id: string): Promise<OperationContentDraft | null> {
		const row = await this.work(() => this.storage.get(scope(value), id));
		return row ? draft(row) : null;
	}

	async readable(
		value: OperationContentScope,
		id: string,
		includeThread: boolean,
	): Promise<OperationContentDraft | null> {
		const row = await this.work(() => this.storage.readable(scope(value), id, includeThread));
		return row === null ? null : draft(row);
	}

	async append(
		value: OperationContentWriteScope,
		ownerId: string,
		id: string,
		chunk: OperationContentChunk,
	): Promise<OperationContentDraft> {
		return draft(
			await this.work(() =>
				this.storage.append(writeScope(value), ownerId, id, {
					index: chunk.index,
					text: chunk.text,
					sha256: chunk.sha256,
					sizeBytes: chunk.sizeBytes,
				}),
			),
		);
	}

	async chunk(value: OperationContentScope, id: string, index: number): Promise<OperationContentChunk | null> {
		const row = await this.work(() => this.storage.chunk(scope(value), id, index));
		return row ? { index: row.index, text: row.text, sha256: row.sha256, sizeBytes: row.sizeBytes } : null;
	}

	async seal(
		value: OperationContentWriteScope,
		ownerId: string,
		id: string,
		chunks: number,
		sha256: string,
	): Promise<OperationContentDraft> {
		return draft(await this.work(() => this.storage.seal(writeScope(value), ownerId, id, chunks, sha256)));
	}
}
