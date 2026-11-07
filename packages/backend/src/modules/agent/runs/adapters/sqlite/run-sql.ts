import { AGENT_RUN_FAILURE_CODES } from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_OPERATION_ERROR_CODES } from '@nexus-terminal/shared/agent/values';
import { resumeRun, readRunSuspension } from './run-resume-sql.js';
import type { RunResumeStorage } from '../../storage/run-resume-storage.js';
import { failUnstartedRun, runOperationUsage, recoverRunExecutions } from './run-lifecycle-sql.js';
import type { StoredRunUnstartedFailure, StoredRunUsage } from '../../storage/run-storage.js';
import { startRunApp, finishRunApp } from './run-app-terminal-sql.js';
import type { StoredRunAppMutation, StoredRunAppResult, StoredRunAppTerminal } from '../../storage/run-app-storage.js';
import { mayAdmitPluginRun } from '../../../plugins/adapters/sqlite/plugin-operation-authority.js';
import { appExecutionBinding } from '../../../plugins/adapters/sqlite/plugin-app-execution-sql.js';
import { readRunAppExecution } from './run-app-execution-row.js';

import type { StoredRunFailure } from '../../storage/run-storage.js';
import { decodeRun, decodeEvent } from './run-row.js';
import { readOverrides } from '../../../governance/adapters/sqlite/governance-row.js';
import type { StoredPolicyOverrides } from '../../../governance/storage/governance-storage.js';
import { executionSettings } from '../../../execution/adapters/sqlite/execution-sql.js';
import type { StoredExecutionSettings } from '../../../execution/storage/execution-storage.js';
import { appAuthority } from '../../../scope/adapters/sqlite/app-row.js';
import { nextThreadSequence } from './run-order.js';
import type { StoredAppAuthority } from '../../../scope/storage/scope-storage.js';
import { fenceRunExecution } from './run-fence.js';
import type { AgentRunCommandOutcome } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { StoredFrozenInput, StoredRunAppExecution } from '../../storage/run-storage.js';
import type {
	RunStorage,
	StoredRun,
	CreateRunStorageCommand,
	CancelRunStorageCommand,
	StoredCreateResult,
	StoredCancelResult,
	StoredCancelRunDecision,
	RunEventPageRecord,
} from '../../storage/run-storage.js';

type Row = Record<string, unknown>;

function stringValue(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt Agent text');
	}
	return value;
}

function integer(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt Agent integer');
	}
	return value;
}

function decodeReplay(row: Row): {
	hash: string;
	outcome: AgentRunCommandOutcome;
	run: StoredRun;
} {
	const outcome = row.result_outcome;
	if (outcome !== 'created' && outcome !== 'cancelled' && outcome !== 'already_cancelled') {
		throw new Error('Corrupt Agent idempotency state');
	}
	const run = decodeRun({
		id: row.run_id,
		user_id: row.user_id,
		app_id: row.app_id,
		thread_id: row.thread_id,
		approval_mode: row.approval_mode,
		status: row.result_status,
		version: row.result_version,
		created_at: row.result_created_at,
		updated_at: row.result_updated_at,
	});
	const hash = stringValue(row.request_hash);
	if (
		!/^[a-f0-9]{64}$/u.test(hash) ||
		(outcome === 'created' ? run.status !== 'pending' || run.version !== 1 : run.status !== 'cancelled')
	) {
		throw new Error('Corrupt Run idempotency snapshot');
	}
	return { hash, outcome, run };
}

const SELECT_RUN = `
	SELECT id,user_id,app_id,thread_id,approval_mode,status,version,created_at,updated_at FROM agent_runs
`;

/** The Run-owned SQLite adapter decodes frozen JSON inside an existing transaction. */
export async function frozenFromRun(
	tx: SqlReader,
	userId: number,
	appId: string,
	runId: string,
): Promise<StoredFrozenInput | null> {
	const row = await tx.one(
		'SELECT i.app_execution_json,i.input_json FROM agent_runs r JOIN agent_run_inputs i ON i.run_id=r.id WHERE r.id=? AND r.user_id=? AND r.app_id=?',
		[runId, userId, appId],
	);
	if (!row) {
		return null;
	}
	if (typeof row.input_json !== 'string') {
		throw new Error('Corrupt App input');
	}
	JSON.parse(row.input_json);
	return { appExecution: readRunAppExecution(row.app_execution_json), inputJson: row.input_json };
}

