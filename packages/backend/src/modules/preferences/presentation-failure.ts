import type { PresentationErrorCode } from '@nexus-terminal/shared/preferences/presentation/values';

export class PresentationFailure extends Error {
	constructor(
		readonly code: PresentationErrorCode,
		options?: ErrorOptions,
	) {
		super('Presentation failed: ' + code, options);
		this.name = 'PresentationFailure';
	}
}
