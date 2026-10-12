/** State rules operate on application facts, not SQLite/storage records. */
import type { RootRunState, CancelRootRunDecision, RunFrozenInput } from './model/run-types.js';
import type { ProviderRecord } from '../providers/model/provider-types.js';

/** Provider eligibility alone never grants execution; B6/B7 own the frozen policy. */
export function mayExecuteFrozenRun(frozen: RunFrozenInput, provider: ProviderRecord | null): boolean {
	if (
		provider === null ||
		!provider.enabled ||
		provider.id !== frozen.providerId ||
		provider.version !== frozen.providerVersion ||
		provider.credentialRevision !== frozen.credentialRevision
	) {
		return false;
	}
	switch (frozen.executionPolicy) {
		case 'awaiting_b6_b7':
			return false;
		default: {
			// New policy values require an explicit authorization decision here.
			const unsupported: never = frozen.executionPolicy;
			throw new Error(`Unsupported execution policy: ${unsupported}`);
		}
	}
}

/** Business state decisions run after the SQLite participant rereads current facts. */
export function mayCreateRootRun(active: RootRunState | null): boolean {
	return active === null;
}

export function decideCancelRootRun(run: RootRunState, expectedVersion: number): CancelRootRunDecision {
	if (run.version !== expectedVersion) {
		return 'version_conflict';
	}
	if (run.status === 'cancelled') {
		return 'already_cancelled';
	}
	if (run.status === 'completed' || run.status === 'failed') {
		return 'active_run_conflict';
	}
	return 'cancel';
}
