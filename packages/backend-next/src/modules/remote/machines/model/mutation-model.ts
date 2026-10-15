import { TargetOperationError } from '../../../targets/public-errors.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { MachineMutationStorage } from '../storage/mutation-storage.js';
import type { MachineMutationTarget, MachineMutationClaim } from './mutation-types.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		const unknown =
			cause instanceof SqliteFailure && (cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed');
		throw new RemoteFileFailure(unknown ? 'operation_unknown' : 'remote_unavailable', { cause });
	}
}

export class MachineMutationModel {
	constructor(
		private readonly owner: MachineMutationStorage,
		private readonly resolver: TrustedSshTargetResolver,
	) {}

	async endpoint(target: MachineMutationTarget): Promise<{ host: string; port: number }> {
		try {
			const value = await this.resolver.resolveStored({
				targetId: target.targetId,
				expectedFingerprint: target.fingerprint,
			});
			return { host: value.host, port: value.port };
		} catch (cause) {
			const code =
				cause instanceof TargetOperationError
					? cause.code === 'reference_not_found'
						? 'not_found'
						: cause.code === 'conflict'
							? 'stale_target'
							: 'remote_unavailable'
					: 'remote_unavailable';
			throw new RemoteFileFailure(code, { cause });
		}
	}

	acquire(claim: MachineMutationClaim, maxClaims: number): Promise<'acquired' | 'conflict' | 'limit_exceeded'> {
		return storage(() =>
			this.owner.acquire({ id: claim.id, keys: claim.keys.map((key) => key), now: Date.now() }, maxClaims),
		);
	}

	settle(claim: MachineMutationClaim, blocked: boolean): Promise<void> {
		return storage(() =>
			this.owner.settle(
				claim.id,
				claim.keys.map((key) => key),
				blocked,
			),
		);
	}

	reconcile(): Promise<void> {
		return storage(() => this.owner.reconcile());
	}
}
