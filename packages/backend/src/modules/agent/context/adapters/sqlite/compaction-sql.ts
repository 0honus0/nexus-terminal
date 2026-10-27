import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { readStepProposals } from '../../../runs/adapters/sqlite/run-step-proposals.js';
import type { CompactionStorage, StoredCompactionCommand } from '../../storage/compaction-storage.js';
import type { RunStepPolicyCheck } from '../../../runs/storage/run-step-storage.js';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../../execution/storage/execution-storage.js';
import type { StoredContextToolResult } from '../../storage/context-storage.js';
import { contextContentHash, decodeContextSnapshot, readContextSnapshot } from './context-row.js';
import { contextContinues, currentContextSources } from './context-snapshot-sql.js';
import { runAuthority } from '../../../runs/adapters/sqlite/run-authority-sql.js';
import { currentParticipant, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { frozenFromRun } from '../../../runs/adapters/sqlite/run-sql.js';
import { frozenExecution, executionUsage } from '../../../execution/adapters/sqlite/execution-budget-sql.js';
import type { ProviderStorage } from '../../../providers/storage/provider-storage.js';

export class SqliteCompactionStorage implements CompactionStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly providers: ProviderStorage,
	) {}

	private async authorized(
		tx: SqlExecutor,
		command: StoredCompactionCommand,
		authorize: RunStepPolicyCheck,
	): Promise<boolean> {
		if ((await runAuthority(tx, command)).status !== 'ok' || !(await currentParticipant(tx, command, Date.now))) {
			return false;
		}
		const frozen = await frozenFromRun(tx, command.userId, command.appId, command.runId);
		const provider = frozen === null ? null : await this.providers.snapshot(tx, command.userId, frozen.providerId);
		return frozen !== null && authorize(frozen, provider);
	}

	reserve(
		command: StoredCompactionCommand,
		authorize: RunStepPolicyCheck,
		verifyResults: (results: StoredContextToolResult[], previewBytes: number) => boolean,
		admit: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await this.authorized(tx, command, authorize))) {
				return false;
			}
			const source = decodeContextSnapshot(JSON.stringify(command.snapshot));
			if (
				command.cut < 1 ||
				command.cut >= source.messages.length ||
				source.messages[command.cut].role === 'tool' ||
				!(await currentContextSources(tx, command, source))
			) {
				return false;
			}
			const current = await tx.one(
				'SELECT content_json,content_hash FROM agent_model_contexts WHERE run_id=? AND step_index=?',
				[command.runId, command.stepIndex],
			);
			if (current) {
				if (JSON.stringify(readContextSnapshot(current)) !== JSON.stringify(source)) {
					return false;
				}
			} else if (command.stepIndex > 1) {
				const previous = await tx.one(
					"SELECT proposals_json FROM agent_run_model_steps WHERE run_id=? AND step_index=? AND state='completed' AND finish_reason='tool_calls'",
					[command.runId, command.stepIndex - 1],
				);
				if (
					!previous ||
					!(await contextContinues(
						tx,
						command,
						source,
						readStepProposals(storedText(previous.proposals_json)),
						verifyResults,
					))
				) {
					return false;
				}
			}
			const usage = await executionUsage(tx, command.runId, command.userId);
			admit(await frozenExecution(tx, command.runId), usage);
			const json = JSON.stringify(source);
			await tx.run(
				`INSERT INTO agent_context_compactions(id,run_id,root_id,step_index,state,request_hash,creation_hash,source_json,source_hash,cut_index,estimated_tokens,created_at,updated_at)
				VALUES(?,?,?,?,'reserved',?,?,?,?,?,?,?,?)`,
				[
					command.id,
					command.runId,
					usage.rootId,
					command.stepIndex,
					command.requestHash,
					command.creationHash,
					json,
					contextContentHash(json),
					command.cut,
					command.estimatedTokens,
					command.now,
					command.now,
				],
			);
			return true;
		});
	}

	dispatch(
		command: StoredCompactionCommand,
		authorize: RunStepPolicyCheck,
		admit: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await this.authorized(tx, command, authorize))) {
				return false;
			}
			admit(await frozenExecution(tx, command.runId), await executionUsage(tx, command.runId, command.userId));
			const updated = await tx.run(
				"UPDATE agent_context_compactions SET state='dispatched',updated_at=? WHERE id=? AND run_id=? AND state='reserved' AND request_hash=?",
				[Date.now(), command.id, command.runId, command.requestHash],
			);
			return updated.changes === 1;
		});
	}

	recordUsage(command: StoredCompactionCommand, input: number, output: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const updated = await tx.run(
				"UPDATE agent_context_compactions SET input_tokens=?,output_tokens=?,updated_at=? WHERE id=? AND run_id=? AND state='dispatched' AND input_tokens IS NULL AND request_hash=?",
				[input, output, Date.now(), command.id, command.runId, command.requestHash],
			);
			return updated.changes === 1;
		});
	}

	finish(
		command: StoredCompactionCommand,
		state: 'completed' | 'failed' | 'unknown',
		summary: string | null,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const prior = state === 'failed' ? 'reserved' : 'dispatched';
			if (state === 'completed' && !(await currentParticipant(tx, command, Date.now))) {
				return false;
			}
			const updated = await tx.run(
				'UPDATE agent_context_compactions SET state=?,summary_text=?,updated_at=? WHERE id=? AND run_id=? AND state=? AND request_hash=?',
				[state, summary, Date.now(), command.id, command.runId, prior, command.requestHash],
			);
			return updated.changes === 1;
		});
	}
}
