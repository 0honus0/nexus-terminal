import type { AgentMemoryView } from '@nexus-terminal/shared/agent/memory/model';
import type { ConversationMemory } from './conversation-memory-types';

export function toConversationMemory(value: AgentMemoryView): ConversationMemory {
	return {
		id: value.id,
		appId: value.appId,
		content: value.content,
		version: value.version,
		expiresAt: value.expiresAt,
	};
}
