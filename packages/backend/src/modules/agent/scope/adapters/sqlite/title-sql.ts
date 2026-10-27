import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	TitleStorage,
	StoredTitleScope,
	StoredTitleClaim,
	StoredTitleCommand,
	TitleBudgetAdmission,
} from '../../storage/title-storage.js';
import type { RunStepPolicyCheck } from '../../../runs/storage/run-step-storage.js';
import type { ProviderStorage } from '../../../providers/storage/provider-storage.js';
import { frozenFromRun } from '../../../runs/adapters/sqlite/run-sql.js';
import { currentParticipant, storedInteger } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { executionUsage, frozenExecution } from '../../../execution/adapters/sqlite/execution-budget-sql.js';

/** A title lease uses its own Thread CAS; streaming deltas may advance the Run version independently. */
export class SqliteTitleStorage implements TitleStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly providers: ProviderStorage,
	) {}

	private async authorized(
		tx: SqlExecutor,
		scope: StoredTitleScope,
		authorize: RunStepPolicyCheck,
	): Promise<boolean> {
		const original = await tx.one(
			`SELECT r.thread_id FROM agent_runs r JOIN agent_command_idempotency i ON i.run_id=r.id
		 WHERE r.id=? AND r.user_id=? AND r.app_id=? AND r.run_kind='root' AND i.user_id=r.user_id AND i.app_id=r.app_id
		 AND i.command_name='create_run' AND i.result_outcome='created' AND i.request_hash=?
		 AND r.thread_sequence=1`,
			[scope.runId, scope.userId, scope.appId, scope.creationHash],
		);
		if (!original || !(await currentParticipant(tx, scope, Date.now))) {
			return false;
		}
		const frozen = await frozenFromRun(tx, scope.userId, scope.appId, scope.runId);
		const provider = frozen === null ? null : await this.providers.snapshot(tx, scope.userId, frozen.providerId);
		return frozen !== null && authorize(frozen, provider);
	}

	private async currentTitle(tx: SqlExecutor, command: StoredTitleCommand): Promise<boolean> {
		return (
			(await tx.one(
				`SELECT t.id FROM agent_threads t JOIN agent_runs r ON r.thread_id=t.id AND r.user_id=t.user_id AND r.app_id=t.app_id
		 WHERE r.id=? AND t.id=? AND t.user_id=? AND t.app_id=? AND t.version=? AND t.title_origin='automatic'`,
				[command.runId, command.claim.threadId, command.userId, command.appId, command.claim.version],
			)) !== null
		);
	}

	claim(scope: StoredTitleScope, fallback: string, authorize: RunStepPolicyCheck): Promise<StoredTitleClaim | null> {
		return this.db.transaction(async (tx) => {
			if (!(await this.authorized(tx, scope, authorize))) {
				return null;
			}
			const row = await tx.one(
				`SELECT t.id,t.version FROM agent_threads t JOIN agent_runs r ON r.thread_id=t.id
			 WHERE r.id=? AND t.user_id=? AND t.app_id=? AND t.title_origin='pending'`,
				[scope.runId, scope.userId, scope.appId],
			);
			if (!row || typeof row.id !== 'string') {
				return null;
			}
			const version = storedInteger(row.version, 1);
			if (version >= Number.MAX_SAFE_INTEGER) {
				return null;
			}
			const changed = await tx.run(
				`UPDATE agent_threads SET title=?,title_origin='automatic',version=version+1,updated_at=MAX(updated_at,?)
			 WHERE id=? AND version=? AND title_origin='pending'`,
				[fallback, Date.now(), row.id, version],
			);
			return changed.changes === 1 ? { threadId: row.id, version: version + 1 } : null;
		});
	}

	reserve(command: StoredTitleCommand, authorize: RunStepPolicyCheck, admit: TitleBudgetAdmission): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await this.authorized(tx, command, authorize)) || !(await this.currentTitle(tx, command))) {
				return false;
			}
			if (await tx.one('SELECT run_id FROM agent_thread_titles WHERE thread_id=?', [command.claim.threadId])) {
				return false;
			}
			admit(await frozenExecution(tx, command.runId), await executionUsage(tx, command.runId, command.userId));
			const now = Date.now();
			await tx.run(
				`INSERT INTO agent_thread_titles(run_id,thread_id,thread_version,state,creation_hash,request_hash,estimated_tokens,created_at,updated_at)
			 VALUES(?,?,?,'reserved',?,?,?,?,?)`,
				[
					command.runId,
					command.claim.threadId,
					command.claim.version,
					command.creationHash,
					command.requestHash,
					command.estimatedTokens,
					now,
					now,
				],
			);
			return true;
		});
	}

	dispatch(
		command: StoredTitleCommand,
		authorize: RunStepPolicyCheck,
		admit: TitleBudgetAdmission,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await this.authorized(tx, command, authorize)) || !(await this.currentTitle(tx, command))) {
				return false;
			}
			admit(await frozenExecution(tx, command.runId), await executionUsage(tx, command.runId, command.userId));
			const updated = await tx.run(
				"UPDATE agent_thread_titles SET state='dispatched',updated_at=? WHERE run_id=? AND state='reserved' AND request_hash=?",
				[Date.now(), command.runId, command.requestHash],
			);
			return updated.changes === 1;
		});
	}

	recordUsage(command: StoredTitleCommand, input: number, output: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const updated = await tx.run(
				"UPDATE agent_thread_titles SET input_tokens=?,output_tokens=?,updated_at=? WHERE run_id=? AND state='dispatched' AND input_tokens IS NULL AND request_hash=?",
				[input, output, Date.now(), command.runId, command.requestHash],
			);
			return updated.changes === 1;
		});
	}

	finish(
		command: StoredTitleCommand,
		state: 'completed' | 'failed' | 'unknown',
		title: string | null,
		authorize: RunStepPolicyCheck,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const now = Date.now();
			const mayRename =
				state === 'completed' &&
				title !== null &&
				(await this.authorized(tx, command, authorize)) &&
				(await this.currentTitle(tx, command));
			const updated = await tx.run(
				'UPDATE agent_thread_titles SET state=?,updated_at=? WHERE run_id=? AND state=? AND request_hash=?',
				[state, now, command.runId, state === 'failed' ? 'reserved' : 'dispatched', command.requestHash],
			);
			if (updated.changes !== 1) {
				return false;
			}
			if (mayRename && command.claim.version < Number.MAX_SAFE_INTEGER) {
				await tx.run(
					"UPDATE agent_threads SET title=?,version=version+1,updated_at=MAX(updated_at,?) WHERE id=? AND user_id=? AND app_id=? AND version=? AND title_origin='automatic'",
					[title, now, command.claim.threadId, command.userId, command.appId, command.claim.version],
				);
			}
			return true;
		});
	}
}
