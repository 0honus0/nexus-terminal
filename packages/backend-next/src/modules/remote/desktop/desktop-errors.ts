import type { RemoteDesktopErrorCode } from '@nexus-terminal/shared/remote/desktop/values';

/** One safe business error owner for Desktop Service and its HTTP boundary. */
export class DesktopFailure extends Error {
	constructor(
		readonly code: RemoteDesktopErrorCode,
		options?: ErrorOptions,
	) {
		super('Desktop session failed: ' + code, options);
		this.name = 'DesktopFailure';
	}
}
