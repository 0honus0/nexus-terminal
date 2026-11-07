import { readAgentPluginAppOutcome } from '@nexus-terminal/shared/agent/plugins/app-outcome';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredRunAppMutation, StoredRunAppResult, StoredRunAppTerminal } from '../../storage/run-app-storage.js';
import { assertRunRevisionAvailable } from './run-participant-sql.js';

async function authority(
	tx: SqlExecutor,
	command: StoredRunAppMutation,
): Promise<StoredRunAppResult | { status: 'ready'; state: 'pending' | 'running' }> {
	const row = await tx.one(
		`SELECT r.status,r.version,e.state AS execution_state FROM agent_runs r
	 JOIN agent_run_executions e ON e.run_id=r.id AND e.generation=?
	 WHERE r.id=? AND r.user_id=? AND r.app_id=? AND (
	 EXISTS(SELECT 1 FROM agent_command_idempotency i WHERE i.run_id=r.id AND i.command_name='create_run' AND i.request_hash=?)
	 OR EXISTS(SELECT 1 FROM agent_run_children c WHERE c.run_id=r.id AND c.request_hash=?))`,
		[
			command.executionGeneration,
			command.runId,
			command.userId,
			command.appId,
			command.creationHash,
			command.creationHash,
		],
	);
	if (!row) {
		return { status: 'not_found' };
	}
	if (row.version !== command.expectedVersion) {
		return { status: 'version_conflict' };
	}
	if (row.status !== 'pending' && row.status !== 'running') {
		return { status: 'scope_closed' };
	}
	return { status: 'ready', state: row.status };
}

async function event(
	tx: SqlExecutor,
	command: StoredRunAppMutation,
	state: 'running' | 'suspended' | 'completed' | 'failed' | 'unknown',
): Promise<void> {
	assertRunRevisionAvailable(command.expectedVersion);
	await tx.run('UPDATE agent_runs SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?', [
		state,
		command.now,
		command.runId,
		command.expectedVersion,
	]);
	await tx.run('INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,?,?,?,?)', [
		command.runId,
		command.expectedVersion + 1,
		state === 'running' ? 'run.started' : 'run.' + state,
		command.expectedVersion + 1,
		command.now,
	]);
}

export async function startRunApp(tx: SqlExecutor, command: StoredRunAppMutation): Promise<StoredRunAppResult> {
	const current = await authority(tx, command);
	if (current.status !== 'ready') {
		return current;
	}
	if (current.state !== 'pending') {
		return { status: 'scope_closed' };
	}
	const open = await tx.one(
		"SELECT run_id FROM agent_run_executions WHERE run_id=? AND generation=? AND state='open'",
		[command.runId, command.executionGeneration],
	);
	if (!open) {
		return { status: 'scope_closed' };
	}
	await event(tx, command, 'running');
	return { status: 'ok', version: command.expectedVersion + 1 };
}

export async function finishRunApp(
	tx: SqlExecutor,
	command: StoredRunAppMutation,
	terminal: StoredRunAppTerminal,
): Promise<StoredRunAppResult> {
	const current = await authority(tx, command);
	if (current.status !== 'ready') {
		return current;
	}
	const pending = await tx.one(
		"SELECT id FROM agent_operations WHERE run_id=? AND state IN ('accepted','dispatched') LIMIT 1",
		[command.runId],
	);
	// Unknown is a truthful final Run outcome even when a lost commit acknowledgement
	// leaves receipts unresolved. Preserve those receipts for recovery; never settle
	// them speculatively or leave a dead execution displayed as running.
	if (pending && terminal.state !== 'unknown') {
		return { status: 'operation_conflict' };
	}
	const unknown = await tx.one("SELECT id FROM agent_operations WHERE run_id=? AND state='unknown' LIMIT 1", [
		command.runId,
	]);
	const unsettledJob = await tx.one(
		`SELECT id FROM agent_tool_jobs WHERE state IN ('queued','dispatched','unknown') AND
	 (run_id=? OR run_id IN (SELECT run_id FROM agent_run_children WHERE parent_id=?)) LIMIT 1`,
		[command.runId, command.runId],
	);
	const unsettledChild = await tx.one(
		`SELECT r.id FROM agent_run_children c JOIN agent_runs r ON r.id=c.run_id
	 WHERE c.parent_id=? AND (r.status IN ('pending','running','suspended','unknown') OR EXISTS(
	 SELECT 1 FROM agent_operations o WHERE o.run_id=r.id AND o.state IN ('accepted','dispatched','unknown'))) LIMIT 1`,
		[command.runId],
	);
	const closed = await tx.one(
		"SELECT run_id FROM agent_run_executions WHERE run_id=? AND generation=? AND state='closed'",
		[command.runId, command.executionGeneration],
	);
	const state = unknown || unsettledJob || unsettledChild || !closed ? 'unknown' : terminal.state;
	if (terminal.state === 'suspended' && state === 'suspended') {
		const checkpoint = await tx.one(
			`SELECT run_id FROM agent_app_checkpoints WHERE run_id=? AND version=? AND execution_generation=?`,
			[command.runId, terminal.checkpointVersion, command.executionGeneration],
		);
		const ref = terminal.inputRequest;
		const content = await tx.one(
			`SELECT id FROM agent_operation_contents WHERE run_id=? AND user_id=? AND app_id=?
		 AND id=? AND sha256=? AND size_bytes=? AND media_type=? AND sealed=1`,
			[command.runId, command.userId, command.appId, ref.id, ref.sha256, ref.sizeBytes, ref.mediaType],
		);
		if (!checkpoint || !content) {
			return { status: 'version_conflict' };
		}
		await tx.run(
			`INSERT INTO agent_run_suspensions(run_id,run_version,execution_generation,checkpoint_version,input_request_json,suspended_at)
		 VALUES(?,?,?,?,?,?)`,
			[
				command.runId,
				command.expectedVersion + 1,
				command.executionGeneration,
				terminal.checkpointVersion,
				JSON.stringify({ id: ref.id, sha256: ref.sha256, sizeBytes: ref.sizeBytes, mediaType: ref.mediaType }),
				command.now,
			],
		);
	}
	if (terminal.state === 'completed' && state === 'completed') {
		const outcome = readAgentPluginAppOutcome(JSON.parse(terminal.outputJson));
		if (outcome.kind !== 'complete') {
			throw new Error('Completion requires exported outputs');
		}
		for (const ref of outcome.outputs) {
			const content = await tx.one(
				`SELECT id FROM agent_operation_contents WHERE run_id=? AND user_id=? AND app_id=?
			 AND id=? AND sha256=? AND size_bytes=? AND media_type=? AND sealed=1`,
				[command.runId, command.userId, command.appId, ref.id, ref.sha256, ref.sizeBytes, ref.mediaType],
			);
			if (!content) {
				return { status: 'version_conflict' };
			}
		}
		await tx.run('UPDATE agent_run_inputs SET output_json=? WHERE run_id=?', [terminal.outputJson, command.runId]);
		await tx.run('UPDATE agent_run_children SET output_text=? WHERE run_id=?', [
			terminal.outputJson,
			command.runId,
		]);
	}
	await event(tx, command, state);
	return { status: 'ok', version: command.expectedVersion + 1 };
}
