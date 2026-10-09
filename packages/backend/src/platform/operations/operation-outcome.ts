/** A terminal UI failure is not evidence that an external writer has stopped. */
export class OperationOutcomeUnknownError extends Error {
	constructor() {
		super('OPERATION_OUTCOME_UNKNOWN');
	}
}

export class SettledOperationFailure extends Error {
	constructor(public readonly failure: unknown) {
		super(failure instanceof Error ? failure.message : 'Operation failed.');
	}
}
