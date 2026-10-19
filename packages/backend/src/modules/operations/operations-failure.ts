import type { OperationsErrorCode } from '@nexus-terminal/shared/operations/values';

export class OperationsFailure extends Error {
	constructor(
		readonly code: OperationsErrorCode,
		options?: ErrorOptions,
	) {
		super('Operations: ' + code, options);
	}
}

/** Delivery remains unknown and its local resources have not been confirmed released. */
export class NotificationCleanupFailure extends OperationsFailure {
	constructor(options?: ErrorOptions) {
		super('delivery_unknown', options);
		this.name = 'NotificationCleanupFailure';
	}
}
