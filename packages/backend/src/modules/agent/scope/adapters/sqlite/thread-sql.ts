import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { AGENT_RUN_STATUSES } from '@nexus-terminal/shared/agent/runs/values';
import type { ThreadRecord } from '../../storage/scope-storage.js';
import type {
	ThreadStorage,
	StoredThreadAccess,
	StoredThreadAccessFacts,
	StoredThreadMutation,
	StoredThreadRemoval,
	StoredThreadRemovalFacts,
	StoredThreadRemovalDecision,
} from '../../storage/thread-storage.js';
import { ThreadStorageRefusal } from '../../storage/thread-storage.js';
import { threadRow } from './thread-row.js';
import { readApp } from './app-row.js';

export class SqliteThreadStorage implements ThreadStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	private authorize: ((tx: SqlExecutor, access: StoredThreadAccess) => Promise<StoredThreadAccessFacts>) | null =
		null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity !== null) {
			throw new Error('Thread identity reader already installed');
		}
		this.readIdentity = read;
	}

	private async sessionAuthority(tx: SqlExecutor, access: StoredThreadAccess): Promise<StoredThreadAccessFacts> {
		if (this.readIdentity === null) {
			throw new Error('Thread identity reader unavailable');
		}
		const identityUserId = await this.readIdentity(tx, access.digest);
		const row = await tx.one('SELECT * FROM agent_apps WHERE user_id=? AND id=?', [access.userId, access.appId]);
		const app = row === null ? null : await readApp(tx, row);
		return {
			kind: 'session',
			identityUserId,
			app:
				app === null ? null : { version: app.version, enabled: app.enabled, declared: app.definitionInstalled },
		};
	}

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
		if (access.kind === 'session') {
			admit(await this.sessionAuthority(tx, access));
			return;
		}
		if (!this.authorize) {
			throw new Error('Thread authority unavailable');
		}
		admit(await this.authorize(tx, access));
	}

	withAdmission<T>(
		access: StoredThreadAccess,
		admit: (facts: StoredThreadAccessFacts) => void,
		work: () => Promise<T>,
	): Promise<T> {
		return this.db.withTransactionAdmission(
			(tx) => this.check(tx, access, admit),
			async () => {
				await this.db.transaction(async () => undefined);
				const value = await work();
				await this.db.transaction(async () => undefined);
				return value;
			},
		);
	}

	async forRun(userId: number, appId: string, runId: string): Promise<ThreadRecord | null> {
		const row = await this.db.one(
			`SELECT t.* FROM agent_threads t JOIN agent_runs r ON r.thread_id=t.id AND r.user_id=t.user_id AND r.app_id=t.app_id WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
			[runId, userId, appId],
		);
		return row === null ? null : threadRow(row);
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
		admitCapacity: (threads: number) => void,
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
			const counts = await tx.one('SELECT COUNT(*) AS threads FROM agent_threads WHERE user_id=? AND app_id=?', [
				access.userId,
				access.appId,
			]);
			if (
				!counts ||
				typeof counts.threads !== 'number' ||
				!Number.isSafeInteger(counts.threads) ||
				counts.threads < 0
			) {
				throw new Error('Corrupt thread capacity');
			}
			admitCapacity(counts.threads);
			const threadId = input.kind === 'create' ? input.operationId : input.threadId;
			if (input.kind === 'create') {
				const existing = await tx.one('SELECT id FROM agent_threads WHERE id=?', [threadId]);
				if (existing) {
					throw new ThreadStorageRefusal('idempotency_conflict');
				}
				await tx.run(
					'INSERT INTO agent_threads(id,user_id,app_id,title,title_origin,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)',
					[
						threadId,
						access.userId,
						access.appId,
						input.title,
						input.autoTitle ? 'pending' : 'manual',
						input.now,
						input.now,
					],
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
				if (input.expectedVersion >= Number.MAX_SAFE_INTEGER) {
					throw new ThreadStorageRefusal('version_conflict');
				}
				const changed = await tx.run(
					"UPDATE agent_threads SET title=?,title_origin='manual',version=version+1,updated_at=? WHERE user_id=? AND app_id=? AND id=? AND version=?",
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

	remove(
		access: StoredThreadAccess,
		input: StoredThreadRemoval,
		admit: (facts: StoredThreadAccessFacts) => void,
		admitRemoval: (facts: StoredThreadRemovalFacts) => StoredThreadRemovalDecision,
	): Promise<ThreadRecord> {
		return this.db.transaction(async (tx) => {
			await this.check(tx, access, admit);
			const row = await tx.one('SELECT * FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
				access.userId,
				access.appId,
				input.threadId,
			]);
			if (!row) {
				throw new ThreadStorageRefusal('not_found');
			}
			const value = threadRow(row);
			if (value.version !== input.expectedVersion) {
				throw new ThreadStorageRefusal('version_conflict');
			}
			const runScope = 'SELECT id FROM agent_runs WHERE user_id=? AND app_id=? AND thread_id=?';
			const runParams = [access.userId, access.appId, input.threadId];
			const statuses = await tx.all(
				'SELECT DISTINCT status FROM agent_runs WHERE user_id=? AND app_id=? AND thread_id=?',
				runParams,
			);
			const runStatuses = statuses.map((row) => {
				const status = AGENT_RUN_STATUSES.find((value) => value === row.status);
				if (status === undefined) {
					throw new Error('Corrupt Run status');
				}
				return status;
			});
			const memories = await tx.one(
				`SELECT MAX(version) AS max_version FROM agent_memories
				 WHERE user_id=? AND app_id=? AND source_run_id IN (${runScope})`,
				[access.userId, access.appId, ...runParams],
			);
			if (
				memories === null ||
				(memories.max_version !== null &&
					(typeof memories.max_version !== 'number' ||
						!Number.isSafeInteger(memories.max_version) ||
						memories.max_version < 1))
			) {
				throw new Error('Corrupt memory version');
			}
			const decision = admitRemoval({ runStatuses, maxMemoryVersion: memories.max_version });
			await tx.run(
				`UPDATE agent_memories SET source_run_id=NULL,version=version+1,updated_at=MAX(updated_at,?)
				 WHERE user_id=? AND app_id=? AND source_run_id IN (${runScope})`,
				[decision.updatedAt, access.userId, access.appId, ...runParams],
			);
			await tx.run(
				`DELETE FROM agent_artifact_attachments WHERE user_id=? AND target_app_id=?
				 AND (thread_id=? OR run_id IN (${runScope}))`,
				[access.userId, access.appId, input.threadId, ...runParams],
			);
			const toolScope = `SELECT id FROM agent_run_tools WHERE run_id IN (${runScope})`;
			await tx.run(
				`DELETE FROM agent_run_children WHERE run_id IN (${runScope}) OR parent_id IN (${runScope}) OR operation_id IN (${toolScope})`,
				[...runParams, ...runParams, ...runParams],
			);
			await tx.run(`DELETE FROM agent_run_facts WHERE root_id IN (${runScope}) OR author_id IN (${runScope})`, [
				...runParams,
				...runParams,
			]);
			await tx.run(
				`DELETE FROM agent_run_mailbox WHERE root_id IN (${runScope}) OR recipient_id IN (${runScope}) OR sender_id IN (${runScope}) OR message_id IN (${toolScope})`,
				[...runParams, ...runParams, ...runParams, ...runParams],
			);
			await tx.run(
				`DELETE FROM agent_run_budget_reservations WHERE root_id IN (${runScope}) OR run_id IN (${runScope})`,
				[...runParams, ...runParams],
			);
			await tx.run('DELETE FROM agent_runs WHERE user_id=? AND app_id=? AND thread_id=?', runParams);
			await tx.run('DELETE FROM agent_thread_commands WHERE user_id=? AND app_id=? AND thread_id=?', [
				access.userId,
				access.appId,
				input.threadId,
			]);
			const deleted = await tx.run(
				'DELETE FROM agent_threads WHERE user_id=? AND app_id=? AND id=? AND version=?',
				[access.userId, access.appId, input.threadId, input.expectedVersion],
			);
			if (deleted.changes !== 1) {
				throw new Error('Lost thread delete CAS');
			}
			await this.check(tx, access, admit);
			return value;
		});
	}
}
