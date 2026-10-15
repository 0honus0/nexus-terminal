import { readOverrides } from '../../../governance/adapters/sqlite/governance-row.js';
import type { StoredPolicyOverrides } from '../../../governance/storage/governance-storage.js';
import { executionSettings } from '../../../execution/adapters/sqlite/execution-sql.js';
import type { StoredExecutionSettings } from '../../../execution/storage/execution-storage.js';
import { appAuthority } from '../../../scope/adapters/sqlite/app-row.js';
import { nextThreadSequence } from './run-order.js';
import type { StoredAppAuthority } from '../../../scope/storage/scope-storage.js';
import { fenceRunSteps } from './run-fence.js';
import type { AgentRunStatus, AgentRunCommandOutcome } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ProviderStorage } from '../../../providers/storage/provider-storage.js';
import type { ProviderStoredRow } from '../../../providers/storage/provider-storage.js';
import type { StoredModelReference } from '../../../providers/storage/provider-storage.js';
import { decodeStoredModel } from '../../../providers/adapters/sqlite/provider-row.js';
import type { StoredFrozenInput } from '../../storage/run-storage.js';
import type {
	RunStorage,
	StoredRun,
	StoredRunEvent,
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

function runStatus(value: unknown): AgentRunStatus {
	if (
		value === 'pending' ||
		value === 'running' ||
		value === 'completed' ||
		value === 'failed' ||
		value === 'unknown' ||
		value === 'cancelled'
	) {
		return value;
	}
	throw new Error('Corrupt Agent Run status');
}

export function decodeRun(row: Row): StoredRun {
	return {
		id: stringValue(row.id),
		userId: integer(row.user_id, 1),
		appId: stringValue(row.app_id),
		threadId: stringValue(row.thread_id),
		status: runStatus(row.status),
		version: integer(row.version, 1),
		createdAt: integer(row.created_at),
		updatedAt: integer(row.updated_at),
	};
}

export function decodeEvent(row: Row): StoredRunEvent {
	const type = row.event_type;
	if (
		type !== 'run.created' &&
		type !== 'run.started' &&
		type !== 'run.completed' &&
		type !== 'run.failed' &&
		type !== 'run.unknown' &&
		type !== 'run.cancelled'
	) {
		throw new Error('Corrupt Agent event');
	}
	return {
		runId: stringValue(row.run_id),
		sequence: integer(row.sequence, 1),
		type,
		runVersion: integer(row.run_version, 1),
		createdAt: integer(row.created_at),
	};
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
		status: row.result_status,
		version: row.result_version,
		created_at: row.result_created_at,
		updated_at: row.result_updated_at,
	});
	return { hash: stringValue(row.request_hash), outcome, run };
}

const SELECT_RUN = `
	SELECT id,user_id,app_id,thread_id,status,version,created_at,updated_at FROM agent_runs
`;

/** The Run-owned SQLite adapter decodes frozen JSON inside an existing transaction. */
export async function frozenFromRun(
	db: SqlReader,
	userId: number,
	appId: string,
	runId: string,
): Promise<StoredFrozenInput | null> {
	const row = await db.one(
		'SELECT f.provider_id,f.provider_version,f.credential_revision,f.model_id,f.base_url,f.protocol,f.capabilities_json,f.execution_policy FROM agent_run_frozen_inputs f JOIN agent_runs r ON r.id=f.run_id WHERE r.id=? AND r.user_id=? AND r.app_id=?',
		[runId, userId, appId],
	);
	if (!row) {
		return null;
	}
	const protocol = row.protocol;
	if (protocol !== 'responses' && protocol !== 'chat-completions') {
		throw new Error('Corrupt frozen protocol');
	}
	if (row.execution_policy !== 'governed') {
		throw new Error('Corrupt execution policy');
	}
	const modelId = stringValue(row.model_id);
	const capabilities = decodeStoredModel(JSON.parse(stringValue(row.capabilities_json)));
	if (capabilities.id !== modelId) {
		throw new Error('Corrupt frozen capability identity');
	}
	return {
		providerId: stringValue(row.provider_id),
		providerVersion: integer(row.provider_version, 1),
		credentialRevision: integer(row.credential_revision, 1),
		modelId,
		baseUrl: stringValue(row.base_url),
		protocol,
		capabilities,
		executionPolicy: 'governed',
	};
}