const SELECT_REPLAY = `
	SELECT i.user_id,i.app_id,i.run_id,i.request_hash,i.result_status,i.result_outcome,
		i.result_version,i.result_created_at,i.result_updated_at,r.thread_id,r.approval_mode
	FROM agent_command_idempotency i
	JOIN agent_runs r ON r.id=i.run_id
	WHERE i.user_id=? AND i.app_id=? AND i.command_name=? AND i.operation_key=?
`;

async function replay(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	operation: string,
	operationKey: string,
): Promise<ReturnType<typeof decodeReplay> | null> {
	const row = await tx.one(SELECT_REPLAY, [userId, appId, operation, operationKey]);
	return row === null ? null : decodeReplay(row);
}

async function saveReplay(
	tx: SqlExecutor,
	command: { userId: number; appId: string; operationKey: string; requestHash: string },
	name: 'create_run' | 'cancel_run',
	run: StoredRun,
	outcome: AgentRunCommandOutcome,
): Promise<void> {
	await tx.run(
		`
		INSERT INTO agent_command_idempotency(
			user_id,app_id,command_name,operation_key,request_hash,run_id,
			result_status,result_outcome,result_version,result_created_at,result_updated_at
		) VALUES(?,?,?,?,?,?,?,?,?,?,?)
	`,
		[
			command.userId,
			command.appId,
			name,
			command.operationKey,
			command.requestHash,
			run.id,
			run.status,
			outcome,
			run.version,
			run.createdAt,
			run.updatedAt,
		],
	);
}

export class SqliteRunStorage implements RunStorage {
	resume(...args: Parameters<RunResumeStorage['resume']>): ReturnType<RunResumeStorage['resume']> {
		return this.db.transaction((tx) => resumeRun(tx, args[0], args[1]));
	}

	suspension(userId: number, appId: string, runId: string): ReturnType<RunResumeStorage['suspension']> {
		return this.db.transaction((tx) => readRunSuspension(tx, userId, appId, runId));
	}

	ownExecution(work: () => Promise<void>): Promise<void> {
		return this.db.withoutTransactionAdmission(work);
	}

	constructor(private readonly db: SqliteRuntime) {}

