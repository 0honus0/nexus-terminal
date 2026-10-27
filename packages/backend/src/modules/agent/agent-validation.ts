import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AgentFailure } from './agent-failure.js';

export function validateUserId(id: number): void {
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new AgentFailure('invalid_input');
	}
}

export function validateAgentId(id: string): void {
	if (typeof id !== 'string' || !AGENT_ID_PATTERN.test(id)) {
		throw new AgentFailure('invalid_input');
	}
}

export function validateOperationKey(key: string): void {
	validateAgentId(key);
}
