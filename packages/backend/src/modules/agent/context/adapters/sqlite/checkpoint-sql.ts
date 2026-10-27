import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	CheckpointStorage,
	StoredCheckpointAuthority,
	StoredCheckpoint,
} from '../../storage/checkpoint-storage.js';
import { readContextSnapshot } from './context-row.js';
import { currentParticipant, storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { toolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';

export async function initializeContextCheckpoints(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_context_checkpoints (
 id TEXT PRIMARY KEY,run_id TEXT NOT NULL,step_index INTEGER NOT NULL,tool_id TEXT NOT NULL UNIQUE,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64),source_messages INTEGER NOT NULL CHECK(source_messages>=1),
 summary_text TEXT NOT NULL CHECK(length(CAST(summary_text AS BLOB)) BETWEEN 1 AND 16384),created_at INTEGER NOT NULL,
 UNIQUE(run_id,step_index),
 FOREIGN KEY(run_id,step_index) REFERENCES agent_model_contexts(run_id,step_index) ON DELETE CASCADE,
 FOREIGN KEY(tool_id) REFERENCES agent_run_tools(id) ON DELETE CASCADE);`);
}

export function checkpointRow(row: Record<string, unknown>): StoredCheckpoint {
	const summary = storedText(row.summary_text);
	const sourceHash = storedText(row.source_hash);
	if (
		!summary.trim() ||
		Buffer.byteLength(summary, 'utf8') > 16384 ||
		Buffer.from(summary, 'utf8').toString('utf8') !== summary ||
		!/^[a-f0-9]{64}$/u.test(sourceHash)
	) {
		throw new Error('Corrupt context checkpoint');
	}
	return {
		id: storedText(row.id),
		runId: storedText(row.run_id),
		stepIndex: storedInteger(row.step_index, 1),
		sourceHash,
		sourceMessages: storedInteger(row.source_messages, 1),
		summary,
		createdAt: storedInteger(row.created_at),
	};
}

export class SqliteCheckpointStorage implements CheckpointStorage {
	constructor(private readonly db: SqliteRuntime) {}

	create(
		input: StoredCheckpointAuthority,
		id: string,
		summary: string,
		now: number,
		admit: (sourceMessages: number, sourceBytes: number) => void,
	): Promise<StoredCheckpoint | null> {
		return this.db.transaction(async (tx) => {
			const scope = { userId: input.userId, appId: input.appId, runId: input.runId };
			const tool = await toolOperation(tx, input.userId, input.appId, input.runId, input.operationId);
			if (
				!tool ||
				tool.toolName !== 'context_checkpoint' ||
				tool.modelStepIndex !== input.stepIndex ||
				tool.state !== 'dispatched' ||
				tool.operationHash !== input.operationHash ||
				!(await currentParticipant(tx, scope, Date.now, tool.toolName, tool.modelStepIndex))
			) {
				return null;
			}
			const source = await tx.one(
				'SELECT content_json,content_hash FROM agent_model_contexts WHERE run_id=? AND step_index=?',
				[input.runId, input.stepIndex],
			);
			if (!source) {
				throw new Error('Checkpoint source context missing');
			}
			const snapshot = readContextSnapshot(source);
			admit(snapshot.messages.length, Buffer.byteLength(storedText(source.content_json), 'utf8'));
			if (
				await tx.one('SELECT id FROM agent_context_checkpoints WHERE run_id=? AND step_index=?', [
					input.runId,
					input.stepIndex,
				])
			) {
				return null;
			}
			await tx.run(
				'INSERT INTO agent_context_checkpoints(id,run_id,step_index,tool_id,source_hash,source_messages,summary_text,created_at) VALUES(?,?,?,?,?,?,?,?)',
				[
					id,
					input.runId,
					input.stepIndex,
					input.operationId,
					storedText(source.content_hash),
					snapshot.messages.length,
					summary,
					now,
				],
			);
			const row = await tx.one('SELECT * FROM agent_context_checkpoints WHERE id=?', [id]);
			if (!row) {
				throw new Error('Checkpoint disappeared');
			}
			return checkpointRow(row);
		});
	}

	get(userId: number, appId: string, runId: string, stepIndex: number): Promise<StoredCheckpoint | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				"SELECT c.* FROM agent_context_checkpoints c JOIN agent_runs r ON r.id=c.run_id JOIN agent_run_tools t ON t.id=c.tool_id WHERE r.user_id=? AND r.app_id=? AND r.id=? AND c.step_index=? AND t.state='completed'",
				[userId, appId, runId, stepIndex],
			);
			return row === null ? null : checkpointRow(row);
		});
	}
}
