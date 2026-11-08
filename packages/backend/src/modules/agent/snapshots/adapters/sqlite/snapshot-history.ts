import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { decodeRun } from '../../../runs/adapters/sqlite/run-row.js';
import type { AgentRunStatus, AgentRunEventType } from '@nexus-terminal/shared/agent/runs/values';

const currentEvents: Readonly<Record<AgentRunStatus, AgentRunEventType>> = {
	pending: 'run.created',
	running: 'run.started',
	suspended: 'run.suspended',
	completed: 'run.completed',
	failed: 'run.failed',
	unknown: 'run.unknown',
	cancelled: 'run.cancelled',
};

function group(rows: readonly SqlRow[], key: (row: SqlRow) => string): Map<string, SqlRow[]> {
	const groups = new Map<string, SqlRow[]>();
	for (const row of rows) {
		const id = key(row);
		const items = groups.get(id) ?? [];
		items.push(row);
		groups.set(id, items);
	}
	return groups;
}

function identity(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new SnapshotFailure('unavailable');
	}
	return value;
}

function position(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new SnapshotFailure('unavailable');
	}
	return value;
}

/** Durable current state must agree with its immutable history, not just pass FK checks. */
export function validateSnapshotHistory(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const runEvents = group(rows.get('agent_run_events') ?? [], (row) => identity(row.run_id));
	for (const run of rows.get('agent_runs') ?? []) {
		const events = runEvents.get(identity(run.id)) ?? [];
		events.sort((a, b) => position(a.sequence) - position(b.sequence));
		const terminal = currentEvents[decodeRun(run).status];
		if (
			events.length !== run.version ||
			events[0]?.event_type !== 'run.created' ||
			events[0]?.created_at !== run.created_at ||
			(events.at(-1)?.event_type !== terminal &&
				!(run.status === 'pending' && events.at(-1)?.event_type === 'run.resumed')) ||
			events.at(-1)?.created_at !== run.updated_at ||
			events.some((event, index) => event.sequence !== index + 1 || event.run_version !== event.sequence)
		) {
			throw new SnapshotFailure('unavailable');
		}
	}
}
