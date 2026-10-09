import type { RelationalDatabase } from '../../../../platform/storage/relational-database.port';
import type { RunView } from '../../../../modules/agent/runtime/runs/run.types';
import type { StateCommitResult } from '../../../../modules/agent/runtime/runs/state-commit.port';
import { settleSubagentToolTransition } from './subagent-tool-settle-transitions';

/** The existing Approval owner parks/resumes Child work in its own transaction. */
export const resumeChildApprovalWork = async (
	tx: RelationalDatabase,
	run: RunView,
	toolCallId: string,
	now: number,
	rejection?: { code: string; feedback?: string },
): Promise<StateCommitResult | null> => {
	const work = await tx.queryOne<{
		id: string;
		agent_runtime_id: string;
		owner_epoch: number;
		tool_step_id: string;
		delegation_id: string;
	}>(
		`SELECT w.id, w.agent_runtime_id, w.owner_epoch,
       json_extract(w.payload_json, '$.toolStepId') AS tool_step_id,
       json_extract(w.payload_json, '$.delegationId') AS delegation_id
     FROM agent_scheduler_work w WHERE w.run_id = ? AND w.kind = 'tool_step'
       AND w.status = 'waiting' AND json_extract(w.payload_json, '$.toolCallId') = ?`,
		[run.id, toolCallId],
	);
	if (!work) return null;
	if (!rejection) {
		await tx.execute(
			`UPDATE agent_scheduler_work SET status = 'queued', owner_epoch = NULL, not_before = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'waiting'`,
			[now, now, work.id],
		);
		return null;
	}
	// No external execution: settle a confirmed denial through the ordinary batch continuation owner.
	await tx.execute(
		`UPDATE agent_scheduler_work SET status = 'claimed', version = version + 1, updated_at = ? WHERE id = ? AND status = 'waiting'`,
		[now, work.id],
	);
	await tx.execute(
		`UPDATE agent_tool_calls SET status = 'running', version = version + 1 WHERE id = ? AND run_id = ? AND status = 'cancelled'`,
		[toolCallId, run.id],
	);
	await tx.execute(`UPDATE agent_steps SET status = 'running' WHERE id = ? AND run_id = ? AND status = 'cancelled'`, [
		work.tool_step_id,
		run.id,
	]);
	await tx.execute(
		`UPDATE agent_runtimes SET schedule_state = 'executing', updated_at = ? WHERE id = ? AND run_id = ? AND status = 'running'`,
		[now, work.agent_runtime_id, run.id],
	);
	// Settlement balances one execution slot. This denial has no external execution slot;
	// reserve it transaction-locally so another active runtime's accounting is not decremented.
	await tx.execute(`UPDATE agent_runs SET executing_runtime_count = executing_runtime_count + 1 WHERE id = ?`, [
		run.id,
	]);
	return settleSubagentToolTransition(tx, {
		scope: run,
		runId: run.id,
		runtimeId: work.agent_runtime_id,
		delegationId: work.delegation_id,
		workId: work.id,
		ownerEpoch: work.owner_epoch,
		toolStepId: work.tool_step_id,
		toolCallId,
		result: {
			ok: false,
			summary: rejection.feedback
				? `The user rejected this action: ${rejection.feedback}`
				: 'The approval was not granted.',
			data: {
				error: { code: rejection.code },
				...(rejection.feedback ? { userFeedback: rejection.feedback } : {}),
			},
			errorCode: rejection.code,
			artifactRefs: [],
			truncated: false,
			outcome: 'confirmed',
			verification: { status: 'failed', summary: 'The action was not executed.', evidenceRefs: [] },
		},
		continuation: 'runnable',
		now,
	});
};
