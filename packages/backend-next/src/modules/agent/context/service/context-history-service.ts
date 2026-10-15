import { AgentFailure } from '../../agent-failure.js';
import { validateUserId, validateAgentId } from '../../agent-validation.js';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import type { ThreadEntryCursor, ThreadEntries } from '../model/context-types.js';
import { CONTEXT_MAX_SOURCES } from '../context-limits.js';
import type { ContextModel } from '../model/context-model.js';
import type { ContextHistoryCommand, ContextHistoryFacts } from '../model/context-types.js';
import { ContextService } from './context-service.js';

function admitHistory(facts: ContextHistoryFacts): void {
	if (
		facts.sources > CONTEXT_MAX_SOURCES ||
		facts.runs > CONTEXT_MAX_SOURCES ||
		facts.steps > 1024 ||
		facts.tools > 4096 ||
		facts.bytes > 512 * 1024
	) {
		throw new AgentFailure('limit_exceeded');
	}
}

export class ContextHistoryService {
	constructor(private readonly model: ContextModel) {}

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

	async open(command: ContextHistoryCommand, prompt: string): Promise<ContextService | null> {
		const history = await this.model.readHistory(command, admitHistory);
		return history === null ? null : new ContextService(prompt, history);
	}
}
