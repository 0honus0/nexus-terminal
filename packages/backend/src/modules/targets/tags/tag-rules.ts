import { TARGET_TAG_NAME_MAX_BYTES } from '@nexus-terminal/shared/targets/tags/values';
import { TargetFailure } from '../target-failure.js';

/** Metadata editing and import must address the same normalized tag name. */
export function validateTagName(value: string): string {
	if (typeof value !== 'string') {
		throw new TargetFailure('invalid_input');
	}
	const name = value.trim();
	const encoded = Buffer.from(name, 'utf8');
	if (!name || encoded.byteLength > TARGET_TAG_NAME_MAX_BYTES || encoded.toString('utf8') !== name) {
		throw new TargetFailure('invalid_input');
	}
	return name;
}
