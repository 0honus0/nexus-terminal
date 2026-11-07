import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AGENT_RUN_STEP_MAX_TEXT_BYTES, AGENT_RUN_STEP_MAX_INDEX } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredRunStep, StoredRunStepEvent } from '../../storage/run-step-storage.js';
import { readStepProposals } from './run-step-proposals.js';

function whole(value: unknown, minimum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt Run model step integer');
	}
	return value;
}

export function decodeStep(row: Record<string, unknown>): StoredRunStep {
	const state = row.state;
	if (
		state !== 'reserved' &&
		state !== 'dispatched' &&
		state !== 'completed' &&
		state !== 'failed' &&
		state !== 'unknown'
	) {
		throw new Error('Corrupt Run model step state');
	}
	if (
		typeof row.run_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.run_id) ||
		typeof row.request_hash !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(row.request_hash) ||
		typeof row.creation_hash !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(row.creation_hash) ||
		(row.failure_code !== null && typeof row.failure_code !== 'string')
	) {
		throw new Error('Corrupt Run model step identity');
	}
	if (
		(row.response_received !== 0 && row.response_received !== 1) ||
		(state === 'reserved' && row.response_received !== 0) ||
		(state === 'completed' && row.response_received !== 1)
	) {
		throw new Error('Corrupt model response receipt');
	}
	const inputTokens = row.input_tokens === null ? undefined : whole(row.input_tokens, 0);
	const outputTokens = row.output_tokens === null ? undefined : whole(row.output_tokens, 0);
	if ((inputTokens === undefined) !== (outputTokens === undefined)) {
		throw new Error('Corrupt Run model step token usage');
	}
	const failureCode = row.failure_code === null ? undefined : row.failure_code;
	if (
		failureCode !== undefined &&
		failureCode !== 'DISPATCH_NOT_STARTED' &&
		failureCode !== 'PROVIDER_REQUEST_REJECTED'
	) {
		throw new Error('Corrupt Run model failure classification');
	}
	const textBytes = whole(row.text_bytes, 0);
	const finishReason = row.finish_reason;
	const proposals = readStepProposals(row.proposals_json);
	if (
		(state === 'completed' && finishReason !== 'stop' && finishReason !== 'tool_calls') ||
		(finishReason === 'tool_calls') !== proposals.length > 0 ||
		(state !== 'completed' && finishReason !== null) ||
		(state === 'failed' && failureCode === undefined) ||
		(state !== 'failed' && failureCode !== undefined)
	) {
		throw new Error('Corrupt Run model step terminal fields');
	}
	if (
		whole(row.step_index, 1) > AGENT_RUN_STEP_MAX_INDEX ||
		textBytes > AGENT_RUN_STEP_MAX_TEXT_BYTES ||
		(finishReason === 'stop' && textBytes === 0) ||
		(state === 'reserved' && (textBytes !== 0 || inputTokens !== undefined)) ||
		(failureCode === 'PROVIDER_REQUEST_REJECTED' && (textBytes !== 0 || inputTokens !== undefined))
	) {
		throw new Error('Corrupt Run model step output bounds');
	}
	return {
		runId: row.run_id,
		stepIndex: whole(row.step_index, 1),
		state,
		revision: whole(row.revision, 1),
		expectedRunVersion: whole(row.expected_run_version, 1),
		requestHash: row.request_hash,
		creationHash: row.creation_hash,
		responseReceived: row.response_received === 1,
		proposals,
		textBytes,
		...(finishReason === 'stop' || finishReason === 'tool_calls' ? { finishReason } : {}),
		...(inputTokens === undefined ? {} : { inputTokens, outputTokens }),
		...(failureCode === undefined ? {} : { failureCode }),
		createdAt: whole(row.created_at, 0),
		updatedAt: whole(row.updated_at, whole(row.created_at, 0)),
	};
}

export function readStepEvent(row: Record<string, unknown>): StoredRunStepEvent {
	const kind = row.kind;
	if (
		kind !== 'text.delta' &&
		kind !== 'usage' &&
		kind !== 'step.completed' &&
		kind !== 'step.failed' &&
		kind !== 'step.unknown'
	) {
		throw new Error('Corrupt Run step event kind');
	}
	if (typeof row.run_id !== 'string' || !AGENT_ID_PATTERN.test(row.run_id)) {
		throw new Error('Corrupt Run step event identity');
	}
	const text = row.text_delta;
	const input = row.input_tokens;
	const output = row.output_tokens;
	if (kind === 'text.delta' && (typeof text !== 'string' || !text.length || input !== null || output !== null)) {
		throw new Error('Corrupt Run step delta');
	}
	if (kind === 'usage' && (text !== null || input === null || output === null)) {
		throw new Error('Corrupt Run step usage');
	}
	if (kind !== 'text.delta' && kind !== 'usage' && (text !== null || input !== null || output !== null)) {
		throw new Error('Corrupt Run step terminal event');
	}
	const textDelta = kind === 'text.delta' && typeof text === 'string' ? text : undefined;
	return {
		runId: row.run_id,
		stepIndex: whole(row.step_index, 1),
		sequence: whole(row.sequence, 1),
		kind,
		...(textDelta === undefined ? {} : { textDelta }),
		...(kind !== 'usage' ? {} : { inputTokens: whole(input, 0), outputTokens: whole(output, 0) }),
		createdAt: whole(row.created_at, 0),
	};
}

export async function validateRunStepRecovery(reader: SqlReader): Promise<void> {
	const inconsistent = await reader.one(
		`SELECT 1 AS invalid FROM agent_runs r
		 JOIN agent_run_model_steps s ON s.run_id=r.id
		 WHERE (s.state='reserved' AND ((s.step_index=1 AND r.status!='pending') OR (s.step_index>1 AND r.status!='running')))
		    OR (s.state='dispatched' AND r.status!='running')
		    OR (s.state IN ('reserved','dispatched') AND s.expected_run_version!=r.version)
		    OR (s.expected_run_version>r.version)
		    OR (r.status='completed' AND NOT EXISTS(SELECT 1 FROM agent_run_model_steps final_step
		      WHERE final_step.run_id=r.id AND final_step.state='completed' AND final_step.finish_reason='stop'
		      AND final_step.expected_run_version=r.version AND NOT EXISTS(SELECT 1 FROM agent_run_model_steps later
		      WHERE later.run_id=r.id AND later.step_index>final_step.step_index)))
		    OR (s.state IN ('failed','unknown') AND r.status!='cancelled' AND s.expected_run_version!=r.version)
		    OR (s.state='failed' AND r.status NOT IN ('failed','cancelled')
		        AND NOT (r.status='unknown' AND (EXISTS(SELECT 1 FROM agent_run_tools t WHERE t.run_id=r.id AND t.state='unknown')
		          OR EXISTS(SELECT 1 FROM agent_legacy_tool_jobs j WHERE j.run_id=r.id AND j.state='unknown'))))
		    OR (s.state='unknown' AND r.status NOT IN ('unknown','cancelled'))
		    OR (r.run_kind='root' AND NOT EXISTS (SELECT 1 FROM agent_command_idempotency i
		      WHERE i.run_id=r.id AND i.user_id=r.user_id AND i.app_id=r.app_id
		      AND i.command_name='create_run' AND i.result_outcome='created'
		      AND i.request_hash=s.creation_hash))
		 OR (r.run_kind='child' AND NOT EXISTS(SELECT 1 FROM agent_legacy_run_children c WHERE c.run_id=r.id AND c.request_hash=s.creation_hash))
		 LIMIT 1`,
	);
	if (inconsistent) {
		throw new Error('Inconsistent Run and model step recovery states');
	}
}
