import type { StoredRun } from '../storage/run-storage.js';

/** Business state decisions run after the SQLite participant rereads current facts. */
export function mayCreateRootRun(active: StoredRun | null): boolean {
	return active === null;
}

export function decideCancelRootRun(
	run: StoredRun,
	expectedVersion: number,
): 'cancel' | 'already_cancelled' | 'version_conflict' {
	if (run.version !== expectedVersion) return 'version_conflict';
	if (run.status === 'cancelled') return 'already_cancelled';
	return 'cancel';
}
