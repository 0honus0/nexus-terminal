import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import {
	frozenExecution,
	executionUsage,
	reserveExecutionTokens,
} from '../../../execution/adapters/sqlite/execution-budget-sql.js';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../../execution/storage/execution-storage.js';
import { fenceRunChildren } from './run-child-fence.js';
import {
	currentContextSources,
	contextContinues,
	insertContextSnapshot,
} from '../../../context/adapters/sqlite/context-snapshot-sql.js';
import { currentParticipant, assertRunRevisionAvailable } from './run-participant-sql.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { readStepProposals } from './run-step-proposals.js';
import { AGENT_RUN_STEP_MAX_TEXT_BYTES, AGENT_RUN_STEP_MAX_COUNT } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { frozenFromRun } from './run-sql.js';
import { fenceRunTools, fenceTerminalRunTools } from './run-tool-events.js';
import type {
	RunStepStorage,
	StoredRunStep,
	StoredRunStepEvent,
	StoredRunStepEventPage,
	StoredStepState,
	StepScope,
	StepReservationScope,
	StepVersionedScope,
	StepWriteResult,
	StepFinish,
	RunStepPolicyCheck,
	UnstartedRunFailure,
} from '../../storage/run-step-storage.js';
import type { ProviderStorage } from '../../../providers/storage/provider-storage.js';
import type { StoredContextToolResult } from '../../../context/storage/context-storage.js';

const STEP_COLUMNS =
	's.run_id,s.step_index,s.state,s.revision,s.expected_run_version,s.request_hash,s.creation_hash,s.text_bytes,s.finish_reason,s.proposals_json,s.input_tokens,s.output_tokens,s.failure_code,s.created_at,s.updated_at';

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
	const inputTokens = row.input_tokens === null ? undefined : whole(row.input_tokens, 0);
	const outputTokens = row.output_tokens === null ? undefined : whole(row.output_tokens, 0);
	if ((inputTokens === undefined) !== (outputTokens === undefined)) {
		throw new Error('Corrupt Run model step token usage');
	}
	const failureCode = row.failure_code === null ? undefined : row.failure_code;
	if (failureCode !== undefined && failureCode !== 'DISPATCH_NOT_STARTED') {
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
		whole(row.step_index, 1) > AGENT_RUN_STEP_MAX_COUNT ||
		textBytes > AGENT_RUN_STEP_MAX_TEXT_BYTES ||
		(finishReason === 'stop' && textBytes === 0) ||
		(state === 'reserved' && (textBytes !== 0 || inputTokens !== undefined))
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
		proposals,
		textBytes,
		...(finishReason === 'stop' || finishReason === 'tool_calls' ? { finishReason } : {}),
		...(inputTokens === undefined ? {} : { inputTokens, outputTokens }),
		...(failureCode === undefined ? {} : { failureCode }),
		createdAt: whole(row.created_at, 0),
		updatedAt: whole(row.updated_at, whole(row.created_at, 0)),
	};
}

