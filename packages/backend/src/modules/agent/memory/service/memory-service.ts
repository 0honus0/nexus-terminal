import type { OperationsEvents } from '../../../operations/public.js';
import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import { randomUUID } from 'node:crypto';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AGENT_MEMORY_MAX_CONTENT_BYTES, AGENT_MEMORY_MAX_PAGE } from '@nexus-terminal/shared/agent/memory/values';
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
	MemoryRecallInput,
	MemoryRecallItem,
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
		Buffer.byteLength(text, 'utf8') > AGENT_MEMORY_MAX_CONTENT_BYTES
	) {
		throw new AgentFailure('invalid_input');
	}
}

function admit(actor: MemoryActor, creation = false): (facts: MemoryAdmissionFacts) => void {
	return (facts) => {
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
		if (creation && facts.count >= 10000) {
			throw new AgentFailure('limit_exceeded');
		}
	};
}

export class MemoryService {
	constructor(
		private readonly model: MemoryModel,
		private readonly settings: ExecutionService,
		private readonly events: OperationsEvents,
	) {}

	private async notice(
		work: Promise<MemoryRecord>,
		actor: MemoryActor,
		event: OperationEvent,
	): Promise<MemoryRecord> {
		const value = await work;
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
	}

	async list(scope: MemoryScope, query: MemoryQuery): Promise<{ items: MemoryRecord[]; nextOffset: number | null }> {
		validateScope(scope);
		if (query.threadId !== undefined) {
			validateId(query.threadId);
		}
		if (
			!Number.isSafeInteger(query.offset) ||
			query.offset < 0 ||
			query.offset > 10000 ||
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
				admit(actor, true)(facts);
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
		if (actor.kind !== 'session' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
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

	async recall(actor: MemoryActor, input: MemoryRecallInput): Promise<MemoryRecallItem[]> {
		validateScope(actor);
		if (
			!input.query.trim() ||
			Buffer.byteLength(input.query, 'utf8') > 4096 ||
			!Number.isSafeInteger(input.limit) ||
			input.limit < 1 ||
			input.limit > 20
		) {
			throw new AgentFailure('invalid_input');
		}
		const configuration =
			actor.kind === 'tool'
				? await this.settings.frozen(actor.userId, actor.appId, actor.runId)
				: await this.settings.get(actor.userId);
		const limit = Math.min(input.limit, configuration.limits.maxRecallItems);
		const terms = [...new Set(input.query.toLowerCase().split(/\s+/u).filter(Boolean))];
		if (terms.length > 32) {
			throw new AgentFailure('invalid_input');
		}
		const candidates = await this.model.recall(actor, Date.now, 64, admit(actor));
		const ranked = candidates
			.map((memory) => ({
				memory,
				score: terms.reduce((score, term) => score + (memory.content.toLowerCase().includes(term) ? 1 : 0), 0),
			}))
			.filter((value) => value.score > 0)
			.sort(
				(a, b) =>
					b.score - a.score ||
					b.memory.confidence - a.memory.confidence ||
					a.memory.id.localeCompare(b.memory.id),
			);
		const items: MemoryRecallItem[] = [];
		let bytes = 2;
		for (const item of ranked.slice(0, limit)) {
			const size = Buffer.byteLength(
				JSON.stringify({
					id: item.memory.id,
					version: item.memory.version,
					content: item.memory.content,
					confidence: item.memory.confidence,
					score: item.score,
				}),
				'utf8',
			);
			if (bytes + size + 1 > configuration.limits.maxRecallBytes) {
				break;
			}
			items.push({ memory: item.memory, score: item.score });
			bytes += size + 1;
		}
		return items;
	}
}
