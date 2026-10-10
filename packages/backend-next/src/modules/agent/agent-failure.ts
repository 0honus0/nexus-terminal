/** Internal input/use-case failure; independent of persistence and module outputs. */
export class AgentFailure extends Error {
	constructor(readonly code: 'invalid_input') {
		super('Agent: ' + code);
		this.name = 'AgentFailure';
	}
}
