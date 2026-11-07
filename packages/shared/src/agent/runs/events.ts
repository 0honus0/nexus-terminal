import { agentInteger, agentRecord, isAgentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';

import {
	AGENT_RUN_STREAM_MAX_COMMAND_BYTES,
	AGENT_RUN_STREAM_MAX_JSON_BYTES,
	AGENT_RUN_EVENT_MAX_LIMIT,
} from './values.js';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '../scope/values.js';
import {
	readAgentCreateThreadResponse,
	readAgentThreadEntryCursor,
	readAgentThreadEntries,
} from '../scope/http-codec.js';
import {
	readAgentRunResponse,
	readAgentRunUsageResponse,
	readAgentRunEventsResponse,
	readAgentResourceSession,
} from './http-codec.js';
import { readAgentApprovalPage, readAgentApprovalAfter } from '../governance/http-codec.js';
import { readAgentChildrenResponse } from '../collaboration/http-codec.js';
import type { AgentThreadView, AgentThreadEntryCursor, AgentThreadEntries } from '../scope/model.js';
import type { AgentRunView, AgentRunUsageView } from './model.js';
import type { AgentRunEventsResponse } from './http.js';
import type { AgentApprovalPage } from '../governance/model.js';
import type { AgentChildrenResponse } from '../collaboration/http.js';

export interface AgentRunSubscription {
	appId: string;
	appVersion: number;
	runId: string;
}

export interface AgentRunStreamCursor {
	threadId: string;
	entries: AgentThreadEntryCursor;
	events: number;
	approvals: string | null;
}

export type AgentStreamAuthorization = { kind: 'session'; appVersion: number } | { kind: 'plugin'; grant: string };

export type AgentStreamSource =
	| { kind: 'run'; appId: string; access: AgentStreamAuthorization; runId: string; cursor: AgentRunStreamCursor }
	| { kind: 'run-events'; appId: string; grant: string; runId: string; after: number }
	| { kind: 'memory'; appId: string; access: AgentStreamAuthorization; threadId: string | null };

export type AgentRunStreamCommand =
	| { type: 'subscribe'; subscriptionId: string; generation: number; source: AgentStreamSource }
	| { type: 'ack'; subscriptionId: string; generation: number; revision: number }
	| { type: 'unsubscribe'; subscriptionId: string; generation: number };

export type AgentStreamFrame =
	| { type: 'heartbeat' }
	| { type: 'data'; subscriptionId: string; generation: number; revision: number; value: unknown }
	| {
			type: 'rejected';
			subscriptionId: string;
			generation: number;
			code: 'forbidden' | 'resync_required' | 'unavailable';
	  };

export function readAgentStreamFrame(input: unknown): AgentStreamFrame {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	const value = input;
	if (value.type === 'heartbeat') {
		agentRecord(input, ['type'], AGENT_RUN_STREAM_MAX_JSON_BYTES);
		return { type: 'heartbeat' };
	}
	const identity = {
		subscriptionId: readAgentId(value.subscriptionId),
		generation: agentInteger(value.generation, 1),
	};
	if (value.type === 'data') {
		agentRecord(
			input,
			['type', 'subscriptionId', 'generation', 'revision', 'value'],
			AGENT_RUN_STREAM_MAX_JSON_BYTES,
		);
		return {
			type: 'data',
			subscriptionId: identity.subscriptionId,
			generation: identity.generation,
			revision: agentInteger(value.revision, 1),
			value: value.value,
		};
	}
	if (
		value.type === 'rejected' &&
		(value.code === 'forbidden' || value.code === 'resync_required' || value.code === 'unavailable')
	) {
		agentRecord(input, ['type', 'subscriptionId', 'generation', 'code'], AGENT_RUN_STREAM_MAX_JSON_BYTES);
		return {
			type: 'rejected',
			subscriptionId: identity.subscriptionId,
			generation: identity.generation,
			code: value.code,
		};
	}
	throw new InvalidAgentPayload();
}

export interface AgentRunStreamState {
	thread: AgentThreadView;
	run: AgentRunView;
	usage: AgentRunUsageView;
	events: AgentRunEventsResponse;
	approvals: AgentApprovalPage;
	children: AgentChildrenResponse;
	resources: import('./model.js').AgentResourceSessionView[];
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

export function readAgentRunStreamCursor(input: unknown): AgentRunStreamCursor {
	const cursor = agentRecord(
		input,
		['threadId', 'entries', 'events', 'approvals'],
		AGENT_RUN_STREAM_MAX_COMMAND_BYTES,
	);
	return {
		threadId: readAgentId(cursor.threadId),
		entries: readAgentThreadEntryCursor(cursor.entries),
		events: agentInteger(cursor.events),
		approvals: readAgentApprovalAfter(cursor.approvals),
	};
}

export function readAgentRunStreamCommand(input: unknown): AgentRunStreamCommand {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	const row = input;
	const subscriptionId = readAgentId(row.subscriptionId);
	const generation = agentInteger(row.generation, 1);
	if (row.type === 'ack') {
		agentRecord(input, ['type', 'subscriptionId', 'generation', 'revision'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return { type: 'ack', subscriptionId, generation, revision: agentInteger(row.revision, 1) };
	}
	if (row.type === 'unsubscribe') {
		agentRecord(input, ['type', 'subscriptionId', 'generation'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return { type: 'unsubscribe', subscriptionId, generation };
	}
	if (row.type !== 'subscribe') {
		throw new InvalidAgentPayload();
	}
	agentRecord(input, ['type', 'subscriptionId', 'generation', 'source'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
	if (!isAgentRecord(row.source)) {
		throw new InvalidAgentPayload();
	}
	const source = row.source;
	if (source.kind === 'run') {
		agentRecord(row.source, ['kind', 'appId', 'access', 'runId', 'cursor'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return {
			type: 'subscribe',
			subscriptionId,
			generation,
			source: {
				kind: 'run',
				appId: readAgentId(source.appId),
				access: readAgentStreamAuthorization(source.access),
				runId: readAgentId(source.runId),
				cursor: readAgentRunStreamCursor(source.cursor),
			},
		};
	}
	if (source.kind === 'run-events') {
		agentRecord(row.source, ['kind', 'appId', 'grant', 'runId', 'after'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return {
			type: 'subscribe',
			subscriptionId,
			generation,
			source: {
				kind: 'run-events',
				appId: readAgentId(source.appId),
				grant: readAgentId(source.grant),
				runId: readAgentId(source.runId),
				after: agentInteger(source.after),
			},
		};
	}
	if (source.kind === 'memory') {
		agentRecord(row.source, ['kind', 'appId', 'access', 'threadId'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return {
			type: 'subscribe',
			subscriptionId,
			generation,
			source: {
				kind: 'memory',
				appId: readAgentId(source.appId),
				access: readAgentStreamAuthorization(source.access),
				threadId: source.threadId === null ? null : readAgentId(source.threadId),
			},
		};
	}
	throw new InvalidAgentPayload();
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
			['thread', 'run', 'usage', 'events', 'approvals', 'children', 'resources'],
			AGENT_RUN_STREAM_MAX_JSON_BYTES,
		);
		const thread = readAgentCreateThreadResponse(value.thread);
		const run = readAgentRunResponse(value.run);
		const usage = readAgentRunUsageResponse(value.usage);
		const events = readAgentRunEventsResponse(value.events);
		const approvals = readAgentApprovalPage(value.approvals, cursor.approvals);
		const children = readAgentChildrenResponse(value.children);
		if (
			thread.id !== cursor.threadId ||
			thread.appId !== selected.appId ||
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
			approvals.items.some(
				(approval) => approval.appId !== selected.appId || approval.runId !== selected.runId,
			) ||
			children.items.some((child) => child.parentId !== selected.runId)
		) {
			throw new InvalidAgentPayload();
		}
		if (!Array.isArray(value.resources)) {
			throw new InvalidAgentPayload();
		}
		const resources = value.resources.map(readAgentResourceSession);
		if (
			new Set(resources.map((resource) => resource.id)).size !== resources.length ||
			resources.some(
				(resource) =>
					resource.runId !== selected.runId && !children.items.some((child) => child.id === resource.runId),
			)
		) {
			throw new InvalidAgentPayload();
		}
		state = { thread, run, usage, events, approvals, children, resources };
	}
	const more =
		body.items.length > 0 || (state !== null && (state.events.items.length > 0 || state.approvals.hasMore));
	if (more && !row.more) {
		throw new InvalidAgentPayload();
	}
	return {
		type: 'update',
		appId: selected.appId,
		runId: selected.runId,
		revision: agentInteger(row.revision, 1),
		body,
		state,
		more: row.more,
	};
}

function readAgentStreamAuthorization(input: unknown): AgentStreamAuthorization {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	if (input.kind === 'session') {
		const row = agentRecord(input, ['kind', 'appVersion'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
		return { kind: 'session', appVersion: agentInteger(row.appVersion, 1) };
	}
	const row = agentRecord(input, ['kind', 'grant'], AGENT_RUN_STREAM_MAX_COMMAND_BYTES);
	if (row.kind !== 'plugin') {
		throw new InvalidAgentPayload();
	}
	return { kind: 'plugin', grant: readAgentId(row.grant) };
}
