import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { AgentMemoryStatus } from '@nexus-terminal/shared/agent/memory/values';
import type {
	StoredMemoryScope,
	StoredMemoryAuthorization,
	StoredMemoryCreation,
	StoredMemoryFacts,
	StoredMemoryReviewTask,
	StoredMemoryImport,
	StoredMemoryImportCreation,
	StoredMemoryImportFacts,
	MemoryStorage,
	StoredMemory,
} from '../../storage/memory-storage.js';
import { MemoryStorageRefusal } from '../../storage/memory-storage.js';
import { memoryRow, memoryImportRow, memoryInteger } from './memory-row.js';
import { currentParticipant } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { toolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';

async function getMemory(tx: SqlExecutor, scope: StoredMemoryScope, id: string): Promise<StoredMemory | null> {
	const row = await tx.one('SELECT * FROM agent_memories WHERE user_id=? AND app_id=? AND id=?', [
		scope.userId,
		scope.appId,
		id,
	]);
	return row === null ? null : memoryRow(row);
}

async function insertMemory(
	tx: SqlExecutor,
	scope: StoredMemoryScope,
	input: StoredMemoryCreation,
	now: number,
): Promise<StoredMemory> {
	await tx.run(
		`INSERT INTO agent_memories(id,user_id,app_id,content,confidence,status,source_run_id,expires_at,review_action,reviewed_at,version,created_at,updated_at) VALUES(?,?,?,?,?,'candidate',?,?,NULL,NULL,1,?,?)`,
		[
			input.id,
			scope.userId,
			scope.appId,
			input.content,
			input.confidence,
			input.sourceRunId,
			input.expiresAt,
			now,
			now,
		],
	);
	const saved = await getMemory(tx, scope, input.id);
	if (!saved) {
		throw new Error('Created memory missing');
	}
	return saved;
}

export class SqliteMemoryStorage implements MemoryStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity !== null) {
			throw new Error('Memory identity reader already installed');
		}
		this.readIdentity = read;
	}

	private async facts(
		tx: SqlExecutor,
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		sourceId: string | null,
	): Promise<StoredMemoryFacts> {
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE id=? AND user_id=?', [
			scope.appId,
			scope.userId,
		]);
		let identityUserId: number | null;
		if (auth.kind === 'session') {
			if (this.readIdentity === null) {
				throw new Error('Memory identity reader unavailable');
			}
			identityUserId = await this.readIdentity(tx, auth.digest);
		} else {
			const operation = await toolOperation(tx, scope.userId, scope.appId, auth.runId, auth.operationId);
			// All authority revocations fence the Run in the same transaction. A dispatched
			// operation cannot outlive that fence or substitute another operation identity.
			const current =
				operation !== null &&
				operation.state === 'dispatched' &&
				operation.operationHash === auth.operationHash &&
				(await currentParticipant(
					tx,
					{ userId: scope.userId, appId: scope.appId, runId: auth.runId },
					Date.now,
					operation.toolName,
					operation.modelStepIndex,
				));
			identityUserId = current ? scope.userId : null;
		}
		const count = await tx.one('SELECT COUNT(*) AS count FROM agent_memories WHERE user_id=? AND app_id=?', [
			scope.userId,
			scope.appId,
		]);
		if (!count) {
			throw new Error('Memory count missing');
		}
		const sourceExists =
			sourceId === null ||
			(await tx.one('SELECT id FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				sourceId,
				scope.userId,
				scope.appId,
			])) !== null;
		return {
			appExists: app !== null,
			enabled: app?.enabled === 1,
			identityUserId,
			sourceExists,
			count: memoryInteger(count.count),
			now: Date.now(),
		};
	}

	list(
		scope: StoredMemoryScope,
		status: AgentMemoryStatus | 'all',
		offset: number,
		limit: number,
		threadId: string | null,
	): Promise<StoredMemory[]> {
		return this.db.transaction(async (tx) => {
			const app = await tx.one('SELECT id FROM agent_apps WHERE id=? AND user_id=?', [scope.appId, scope.userId]);
			if (!app) {
				throw new MemoryStorageRefusal('not_found');
			}
			if (
				threadId !== null &&
				!(await tx.one('SELECT id FROM agent_threads WHERE id=? AND user_id=? AND app_id=?', [
					threadId,
					scope.userId,
					scope.appId,
				]))
			) {
				throw new MemoryStorageRefusal('not_found');
			}
			return (
				await tx.all(
					`SELECT m.* FROM agent_memories m
					 WHERE m.user_id=? AND m.app_id=? AND (?='all' OR m.status=?)
					 AND (? IS NULL OR EXISTS (
						 SELECT 1 FROM agent_runs r WHERE r.id=m.source_run_id
						 AND r.user_id=m.user_id AND r.app_id=m.app_id AND r.thread_id=?
					 )) ORDER BY m.created_at DESC,m.id LIMIT ? OFFSET ?`,
					[scope.userId, scope.appId, status, status, threadId, threadId, limit, offset],
				)
			).map(memoryRow);
		});
	}

	get(scope: StoredMemoryScope, id: string): Promise<StoredMemory | null> {
		return this.db.transaction((tx) => getMemory(tx, scope, id));
	}

	create(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		input: StoredMemoryCreation,
		admit: (facts: StoredMemoryFacts) => void,
	): Promise<StoredMemory> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, scope, auth, input.sourceRunId);
			admit(facts);
			return insertMemory(tx, scope, input, facts.now);
		});
	}

	review(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		id: string,
		version: number,
		clock: () => number,
		admit: (facts: StoredMemoryFacts) => void,
		decide: (memory: StoredMemory, now: number) => StoredMemoryReviewTask,
	): Promise<StoredMemory> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth, null));
			const memory = await getMemory(tx, scope, id);
			if (!memory) {
				throw new MemoryStorageRefusal('not_found');
			}
			if (memory.version !== version || memory.version === Number.MAX_SAFE_INTEGER) {
				throw new MemoryStorageRefusal('version_conflict');
			}
			const now = clock();
			const task = decide(memory, now);
			const saved = await tx.run(
				'UPDATE agent_memories SET content=?,status=?,review_action=?,reviewed_at=?,version=version+1,updated_at=? WHERE id=? AND version=?',
				[task.content, task.status, task.decision, now, now, id, version],
			);
			if (saved.changes !== 1) {
				throw new Error('Lost memory review CAS');
			}
			const result = await getMemory(tx, scope, id);
			if (!result) {
				throw new Error('Reviewed memory missing');
			}
			return result;
		});
	}

	previewImport(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		input: StoredMemoryImportCreation,
		clock: () => number,
		admit: (facts: StoredMemoryFacts) => void,
		admitSource: (facts: StoredMemoryImportFacts, confirmations: number, now: number) => void,
	): Promise<StoredMemoryImport> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth, null));
			await tx.run('DELETE FROM agent_memory_imports WHERE expires_at<=?', [clock()]);
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_memory_imports WHERE user_id=?', [
				scope.userId,
			]);
			if (!count) {
				throw new Error('Memory confirmation count missing');
			}
			const source = await getMemory(
				tx,
				{ userId: scope.userId, appId: input.sourceAppId },
				input.sourceMemoryId,
			);
			const sourceApp = await tx.one('SELECT enabled FROM agent_apps WHERE id=? AND user_id=?', [
				input.sourceAppId,
				scope.userId,
			]);
			if (!source) {
				throw new MemoryStorageRefusal('not_found');
			}
			const now = clock();
			admitSource({ source, sourceEnabled: sourceApp?.enabled === 1 }, memoryInteger(count.count), now);
			const expiresAt = now + input.ttlMs;
			await tx.run(
				'INSERT INTO agent_memory_imports(id,user_id,app_id,memory_id,source_app_id,source_memory_id,source_version,expires_at) VALUES(?,?,?,?,?,?,?,?)',
				[
					input.id,
					scope.userId,
					scope.appId,
					input.memoryId,
					input.sourceAppId,
					input.sourceMemoryId,
					source.version,
					expiresAt,
				],
			);
			return {
				id: input.id,
				memoryId: input.memoryId,
				sourceAppId: input.sourceAppId,
				sourceMemoryId: input.sourceMemoryId,
				sourceVersion: source.version,
				expiresAt,
			};
		});
	}

	confirmImport(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		id: string,
		clock: () => number,
		admit: (facts: StoredMemoryFacts) => void,
		admitSource: (facts: StoredMemoryImportFacts, now: number) => void,
	): Promise<StoredMemory> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth, null));
			const row = await tx.one('SELECT * FROM agent_memory_imports WHERE id=? AND user_id=? AND app_id=?', [
				id,
				scope.userId,
				scope.appId,
			]);
			if (!row) {
				throw new MemoryStorageRefusal('not_found');
			}
			const confirmation = memoryImportRow(row);
			const source = await getMemory(
				tx,
				{ userId: scope.userId, appId: confirmation.sourceAppId },
				confirmation.sourceMemoryId,
			);
			const sourceApp = await tx.one('SELECT enabled FROM agent_apps WHERE id=? AND user_id=?', [
				confirmation.sourceAppId,
				scope.userId,
			]);
			if (!source || source.version !== confirmation.sourceVersion) {
				throw new MemoryStorageRefusal('version_conflict');
			}
			const now = clock();
			if (confirmation.expiresAt <= now || row.consumed_at !== null) {
				throw new MemoryStorageRefusal('version_conflict');
			}
			admitSource({ source, sourceEnabled: sourceApp?.enabled === 1 }, now);
			const consumed = await tx.run(
				'UPDATE agent_memory_imports SET consumed_at=? WHERE id=? AND consumed_at IS NULL',
				[now, id],
			);
			if (consumed.changes !== 1) {
				throw new Error('Lost memory import CAS');
			}
			return insertMemory(
				tx,
				scope,
				{
					id: confirmation.memoryId,
					content: source.content,
					confidence: source.confidence,
					expiresAt: source.expiresAt,
					sourceRunId: null,
				},
				now,
			);
		});
	}

	recall(
		scope: StoredMemoryScope,
		auth: StoredMemoryAuthorization,
		clock: () => number,
		limit: number,
		admit: (facts: StoredMemoryFacts) => void,
	): Promise<StoredMemory[]> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth, null));
			return (
				await tx.all(
					"SELECT * FROM agent_memories WHERE user_id=? AND app_id=? AND status='published' AND (expires_at IS NULL OR expires_at>?) ORDER BY reviewed_at DESC,id LIMIT ?",
					[scope.userId, scope.appId, clock(), limit],
				)
			).map(memoryRow);
		});
	}
}
