import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { decodeRun } from '../../../runs/adapters/sqlite/run-sql.js';
import type { AgentRunStatus, AgentRunEventType } from '@nexus-terminal/shared/agent/runs/values';

const currentEvents: Readonly<Record<AgentRunStatus, AgentRunEventType>> = {
	pending: 'run.created',
	running: 'run.started',
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
			events.at(-1)?.event_type !== terminal ||
			events.at(-1)?.created_at !== run.updated_at ||
			events.some((event, index) => event.sequence !== index + 1 || event.run_version !== event.sequence)
		) {
			throw new SnapshotFailure('unavailable');
		}
	}
	const toolEvents = group(rows.get('agent_run_tool_events') ?? [], (row) => identity(row.tool_call_id));
	for (const tool of rows.get('agent_run_tools') ?? []) {
		const events = toolEvents.get(identity(tool.id)) ?? [];
		events.sort((a, b) => position(a.revision) - position(b.revision));
		const latest = events.at(-1);
		if (!latest) {
			throw new SnapshotFailure('unavailable');
		}
		if (
			events.length !== tool.revision ||
			latest.state !== tool.state ||
			latest.operation_hash !== tool.operation_hash ||
			latest.operation_revision !== tool.operation_revision ||
			latest.created_at !== tool.updated_at ||
			events.some((event, index) => event.revision !== index + 1)
		) {
			throw new SnapshotFailure('unavailable');
		}
	}

	const stepKey = (row: SqlRow) => JSON.stringify([identity(row.run_id), position(row.step_index)]);

	const stepEvents = group(rows.get('agent_run_model_step_events') ?? [], stepKey);
	for (const step of rows.get('agent_run_model_steps') ?? []) {
		const events = stepEvents.get(stepKey(step)) ?? [];
		events.sort((a, b) => position(a.sequence) - position(b.sequence));
		const latest = events.at(-1);
		const settled = step.state === 'completed' || step.state === 'failed' || step.state === 'unknown';
		const terminal =
			step.state === 'completed' ? 'step.completed' : step.state === 'failed' ? 'step.failed' : 'step.unknown';
		const usages = events.filter((event) => event.kind === 'usage');
		// reserve and dispatch advance revision without publishing an event.
		const firstSequence = step.state === 'failed' && step.revision === 2 ? 2 : 3;
		if (
			events.length !== Math.max(0, position(step.revision) - firstSequence + 1) ||
			events.some((event, index) => event.sequence !== firstSequence + index) ||
			(latest !== undefined && latest.created_at !== step.updated_at) ||
			(settled && (!latest || latest.kind !== terminal || latest.sequence !== step.revision)) ||
			usages.length !== (step.input_tokens === null ? 0 : 1) ||
			(usages.length === 1 &&
				(usages[0].input_tokens !== step.input_tokens || usages[0].output_tokens !== step.output_tokens))
		) {
			throw new SnapshotFailure('unavailable');
		}
		let bytes = 0;
		for (const event of events) {
			if (position(event.sequence) > position(step.revision)) {
				throw new SnapshotFailure('unavailable');
			}
			if (event.kind === 'text.delta') {
				if (typeof event.text_delta !== 'string') {
					throw new SnapshotFailure('unavailable');
				}
				bytes += Buffer.byteLength(event.text_delta, 'utf8');
			}
		}
		if (bytes !== step.text_bytes) {
			throw new SnapshotFailure('unavailable');
		}
	}
}
