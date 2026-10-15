import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ThreadRecord } from '../../storage/scope-storage.js';
import type {
	ThreadStorage,
	StoredThreadAccess,
	StoredThreadAccessFacts,
	StoredThreadMutation,
} from '../../storage/thread-storage.js';
import { ThreadStorageRefusal } from '../../storage/thread-storage.js';
import { threadRow } from './thread-row.js';

export class SqliteThreadStorage implements ThreadStorage {
	private authorize: ((tx: SqlExecutor, access: StoredThreadAccess) => Promise<StoredThreadAccessFacts>) | null =
		null;

	constructor(private readonly db: SqliteRuntime) {}

	installAuthorityReader(
		read: (tx: SqlExecutor, access: StoredThreadAccess) => Promise<StoredThreadAccessFacts>,
	): void {
		if (this.authorize) {
			throw new Error('Thread authority already installed');
		}
		this.authorize = read;
	}

	private async check(
		tx: SqlExecutor,
		access: StoredThreadAccess,
		admit: (facts: StoredThreadAccessFacts) => void,
	): Promise<void> {
		if (!this.authorize) {
			throw new Error('Thread authority unavailable');
		}
		admit(await this.authorize(tx, access));
	}

	list(
		access: StoredThreadAccess,
		after: string | null,
		limit: number,
		admit: (facts: StoredThreadAccessFacts) => void,
	): Promise<ThreadRecord[]> {
		return this.db.transaction(async (tx) => {
			await this.check(tx, access, admit);
			const rows = await tx.all(
				'SELECT * FROM agent_threads WHERE user_id=? AND app_id=? AND id>? ORDER BY id LIMIT ?',
				[access.userId, access.appId, after ?? '', limit],
			);
			const values = rows.map(threadRow);
			await this.check(tx, access, admit);
			return values;
		});
	}

	mutate(
		access: StoredThreadAccess,
		input: StoredThreadMutation,
		admit: (facts: StoredThreadAccessFacts) => void,
		admitCapacity: (threads: number, commands: number) => void,
	): Promise<ThreadRecord> {
		return this.db.transaction(async (tx) => {
			await this.check(tx, access, admit);
			const replay = await tx.one(
				'SELECT * FROM agent_thread_commands WHERE user_id=? AND app_id=? AND operation_id=?',
				[access.userId, access.appId, input.operationId],
			);
			if (replay) {
				if (replay.request_hash !== input.requestHash) {
					throw new ThreadStorageRefusal('idempotency_conflict');
				}
				const result = threadRow({
					id: replay.thread_id,
					user_id: replay.user_id,
					app_id: replay.app_id,
					title: replay.result_title,
					version: replay.result_version,
					created_at: replay.result_created_at,
					updated_at: replay.result_updated_at,
				});
				await this.check(tx, access, admit);
				return result;
			}
			const counts = await tx.one(
				'SELECT (SELECT COUNT(*) FROM agent_threads WHERE user_id=? AND app_id=?) AS threads,(SELECT COUNT(*) FROM agent_thread_commands WHERE user_id=? AND app_id=?) AS commands',
				[access.userId, access.appId, access.userId, access.appId],
			);
			if (
				!counts ||
				typeof counts.threads !== 'number' ||
				typeof counts.commands !== 'number' ||
				!Number.isSafeInteger(counts.threads) ||
				!Number.isSafeInteger(counts.commands) ||
				counts.threads < 0 ||
				counts.commands < 0
			) {
				throw new Error('Corrupt thread capacity');
			}
			admitCapacity(counts.threads, counts.commands);
			const threadId = input.kind === 'create' ? input.operationId : input.threadId;
			if (input.kind === 'create') {
				const existing = await tx.one('SELECT id FROM agent_threads WHERE id=?', [threadId]);
				if (existing) {
					throw new ThreadStorageRefusal('idempotency_conflict');
				}
				await tx.run(
					'INSERT INTO agent_threads(id,user_id,app_id,title,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',
					[threadId, access.userId, access.appId, input.title, input.now, input.now],
				);
			} else {
				const row = await tx.one('SELECT * FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
					access.userId,
					access.appId,
					threadId,
				]);
				if (!row) {
					throw new ThreadStorageRefusal('not_found');
				}
				if (threadRow(row).version !== input.expectedVersion) {
					throw new ThreadStorageRefusal('version_conflict');
				}
				const changed = await tx.run(
					'UPDATE agent_threads SET title=?,version=version+1,updated_at=? WHERE user_id=? AND app_id=? AND id=? AND version=?',
					[input.title, input.now, access.userId, access.appId, threadId, input.expectedVersion],
				);
				if (changed.changes !== 1) {
					throw new Error('Lost thread CAS');
				}
			}
			const row = await tx.one('SELECT * FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
				access.userId,
				access.appId,
				threadId,
			]);
			if (!row) {
				throw new Error('Thread disappeared during mutation');
			}
			const value = threadRow(row);
			await tx.run(
				'INSERT INTO agent_thread_commands(user_id,app_id,operation_id,request_hash,thread_id,result_title,result_version,result_created_at,result_updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
				[
					access.userId,
					access.appId,
					input.operationId,
					input.requestHash,
					value.id,
					value.title,
					value.version,
					value.createdAt,
					value.updatedAt,
				],
			);
			await this.check(tx, access, admit);
			return value;
		});
	}
}
