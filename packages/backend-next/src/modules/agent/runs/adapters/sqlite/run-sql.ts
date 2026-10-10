import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	RunStorage,
	StoredRun,
	StoredRunEvent,
	CreateRunStorageCommand,
	CancelRunStorageCommand,
	StoredCreateResult,
	StoredCancelResult,
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

function runStatus(value: unknown): 'pending' | 'cancelled' {
	if (value === 'pending' || value === 'cancelled') {
		return value;
	}
	throw new Error('Corrupt Agent Run status');
}

function decodeRun(row: Row): StoredRun {
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

function decodeEvent(row: Row): StoredRunEvent {
	const type = row.event_type;
	if (type !== 'run.created' && type !== 'run.cancelled') {
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
	outcome: 'created' | 'cancelled' | 'already_cancelled';
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
	outcome: 'created' | 'cancelled' | 'already_cancelled',
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
	constructor(private readonly db: SqliteRuntime) {}

	create(
		command: CreateRunStorageCommand,
		mayCreate: (active: StoredRun | null) => boolean,
	): Promise<StoredCreateResult> {
		return this.db.transaction(async (tx) => {
			const previous = await replay(tx, command.userId, command.appId, 'create_run', command.operationKey);
			if (previous !== null) {
				if (previous.hash !== command.requestHash || previous.outcome !== 'created') {
					return { status: 'idempotency_conflict' };
				}
				return { status: 'replayed', originalStatus: 'created', run: previous.run };
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
			const row = await tx.one(SELECT_RUN + ' WHERE thread_id=? AND status=?', [command.threadId, 'pending']);
			const active = row === null ? null : decodeRun(row);
			if (!mayCreate(active)) {
				return { status: 'active_run_conflict' };
			}
			await tx.run(
				`
				INSERT INTO agent_runs(id,user_id,app_id,thread_id,run_kind,status,version,input_text,created_at,updated_at)
				VALUES(?,?,?,?,?,?,?,?,?,?)
			`,
				[
					command.id,
					command.userId,
					command.appId,
					command.threadId,
					'root',
					'pending',
					1,
					command.inputText,
					command.createdAt,
					command.createdAt,
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
				`
				INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at)
				VALUES(?,?,?,?,?)
			`,
				[run.id, 1, 'run.created', run.version, run.createdAt],
			);
			await saveReplay(tx, command, 'create_run', run, 'created');
			return { status: 'created', run };
		});
	}

	cancel(
		command: CancelRunStorageCommand,
		decide: (run: StoredRun) => 'cancel' | 'already_cancelled' | 'version_conflict',
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
				WHERE id=? AND app_id=? AND user_id=? AND status='pending' AND version=?
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
			return { status: 'cancelled', run: updated };
		});
	}

	async get(userId: number, appId: string, runId: string): Promise<StoredRun | null> {
		const row = await this.db.one(SELECT_RUN + ' WHERE id=? AND app_id=? AND user_id=?', [runId, appId, userId]);
		return row === null ? null : decodeRun(row);
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