	create(
		command: CreateRunStorageCommand,
		mayCreate: (active: StoredRun | null) => boolean,
		authorizeApp: (current: StoredAppAuthority) => void,
		authorizeOrigin: (current: StoredRun | null) => void,
		freezeExecution: (
			current: StoredExecutionSettings | null,
			activeRuns: number,
			overrides: StoredPolicyOverrides,
		) => StoredExecutionSettings,
	): Promise<StoredCreateResult> {
		return this.db.transaction(async (tx) => {
			const previous = await replay(tx, command.userId, command.appId, 'create_run', command.operationKey);
			if (previous !== null) {
				if (previous.hash !== command.requestHash || previous.outcome !== 'created') {
					return { status: 'idempotency_conflict' };
				}
				return { status: 'replayed', originalStatus: 'created', run: previous.run };
			}
			if (command.origin !== null) {
				const source = await tx.one(
					"SELECT * FROM agent_runs WHERE user_id=? AND app_id=? AND thread_id=? AND id=? AND run_kind='root'",
					[command.userId, command.appId, command.threadId, command.origin.runId],
				);
				authorizeOrigin(source === null ? null : decodeRun(source));
			}
			const scope = await tx.one(
				`
				SELECT t.id FROM agent_threads t
				JOIN agent_apps a ON a.id=t.app_id AND a.user_id=t.user_id
				WHERE t.id=? AND t.app_id=? AND t.user_id=?
			`,
				[command.threadId, command.appId, command.userId],
			);
			if (scope === null) {
				return { status: 'scope_not_found' };
			}
			const authority = await appAuthority(tx, command.userId, command.appId);
			if (authority === null) {
				return { status: 'scope_not_found' };
			}
			authorizeApp(authority);
			if (!(await mayAdmitPluginRun(tx, command.userId, command.appId))) {
				return { status: 'active_run_conflict' };
			}
			const policyBinding = await appExecutionBinding(tx, command.userId, command.appId);
			if (!policyBinding) {
				return { status: 'active_run_conflict' };
			}
			const appExecution: StoredRunAppExecution = {
				kind: 'plugin',
				package: {
					packageId: policyBinding.package.packageId,
					version: policyBinding.package.version,
					packageHash: policyBinding.package.packageHash,
					publisherKeyId: policyBinding.package.publisherKeyId,
				},
				codeDependencies: policyBinding.codeDependencies.map((dependency) => ({
					packageId: dependency.packageId,
					version: dependency.version,
					packageHash: dependency.packageHash,
					publisherKeyId: dependency.publisherKeyId,
				})),
				handler: policyBinding.handler,
			};
			const row = await tx.one(
				SELECT_RUN +
					" WHERE thread_id=? AND run_kind='root' AND status IN ('pending','running','suspended','unknown')",
				[command.threadId],
			);
			const active = row === null ? null : decodeRun(row);
			if (!mayCreate(active)) {
				return { status: 'active_run_conflict' };
			}
			const occupied = await tx.one(
				"SELECT COUNT(*) AS count FROM agent_runs WHERE user_id=? AND status IN ('pending','running','unknown')",
				[command.userId],
			);
			if (!occupied) {
				throw new Error('Execution occupancy missing');
			}
			const policy = await tx.one(
				'SELECT execution_overrides_json FROM agent_governance_policies WHERE user_id=? AND app_id=?',
				[command.userId, command.appId],
			);
			const execution = freezeExecution(
				await executionSettings(tx, command.userId),
				integer(occupied.count),
				policy === null ? {} : readOverrides(policy.execution_overrides_json),
			);

			const threadSequence = await nextThreadSequence(tx, command.threadId);
			const createdAt = Date.now();
			const deadlineAt = createdAt + execution.limits.maxActiveSeconds * 1000;
			await tx.run(
				`
				INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,status,version,input_text,selected_connections_json,created_at,updated_at,deadline_at,approval_mode)
				VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
			`,
				[
					command.id,
					command.userId,
					command.appId,
					command.threadId,
					threadSequence,
					'root',
					'pending',
					1,
					command.inputText,
					JSON.stringify(command.connectionIds),
					createdAt,
					createdAt,
					deadlineAt,
					command.approvalMode,
				],
			);
			const run: StoredRun = {
				id: command.id,
				userId: command.userId,
				appId: command.appId,
				threadId: command.threadId,
				approvalMode: command.approvalMode,
				status: 'pending',
				version: 1,
				createdAt,
				updatedAt: createdAt,
			};
			await tx.run(
				'INSERT INTO agent_run_inputs(run_id,app_execution_json,input_json,output_json) VALUES(?,?,?,NULL)',
				[run.id, JSON.stringify(appExecution), command.inputJson],
			);

			await tx.run(
				`
				INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
				VALUES(?,?,?,?,?)
			`,
				[run.id, 1, 'run.created', run.version, run.createdAt],
			);
			await tx.run('INSERT INTO agent_run_execution_settings(run_id,settings_json) VALUES(?,?)', [
				command.id,
				JSON.stringify(execution),
			]);
			await saveReplay(tx, command, 'create_run', run, 'created');
			return { status: 'created', run };
		});
	}

	failUnstarted(command: StoredRunUnstartedFailure): Promise<boolean> {
		return this.db.transaction((tx) => failUnstartedRun(tx, command));
	}

	usage(userId: number, appId: string, runId: string): Promise<StoredRunUsage | null> {
		return this.db.transaction((tx) => runOperationUsage(tx, userId, appId, runId));
	}

	recover(now: number): Promise<number> {
		return this.db.transaction((tx) => recoverRunExecutions(tx, now));
	}

	startApp(command: StoredRunAppMutation): Promise<StoredRunAppResult> {
		return this.db.transaction((tx) => startRunApp(tx, command));
	}

	finishApp(command: StoredRunAppMutation, terminal: StoredRunAppTerminal): Promise<StoredRunAppResult> {
		return this.db.transaction((tx) => finishRunApp(tx, command, terminal));
	}

	async frozen(userId: number, appId: string, runId: string): Promise<StoredFrozenInput | null> {
		return frozenFromRun(this.db, userId, appId, runId);
	}

