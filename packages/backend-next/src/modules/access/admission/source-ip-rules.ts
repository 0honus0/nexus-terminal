import { AccessFailure } from '../access-failure.js';

export function isInternalRange(range: string): boolean {
	return ['loopback', 'private', 'linkLocal', 'uniqueLocal'].includes(range);
}

export function readAllowedNetworks(raw: string): string[] {
	if (Buffer.byteLength(raw, 'utf8') > 16_384) {
		throw new AccessFailure('invalid_input');
	}
	const entries = raw
		.split(/[\n,]+/u)
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length > 256 || (raw.trim().length > 0 && entries.length === 0)) {
		throw new AccessFailure('invalid_input');
	}
	return entries;
}
