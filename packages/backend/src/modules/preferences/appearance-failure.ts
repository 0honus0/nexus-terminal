import type { AppearanceErrorCode } from '@nexus-terminal/shared/preferences/appearance/values';

export class AppearanceFailure extends Error {
	constructor(
		readonly code: AppearanceErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'AppearanceFailure';
	}
}

/** A local content resource could not confirm release; its owner must stop admission. */
export class AppearanceResourceFailure extends AppearanceFailure {
	constructor(options?: ErrorOptions) {
		super('cleanup_failed', options);
		this.name = 'AppearanceResourceFailure';
	}
}