async function runAuthority(
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
	if (whole(row.version, 1) !== command.expectedRunVersion) {
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

async function step(tx: SqlExecutor, command: StepScope): Promise<StoredRunStep | null> {
	const row = await tx.one(
		'SELECT ' + STEP_COLUMNS + ' FROM agent_run_model_steps s WHERE s.run_id=? AND s.step_index=?',
		[command.runId, command.stepIndex],
	);
	return row === null ? null : decodeStep(row);
}

async function insertEvent(
	tx: SqlExecutor,
	runId: string,
	index: number,
	sequence: number,
	kind: StoredRunStepEvent['kind'],
	now: number,
	text: string | null = null,
	inputTokens: number | null = null,
	outputTokens: number | null = null,
): Promise<void> {
	await tx.run(
		'INSERT INTO agent_run_model_step_events(run_id,step_index,sequence,kind,text_delta,input_tokens,output_tokens,created_at) VALUES(?,?,?,?,?,?,?,?)',
		[runId, index, sequence, kind, text, inputTokens, outputTokens, now],
	);
}

/** Parent Run state/event and step journal share the same authoritative SQL transaction. */
async function advanceRun(
	tx: SqlExecutor,
	command: StepScope,
	from: 'pending' | 'running',
	to: 'running' | 'completed' | 'failed' | 'unknown',
	event: 'run.started' | 'run.completed' | 'run.failed' | 'run.unknown',
): Promise<void> {
	assertRunRevisionAvailable(command.expectedRunVersion, to === 'running' ? 2 : 1);
	const changed = await tx.run(
		`UPDATE agent_runs SET status=?,version=version+1,updated_at=?
		 WHERE id=? AND app_id=? AND user_id=? AND status=? AND version=?`,
		[to, command.now, command.runId, command.appId, command.userId, from, command.expectedRunVersion],
	);
	if (changed.changes !== 1) {
		throw new Error('Lost parent Run CAS inside step transaction');
	}
	await tx.run(
		`INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
		 VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),?,?,?)`,
		[command.runId, command.runId, event, command.expectedRunVersion + 1, command.now],
	);
	if (to !== 'running') {
		await fenceRunChildren(tx, command.runId, command.now);
		await fenceRunTools(tx, command.runId, command.now);
	}
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
		    OR (s.state='completed' AND s.finish_reason='stop' AND r.status!='completed')
		    OR (s.state='completed' AND s.finish_reason='stop' AND s.expected_run_version!=r.version)
		    OR (s.state IN ('failed','unknown') AND r.status!='cancelled' AND s.expected_run_version!=r.version)
		    OR (s.state='failed' AND r.status NOT IN ('failed','cancelled')
		        AND NOT (r.status='unknown' AND EXISTS(SELECT 1 FROM agent_run_tools t WHERE t.run_id=r.id AND t.state='unknown')))
		    OR (s.state='unknown' AND r.status NOT IN ('unknown','cancelled'))
		    OR (r.run_kind='root' AND NOT EXISTS (SELECT 1 FROM agent_command_idempotency i
		      WHERE i.run_id=r.id AND i.user_id=r.user_id AND i.app_id=r.app_id
		      AND i.command_name='create_run' AND i.result_outcome='created'
		      AND i.request_hash=s.creation_hash))
		 OR (r.run_kind='child' AND NOT EXISTS(SELECT 1 FROM agent_run_children c WHERE c.run_id=r.id AND c.request_hash=s.creation_hash))
		 LIMIT 1`,
	);
	if (inconsistent) {
		throw new Error('Inconsistent Run and model step recovery states');
	}
}

export class SqliteRunStepStorage implements RunStepStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly providers: ProviderStorage,
	) {}

	failUnstarted(command: UnstartedRunFailure): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			assertRunRevisionAvailable(command.expectedVersion);
			const result = await tx.run(
				`UPDATE agent_runs SET status='failed',version=version+1,updated_at=?
				 WHERE id=? AND user_id=? AND app_id=? AND version=? AND status='pending'
				 AND NOT EXISTS(SELECT 1 FROM agent_run_model_steps s WHERE s.run_id=agent_runs.id)
				 AND CASE WHEN run_kind='root' THEN EXISTS(
				  SELECT 1 FROM agent_command_idempotency i WHERE i.run_id=agent_runs.id
				  AND i.user_id=agent_runs.user_id AND i.app_id=agent_runs.app_id
				  AND i.command_name='create_run' AND i.result_outcome='created' AND i.request_hash=?)
				 ELSE EXISTS(SELECT 1 FROM agent_run_children c WHERE c.run_id=agent_runs.id AND c.request_hash=?) END`,
				[
					command.now,
					command.runId,
					command.userId,
					command.appId,
					command.expectedVersion,
					command.creationHash,
					command.creationHash,
				],
			);
			if (result.changes === 0) {
				return false;
			}
			await tx.run(
				`INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
				 VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),'run.failed',?,?)`,
				[command.runId, command.runId, command.expectedVersion + 1, command.now],
			);
			await fenceRunChildren(tx, command.runId, command.now);
			await fenceRunTools(tx, command.runId, command.now);
			return true;
		});
	}

	reserve(
		command: StepReservationScope,
		authorize: RunStepPolicyCheck,
		verifyResults: (results: StoredContextToolResult[]) => boolean,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StepWriteResult> {
		return this.db.transaction(async (tx) => {
			const authority = await runAuthority(tx, command);
			if (authority.status !== 'ok') {
				return { status: authority.status };
			}
			if (
				!(await currentParticipant(
					tx,
					{ userId: command.userId, appId: command.appId, runId: command.runId },
					Date.now,
					undefined,
					command.stepIndex,
				))
			) {
				return { status: 'stale' };
			}
			if ((command.stepIndex === 1) !== (authority.runStatus === 'pending')) {
				return { status: 'stale' };
			}
			const frozen = await frozenFromRun(tx, command.userId, command.appId, command.runId);
			const provider =
				frozen === null ? null : await this.providers.snapshot(tx, command.userId, frozen.providerId);
			if (frozen === null || !authorize(frozen, provider)) {
				return { status: 'policy_blocked' };
			}
			if (
				!Number.isSafeInteger(command.stepIndex) ||
				command.stepIndex < 1 ||
				command.stepIndex > AGENT_RUN_STEP_MAX_COUNT ||
				(await step(tx, command)) !== null
			) {
				return { status: 'step_conflict' };
			}
			if (command.stepIndex > 1) {
				const previous = await tx.one(
					'SELECT ' + STEP_COLUMNS + ' FROM agent_run_model_steps s WHERE s.run_id=? AND s.step_index=?',
					[command.runId, command.stepIndex - 1],
				);
				if (!previous) {
					return { status: 'step_conflict' };
				}
				const prior = decodeStep(previous);
				if (prior.state !== 'completed' || prior.finishReason !== 'tool_calls') {
					return { status: 'step_conflict' };
				}
				if (!(await contextContinues(tx, command, command.context, prior.proposals, verifyResults))) {
					return { status: 'step_conflict' };
				}
			}
			if (!(await currentContextSources(tx, command, command.context))) {
				return { status: 'stale' };
			}
			await tx.run(
				'INSERT INTO agent_run_model_steps(run_id,step_index,state,revision,expected_run_version,request_hash,creation_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
				[
					command.runId,
					command.stepIndex,
					'reserved',
					1,
					command.expectedRunVersion,
					command.requestHash,
					command.creationHash,
					command.now,
					command.now,
				],
			);
			const usage = await executionUsage(tx, command.runId, command.userId);
			admitBudget(await frozenExecution(tx, command.runId), {
				rootId: usage.rootId,
				modelRequests: usage.modelRequests - 1,
				toolExecutions: usage.toolExecutions,
				reservedTokens: usage.reservedTokens,
				concurrentModelCalls: usage.concurrentModelCalls,
			});
			await reserveExecutionTokens(tx, command.runId, command.stepIndex, usage.rootId, command.estimatedTokens);
			await insertContextSnapshot(tx, command, command.context);
			const record = await step(tx, command);
			if (!record) {
				throw new Error('Model step was not persisted');
			}
			return { status: 'ok', step: record };
		});
	}

	private mutate(
		command: StepVersionedScope,
		allowed: readonly StoredStepState[],
		change: (tx: SqlExecutor, current: StoredRunStep) => Promise<void | 'step_conflict'>,
		authorize?: RunStepPolicyCheck,
		stepIncrements = 1,
	): Promise<StepWriteResult> {
		return this.db.transaction(async (tx) => {
			const authority = await runAuthority(tx, command);
			if (authority.status !== 'ok') {
				return { status: authority.status };
			}
			const current = await step(tx, command);
			if (!current) {
				return { status: 'not_found' };
			}
			if (
				current.requestHash !== command.requestHash ||
				current.creationHash !== command.creationHash ||
				current.expectedRunVersion !== command.expectedRunVersion ||
				current.revision !== command.expectedRevision ||
				!allowed.includes(current.state) ||
				(current.state === 'reserved' && (command.stepIndex === 1) !== (authority.runStatus === 'pending')) ||
				(current.state === 'dispatched' && authority.runStatus !== 'running')
			) {
				return { status: 'stale' };
			}
			assertRunRevisionAvailable(current.revision, stepIncrements);
			if (authorize) {
				assertRunRevisionAvailable(command.expectedRunVersion, command.stepIndex === 1 ? 2 : 1);
				if (
					!(await currentParticipant(
						tx,
						{ userId: command.userId, appId: command.appId, runId: command.runId },
						Date.now,
						undefined,
						command.stepIndex,
					))
				) {
					return { status: 'stale' };
				}
				// Dispatch intent can become durable only after a fresh,
				// synchronous frozen-policy AND live Provider generation check.
				const frozen = await frozenFromRun(tx, command.userId, command.appId, command.runId);
				const provider =
					frozen === null ? null : await this.providers.snapshot(tx, command.userId, frozen.providerId);
				if (frozen === null || !authorize(frozen, provider)) {
					return { status: 'policy_blocked' };
				}
			}
			if ((await change(tx, current)) === 'step_conflict') {
				return { status: 'step_conflict' };
			}
			const updated = await step(tx, command);
			if (!updated) {
				throw new Error('Model step disappeared in transaction');
			}
			return { status: 'ok', step: updated };
		});
	}

	dispatch(
		command: StepVersionedScope,
		authorize: RunStepPolicyCheck,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StepWriteResult> {
		return this.mutate(
			command,
			['reserved'],
			async (tx, current) => {
				admitBudget(
					await frozenExecution(tx, command.runId),
					await executionUsage(tx, command.runId, command.userId),
				);
				if (command.stepIndex === 1) {
					await advanceRun(tx, command, 'pending', 'running', 'run.started');
				}
				const updated = await tx.run(
					`UPDATE agent_run_model_steps SET state=?,expected_run_version=?,revision=?,updated_at=?
				 WHERE run_id=? AND step_index=? AND revision=?`,
					[
						'dispatched',
						command.expectedRunVersion + (command.stepIndex === 1 ? 1 : 0),
						current.revision + 1,
						command.now,
						command.runId,
						command.stepIndex,
						current.revision,
					],
				);
				if (updated.changes !== 1) {
					throw new Error('Lost Run model dispatch CAS in transaction');
				}
			},
			authorize,
			2,
		);
	}

	appendText(command: StepVersionedScope, text: string): Promise<StepWriteResult> {
		const bytes = Buffer.byteLength(text, 'utf8');
		if (!bytes || bytes > AGENT_RUN_STEP_MAX_TEXT_BYTES) {
			throw new Error('Invalid model delta length');
		}
		return this.mutate(command, ['dispatched'], async (tx, current) => {
			assertRunRevisionAvailable(current.revision, 2);
			if (current.textBytes + bytes > AGENT_RUN_STEP_MAX_TEXT_BYTES) {
				throw new Error('Run model step output limit');
			}
			const updated = await tx.run(
				'UPDATE agent_run_model_steps SET text_bytes=?,revision=?,updated_at=? WHERE run_id=? AND step_index=? AND revision=?',
				[
					current.textBytes + bytes,
					current.revision + 1,
					command.now,
					command.runId,
					command.stepIndex,
					current.revision,
				],
			);
			if (updated.changes !== 1) {
				throw new Error('Lost Run model delta CAS in transaction');
			}
			await insertEvent(
				tx,
				command.runId,
				command.stepIndex,
				current.revision + 1,
				'text.delta',
				command.now,
				text,
			);
		});
	}

	recordUsage(command: StepVersionedScope, inputTokens: number, outputTokens: number): Promise<StepWriteResult> {
		if (![inputTokens, outputTokens].every((v) => Number.isSafeInteger(v) && v >= 0)) {
			throw new Error('Invalid model token usage');
		}
		return this.mutate(command, ['dispatched'], async (tx, current) => {
			assertRunRevisionAvailable(current.revision, 2);
			if (current.inputTokens !== undefined || current.outputTokens !== undefined) {
				throw new Error('Duplicate model usage');
			}
			const updated = await tx.run(
				'UPDATE agent_run_model_steps SET input_tokens=?,output_tokens=?,revision=?,updated_at=? WHERE run_id=? AND step_index=? AND revision=?',
				[
					inputTokens,
					outputTokens,
					current.revision + 1,
					command.now,
					command.runId,
					command.stepIndex,
					current.revision,
				],
			);
			if (updated.changes !== 1) {
				throw new Error('Lost Run model usage CAS in transaction');
			}
			await insertEvent(
				tx,
				command.runId,
				command.stepIndex,
				current.revision + 1,
				'usage',
				command.now,
				null,
				inputTokens,
				outputTokens,
			);
		});
	}

	finish(
		command: StepVersionedScope,
		result: StepFinish,
		maySettle: (hasUnsettledTools: boolean, hasUnsettledChildren: boolean) => boolean,
	): Promise<StepWriteResult> {
		if (result.state === 'failed' && result.failureCode !== 'DISPATCH_NOT_STARTED') {
			throw new Error('Invalid model failure classification');
		}
		return this.mutate(command, ['reserved', 'dispatched'], async (tx, current) => {
			const unsettled = await tx.one(
				"SELECT 1 FROM agent_run_tools WHERE run_id=? AND state IN ('inspected','dispatched','unknown') LIMIT 1",
				[command.runId],
			);
			const children = await tx.one(
				"SELECT 1 FROM agent_run_children c JOIN agent_runs r ON r.id=c.run_id WHERE c.parent_id=? AND r.status!='completed' LIMIT 1",
				[command.runId],
			);
			if (!maySettle(unsettled !== null, children !== null)) {
				return 'step_conflict';
			}
			if (current.state === 'reserved' && result.state === 'unknown') {
				throw new Error('An undispatched model step cannot have unknown remote side effects');
			}
			if (
				result.state === 'completed' &&
				(current.state !== 'dispatched' || (result.finishReason === 'stop' && current.textBytes === 0))
			) {
				throw new Error('Cannot complete a model request without confirmed output');
			}
			if (result.state === 'completed' && result.finishReason === 'stop') {
				if (Buffer.byteLength(result.outputText, 'utf8') !== current.textBytes) {
					throw new Error('Final output does not match model journal');
				}
				const child = await tx.one('SELECT run_id FROM agent_run_children WHERE run_id=?', [command.runId]);
				if (child) {
					if (current.textBytes > 8192) {
						throw new Error('Child completion output exceeded its bound');
					}
					await tx.run('UPDATE agent_run_children SET output_text=? WHERE run_id=?', [
						result.outputText,
						command.runId,
					]);
				}
			}
			const isProposal = result.state === 'completed' && result.finishReason === 'tool_calls';
			const proposals = isProposal ? readStepProposals(JSON.stringify(result.proposals)) : [];
			if (isProposal && proposals.length === 0) {
				throw new Error('Missing completed tool proposals');
			}
			const kind =
				result.state === 'completed'
					? 'step.completed'
					: result.state === 'failed'
						? 'step.failed'
						: 'step.unknown';
			const updated = await tx.run(
				`UPDATE agent_run_model_steps SET state=?,finish_reason=?,proposals_json=?,failure_code=?,
				 expected_run_version=?,revision=?,updated_at=? WHERE run_id=? AND step_index=? AND revision=?`,
				[
					result.state,
					result.state === 'completed' ? result.finishReason : null,
					JSON.stringify(proposals),
					result.state === 'failed' ? result.failureCode : null,
					command.expectedRunVersion + (isProposal ? 0 : 1),
					current.revision + 1,
					command.now,
					command.runId,
					command.stepIndex,
					current.revision,
				],
			);
			if (updated.changes !== 1) {
				throw new Error('Lost Run model terminal CAS in transaction');
			}
			await insertEvent(tx, command.runId, command.stepIndex, current.revision + 1, kind, command.now);
			if (isProposal) {
				return;
			}
			const event =
				result.state === 'completed'
					? 'run.completed'
					: result.state === 'failed'
						? 'run.failed'
						: 'run.unknown';
			await advanceRun(
				tx,
				command,
				current.state === 'reserved' && command.stepIndex === 1 ? 'pending' : 'running',
				result.state,
				event,
			);
		});
	}

	endRoot(
		command: StepVersionedScope,
		decide: (hasUnconfirmedEffects: boolean) => 'failed' | 'unknown',
	): Promise<StepWriteResult> {
		return this.mutate(
			command,
			['completed'],
			async (tx, current) => {
				if (current.finishReason !== 'tool_calls') {
					return 'step_conflict';
				}
				const unsettled = await tx.one(
					"SELECT 1 FROM agent_run_tools WHERE run_id=? AND state IN ('dispatched','unknown') UNION ALL SELECT 1 FROM agent_run_children c JOIN agent_runs r ON r.id=c.run_id WHERE c.parent_id=? AND r.status IN ('running','unknown') LIMIT 1",
					[command.runId, command.runId],
				);
				const state = decide(unsettled !== null);
				await advanceRun(tx, command, 'running', state, state === 'unknown' ? 'run.unknown' : 'run.failed');
			},
			undefined,
			0,
		);
	}

	async get(userId: number, appId: string, runId: string, stepIndex: number): Promise<StoredRunStep | null> {
		const row = await this.db.one(
			'SELECT ' +
				STEP_COLUMNS +
				' FROM agent_run_model_steps s JOIN agent_runs r ON r.id=s.run_id WHERE r.user_id=? AND r.app_id=? AND s.run_id=? AND s.step_index=?',
			[userId, appId, runId, stepIndex],
		);
		return row === null ? null : decodeStep(row);
	}

	listEvents(
		userId: number,
		appId: string,
		runId: string,
		stepIndex: number,
		after: number,
		limit: number,
	): Promise<StoredRunStepEventPage | null> {
		if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new Error('Invalid model step event pagination');
		}
		return this.db.transaction(async (tx) => {
			const current = await tx.one(
				'SELECT ' +
					STEP_COLUMNS +
					` FROM agent_run_model_steps s JOIN agent_runs r ON r.id=s.run_id
				 WHERE r.user_id=? AND r.app_id=? AND s.run_id=? AND s.step_index=?`,
				[userId, appId, runId, stepIndex],
			);
			if (!current) {
				return null;
			}
			const rows = await tx.all(
				`SELECT run_id,step_index,sequence,kind,text_delta,input_tokens,output_tokens,created_at
				 FROM agent_run_model_step_events WHERE run_id=? AND step_index=? AND sequence>?
				 ORDER BY sequence ASC LIMIT ?`,
				[runId, stepIndex, after, limit],
			);
			const snapshot = decodeStep(current);
			const firstSequence = snapshot.state === 'failed' && snapshot.revision === 2 ? 2 : 3;
			const cursor = Math.max(after, firstSequence - 1);
			if (rows.length !== Math.min(limit, Math.max(0, snapshot.revision - cursor))) {
				throw new Error('Incomplete model step event journal');
			}
			const items = rows.map((row, index) => {
				const value = readStepEvent(row);
				if (value.runId !== runId || value.stepIndex !== stepIndex || value.sequence !== cursor + index + 1) {
					throw new Error('Corrupt Run step event identity');
				}
				if (value.sequence === snapshot.revision) {
					const terminal = snapshot.state !== 'reserved' && snapshot.state !== 'dispatched';
					if (
						value.createdAt !== snapshot.updatedAt ||
						(terminal
							? value.kind !== 'step.' + snapshot.state
							: value.kind !== 'text.delta' && value.kind !== 'usage')
					) {
						throw new Error('Model step event does not match current step');
					}
					if (
						value.kind === 'usage' &&
						(value.inputTokens !== snapshot.inputTokens || value.outputTokens !== snapshot.outputTokens)
					) {
						throw new Error('Model step usage does not match current step');
					}
				}
				return value;
			});
			return { items, nextCursor: items.length ? items[items.length - 1].sequence : after };
		});
	}

	/** Only a dispatched step can have reached the provider; never retry it. */
	reconcileUnsettled(now: number): Promise<number> {
		return this.db.transaction(async (tx) => {
			// Each write changes the parent and step in one transaction. A
			// mismatched pair cannot be a normal crash boundary. In particular,
			// an unknown parent is terminal too: do not quietly settle its
			// leftover dispatched step without a matching parent event/version.
			await validateRunStepRecovery(tx);
			const exhausted = await tx.one(
				`SELECT id FROM agent_runs WHERE status IN ('pending','running') AND version>=?
				 UNION ALL SELECT run_id FROM agent_run_model_steps WHERE state IN ('reserved','dispatched') AND revision>=? LIMIT 1`,
				[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
			);
			if (exhausted) {
				throw new Error('Run recovery revision exhausted');
			}
			// Dispatched means the external side effect is unknown; reserved
			// means no dispatch occurred. Parent and step must settle together.
			// Historical command-idempotency snapshots remain immutable.
			// A running parent with no unsettled child is an inconsistent
			// remote-dispatch record: fail closed as unknown, never as success.
			const parentEvents = await tx.run(
				`INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
				 SELECT r.id,(SELECT COALESCE(MAX(e.sequence),0)+1 FROM agent_run_events e WHERE e.run_id=r.id),
				        CASE WHEN r.status='running' OR EXISTS(SELECT 1 FROM agent_run_model_steps d WHERE d.run_id=r.id AND d.state='dispatched')
				             OR EXISTS(SELECT 1 FROM agent_run_tools t WHERE t.run_id=r.id AND t.state IN ('dispatched','unknown'))
				             THEN 'run.unknown' ELSE 'run.failed' END,r.version+1,?
				 FROM agent_runs r
				 WHERE r.status IN ('pending','running')`,
				[now],
			);
			const parentChanges = await tx.run(
				`UPDATE agent_runs
				 SET status=CASE WHEN status='running' OR EXISTS(SELECT 1 FROM agent_run_model_steps d
				                             WHERE d.run_id=agent_runs.id AND d.state='dispatched')
				                     OR EXISTS(SELECT 1 FROM agent_run_tools t WHERE t.run_id=agent_runs.id AND t.state IN ('dispatched','unknown'))
				                 THEN 'unknown' ELSE 'failed' END,
				     version=version+1,updated_at=?
				 WHERE status IN ('pending','running')`,
				[now],
			);
			if (parentChanges.changes !== parentEvents.changes) {
				throw new Error('Run recovery event/state mismatch');
			}
			const stepEvents = await tx.run(
				`INSERT INTO agent_run_model_step_events(run_id,step_index,sequence,kind,created_at)
				 SELECT run_id,step_index,revision+1,
				        CASE WHEN state='reserved' THEN 'step.failed' ELSE 'step.unknown' END,?
				 FROM agent_run_model_steps WHERE state IN ('reserved','dispatched')`,
				[now],
			);
			const result = await tx.run(
				`UPDATE agent_run_model_steps
				 SET failure_code=CASE WHEN state='reserved' THEN 'DISPATCH_NOT_STARTED' ELSE NULL END,
				     state=CASE WHEN state='reserved' THEN 'failed' ELSE 'unknown' END,
				     expected_run_version=(SELECT version FROM agent_runs WHERE id=agent_run_model_steps.run_id),
				     revision=revision+1,updated_at=?
				 WHERE state IN ('reserved','dispatched')`,
				[now],
			);
			if (result.changes !== stepEvents.changes) {
				throw new Error('Run step recovery event/state mismatch');
			}
			await fenceTerminalRunTools(tx, now);
			return result.changes;
		});
	}
}
