import { AccessFailure } from './authentication/model/access-failure.js';

import type { AccessErrorCode } from './public.js';

export class AccessOperationError extends Error {
	constructor(
		readonly code: AccessErrorCode,
		options?: ErrorOptions,
	) {
		super('Access operation failed: ' + code, options);
		this.name = 'AccessOperationError';
	}
}

export async function accessBoundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof AccessOperationError) {
			throw error;
		}
		if (error instanceof AccessFailure) {
			throw new AccessOperationError(error.code, { cause: error });
		}
		throw new AccessOperationError('internal_failure', { cause: error });
	}
}
