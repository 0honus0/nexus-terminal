import type { TargetErrorCode } from '@nexus-terminal/shared/targets/values';

/** Internal failure category; classification never depends on diagnostic text. */
export class TargetFailure extends Error {
	constructor(
		readonly code: TargetErrorCode,
		options?: ErrorOptions,
	) {
		super('Targets: ' + code, options);
		this.name = 'TargetFailure';
	}
}
