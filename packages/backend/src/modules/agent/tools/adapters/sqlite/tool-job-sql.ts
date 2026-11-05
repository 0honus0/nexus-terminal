import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { TOOL_RESULT_MAX_BYTES } from '../../../runs/run-tool-limits.js';
import { TOOL_JOB_STATES } from '../../tool-job-values.js';
import type {
	ToolJobStorage,
	StoredToolJobResult,
	StoredToolJob,
	StoredJobScope,
	StoredJobCreate,
	StoredJobChange,
} from '../../storage/tool-job-storage.js';

function integer(value: unknown, minimum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Invalid stored job integer');
	}
	return value;
}

function text(value: unknown, maxBytes: number): string {
	if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > maxBytes) {
		throw new Error('Invalid stored job text');
	}
	return value;
}

function storedResult(text: string): StoredToolJobResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw new Error('Corrupt stored job result', { cause });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Corrupt stored job result');
	}
	if (!('status' in value)) {
		throw new Error('Corrupt stored job result');
	}
	if (value.status === 'not_started' && Object.keys(value).length === 1) {
		return { status: value.status };
	}
	if (
		(value.status !== 'completed' && value.status !== 'nonzero') ||
		Object.keys(value).length !== 2 ||
		!('commands' in value) ||
		!Array.isArray(value.commands) ||
		!value.commands.length
	) {
		throw new Error('Corrupt stored job result');
	}
	let outputBytes = 0;
	let skipped = false;
	let failed = false;
	const commands: Exclude<StoredToolJobResult, { status: 'not_started' }>['commands'] = value.commands.map(
		(item: unknown, index: number) => {
			if (
				!item ||
				typeof item !== 'object' ||
				!('index' in item) ||
				item.index !== index ||
				!('status' in item)
			) {
				throw new Error('Corrupt stored job command');
			}
			if (item.status === 'not_started' && Object.keys(item).length === 2 && failed) {
				skipped = true;
				return { index, status: item.status };
			}
			if (
				skipped ||
				(item.status !== 'completed' && item.status !== 'nonzero') ||
				Object.keys(item).length !== 7 ||
				!('exitCode' in item) ||
				typeof item.exitCode !== 'number' ||
				!Number.isSafeInteger(item.exitCode) ||
				item.exitCode < 0 ||
				(item.status === 'completed') !== (item.exitCode === 0) ||
				!('signal' in item) ||
				(item.signal !== null && (typeof item.signal !== 'string' || Buffer.byteLength(item.signal) > 128)) ||
				!('stdout' in item) ||
				typeof item.stdout !== 'string' ||
				!('stderr' in item) ||
				typeof item.stderr !== 'string' ||
				!('truncated' in item) ||
				typeof item.truncated !== 'boolean'
			) {
				throw new Error('Corrupt stored job command');
			}
			outputBytes += Buffer.byteLength(item.stdout) + Buffer.byteLength(item.stderr);
			failed ||= item.status === 'nonzero';
			return {
				index,
				status: item.status,
				exitCode: item.exitCode,
				signal: item.signal,
				stdout: item.stdout,
				stderr: item.stderr,
				truncated: item.truncated,
			};
		},
	);
	if (outputBytes > 32 * 1024 + 4 || (value.status === 'nonzero') !== failed) {
		throw new Error('Corrupt stored job result');
	}
	return { status: value.status, commands };
}

export function readToolJob(value: Record<string, unknown>): StoredToolJob {
	const id = text(value.id, 36);
	const appId = text(value.app_id, 36);
	const runId = text(value.run_id, 36);
	const fingerprint = text(value.fingerprint, 64);
	if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
		throw new Error('Invalid stored job fingerprint');
	}
	const state = TOOL_JOB_STATES.find((item) => item === value.state);
	if (!AGENT_ID_PATTERN.test(id) || !AGENT_ID_PATTERN.test(appId) || !AGENT_ID_PATTERN.test(runId) || !state) {
		throw new Error('Invalid stored job identity');
	}
	const createdAt = integer(value.created_at, 0);
	const updatedAt = integer(value.updated_at, createdAt);
	const result = value.result_text === null ? null : storedResult(text(value.result_text, TOOL_RESULT_MAX_BYTES));
	if (
		(state === 'completed' || state === 'failed') !== (result !== null) ||
		(state === 'completed') !== (result?.status === 'completed')
	) {
		throw new Error('Inconsistent job result');
	}
	return {
		id,
		userId: integer(value.user_id, 1),
		appId,
		runId,
		connectionId: integer(value.connection_id, 1),
		targetVersion: integer(value.target_version, 1),
		fingerprint,
		policyRevision: integer(value.policy_revision, 1),
		state,
		revision: integer(value.revision, 1),
		result,
		createdAt,
		updatedAt,
	};
}

async function get(tx: SqlExecutor, scope: StoredJobScope, id: string): Promise<StoredToolJob | null> {
	const value = await tx.one('SELECT * FROM agent_tool_jobs WHERE id=? AND user_id=? AND app_id=? AND run_id=?', [
		id,
		scope.userId,
		scope.appId,
		scope.runId,
	]);
	return value === null ? null : readToolJob(value);
}

