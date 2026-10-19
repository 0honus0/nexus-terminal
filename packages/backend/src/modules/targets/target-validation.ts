import { TargetFailure } from './target-failure.js';

export function validateTargetId(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TargetFailure('invalid_input');
	}
}

/** Check application text without depending on a wire codec or changing its content. */
export function validateTargetText(value: string, maxBytes: number, allowEmpty = true): string {
	if (typeof value !== 'string') {
		throw new TargetFailure('invalid_input');
	}
	const bytes = Buffer.from(value, 'utf8');
	if (bytes.byteLength > maxBytes || bytes.toString('utf8') !== value || (!allowEmpty && !value.trim())) {
		throw new TargetFailure('invalid_input');
	}
	return value;
}
