import { agentRecord, agentInteger, agentText, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_MEMORY_STATUSES,
	AGENT_MEMORY_DECISIONS,
	AGENT_MEMORY_MAX_CONTENT_BYTES,
	AGENT_MEMORY_MAX_BODY_BYTES,
	AGENT_MEMORY_MAX_PAGE,
	AGENT_MEMORY_MAX_RESPONSE_BYTES,
} from './values.js';
import type { AgentMemoryView } from './model.js';
import type {
	AgentMemoryProposalRequest,
	AgentMemoryReviewRequest,
	AgentMemoryPath,
	AgentMemoryListQuery,
	AgentMemoryResponse,
	AgentMemoryListResponse,
} from './http.js';

function confidence(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new InvalidAgentPayload();
	}
	return value;
}

export function readAgentMemoryPath(value: unknown): AgentMemoryPath {
	const r = agentRecord(value, ['appId', 'memoryId']);
	return { appId: readAgentId(r.appId), memoryId: readAgentId(r.memoryId) };
}

export function readAgentMemoryProposal(value: unknown): AgentMemoryProposalRequest {
	const r = agentRecord(value, ['content', 'confidence', 'expiresAt', 'sourceRunId'], AGENT_MEMORY_MAX_BODY_BYTES);
	return {
		content: agentText(r.content, AGENT_MEMORY_MAX_CONTENT_BYTES),
		confidence: confidence(r.confidence),
		expiresAt: r.expiresAt === null ? null : agentInteger(r.expiresAt, 1),
		sourceRunId: r.sourceRunId === null ? null : readAgentId(r.sourceRunId),
	};
}

export function readAgentMemoryReview(value: unknown): AgentMemoryReviewRequest {
	const r = agentRecord(value, ['decision', 'expectedVersion', 'content'], AGENT_MEMORY_MAX_BODY_BYTES);
	const decision = AGENT_MEMORY_DECISIONS.find((v) => v === r.decision);
	if (!decision) {
		throw new InvalidAgentPayload();
	}
	return {
		expectedVersion: agentInteger(r.expectedVersion, 1),
		decision,
		content: r.content === null ? null : agentText(r.content, AGENT_MEMORY_MAX_CONTENT_BYTES),
	};
}

export function readAgentMemoryListQuery(query: URLSearchParams): AgentMemoryListQuery {
	if (
		[...query.keys()].some((k) => !['status', 'limit', 'offset', 'threadId'].includes(k)) ||
		['status', 'limit', 'offset', 'threadId'].some((k) => query.getAll(k).length > 1)
	) {
		throw new InvalidAgentPayload();
	}
	const status = query.get('status') ?? 'all';
	if (status !== 'all' && !AGENT_MEMORY_STATUSES.some((v) => v === status)) {
		throw new InvalidAgentPayload();
	}
	const selected = AGENT_MEMORY_STATUSES.find((v) => v === status) ?? 'all';

	function number(k: string, fallback: number, min: number, max: number): number {
		const v = query.get(k);
		if (v === null) {
			return fallback;
		}
		if (!/^(0|[1-9][0-9]{0,8})$/u.test(v)) {
			throw new InvalidAgentPayload();
		}
		return agentInteger(Number(v), min, max);
	}

	const result: AgentMemoryListQuery = {
		status: selected,
		limit: number('limit', 20, 1, AGENT_MEMORY_MAX_PAGE),
		offset: number('offset', 0, 0, 10000),
	};
	if (query.has('threadId')) {
		result.threadId = readAgentId(query.get('threadId'));
	}
	return result;
}

export function readAgentMemoryView(value: unknown): AgentMemoryView {
	const r = agentRecord(
		value,
		[
			'id',
			'appId',
			'content',
			'confidence',
			'status',
			'sourceRunId',
			'expiresAt',
			'reviewAction',
			'reviewedAt',
			'version',
			'createdAt',
			'updatedAt',
		],
		AGENT_MEMORY_MAX_BODY_BYTES,
	);
	const status = AGENT_MEMORY_STATUSES.find((v) => v === r.status);
	const action = r.reviewAction === null ? null : AGENT_MEMORY_DECISIONS.find((v) => v === r.reviewAction);
	if (
		!status ||
		action === undefined ||
		(action === null) !== (r.reviewedAt === null) ||
		(status === 'candidate') !== (action === null) ||
		(status === 'published' && action !== 'publish') ||
		(status === 'revoked' && action !== 'revoke' && action !== 'reject')
	) {
		throw new InvalidAgentPayload();
	}
	const createdAt = agentInteger(r.createdAt);
	const updatedAt = agentInteger(r.updatedAt, createdAt);
	const expiresAt = r.expiresAt === null ? null : agentInteger(r.expiresAt, createdAt + 1);
	const reviewedAt = r.reviewedAt === null ? null : agentInteger(r.reviewedAt, createdAt);
	if (
		(reviewedAt !== null && reviewedAt > updatedAt) ||
		(status === 'published' && expiresAt !== null && reviewedAt !== null && reviewedAt >= expiresAt)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(r.id),
		appId: readAgentId(r.appId),
		content: agentText(r.content, AGENT_MEMORY_MAX_CONTENT_BYTES),
		confidence: confidence(r.confidence),
		status,
		sourceRunId: r.sourceRunId === null ? null : readAgentId(r.sourceRunId),
		expiresAt,
		reviewAction: action,
		reviewedAt,
		version: agentInteger(r.version, 1),
		createdAt,
		updatedAt,
	};
}

export function readAgentMemoryResponse(value: unknown): AgentMemoryResponse {
	return { memory: readAgentMemoryView(agentRecord(value, ['memory'], AGENT_MEMORY_MAX_BODY_BYTES).memory) };
}

export function readAgentMemoryListResponse(value: unknown): AgentMemoryListResponse {
	const r = agentRecord(value, ['items', 'nextOffset'], AGENT_MEMORY_MAX_RESPONSE_BYTES);
	if (!Array.isArray(r.items) || r.items.length > AGENT_MEMORY_MAX_PAGE) {
		throw new InvalidAgentPayload();
	}
	const items = r.items.map((v: unknown) => readAgentMemoryView(v));
	if (new Set(items.map((v) => v.id)).size !== items.length) {
		throw new InvalidAgentPayload();
	}
	return { items, nextOffset: r.nextOffset === null ? null : agentInteger(r.nextOffset, 1, 10000) };
}
