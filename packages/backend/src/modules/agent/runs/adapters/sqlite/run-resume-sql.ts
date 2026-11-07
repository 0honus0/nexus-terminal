import { isAgentRecord } from '@nexus-terminal/shared/agent/http-codec';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { readAgentPluginContentReference } from '@nexus-terminal/shared/agent/plugins/content';
import { executionSettings } from '../../../execution/adapters/sqlite/execution-sql.js';
import { mayAdmitPluginRun } from '../../../plugins/adapters/sqlite/plugin-operation-authority.js';
import { currentRunAppExecution } from './run-app-execution-sql.js';
import { assertRunRevisionAvailable, storedInteger, storedText } from './run-participant-sql.js';
import { decodeRun } from './run-row.js';
import type {
	RunResumeStorage,
	StoredResumeRunCommand,
	StoredResumeRunResult,
	StoredRunSuspension,
} from '../../storage/run-resume-storage.js';

export async function readRunSuspension(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	runId: string,
): Promise<StoredRunSuspension | null> {
	const row = await tx.one(
		`SELECT s.* FROM agent_run_suspensions s JOIN agent_runs r ON r.id=s.run_id
	 WHERE r.id=? AND r.user_id=? AND r.app_id=? AND r.status='suspended' AND s.run_version=r.version AND s.resumed_at IS NULL`,
		[runId, userId, appId],
	);
	if (!row) {
		return null;
	}
	const raw: unknown = JSON.parse(storedText(row.input_request_json));
	const ref = readAgentPluginContentReference(raw);
	return {
		runId,
		runVersion: storedInteger(row.run_version, 1),
		checkpointVersion: storedInteger(row.checkpoint_version, 1),
		inputRequest: { id: ref.id, sha256: ref.sha256, sizeBytes: ref.sizeBytes, mediaType: ref.mediaType },
		suspendedAt: storedInteger(row.suspended_at),
	};
}

