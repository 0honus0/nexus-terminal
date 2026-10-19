import { TargetFailure } from './target-failure.js';

import type { TargetErrorCode } from '@nexus-terminal/shared/targets/values';

/** Safe cross-module failure: never contains SQL, worker text or credential input. */
export class TargetOperationError extends Error {
	constructor(readonly code: TargetErrorCode) {
		super('Targets operation failed: ' + code);
		this.name = 'TargetOperationError';
	}
}

function targetErrorCode(error: unknown): TargetErrorCode {
	if (error instanceof TargetOperationError || error instanceof TargetFailure) {
		return error.code;
	}
	return 'internal_failure';
}

/** Also catches synchronous Service validation failures. */
export async function targetsBoundary<T>(work: () => Promise<T> | T): Promise<T> {
	try {
		return await work();
	} catch (error) {
		throw new TargetOperationError(targetErrorCode(error));
	}
}
