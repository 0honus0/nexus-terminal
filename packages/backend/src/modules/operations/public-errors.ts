import type { OperationsErrorCode } from '@nexus-terminal/shared/operations/values';

export class OperationsError extends Error {
	constructor(readonly code: OperationsErrorCode) {
		super('Operations: ' + code);
	}
}
