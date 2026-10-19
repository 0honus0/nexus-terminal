import type { SystemStatusErrorCode } from '@nexus-terminal/shared/system/status/values';

export class SystemStatusFailure extends Error {
	constructor(
		readonly code: SystemStatusErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}

/** Preserve collection failures when draining, while keeping the external code safe. */
export class SystemCollectionFailure extends SystemStatusFailure {
	constructor(options: ErrorOptions) {
		super('remote_unavailable', options);
		this.name = 'SystemCollectionFailure';
	}
}

export function isSystemDrainFailure(error: unknown): boolean {
	return error instanceof SystemCollectionFailure || !(error instanceof SystemStatusFailure);
}
