import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_RUN_STATUSES } from '../runs/values.js';
import {
	AGENT_CHILD_MAX_LIST,
	AGENT_CHILD_PROFILES,
	AGENT_MESSAGE_METADATA_MAX_BODY_BYTES,
	AGENT_COLLABORATION_MESSAGE_MAX_PAGE,
	AGENT_COLLABORATION_MAX_RESPONSE_BYTES,
} from './values.js';
import type {
	AgentChildPath,
	AgentChildrenResponse,
	AgentMessageMetadataQuery,
	AgentMessageMetadataResponse,
} from './http.js';

export function readAgentChildPath(input: unknown): AgentChildPath {
	const row = agentRecord(input, ['appId', 'runId', 'childId']);
	return { appId: readAgentId(row.appId), runId: readAgentId(row.runId), childId: readAgentId(row.childId) };
}

export function readAgentMessageMetadataQuery(query: URLSearchParams): AgentMessageMetadataQuery {
	if ([...query.keys()].some((key) => key !== 'after' && key !== 'limit')) {
		throw new InvalidAgentPayload();
	}

	function number(key: string, fallback: number, min: number, max: number): number {
		const values = query.getAll(key);
		if (!values.length) {
			return fallback;
		}
		if (values.length !== 1 || !/^(0|[1-9][0-9]{0,14})$/u.test(values[0])) {
			throw new InvalidAgentPayload();
		}
		return agentInteger(Number(values[0]), min, max);
	}

	return {
		after: number('after', 0, 0, Number.MAX_SAFE_INTEGER),
		limit: number('limit', 16, 1, AGENT_COLLABORATION_MESSAGE_MAX_PAGE),
	};
}

export function readAgentChildrenResponse(input: unknown): AgentChildrenResponse {
	const row = agentRecord(input, ['items'], AGENT_COLLABORATION_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > AGENT_CHILD_MAX_LIST) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map((input: unknown) => {
		const child = agentRecord(input, ['id', 'parentId', 'status', 'version', 'profile', 'deadlineAt']);
		const profile = AGENT_CHILD_PROFILES.find((value) => value === child.profile);
		const status = AGENT_RUN_STATUSES.find((value) => value === child.status);
		if (!status || !profile) {
			throw new InvalidAgentPayload();
		}
		return {
			id: readAgentId(child.id),
			parentId: readAgentId(child.parentId),
			status,
			version: agentInteger(child.version, 1),
			profile,
			deadlineAt: agentInteger(child.deadlineAt, 1),
		};
	});
	if (
		new Set(items.map((item) => item.id)).size !== items.length ||
		items.some((item) => item.id === item.parentId || item.parentId !== items[0].parentId)
	) {
		throw new InvalidAgentPayload();
	}
	return { items };
}

export function readAgentMessageMetadataResponse(input: unknown): AgentMessageMetadataResponse {
	const row = agentRecord(input, ['items', 'nextCursor'], AGENT_COLLABORATION_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > AGENT_COLLABORATION_MESSAGE_MAX_PAGE) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map((input: unknown) => {
		const item = agentRecord(input, ['sequence', 'senderId', 'bodyBytes', 'expiresAt']);
		return {
			sequence: agentInteger(item.sequence, 1),
			senderId: readAgentId(item.senderId),
			bodyBytes: agentInteger(item.bodyBytes, 0, AGENT_MESSAGE_METADATA_MAX_BODY_BYTES),
			expiresAt: agentInteger(item.expiresAt, 1),
		};
	});
	const nextCursor = agentInteger(row.nextCursor);
	if (
		items.some((item, index) => index > 0 && item.sequence <= items[index - 1].sequence) ||
		(items.length > 0 && nextCursor !== items[items.length - 1].sequence)
	) {
		throw new InvalidAgentPayload();
	}
	return { items, nextCursor };
}