	cancel(
		command: CancelRunStorageCommand,
		decide: (run: StoredRun) => StoredCancelRunDecision,
	): Promise<StoredCancelResult> {
		return this.db.transaction(async (tx) => {
			const previous = await replay(tx, command.userId, command.appId, 'cancel_run', command.operationKey);
			if (previous !== null) {
				if (
					previous.hash !== command.requestHash ||
					previous.outcome === 'created' ||
					previous.run.id !== command.runId
				) {
					return { status: 'idempotency_conflict' };
				}
				return { status: 'replayed', originalStatus: previous.outcome, run: previous.run };
			}
			const row = await tx.one(SELECT_RUN + ' WHERE id=? AND app_id=? AND user_id=?', [
				command.runId,
				command.appId,
				command.userId,
			]);
			if (row === null) {
				return { status: 'not_found' };
			}
			const current = decodeRun(row);
			const decision = decide(current);
			if (decision === 'version_conflict') {
				return { status: 'version_conflict' };
			}
			if (decision === 'active_run_conflict') {
				return { status: 'active_run_conflict' };
			}
			if (decision === 'already_cancelled') {
				await saveReplay(tx, command, 'cancel_run', current, 'already_cancelled');
				return { status: 'already_cancelled', run: current };
			}
			if (current.version === Number.MAX_SAFE_INTEGER) {
				return { status: 'version_conflict' };
			}
			const updated: StoredRun = {
				id: current.id,
				userId: current.userId,
				appId: current.appId,
				threadId: current.threadId,
				approvalMode: current.approvalMode,
				status: 'cancelled',
				version: current.version + 1,
				createdAt: current.createdAt,
				updatedAt: Date.now(),
			};
			const changed = await tx.run(
				`
				UPDATE agent_runs SET status='cancelled',version=?,updated_at=?
				WHERE id=? AND app_id=? AND user_id=? AND status IN ('pending','running','suspended','unknown') AND version=?
			`,
				[updated.version, updated.updatedAt, updated.id, updated.appId, updated.userId, current.version],
			);
			if (changed.changes !== 1) {
				throw new Error('Lost Agent Run CAS inside transaction');
			}
			const maximum = await tx.one('SELECT MAX(sequence) AS last_sequence FROM agent_run_events WHERE run_id=?', [
				updated.id,
			]);
			if (maximum === null) {
				throw new Error('Missing Agent event watermark');
			}
			const sequence = integer(integer(maximum.last_sequence, 1) + 1, 1);
			await tx.run(
				`
				INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
				VALUES(?,?,?,?,?)
			`,
				[updated.id, sequence, 'run.cancelled', updated.version, updated.updatedAt],
			);
			await saveReplay(tx, command, 'cancel_run', updated, 'cancelled');
			await fenceRunExecution(tx, updated.id, updated.updatedAt);
			return { status: 'cancelled', run: updated };
		});
	}

