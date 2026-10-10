/** State rules operate on application facts, not SQLite/storage records. */
import type { RootRunState } from './run-types.js';

/** Business state decisions run after the SQLite participant rereads current facts. */
export function mayCreateRootRun(active: RootRunState | null): boolean {
	return active === null;
}

export function decideCancelRootRun(
	run: RootRunState,
	expectedVersion: number,
): 'cancel' | 'already_cancelled' | 'version_conflict' {
	if (run.version !== expectedVersion) {
		return 'version_conflict';
	}
	if (run.status === 'cancelled') {
		return 'already_cancelled';
	}
	return 'cancel';
}
