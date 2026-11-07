import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import type { StoredRun, StoredRunEvent } from '../../storage/run-storage.js';
import { storedText as stringValue, storedInteger as integer } from './run-participant-sql.js';
type Row = Record<string, unknown>;

function runStatus(value: unknown): AgentRunStatus {
	if (
		value === 'pending' ||
		value === 'running' ||
		value === 'suspended' ||
		value === 'completed' ||
		value === 'failed' ||
		value === 'unknown' ||
		value === 'cancelled'
	) {
		return value;
	}
	throw new Error('Corrupt Agent Run status');
}

export function readRunApprovalMode(
	value: unknown,
): import('@nexus-terminal/shared/agent/runs/values').AgentApprovalMode {
	if (value !== 'ask' && value !== 'full_access') {
		throw new Error('Corrupt Run approval mode');
	}
	return value;
}

export function decodeRun(row: Row): StoredRun {
	const createdAt = integer(row.created_at);
	if (
		![row.id, row.app_id, row.thread_id].every((value) => typeof value === 'string' && AGENT_ID_PATTERN.test(value))
	) {
		throw new Error('Corrupt Run identity');
	}
	return {
		id: stringValue(row.id),
		userId: integer(row.user_id, 1),
		appId: stringValue(row.app_id),
		threadId: stringValue(row.thread_id),
		approvalMode: readRunApprovalMode(row.approval_mode),
		status: runStatus(row.status),
		version: integer(row.version, 1),
		createdAt,
		updatedAt: integer(row.updated_at, createdAt),
	};
}

export function decodeEvent(row: Row): StoredRunEvent {
	const type = row.event_type;
	if (
		type !== 'run.created' &&
		type !== 'run.started' &&
		type !== 'run.resumed' &&
		type !== 'run.suspended' &&
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