const SELECT_REPLAY = `
	SELECT i.user_id,i.app_id,i.run_id,i.request_hash,i.result_status,i.result_outcome,
		i.result_version,i.result_created_at,i.result_updated_at,r.thread_id
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
	ownExecution(work: () => Promise<void>): Promise<void> {
		return this.db.withoutTransactionAdmission(work);
	}

	constructor(
		private readonly db: SqliteRuntime,
		private readonly providers: ProviderStorage,
	) {}

	create(
		command: CreateRunStorageCommand,
		mayCreate: (active: StoredRun | null) => boolean,
		resolve: (provider: ProviderStoredRow, reference: StoredModelReference) => StoredFrozenInput | null,
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
			const row = await tx.one(
				SELECT_RUN + " WHERE thread_id=? AND run_kind='root' AND status IN ('pending','running','unknown')",
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
			const deadlineAt = command.createdAt + execution.limits.maxActiveSeconds * 1000;
			const provider = await this.providers.snapshot(tx, command.userId, command.model.providerId);
			const frozen = provider === null ? null : resolve(provider, command.model);
			if (!frozen) {
				return { status: 'provider_unavailable' };
			}
			await tx.run(
				`
				INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,status,version,input_text,selected_connections_json,created_at,updated_at,deadline_at)
				VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
			`,
				[
					command.id,
					command.userId,
					command.appId,
					command.threadId,
					await nextThreadSequence(tx, command.threadId),
					'root',
					'pending',
					1,
					command.inputText,
					JSON.stringify(command.connectionIds),
					command.createdAt,
					command.createdAt,
					deadlineAt,
				],
			);
			const run: StoredRun = {
				id: command.id,
				userId: command.userId,
				appId: command.appId,
				threadId: command.threadId,
				status: 'pending',
				version: 1,
				createdAt: command.createdAt,
				updatedAt: command.createdAt,
			};
			await tx.run(
				'INSERT INTO agent_run_frozen_inputs(run_id,provider_id,provider_version,credential_revision,model_id,base_url,protocol,capabilities_json,execution_policy) VALUES(?,?,?,?,?,?,?,?,?)',
				[
					run.id,
					frozen.providerId,
					frozen.providerVersion,
					frozen.credentialRevision,
					frozen.modelId,
					frozen.baseUrl,
					frozen.protocol,
					JSON.stringify(frozen.capabilities),
					frozen.executionPolicy,
				],
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
			const updated: StoredRun = {
				id: current.id,
				userId: current.userId,
				appId: current.appId,
				threadId: current.threadId,
				status: 'cancelled',
				version: current.version + 1,
				createdAt: current.createdAt,
				updatedAt: command.now,
			};
			const changed = await tx.run(
				`
				UPDATE agent_runs SET status='cancelled',version=?,updated_at=?
				WHERE id=? AND app_id=? AND user_id=? AND status IN ('pending','running','unknown') AND version=?
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
			const sequence = integer(maximum.last_sequence, 1) + 1;
			await tx.run(
				`
				INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
				VALUES(?,?,?,?,?)
			`,
				[updated.id, sequence, 'run.cancelled', updated.version, updated.updatedAt],
			);
			await saveReplay(tx, command, 'cancel_run', updated, 'cancelled');
			await fenceRunSteps(tx, updated.id, updated.version, updated.updatedAt);
			return { status: 'cancelled', run: updated };
		});
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
			const run = await tx.one('SELECT id FROM agent_runs WHERE id=? AND app_id=? AND user_id=?', [
				runId,
				appId,
				userId,
			]);
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
			const items = rows.map(decodeEvent);
			return { items, nextCursor: items.length ? items[items.length - 1].sequence : after };
		});
	}
}
