import { AgentFailure } from '../agent-failure.js';

/** The collaboration transaction rejected its input and rolled back every write. */
export class CollaborationRefusal extends AgentFailure {
	constructor(code: 'invalid_input' | 'limit_exceeded' | 'version_conflict', options?: ErrorOptions) {
		super(code, options);
		this.name = 'CollaborationRefusal';
	}
}
