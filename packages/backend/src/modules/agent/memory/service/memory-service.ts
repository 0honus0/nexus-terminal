import { agentPluginCapabilityReplyBytes } from '@nexus-terminal/shared/agent/plugins/runtime-codec';
import { MemoryChanges } from './memory-changes.js';
import type { OperationsEvents } from '../../../operations/public.js';
import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import { randomUUID, createHash } from 'node:crypto';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	hasAgentMemoryContentCapacity,
	AGENT_MEMORY_MAX_PAGE,
	AGENT_MEMORY_MAX_OFFSET,
} from '@nexus-terminal/shared/agent/memory/values';
import { AgentFailure } from '../../agent-failure.js';
import type { MemoryModel } from '../model/memory-model.js';
import type {
	MemoryScope,
	MemoryActor,
	MemoryRecord,
	MemoryProposal,
	MemoryReview,
	MemoryQuery,
	MemoryAdmissionFacts,
	MemoryCandidatesInput,
	MemoryCandidate,
	MemoryCandidatePage,
	MemorySelectionInput,
	MemorySelectedItem,
} from '../model/memory-types.js';

function validateScope(scope: MemoryScope): void {
	if (!Number.isSafeInteger(scope.userId) || scope.userId < 1 || !AGENT_ID_PATTERN.test(scope.appId)) {
		throw new AgentFailure('invalid_input');
	}
}

function validateId(id: string): void {
	if (!AGENT_ID_PATTERN.test(id)) {
		throw new AgentFailure('invalid_input');
	}
}

function content(text: string): void {
	if (
		!text.trim() ||
		text.includes('\0') ||
		Buffer.from(text, 'utf8').toString('utf8') !== text ||
		!hasAgentMemoryContentCapacity(text)
	) {
		throw new AgentFailure('invalid_input');
	}
}

function admit(actor: MemoryActor): (facts: MemoryAdmissionFacts) => void {
	return (facts) => {
		if (actor.kind === 'plugin-ui') {
			actor.assertCurrent();
		}
		if (facts.identityUserId !== actor.userId) {
			throw new AgentFailure(
				actor.kind === 'session'
					? facts.identityUserId === null
						? 'unauthenticated'
						: 'forbidden'
					: 'version_conflict',
			);
		}
		if (!facts.appExists) {
			throw new AgentFailure('not_found');
		}
		if (!facts.enabled) {
			throw new AgentFailure('app_disabled');
		}
		if (!facts.sourceExists) {
			throw new AgentFailure('not_found');
		}
	};
}

export class MemoryService {
	readonly changes = new MemoryChanges();

	constructor(
		private readonly model: MemoryModel,
		private readonly events: OperationsEvents,
	) {}

	private async notice(
		work: Promise<MemoryRecord>,
		actor: MemoryActor,
		event: OperationEvent,
	): Promise<MemoryRecord> {
		let notified = false;
		try {
			const value = await work;
			this.changes.notify({ userId: actor.userId, appId: actor.appId });
			notified = true;
			try {
				await this.events.publish({
					key: 'memory:' + value.id + ':' + value.version,
					event,
					userId: actor.userId,
					subjectId: value.id,
					sourceIp: null,
					route: null,
					statusCode: null,
				});
			} catch (error) {
				throw new AgentFailure('operation_unknown', { cause: error });
			}
			return value;
		} finally {
			// Both confirmed commits and unknown commits require consumers to re-read facts.
			if (!notified) {
				this.changes.notify({ userId: actor.userId, appId: actor.appId });
			}
		}
	}

	async list(scope: MemoryScope, query: MemoryQuery): Promise<{ items: MemoryRecord[]; nextOffset: number | null }> {
		validateScope(scope);
		if (query.threadId !== undefined) {
			validateId(query.threadId);
		}
		if (
			!Number.isSafeInteger(query.offset) ||
			query.offset < 0 ||
			query.offset > AGENT_MEMORY_MAX_OFFSET ||
			!Number.isSafeInteger(query.limit) ||
			query.limit < 1 ||
			query.limit > AGENT_MEMORY_MAX_PAGE
		) {
			throw new AgentFailure('invalid_input');
		}
		const items = await this.model.list(scope, {
			status: query.status,
			offset: query.offset,
			limit: query.limit + 1,
			threadId: query.threadId,
		});
		return {
			items: items.slice(0, query.limit),
			nextOffset: items.length > query.limit ? query.offset + query.limit : null,
		};
	}

	get(scope: MemoryScope, id: string): Promise<MemoryRecord | null> {
		validateScope(scope);
		validateId(id);
		return this.model.get(scope, id);
	}

