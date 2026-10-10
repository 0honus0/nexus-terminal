import { TargetFailure } from './target-failure.js';

export function validateTargetId(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TargetFailure('invalid_input');
	}
}