/** One resume intent wins the version CAS. Replaying its receipt never schedules another App. */
export async function resumeRun(
	tx: SqlExecutor,
	command: StoredResumeRunCommand,
	admit: Parameters<RunResumeStorage['resume']>[1],
	clock: () => number = Date.now,
): Promise<StoredResumeRunResult> {
	const original = await tx.one(
		`SELECT run_id,request_hash,result_json FROM agent_run_resume_commands
	 WHERE user_id=? AND app_id=? AND operation_key=?`,
		[command.userId, command.appId, command.operationKey],
	);
	if (original) {
		if (original.run_id !== command.runId || original.request_hash !== command.requestHash) {
			return { status: 'idempotency_conflict' };
		}
		const raw: unknown = JSON.parse(storedText(original.result_json));
		if (!isAgentRecord(raw)) {
			throw new Error('Corrupt resume receipt');
		}
		const run = decodeRun(raw);
		if (
			run.id !== command.runId ||
			run.userId !== command.userId ||
			run.appId !== command.appId ||
			run.version !== command.expectedVersion + 1 ||
			run.status !== 'pending'
		) {
			throw new Error('Mismatched resume receipt');
		}
		return { status: 'replayed', originalStatus: 'resumed', run };
	}
	const row = await tx.one(
		`SELECT r.*,i.input_json,i.app_execution_json,c.parent_id,
	 COALESCE(c.request_hash,(SELECT request_hash FROM agent_command_idempotency k
	 WHERE k.run_id=r.id AND k.command_name='create_run')) AS creation_hash
	 FROM agent_runs r JOIN agent_run_inputs i ON i.run_id=r.id LEFT JOIN agent_run_children c ON c.run_id=r.id
	 WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
		[command.runId, command.userId, command.appId],
	);
	if (!row) {
		return { status: 'not_found' };
	}
	if (row.version !== command.expectedVersion) {
		return { status: 'version_conflict' };
	}
	if (row.status !== 'suspended') {
		return { status: 'active_run_conflict' };
	}
	const waiting = await readRunSuspension(tx, command.userId, command.appId, command.runId);
	if (!waiting) {
		throw new Error('Suspended Run has no waiting checkpoint');
	}
	const unsafe = await tx.one(
		`SELECT 1 AS unsafe WHERE EXISTS(SELECT 1 FROM agent_run_executions
	 WHERE run_id=? AND state<>'closed') OR EXISTS(SELECT 1 FROM agent_operations WHERE run_id=?
	 AND state IN ('accepted','dispatched','unknown')) OR EXISTS(SELECT 1 FROM agent_tool_jobs
	 WHERE run_id=? AND state IN ('queued','dispatched','unknown')) OR EXISTS(SELECT 1 FROM agent_run_children c
	 JOIN agent_runs r ON r.id=c.run_id WHERE c.parent_id=? AND (r.status IN ('pending','running','suspended','unknown')
	 OR EXISTS(SELECT 1 FROM agent_operations o WHERE o.run_id=r.id AND o.state IN ('accepted','dispatched','unknown'))
	 OR EXISTS(SELECT 1 FROM agent_tool_jobs j WHERE j.run_id=r.id AND j.state IN ('queued','dispatched','unknown'))))`,
		[command.runId, command.runId, command.runId, command.runId],
	);
	const now = clock();
	if (
		unsafe ||
		now < waiting.suspendedAt ||
		!(await mayAdmitPluginRun(tx, command.userId, command.appId)) ||
		!(await currentRunAppExecution(tx, { userId: command.userId, appId: command.appId, runId: command.runId }))
	) {
		return { status: 'active_run_conflict' };
	}
	const creationHash = storedText(row.creation_hash);
	if (!/^[a-f0-9]{64}$/u.test(creationHash)) {
		throw new Error('Corrupt original Run intent');
	}
	const parentId = row.parent_id === null ? null : storedText(row.parent_id);
	let deadlineAt = storedInteger(row.deadline_at, 1) + now - waiting.suspendedAt;
	if (parentId !== null) {
		const parent = await tx.one(
			`SELECT r.deadline_at FROM agent_runs r JOIN agent_run_executions e ON e.run_id=r.id
		 WHERE r.id=? AND r.user_id=? AND r.app_id=? AND r.status='running' AND e.state='open' AND r.deadline_at>?`,
			[parentId, command.userId, command.appId, now],
		);
		if (!parent) {
			return { status: 'active_run_conflict' };
		}
		deadlineAt = Math.min(deadlineAt, storedInteger(parent.deadline_at, 1));
	}
	if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= now) {
		return { status: 'active_run_conflict' };
	}
	const occupied = await tx.one(
		`SELECT COUNT(*) AS count FROM agent_runs WHERE user_id=? AND status IN ('pending','running','unknown')`,
		[command.userId],
	);
	if (!occupied) {
		throw new Error('Missing execution occupancy');
	}
	admit(await executionSettings(tx, command.userId), storedInteger(occupied.count));
	const checkpoint = await tx.one(
		`SELECT version FROM agent_app_checkpoints WHERE run_id=? AND version=? AND execution_generation=(
	 SELECT execution_generation FROM agent_run_suspensions WHERE run_id=? AND run_version=?)`,
		[command.runId, waiting.checkpointVersion, command.runId, waiting.runVersion],
	);
	if (!checkpoint) {
		throw new Error('Suspension checkpoint changed');
	}
	assertRunRevisionAvailable(command.expectedVersion, 2);
	await tx.run(
		`UPDATE agent_run_suspensions SET resumed_at=?,resume_input_json=? WHERE run_id=? AND run_version=? AND resumed_at IS NULL`,
		[now, command.inputJson, command.runId, command.expectedVersion],
	);
	const changed = await tx.run(
		`UPDATE agent_runs SET status='pending',version=version+1,updated_at=?,deadline_at=?
	 WHERE id=? AND user_id=? AND app_id=? AND status='suspended' AND version=?`,
		[now, deadlineAt, command.runId, command.userId, command.appId, command.expectedVersion],
	);
	if (changed.changes !== 1) {
		throw new Error('Lost Run resume CAS');
	}
	await tx.run(
		`INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,?,'run.resumed',?,?)`,
		[command.runId, command.expectedVersion + 1, command.expectedVersion + 1, now],
	);
	const snapshot = {
		id: command.runId,
		user_id: command.userId,
		app_id: command.appId,
		thread_id: row.thread_id,
		approval_mode: row.approval_mode,
		status: 'pending',
		version: command.expectedVersion + 1,
		created_at: row.created_at,
		updated_at: now,
	};
	const run = decodeRun(snapshot);
	await tx.run(
		`INSERT INTO agent_run_resume_commands(user_id,app_id,operation_key,run_id,request_hash,result_json) VALUES(?,?,?,?,?,?)`,
		[
			command.userId,
			command.appId,
			command.operationKey,
			command.runId,
			command.requestHash,
			JSON.stringify(snapshot),
		],
	);
	return {
		status: 'resumed',
		run,
		parentId,
		requestHash: creationHash,
		deadlineAt,
		prompt: storedText(row.input_text),
		inputJson: storedText(row.input_json),
	};
}
