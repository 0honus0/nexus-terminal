import { AgentFailure } from './agent-failure.js';

export function validateUserId(id: number): void {
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new AgentFailure('invalid_input');
	}
}

export function validateAgentId(id: string): void {
	if (
		typeof id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)
	) {
		throw new AgentFailure('invalid_input');
	}
}

export function validateOperationKey(key: string): void {
	validateAgentId(key);
}
