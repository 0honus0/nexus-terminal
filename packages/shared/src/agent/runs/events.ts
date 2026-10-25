import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';

import {
	AGENT_RUN_STREAM_MAX_COMMAND_BYTES,
	AGENT_RUN_STREAM_MAX_JSON_BYTES,
	AGENT_RUN_EVENT_MAX_LIMIT,
} from './values.js';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '../scope/values.js';
import { readAgentThreadEntryCursor, readAgentThreadEntries } from '../scope/http-codec.js';
import { readAgentRunResponse, readAgentRunUsageResponse, readAgentRunEventsResponse } from './http-codec.js';
import { readAgentApprovalList } from '../governance/http-codec.js';
import { readAgentChildrenResponse } from '../collaboration/http-codec.js';
import type { AgentThreadEntryCursor, AgentThreadEntries } from '../scope/model.js';
import type { AgentRunView, AgentRunUsageView } from './model.js';
import type { AgentRunEventsResponse } from './http.js';
import type { AgentApprovalView } from '../governance/model.js';
import type { AgentChildrenResponse } from '../collaboration/http.js';

export interface AgentRunSubscription {
	appId: string;
	appVersion: number;
	runId: string;
}

export function readAgentRunSubscription(query: URLSearchParams): AgentRunSubscription {
	const keys = ['appId', 'appVersion', 'runId'];
	if ([...query.keys()].length !== keys.length || keys.some((key) => query.getAll(key).length !== 1)) {
		throw new InvalidAgentPayload();
	}
	const version = query.get('appVersion');
	if (version === null || !/^[1-9][0-9]{0,15}$/.test(version)) {
		throw new InvalidAgentPayload();
	}
	return {
		appId: readAgentId(query.get('appId')),
		appVersion: agentInteger(Number(version), 1),
		runId: readAgentId(query.get('runId')),
	};
}

export interface AgentRunStreamCursor {
	threadId: string;
	entries: AgentThreadEntryCursor;
	events: number;
}

export type AgentRunStreamCommand =
	{ type: 'subscribe'; cursor: AgentRunStreamCursor } | { type: 'ack'; revision: number };

export interface AgentRunStreamState {
	run: AgentRunView;
	usage: AgentRunUsageView;
	events: AgentRunEventsResponse;
	approvals: AgentApprovalView[];
	children: AgentChildrenResponse;
}

export interface AgentRunStreamUpdate {
	type: 'update';
	appId: string;
	runId: string;
	revision: number;
	body: AgentThreadEntries;
	state: AgentRunStreamState | null;
	more: boolean;
}

export type AgentRunStreamEvent = AgentRunStreamUpdate | { type: 'heartbeat' };

export function readAgentRunStreamCommand(input: unknown): AgentRunStreamCommand {
	if (input !== null && typeof input === 'object' && 'type' in input && input.type === 'ack') {
		const row = agentRecord(input, ['type', 'revision'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return { type: 'ack', revision: agentInteger(row.revision, 1) };
	}
	const row = agentRecord(input, ['type', 'cursor'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
	if (row.type !== 'subscribe') {
		throw new InvalidAgentPayload();
	}
	const cursor = agentRecord(row.cursor, ['threadId', 'entries', 'events'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
	return {
		type: 'subscribe',
		cursor: {
			threadId: readAgentId(cursor.threadId),
			entries: readAgentThreadEntryCursor(cursor.entries),
			events: agentInteger(cursor.events),
		},
	};
}

export function readAgentRunStreamEvent(
	input: unknown,
	selected: AgentRunSubscription,
	cursor: AgentRunStreamCursor,
): AgentRunStreamEvent {
	if (input !== null && typeof input === 'object' && 'type' in input && input.type === 'heartbeat') {
		agentRecord(input, ['type'], AGENT_RUN_STREAM_MAX_JSON_BYTES);
		return { type: 'heartbeat' };
	}
	const row = agentRecord(
		input,
		['type', 'appId', 'runId', 'revision', 'body', 'state', 'more'],
		AGENT_RUN_STREAM_MAX_JSON_BYTES,
	);
	if (
		row.type !== 'update' ||
		row.appId !== selected.appId ||
		row.runId !== selected.runId ||
		typeof row.more !== 'boolean'
	) {
		throw new InvalidAgentPayload();
	}
	const body = readAgentThreadEntries(row.body, cursor.threadId, cursor.entries, AGENT_THREAD_ENTRY_MAX_PAGE);
	if (body.appId !== selected.appId) {
		throw new InvalidAgentPayload();
	}
	let state: AgentRunStreamState | null = null;
	if (row.state !== null) {
		const value = agentRecord(
			row.state,
			['run', 'usage', 'events', 'approvals', 'children'],
			AGENT_RUN_STREAM_MAX_JSON_BYTES,
		);
		const run = readAgentRunResponse(value.run);
		const usage = readAgentRunUsageResponse(value.usage);
		const events = readAgentRunEventsResponse(value.events);
		const approvals = readAgentApprovalList(value.approvals);
		const children = readAgentChildrenResponse(value.children);
		if (
			run.id !== selected.runId ||
			run.appId !== selected.appId ||
			run.threadId !== cursor.threadId ||
			usage.runId !== selected.runId ||
			usage.runVersion < run.version ||
			events.items.length > AGENT_RUN_EVENT_MAX_LIMIT ||
			events.items.some(
				(event) =>
					event.runId !== selected.runId || event.sequence <= cursor.events || event.runVersion > run.version,
			) ||
			(events.items.length === 0 && events.nextCursor !== cursor.events) ||
			approvals.some((approval) => approval.appId !== selected.appId || approval.runId !== selected.runId) ||
			children.items.some((child) => child.parentId !== selected.runId)
		) {
			throw new InvalidAgentPayload();
		}
		state = { run, usage, events, approvals, children };
	}
	const more = body.items.length > 0 || (state !== null && state.events.items.length > 0);
	if (row.more !== more) {
		throw new InvalidAgentPayload();
	}
	return {
		type: 'update',
		appId: selected.appId,
		runId: selected.runId,
		revision: agentInteger(row.revision, 1),
		body,
		state,
		more,
	};
}
