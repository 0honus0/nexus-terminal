import { MutationRecoveryFailure } from '../mutation-failure.js';

export const MAX_MUTATION_CLAIMS = 4096;

export const MAX_MUTATION_RESOURCES = 128;

export function validateMutationCapacity(claims: number, resources: number): void {
	if (claims > MAX_MUTATION_CLAIMS || resources > MAX_MUTATION_RESOURCES) {
		throw new MutationRecoveryFailure('limit_exceeded');
	}
}
