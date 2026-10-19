import type { MutationErrorCode } from '@nexus-terminal/shared/remote/mutations/values';

export class MutationRecoveryFailure extends Error {
	constructor(
		readonly code: MutationErrorCode,
		options?: ErrorOptions,
	) {
		super('Mutation recovery failed: ' + code, options);
		this.name = 'MutationRecoveryFailure';
	}
}
