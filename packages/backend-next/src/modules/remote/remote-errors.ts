import type { RemoteOperationErrorCode } from '@nexus-terminal/shared/remote/sessions/values';
import { RemoteSessionFailure } from './sessions/model/session-failure.js';
import { RemoteHostKeyUntrustedError } from './model/machine-errors.js';

/** Safe module error. No technical cause, destination or credential is exposed. */
export class RemoteOperationError extends Error {
	constructor(readonly code: RemoteOperationErrorCode) {
		super('Remote operation failed: ' + code);
		this.name = 'RemoteOperationError';
	}
}

function publicError(error: unknown): RemoteOperationError {
	if (error instanceof RemoteOperationError) {
		return error;
	}
	return new RemoteOperationError(
		error instanceof RemoteHostKeyUntrustedError
			? 'host_key_untrusted'
			: error instanceof RemoteSessionFailure
				? error.code
				: 'remote_unavailable',
	);
}

export function remoteSyncBoundary<T>(work: () => T): T {
	try {
		return work();
	} catch (error) {
		throw publicError(error);
	}
}

export async function remoteBoundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		throw publicError(error);
	}
}

export function remoteSubscription(work: () => () => void): () => void {
	const unsubscribe = remoteSyncBoundary(work);
	return () => remoteSyncBoundary(unsubscribe);
}