	async failure(userId: number, appId: string, runId: string): Promise<StoredRunFailure | null> {
		const job = await this.db.one(
			`SELECT o.label FROM agent_tool_jobs j JOIN agent_operations o ON o.id=j.id
			 JOIN agent_runs r ON r.id=? AND r.user_id=j.user_id AND r.app_id=j.app_id
			 WHERE j.user_id=? AND j.app_id=? AND j.state='unknown' AND r.status IN ('failed','unknown')
			 AND (j.run_id=r.id OR EXISTS(SELECT 1 FROM agent_run_children c WHERE c.run_id=j.run_id AND c.parent_id=r.id))
			 ORDER BY j.updated_at,j.id LIMIT 1`,
			[runId, userId, appId],
		);
		if (job) {
			return { kind: 'job_unknown', toolName: stringValue(job.label) };
		}
		const diagnostic = await this.db.one(
			`SELECT d.code,COALESCE((WITH RECURSIVE ancestors(id,parent_id,kind,label,depth) AS (
 SELECT a.id,a.parent_id,a.kind,a.label,0 FROM agent_operations a WHERE a.id=o.parent_id
 UNION ALL SELECT a.id,a.parent_id,a.kind,a.label,b.depth+1 FROM agent_operations a JOIN ancestors b ON a.id=b.parent_id)
 SELECT label FROM ancestors WHERE kind='tool' ORDER BY depth LIMIT 1),CASE WHEN o.kind='model' THEN NULL ELSE o.label END) AS label
 FROM agent_operation_diagnostics d JOIN agent_operations o ON o.id=d.operation_id
 JOIN agent_runs r ON r.id=o.run_id WHERE o.user_id=? AND o.app_id=? AND o.run_id=?
 AND r.status IN ('failed','unknown') AND o.state IN ('failed','unknown')
 ORDER BY o.sequence DESC LIMIT 1`,
			[userId, appId, runId],
		);
		if (diagnostic) {
			const code = AGENT_RUN_FAILURE_CODES.find((value) => value === diagnostic.code);
			if (!code) {
				throw new Error('Corrupt operation diagnostic');
			}
			return {
				kind: 'diagnostic',
				code,
				toolName: diagnostic.label === null ? null : stringValue(diagnostic.label),
			};
		}
		const row = await this.db.one(
			`SELECT o.label,o.state,o.failure_code FROM agent_operations o JOIN agent_runs r ON r.id=o.run_id
			 WHERE o.user_id=? AND o.app_id=? AND o.run_id=? AND r.status IN ('failed','unknown')
			 AND o.state IN ('failed','unknown') ORDER BY o.sequence DESC LIMIT 1`,
			[userId, appId, runId],
		);
		if (!row) {
			return null;
		}
		const code =
			row.state === 'unknown'
				? 'operation_unknown'
				: AGENT_OPERATION_ERROR_CODES.find((value) => value === row.failure_code);
		if (!code) {
			throw new Error('Corrupt operation failure code');
		}
		return { kind: 'operation', code, toolName: stringValue(row.label) };
	}

	async get(userId: number, appId: string, runId: string): Promise<StoredRun | null> {
		const row = await this.db.one(SELECT_RUN + ' WHERE id=? AND app_id=? AND user_id=?', [runId, appId, userId]);
		return row === null ? null : decodeRun(row);
	}

	list(
		userId: number,
		appId: string,
		threadId: string,
		after: number,
		limit: number,
	): Promise<{ items: StoredRun[]; nextCursor: number } | null> {
		return this.db.transaction(async (tx) => {
			if (
				!(await tx.one('SELECT id FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
					userId,
					appId,
					threadId,
				]))
			) {
				return null;
			}
			const rows = await tx.all(
				"SELECT * FROM agent_runs WHERE user_id=? AND app_id=? AND thread_id=? AND run_kind='root' AND thread_sequence>? ORDER BY thread_sequence LIMIT ?",
				[userId, appId, threadId, after, limit],
			);
			return {
				items: rows.map(decodeRun),
				nextCursor: rows.length ? integer(rows[rows.length - 1].thread_sequence, after + 1) : after,
			};
		});
	}

	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPageRecord | null> {
		return this.db.transaction(async (tx) => {
			const run = await tx.one(SELECT_RUN + ' WHERE id=? AND app_id=? AND user_id=?', [runId, appId, userId]);
			if (run === null) {
				return null;
			}
			const rows = await tx.all(
				`
				SELECT run_id,sequence,event_type,run_version,created_at FROM agent_run_events
				WHERE run_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?
			`,
				[runId, after, limit],
			);
			const current = decodeRun(run);
			const items = rows.map(decodeEvent);
			if (items.length !== Math.min(limit, Math.max(0, current.version - after))) {
				throw new Error('Incomplete Run event journal');
			}
			for (const [index, event] of items.entries()) {
				if (
					event.runId !== current.id ||
					event.sequence !== after + index + 1 ||
					event.runVersion !== event.sequence
				) {
					throw new Error('Inconsistent Run event journal');
				}
				const currentType =
					current.status === 'pending'
						? current.version === 1
							? 'run.created'
							: 'run.resumed'
						: current.status === 'running'
							? 'run.started'
							: 'run.' + current.status;
				if (
					event.sequence === current.version &&
					(event.type !== currentType || event.createdAt !== current.updatedAt)
				) {
					throw new Error('Run event does not match current Run');
				}
			}
			return { items, nextCursor: items.length ? items[items.length - 1].sequence : after };
		});
	}
}
