import type { RemoteDesktopErrorCode } from '@nexus-terminal/shared/remote/desktop/values';
import type { DesktopCertificateChallenge } from './model/desktop-types.js';

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

export class DesktopCertificateRequired extends DesktopFailure {
	constructor(readonly certificate: DesktopCertificateChallenge) {
		super('certificate_required');
	}
}
