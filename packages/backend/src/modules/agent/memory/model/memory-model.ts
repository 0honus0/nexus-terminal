import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type {
	MemoryStorage,
	StoredMemoryScope,
	StoredMemory,
	StoredMemoryAuthorization,
	StoredMemoryFacts,
} from '../storage/memory-storage.js';
import { MemoryStorageRefusal } from '../storage/memory-storage.js';
import type {
	MemoryScope,
	MemoryActor,
	MemoryRecord,
	MemoryProposal,
	MemoryQuery,
	MemoryAdmissionFacts,
	MemoryReviewTask,
	MemoryImport,
	MemoryImportCreation,
	MemoryImportFacts,
} from './memory-types.js';

function fromStorage(row: StoredMemory): MemoryRecord {
	return {
		id: row.id,
		appId: row.appId,
		content: row.content,
		confidence: row.confidence,
		status: row.status,
		sourceRunId: row.sourceRunId,
		expiresAt: row.expiresAt,
		reviewAction: row.reviewAction,
		reviewedAt: row.reviewedAt,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function fromFacts(value: StoredMemoryFacts): MemoryAdmissionFacts {
	return {
		appExists: value.appExists,
		enabled: value.enabled,
		identityUserId: value.identityUserId,
		sourceExists: value.sourceExists,
		count: value.count,
		now: value.now,
	};
}

async function storage<T>(action: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await action();
		} catch (error) {
			if (error instanceof MemoryStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

function scope(value: MemoryScope): StoredMemoryScope {
	return { userId: value.userId, appId: value.appId };
}

export class MemoryModel {
	constructor(
		private readonly storage: MemoryStorage,
		private readonly tokens: SessionTokens,
	) {}

	private authorization(actor: MemoryActor): StoredMemoryAuthorization {
		return actor.kind === 'session'
			? { kind: 'session', digest: this.tokens.digest(actor.token) }
			: { kind: 'tool', runId: actor.runId, operationId: actor.operationId, operationHash: actor.operationHash };
	}

	async list(owner: MemoryScope, query: MemoryQuery): Promise<MemoryRecord[]> {
		return (await storage(() => this.storage.list(scope(owner), query.status, query.offset, query.limit))).map(
			fromStorage,
		);
	}

	async get(owner: MemoryScope, id: string): Promise<MemoryRecord | null> {
		const row = await storage(() => this.storage.get(scope(owner), id));
		return row === null ? null : fromStorage(row);
	}

	async create(
		actor: MemoryActor,
		id: string,
		input: MemoryProposal,
		admit: (facts: MemoryAdmissionFacts) => void,
	): Promise<MemoryRecord> {
		const saved = await storage(() =>
			this.storage.create(
				scope(actor),
				this.authorization(actor),
				{
					id,
					content: input.content,
					confidence: input.confidence,
					expiresAt: input.expiresAt,
					sourceRunId: input.sourceRunId,
				},
				(facts) => admit(fromFacts(facts)),
			),
		);
		return fromStorage(saved);
	}

	async review(
		actor: MemoryActor,
		id: string,
		version: number,
		clock: () => number,
		admit: (facts: MemoryAdmissionFacts) => void,
		decide: (value: MemoryRecord, now: number) => MemoryReviewTask,
	): Promise<MemoryRecord> {
		const saved = await storage(() =>
			this.storage.review(
				scope(actor),
				this.authorization(actor),
				id,
				version,
				clock,
				(facts) => admit(fromFacts(facts)),
				(row, now) => {
					const task = decide(fromStorage(row), now);
					return { content: task.content, status: task.status, decision: task.decision };
				},
			),
		);
		return fromStorage(saved);
	}

	async previewImport(
		actor: MemoryActor,
		input: MemoryImportCreation,
		clock: () => number,
		admit: (facts: MemoryAdmissionFacts) => void,
		admitSource: (facts: MemoryImportFacts, confirmations: number, now: number) => void,
	): Promise<MemoryImport> {
		const row = await storage(() =>
			this.storage.previewImport(
				scope(actor),
				this.authorization(actor),
				{
					id: input.id,
					memoryId: input.memoryId,
					sourceAppId: input.sourceAppId,
					sourceMemoryId: input.sourceMemoryId,
					ttlMs: input.ttlMs,
				},
				clock,
				(facts) => admit(fromFacts(facts)),
				(facts, confirmations, now) =>
					admitSource(
						{ source: fromStorage(facts.source), sourceEnabled: facts.sourceEnabled },
						confirmations,
						now,
					),
			),
		);
		return {
			id: row.id,
			memoryId: row.memoryId,
			sourceAppId: row.sourceAppId,
			sourceMemoryId: row.sourceMemoryId,
			sourceVersion: row.sourceVersion,
			expiresAt: row.expiresAt,
		};
	}

	async confirmImport(
		actor: MemoryActor,
		id: string,
		clock: () => number,
		admit: (facts: MemoryAdmissionFacts) => void,
		admitSource: (facts: MemoryImportFacts, now: number) => void,
	): Promise<MemoryRecord> {
		return fromStorage(
			await storage(() =>
				this.storage.confirmImport(
					scope(actor),
					this.authorization(actor),
					id,
					clock,
					(facts) => admit(fromFacts(facts)),
					(facts, now) =>
						admitSource(
							{
								source: fromStorage(facts.source),
								sourceEnabled: facts.sourceEnabled,
							},
							now,
						),
				),
			),
		);
	}

	async recall(
		actor: MemoryActor,
		clock: () => number,
		limit: number,
		admit: (facts: MemoryAdmissionFacts) => void,
	): Promise<MemoryRecord[]> {
		return (
			await storage(() =>
				this.storage.recall(scope(actor), this.authorization(actor), clock, limit, (facts) =>
					admit(fromFacts(facts)),
				),
			)
		).map(fromStorage);
	}
}
