import type { OperationsErrorCode } from '@nexus-terminal/shared/operations/values';

/** Persistence conflicts are converted to application failures at the Model boundary. */
export class OperationsStorageRefusal extends Error {
	constructor(readonly code: Extract<OperationsErrorCode, 'not_found' | 'version_conflict'>) {
		super('Operations storage refused: ' + code);
		this.name = 'OperationsStorageRefusal';
	}
}
