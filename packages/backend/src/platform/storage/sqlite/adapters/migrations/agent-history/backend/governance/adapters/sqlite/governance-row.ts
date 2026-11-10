// Frozen published database migration dependency. Not an application API.
import type { StoredScope } from '../../storage/governance-storage.js';

const invalid = (): never => {
	throw new Error('Corrupt Agent governance row');
};

export const integer = (v: unknown, min = 0): number =>
	typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : invalid();

export function assertRevisionAvailable(value: unknown, minimum = 0, increments = 1): void {
	if (integer(value, minimum) > Number.MAX_SAFE_INTEGER - increments) {
		throw new Error('Agent governance revision exhausted');
	}
}

export function scopeJson(value: StoredScope): string {
	if (value.kind === 'global') {
		return JSON.stringify({ kind: 'global' });
	}
	if (value.sshMode === undefined) {
		return JSON.stringify({ kind: 'targets', targets: {} });
	}
	if (value.sshMode === 'all') {
		return JSON.stringify({ kind: 'targets', targets: { ssh: { mode: 'all' } } });
	}
	return JSON.stringify({ kind: 'targets', targets: { ssh: { mode: 'ids', ids: value.sshIds.map((id) => id) } } });
}
