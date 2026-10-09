/** Raised only by an execution adapter that can prove it rejected the operation before a side effect. */
export class ToolMutationNotStartedError extends Error {
	constructor(code: string) {
		super(code);
		this.name = 'ToolMutationNotStartedError';
	}
}
