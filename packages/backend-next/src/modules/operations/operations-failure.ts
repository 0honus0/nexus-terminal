import type { OperationsErrorCode } from '@nexus-terminal/shared/operations/values';

export class OperationsFailure extends Error {
	constructor(
		readonly code: OperationsErrorCode,
		options?: ErrorOptions,
	) {
		super('Operations: ' + code, options);
	}
}
