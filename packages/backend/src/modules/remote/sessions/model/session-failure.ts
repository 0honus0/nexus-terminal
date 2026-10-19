import type { RemoteOperationErrorCode } from '@nexus-terminal/shared/remote/sessions/values';

/** Internal session failure; technical causes never pass through the public mapper. */
export class RemoteSessionFailure extends Error {
	constructor(
		readonly code: RemoteOperationErrorCode,
		options?: ErrorOptions,
	) {
		super('Remote session: ' + code, options);
		this.name = 'RemoteSessionFailure';
	}
}
