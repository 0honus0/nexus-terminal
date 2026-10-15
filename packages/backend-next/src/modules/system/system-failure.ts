import type { SystemStatusErrorCode } from '@nexus-terminal/shared/system/status/values';

export class SystemStatusFailure extends Error {
	constructor(
		readonly code: SystemStatusErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
	}
}
