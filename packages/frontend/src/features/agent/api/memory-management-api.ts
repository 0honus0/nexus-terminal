import {
	readAgentMemoryConfirm,
	readAgentMemoryImport,
	readAgentMemoryImportResponse,
	readAgentMemoryListQuery,
	readAgentMemoryListResponse,
	readAgentMemoryPath,
	readAgentMemoryProposal,
	readAgentMemoryResponse,
	readAgentMemoryReview,
} from '@nexus-terminal/shared/agent/memory/http-codec';
import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_MEMORY_MAX_BODY_BYTES,
	AGENT_MEMORY_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/memory/values';
import type { AgentMemoryDecision, AgentMemoryStatus } from '@nexus-terminal/shared/agent/memory/values';
import type {
	AgentMemoryProposalRequest,
	AgentMemoryReviewRequest,
	AgentMemoryListQuery,
} from '@nexus-terminal/shared/agent/memory/http';
import { fromMemory, fromMemoryImport, toMemoryProposal } from '../model/memory-mapper';
import type { ManagedMemory, MemoryPage, MemoryImportConfirmation, MemoryProposalDraft } from '../model/memory-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

const budgets = { maxRequestBytes: AGENT_MEMORY_MAX_BODY_BYTES, maxResponseBytes: AGENT_MEMORY_MAX_RESPONSE_BYTES };

function memoryPath(appId: string, id?: string): string {
	try {
		if (id === undefined) {
			return '/apps/' + encodeURIComponent(readAgentId(appId)) + '/memories';
		}
		const path = readAgentMemoryPath({ appId, memoryId: id });
		return '/apps/' + encodeURIComponent(path.appId) + '/memories/' + encodeURIComponent(path.memoryId);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export async function listManagedMemories(
	appId: string,
	status: AgentMemoryStatus | 'all',
	offset: number,
	signal?: AbortSignal,
): Promise<MemoryPage> {
	let query: AgentMemoryListQuery;
	const params = new URLSearchParams({ status, limit: '20', offset: String(offset) });
	try {
		query = readAgentMemoryListQuery(params);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const page = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: memoryPath(appId) + '?' + params,
		signal,

		decode(value) {
			const page = readAgentMemoryListResponse(value);
			if (
				page.items.length > query.limit ||
				page.items.some((item) => item.appId !== appId || (status !== 'all' && item.status !== status)) ||
				(page.nextOffset !== null &&
					(page.nextOffset !== offset + query.limit || page.items.length !== query.limit))
			) {
				throw new Error('Memory page does not match requested scope or pagination');
			}
			return page;
		},
	});
	return { items: page.items.map(fromMemory), nextOffset: page.nextOffset };
}

export async function getManagedMemory(appId: string, id: string, signal?: AbortSignal): Promise<ManagedMemory> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: memoryPath(appId, id),
		signal,

		decode(value) {
			const memory = readAgentMemoryResponse(value).memory;
			if (memory.appId !== appId || memory.id !== id) {
				throw new Error('Memory response belongs to another resource');
			}
			return memory;
		},
	});
	return fromMemory(value);
}

export async function proposeManagedMemory(
	appId: string,
	draft: MemoryProposalDraft,
	signal?: AbortSignal,
): Promise<ManagedMemory> {
	let expected: AgentMemoryProposalRequest | null = null;
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: memoryPath(appId),
		expectedStatus: 201,
		signal,

		input() {
			expected = readAgentMemoryProposal(toMemoryProposal(draft));
			return expected;
		},

		decode(value) {
			const memory = readAgentMemoryResponse(value).memory;
			if (
				!expected ||
				memory.appId !== appId ||
				memory.version !== 1 ||
				memory.status !== 'candidate' ||
				memory.content !== expected.content ||
				memory.confidence !== expected.confidence ||
				memory.expiresAt !== expected.expiresAt ||
				memory.sourceRunId !== expected.sourceRunId
			) {
				throw new Error('Memory proposal confirmation mismatch');
			}
			return memory;
		},
	});
	return fromMemory(value);
}

export async function reviewManagedMemory(
	appId: string,
	original: ManagedMemory,
	decision: AgentMemoryDecision,
	content: string | null,
	signal?: AbortSignal,
): Promise<ManagedMemory> {
	let expected: AgentMemoryReviewRequest | null = null;
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: memoryPath(appId, original.id) + '/review',
		signal,

		input() {
			expected = readAgentMemoryReview({ expectedVersion: original.version, decision, content });
			return expected;
		},

		decode(value) {
			const memory = readAgentMemoryResponse(value).memory;
			if (
				!expected ||
				memory.appId !== appId ||
				memory.id !== original.id ||
				memory.version !== original.version + 1 ||
				memory.reviewAction !== decision ||
				memory.status !== (decision === 'publish' ? 'published' : 'revoked') ||
				memory.content !== (expected.content ?? original.content)
			) {
				throw new Error('Memory review confirmation mismatch');
			}
			return memory;
		},
	});
	return fromMemory(value);
}

export async function previewManagedMemoryImport(
	appId: string,
	source: ManagedMemory,
	signal?: AbortSignal,
): Promise<MemoryImportConfirmation> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: memoryPath(appId) + '/imports/preview',
		signal,

		input: () => readAgentMemoryImport({ sourceAppId: source.appId, sourceMemoryId: source.id }),

		decode(value) {
			const confirmation = readAgentMemoryImportResponse(value).confirmation;
			if (confirmation.sourceAppId !== source.appId || confirmation.sourceMemoryId !== source.id) {
				throw new Error('Memory import preview belongs to another source');
			}
			return confirmation;
		},
	});
	return fromMemoryImport(value);
}

export async function confirmManagedMemoryImport(
	appId: string,
	confirmation: MemoryImportConfirmation,
	signal?: AbortSignal,
): Promise<ManagedMemory> {
	const value = await requestAgentManagement({
		...budgets,
		method: 'POST',
		path: memoryPath(appId) + '/imports/confirm',
		expectedStatus: 201,
		signal,

		input: () => readAgentMemoryConfirm({ confirmationId: confirmation.id }),

		decode(value) {
			const memory = readAgentMemoryResponse(value).memory;
			if (
				memory.appId !== appId ||
				memory.id !== confirmation.memoryId ||
				memory.version !== 1 ||
				memory.status !== 'candidate'
			) {
				throw new Error('Memory import confirmation mismatch');
			}
			return memory;
		},
	});
	return fromMemory(value);
}
