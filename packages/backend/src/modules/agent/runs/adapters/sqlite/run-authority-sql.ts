import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StepScope } from '../../storage/run-step-storage.js';
import { currentParticipant, storedInteger } from './run-participant-sql.js';

export async function runAuthority(
	tx: SqlExecutor,
	command: StepScope,
): Promise<
	{ status: 'ok'; runStatus: 'pending' | 'running' } | { status: 'not_found' | 'version_conflict' | 'stale' }
> {
	const row = await tx.one(
		`SELECT r.status,r.version,
		 CASE WHEN r.run_kind='root' THEN (SELECT i.request_hash FROM agent_command_idempotency i
		  WHERE i.run_id=r.id AND i.user_id=r.user_id AND i.app_id=r.app_id
		  AND i.command_name='create_run' AND i.result_outcome='created')
		 ELSE (SELECT c.request_hash FROM agent_run_children c WHERE c.run_id=r.id) END AS create_request_hash
		 FROM agent_runs r WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
		[command.runId, command.userId, command.appId],
	);
	if (row === null) {
		return { status: 'not_found' };
	}
	if (typeof row.create_request_hash !== 'string' || !/^[a-f0-9]{64}$/u.test(row.create_request_hash)) {
		throw new Error('Run has no valid original creation identity');
	}
	if (row.create_request_hash !== command.creationHash) {
		return { status: 'stale' };
	}
	if (storedInteger(row.version, 1) !== command.expectedRunVersion) {
		return { status: 'version_conflict' };
	}
	if (
		!(await currentParticipant(
			tx,
			{ userId: command.userId, appId: command.appId, runId: command.runId },
			Date.now,
			undefined,
			command.stepIndex,
			true,
		))
	) {
		return { status: 'stale' };
	}
	if (row.status !== 'pending' && row.status !== 'running') {
		return { status: 'stale' };
	}
	return { status: 'ok', runStatus: row.status };
}
