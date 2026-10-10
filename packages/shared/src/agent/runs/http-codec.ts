import { agentRecord, agentInteger, agentText, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_RUN_EVENT_DEFAULT_AFTER,
	AGENT_RUN_EVENT_DEFAULT_LIMIT,
	AGENT_RUN_EVENT_MAX_LIMIT,
	AGENT_RUN_MAX_PROMPT_BYTES,
	AGENT_RUN_MAX_JSON_BODY_BYTES,
} from './values.js';
import { AGENT_MAX_JSON_BODY_BYTES } from '../values.js';
import type { AgentRunView, AgentRunEventView } from './model.js';
import type {
	AgentCreateRunRequest,
	AgentCancelRunRequest,
	AgentRunCommandHeaders,
	AgentCreateRunPath,
	AgentRunPath,
	AgentRunEventsQuery,
	AgentCreateRunResponse,
	AgentCancelRunResponse,
	AgentRunEventsResponse,
} from './http.js';

export function readAgentCreateRunRequest(input: unknown): AgentCreateRunRequest {
	return {
		prompt: agentText(
			agentRecord(input, ['prompt'], AGENT_RUN_MAX_JSON_BODY_BYTES).prompt,
			AGENT_RUN_MAX_PROMPT_BYTES,
		),
	};
}

export function readAgentCancelRunRequest(input: unknown): AgentCancelRunRequest {
	return {
		expectedVersion: agentInteger(
			agentRecord(input, ['expectedVersion'], AGENT_MAX_JSON_BODY_BYTES).expectedVersion,
			1,
		),
	};
}

export function readAgentRunCommandHeaders(idempotencyKey: unknown): AgentRunCommandHeaders {
	return { operationKey: readAgentId(idempotencyKey) };
}

export function readAgentCreateRunPath(input: unknown): AgentCreateRunPath {
	const row = agentRecord(input, ['appId', 'threadId']);
	return { appId: readAgentId(row.appId), threadId: readAgentId(row.threadId) };
}

export function readAgentRunPath(input: unknown): AgentRunPath {
	const row = agentRecord(input, ['appId', 'runId']);
	return { appId: readAgentId(row.appId), runId: readAgentId(row.runId) };
}

function queryNumber(query: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
	const values = query.getAll(key);
	if (values.length === 0) {
		return fallback;
	}
	if (values.length !== 1 || !/^(0|[1-9][0-9]{0,14})$/u.test(values[0])) {
		throw new InvalidAgentPayload();
	}
	return agentInteger(Number(values[0]), min, max);
}

export function readAgentRunEventsQuery(query: URLSearchParams): AgentRunEventsQuery {
	if ([...query.keys()].some((key) => key !== 'after' && key !== 'limit')) {
		throw new InvalidAgentPayload();
	}
	return {
		after: queryNumber(query, 'after', AGENT_RUN_EVENT_DEFAULT_AFTER, 0, Number.MAX_SAFE_INTEGER),
		limit: queryNumber(query, 'limit', AGENT_RUN_EVENT_DEFAULT_LIMIT, 1, AGENT_RUN_EVENT_MAX_LIMIT),
	};
}

export function readAgentRunResponse(input: unknown): AgentRunView {
	const row = agentRecord(input, ['id', 'appId', 'threadId', 'status', 'version', 'createdAt', 'updatedAt']);
	if (row.status !== 'pending' && row.status !== 'cancelled') {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		threadId: readAgentId(row.threadId),
		status: row.status,
		version: agentInteger(row.version, 1),
		createdAt: agentInteger(row.createdAt),
		updatedAt: agentInteger(row.updatedAt),
	};
}

export function readAgentRunEvent(input: unknown): AgentRunEventView {
	const row = agentRecord(input, ['runId', 'sequence', 'type', 'runVersion', 'createdAt']);
	if (row.type !== 'run.created' && row.type !== 'run.cancelled') {
		throw new InvalidAgentPayload();
	}
	return {
		runId: readAgentId(row.runId),
		sequence: agentInteger(row.sequence, 1),
		type: row.type,
		runVersion: agentInteger(row.runVersion, 1),
		createdAt: agentInteger(row.createdAt),
	};
}

function commandResult(input: unknown): Record<string, unknown> {
	if (input !== null && typeof input === 'object' && 'status' in input && input.status === 'replayed') {
		return agentRecord(input, ['status', 'originalStatus', 'run']);
	}
	return agentRecord(input, ['status', 'run']);
}

export function readAgentCreateRunResponse(input: unknown): AgentCreateRunResponse {
	const row = commandResult(input);
	const run = readAgentRunResponse(row.run);
	if (row.status === 'created') {
		return { status: 'created', run };
	}
	if (row.status === 'replayed' && row.originalStatus === 'created') {
		return { status: 'replayed', originalStatus: 'created', run };
	}
	throw new InvalidAgentPayload();
}

export function readAgentCancelRunResponse(input: unknown): AgentCancelRunResponse {
	const row = commandResult(input);
	const run = readAgentRunResponse(row.run);
	if (row.status === 'cancelled' || row.status === 'already_cancelled') {
		return { status: row.status, run };
	}
	if (
		row.status === 'replayed' &&
		(row.originalStatus === 'cancelled' || row.originalStatus === 'already_cancelled')
	) {
		return { status: 'replayed', originalStatus: row.originalStatus, run };
	}
	throw new InvalidAgentPayload();
}

export function readAgentRunEventsResponse(input: unknown): AgentRunEventsResponse {
	const row = agentRecord(input, ['items', 'nextCursor']);
	if (!Array.isArray(row.items) || row.items.length > AGENT_RUN_EVENT_MAX_LIMIT) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readAgentRunEvent);
	const nextCursor = agentInteger(row.nextCursor);
	for (let index = 0; index < items.length; index++) {
		if (
			index > 0 &&
			(items[index].runId !== items[0].runId || items[index].sequence <= items[index - 1].sequence)
		) {
			throw new InvalidAgentPayload();
		}
	}
	if (items.length > 0 && nextCursor !== items[items.length - 1].sequence) {
		throw new InvalidAgentPayload();
	}
	return { items, nextCursor };
}
