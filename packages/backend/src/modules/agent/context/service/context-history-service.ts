import { AgentFailure } from '../../agent-failure.js';
import { validateUserId, validateAgentId } from '../../agent-validation.js';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import type { ThreadEntryCursor, ThreadEntries, ThreadEntryHistory } from '../model/context-types.js';
import type { ContextModel } from '../model/context-model.js';

export class ContextHistoryService {
	constructor(private readonly model: ContextModel) {}

	previousEntries(
		userId: number,
		appId: string,
		threadId: string,
		before: ThreadEntryCursor | null,
		limit: number,
	): Promise<ThreadEntryHistory | null> {
		validateUserId(userId);
		validateAgentId(appId);
		validateAgentId(threadId);
		if (
			(before &&
				Object.values(before).some(
					(value) => !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER,
				)) ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > AGENT_THREAD_ENTRY_MAX_PAGE
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.previousEntries(userId, appId, threadId, before, limit);
	}

	entries(
		userId: number,
		appId: string,
		threadId: string,
		after: ThreadEntryCursor,
		limit: number,
	): Promise<ThreadEntries | null> {
		validateUserId(userId);
		validateAgentId(appId);
		validateAgentId(threadId);
		if (
			Object.values(after).some(
				(value) => !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER,
			) ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > AGENT_THREAD_ENTRY_MAX_PAGE
		) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.entries(userId, appId, threadId, after, limit);
	}
}