export class SqliteToolJobStorage implements ToolJobStorage {
	constructor(private readonly db: SqliteRuntime) {}

	create(input: StoredJobCreate): Promise<StoredToolJob | 'version_conflict' | 'limit_exceeded'> {
		return this.db.transaction(async (tx) => {
			const authority = await tx.one(
				`SELECT t.id FROM agent_run_tools t JOIN agent_runs r ON r.id=t.run_id WHERE t.id=? AND t.user_id=? AND t.app_id=? AND t.run_id=? AND t.state='dispatched' AND t.tool_name='shell_execute' AND t.capability='shell.execute' AND t.mutation=1 AND t.target_id=? AND t.target_version=? AND r.status='running'`,
				[input.id, input.userId, input.appId, input.runId, input.connectionId, input.targetVersion],
			);
			if (!authority) {
				return 'version_conflict';
			}
			const count = await tx.one(
				'SELECT count(*) AS total FROM agent_tool_jobs WHERE user_id=? AND app_id=? AND run_id=?',
				[input.userId, input.appId, input.runId],
			);
			if (!count || integer(count.total, 0) >= input.maxHistory) {
				return 'limit_exceeded';
			}
			const now = Date.now();
			await tx.run(
				`INSERT INTO agent_tool_jobs(id,user_id,app_id,run_id,connection_id,target_version,fingerprint,policy_revision,state,revision,result_text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued',1,NULL,?,?)`,
				[
					input.id,
					input.userId,
					input.appId,
					input.runId,
					input.connectionId,
					input.targetVersion,
					input.fingerprint,
					input.policyRevision,
					now,
					now,
				],
			);
			const value = await get(tx, input, input.id);
			if (!value) {
				throw new Error('Job disappeared');
			}
			return value;
		});
	}

	get(scope: StoredJobScope, id: string): Promise<StoredToolJob | null> {
		return this.db.transaction((tx) => get(tx, scope, id));
	}

	list(scope: StoredJobScope, connectionId: number, limit: number, offset: number): Promise<StoredToolJob[]> {
		return this.db.transaction(async (tx) =>
			(
				await tx.all(
					'SELECT * FROM agent_tool_jobs WHERE user_id=? AND app_id=? AND run_id=? AND connection_id=? ORDER BY created_at,id LIMIT ? OFFSET ?',
					[scope.userId, scope.appId, scope.runId, connectionId, limit + 1, offset],
				)
			).map(readToolJob),
		);
	}

	change(input: StoredJobChange): Promise<StoredToolJob | 'version_conflict'> {
		return this.db.transaction(async (tx) => {
			const resultText = input.result === null ? null : JSON.stringify(input.result);
			if (resultText !== null && Buffer.byteLength(resultText) > TOOL_RESULT_MAX_BYTES) {
				throw new Error('Job result capacity exceeded');
			}
			if (resultText !== null) {
				storedResult(resultText);
			}
			const current = await get(tx, input.scope, input.id);
			if (
				!current ||
				current.revision !== input.expectedRevision ||
				current.revision > Number.MAX_SAFE_INTEGER - (input.state === 'dispatched' ? 2 : 1) ||
				(current.state !== 'queued' && current.state !== 'dispatched')
			) {
				return 'version_conflict';
			}
			if (input.state === 'dispatched') {
				const owner = await tx.one(
					`SELECT t.id FROM agent_run_tools t JOIN agent_runs r ON r.id=t.run_id WHERE t.id=? AND t.state IN ('dispatched','completed') AND r.status='running'`,
					[current.id],
				);
				if (!owner || current.state !== 'queued' || resultText !== null) {
					return 'version_conflict';
				}
			} else if (current.state === 'queued' && input.state !== 'failed') {
				return 'version_conflict';
			}
			const changed = await tx.run(
				'UPDATE agent_tool_jobs SET state=?,result_text=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
				[input.state, resultText, Date.now(), current.id, current.revision],
			);
			if (changed.changes !== 1) {
				throw new Error('Lost job CAS');
			}
			const value = await get(tx, input.scope, input.id);
			if (!value) {
				throw new Error('Job disappeared');
			}
			return value;
		});
	}

	reconcile(): Promise<void> {
		return this.db.transaction(async (tx) => {
			const exhausted = await tx.one(
				"SELECT id FROM agent_tool_jobs WHERE state IN ('queued','dispatched') AND revision>=? LIMIT 1",
				[Number.MAX_SAFE_INTEGER],
			);
			if (exhausted) {
				throw new Error('Job recovery revision exhausted');
			}
			await tx.run(
				`UPDATE agent_tool_jobs SET state=CASE WHEN state='queued' THEN 'failed' ELSE 'unknown' END,result_text=CASE WHEN state='queued' THEN '{"status":"not_started"}' ELSE NULL END,revision=revision+1,updated_at=? WHERE state IN ('queued','dispatched')`,
				[Date.now()],
			);
		});
	}
}
