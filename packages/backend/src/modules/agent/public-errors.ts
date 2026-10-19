import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';

export class AgentOperationError extends Error {
	constructor(readonly code: AgentOperationErrorCode) {
		super('Agent operation failed: ' + code);
		this.name = 'AgentOperationError';
	}
}