	propose(actor: MemoryActor, input: MemoryProposal): Promise<MemoryRecord> {
		validateScope(actor);
		content(input.content);
		const now = Date.now();
		if (
			!Number.isFinite(input.confidence) ||
			input.confidence < 0 ||
			input.confidence > 1 ||
			(input.expiresAt !== null && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now))
		) {
			throw new AgentFailure('invalid_input');
		}
		if (input.sourceRunId !== null) {
			validateId(input.sourceRunId);
		}
		if (actor.kind === 'tool' && input.sourceRunId !== actor.runId) {
			throw new AgentFailure('invalid_input');
		}
		return this.notice(
			this.model.create(actor, randomUUID(), input, (facts) => {
				admit(actor)(facts);
				if (input.expiresAt !== null && input.expiresAt <= facts.now) {
					throw new AgentFailure('invalid_input');
				}
			}),
			actor,
			'AGENT_MEMORY_PROPOSED',
		);
	}

	review(actor: MemoryActor, id: string, input: MemoryReview): Promise<MemoryRecord> {
		validateScope(actor);
		validateId(id);
		if (
			(actor.kind !== 'session' && actor.kind !== 'plugin-ui') ||
			!Number.isSafeInteger(input.expectedVersion) ||
			input.expectedVersion < 1
		) {
			throw new AgentFailure('invalid_input');
		}
		if (input.content !== null) {
			content(input.content);
		}
		return this.notice(
			this.model.review(actor, id, input.expectedVersion, Date.now, admit(actor), (memory, now) => {
				const allowed =
					(memory.status === 'candidate' && (input.decision === 'publish' || input.decision === 'reject')) ||
					(memory.status === 'published' && input.decision === 'revoke');
				if (
					!allowed ||
					(memory.expiresAt !== null && memory.expiresAt <= now && input.decision === 'publish')
				) {
					throw new AgentFailure('version_conflict');
				}
				if (input.decision !== 'publish' && input.content !== null) {
					throw new AgentFailure('invalid_input');
				}
				return {
					content: input.content ?? memory.content,
					status: input.decision === 'publish' ? 'published' : 'revoked',
					decision: input.decision,
				};
			}),
			actor,
			input.decision === 'publish'
				? 'AGENT_MEMORY_PUBLISHED'
				: input.decision === 'reject'
					? 'AGENT_MEMORY_REJECTED'
					: 'AGENT_MEMORY_REVOKED',
		);
	}

	private async candidateSet(actor: MemoryActor, limit: number) {
		validateScope(actor);
		if (!Number.isSafeInteger(limit) || limit < 1) {
			throw new AgentFailure('invalid_input');
		}
		// These describe this request and its encoded reply page, not a Host recall policy.
		const maxItems = limit;
		const maxBytes = AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES;
		const records = await this.model.recall(actor, Date.now, admit(actor));
		const candidates = records.map((memory): MemoryCandidate => ({
			id: memory.id,
			version: memory.version,
			content: memory.content,
			confidence: memory.confidence,
		}));
		const candidatesSha256 = createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
		return { candidates, candidatesSha256, maxItems, maxBytes };
	}

	async candidates(actor: MemoryActor, input: MemoryCandidatesInput): Promise<MemoryCandidatePage> {
		if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
			throw new AgentFailure('invalid_input');
		}
		const { candidates, candidatesSha256, maxItems, maxBytes } = await this.candidateSet(actor, input.limit);
		if (input.offset > candidates.length) {
			throw new AgentFailure('invalid_input');
		}
		const items: MemoryCandidate[] = [];
		let itemsBytes = 0;
		for (const candidate of candidates.slice(input.offset)) {
			const nextOffset =
				input.offset + items.length + 1 < candidates.length ? input.offset + items.length + 1 : null;
			const value = {
				action: 'candidates',
				items: [],
				nextOffset,
				candidatesSha256,
				maxItems,
				maxBytes,
			};
			const response = { operation: 'memory.retrieve', value };
			// The native reply contains JSON inside valueJson. Count each item's
			// doubly escaped representation once, including its array separator;
			// recompute only the empty envelope as the numeric cursor changes.
			const nextItemsBytes =
				itemsBytes + Buffer.byteLength(JSON.stringify(JSON.stringify(candidate))) - 2 + (items.length ? 1 : 0);
			if (agentPluginCapabilityReplyBytes(response) + nextItemsBytes > AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES) {
				if (items.length === 0) {
					throw new AgentFailure('limit_exceeded');
				}
				break;
			}
			itemsBytes = nextItemsBytes;
			items.push(candidate);
		}
		return {
			items,
			nextOffset: input.offset + items.length < candidates.length ? input.offset + items.length : null,
			candidatesSha256,
			maxItems,
			maxBytes,
		};
	}

	/** Re-read and validate every requested selection; package policy owns ranking and totals. */
	async select(actor: MemoryActor, input: MemorySelectionInput): Promise<MemorySelectedItem[]> {
		if (
			!/^[a-f0-9]{64}$/u.test(input.candidatesSha256) ||
			input.items.length > input.limit ||
			new Set(input.items.map((item) => item.id)).size !== input.items.length ||
			input.items.some(
				(item) =>
					!AGENT_ID_PATTERN.test(item.id) ||
					!Number.isSafeInteger(item.version) ||
					item.version < 1 ||
					!Number.isSafeInteger(item.score) ||
					item.score < 1,
			)
		) {
			throw new AgentFailure('invalid_input');
		}
		const { candidates, candidatesSha256 } = await this.candidateSet(actor, input.limit);
		if (input.candidatesSha256 !== candidatesSha256) {
			throw new AgentFailure('version_conflict');
		}
		const byId = new Map(candidates.map((item) => [item.id, item]));
		const selected = input.items.map((item): MemorySelectedItem => {
			const candidate = byId.get(item.id);
			if (!candidate || candidate.version !== item.version) {
				throw new AgentFailure('version_conflict');
			}
			return {
				id: candidate.id,
				version: candidate.version,
				content: candidate.content,
				confidence: candidate.confidence,
				score: item.score,
			};
		});
		if (
			agentPluginCapabilityReplyBytes({
				operation: 'memory.retrieve',
				value: { action: 'select', items: selected },
			}) > AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES
		) {
			throw new AgentFailure('limit_exceeded');
		}
		return selected;
	}
}
