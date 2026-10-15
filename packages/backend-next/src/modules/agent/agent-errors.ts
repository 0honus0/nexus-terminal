import { AgentFailure } from './agent-failure.js';
import { AgentOperationError } from './public-errors.js';

export async function agentBoundary<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof AgentOperationError) {
			throw error;
		}
		if (error instanceof AgentFailure) {
			throw new AgentOperationError(error.code);
		}
		// The underlying SQL, internal payload or arbitrary source errors are private.
		throw new AgentOperationError('internal_failure');
	}
}
