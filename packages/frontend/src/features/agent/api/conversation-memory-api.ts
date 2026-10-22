import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentMemoryListQuery,
	readAgentMemoryListResponse,
	readAgentMemoryResponse,
	readAgentMemoryReview,
} from '@nexus-terminal/shared/agent/memory/http-codec';
import {
	AGENT_MEMORY_MAX_BODY_BYTES,
	AGENT_MEMORY_MAX_RESPONSE_BYTES,
	AGENT_MEMORY_MAX_PAGE,
} from '@nexus-terminal/shared/agent/memory/values';
import type { ConversationMemory, ConversationMemoryPage } from '../model/conversation-memory-types';
import { toConversationMemory } from '../model/conversation-memory-mapper';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

function memoryPath(appId: string): string {
	return '/apps/' + encodeURIComponent(readAgentId(appId)) + '/memories';
}

export async function verifyConversationMemory(item: ConversationMemory, signal: AbortSignal): Promise<void> {
	try {
		await requestAgentManagement({
			method: 'GET',
			path: memoryPath(item.appId) + '/' + encodeURIComponent(readAgentId(item.id)),
			signal,
			maxRequestBytes: AGENT_MEMORY_MAX_BODY_BYTES,
			maxResponseBytes: AGENT_MEMORY_MAX_RESPONSE_BYTES,

			decode(value) {
				const memory = readAgentMemoryResponse(value).memory;
				if (memory.id !== item.id || memory.appId !== item.appId) {
					throw new Error('Inconsistent memory verification');
				}
			},
		});
	} catch (cause) {
		if (cause instanceof AgentManagementFailure && cause.code === 'not_found' && cause.outcome === 'confirmed') {
			return;
		}
		throw cause;
	}
}

export function listConversationMemories(
	appId: string,
	threadId: string,
	signal: AbortSignal,
): Promise<ConversationMemoryPage> {
	const query = new URLSearchParams({
		status: 'candidate',
		limit: String(AGENT_MEMORY_MAX_PAGE),
		offset: '0',
		threadId,
	});
	readAgentMemoryListQuery(query);
	return requestAgentManagement({
		method: 'GET',
		path: memoryPath(appId) + '?' + query,
		signal,
		maxRequestBytes: AGENT_MEMORY_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_MEMORY_MAX_RESPONSE_BYTES,

		decode(value) {
			const page = readAgentMemoryListResponse(value);
			if (
				page.items.length > AGENT_MEMORY_MAX_PAGE ||
				page.items.some(
					(item) => item.appId !== appId || item.status !== 'candidate' || item.sourceRunId === null,
				) ||
				new Set(page.items.map((item) => item.id)).size !== page.items.length ||
				(page.nextOffset !== null &&
					(page.nextOffset !== AGENT_MEMORY_MAX_PAGE || page.items.length !== AGENT_MEMORY_MAX_PAGE))
			) {
				throw new Error('Inconsistent conversation memory page');
			}
			return { items: page.items.map(toConversationMemory), hasMore: page.nextOffset !== null };
		},
	});
}

export function reviewConversationMemory(
	item: ConversationMemory,
	decision: 'publish' | 'reject',
	signal: AbortSignal,
): Promise<void> {
	return requestAgentManagement({
		method: 'POST',
		path: memoryPath(item.appId) + '/' + encodeURIComponent(readAgentId(item.id)) + '/review',
		signal,
		maxRequestBytes: AGENT_MEMORY_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_MEMORY_MAX_RESPONSE_BYTES,

		input: () =>
			readAgentMemoryReview({
				expectedVersion: item.version,
				decision,
				content: decision === 'publish' ? item.content : null,
			}),

		decode(value) {
			const receipt = readAgentMemoryResponse(value).memory;
			if (
				receipt.id !== item.id ||
				receipt.appId !== item.appId ||
				receipt.version !== item.version + 1 ||
				receipt.reviewAction !== decision ||
				receipt.status !== (decision === 'publish' ? 'published' : 'revoked') ||
				receipt.content !== item.content
			) {
				throw new Error('Inconsistent memory review receipt');
			}
		},
	});
}
