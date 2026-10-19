import { TargetOperationError } from '../../../targets/public-errors.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { MachineMutationStorage } from '../storage/mutation-storage.js';
import { MutationStorageRefusal } from '../storage/mutation-storage.js';
import type { StoredMutationObservation } from '../storage/mutation-storage.js';
import type {
	MachineMutationTarget,
	MachineMutationClaim,
	MutationObservation,
	MutationRecoveryActor,
	MutationRecoveryTask,
} from './mutation-types.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { MutationRecoveryFailure } from '../../mutation-failure.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof RemoteFileFailure) {
			throw cause;
		}
		const unknown =
			cause instanceof SqliteFailure && (cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed');
		throw new RemoteFileFailure(unknown ? 'operation_unknown' : 'remote_unavailable', { cause });
	}
}

export class MachineMutationModel {
	constructor(
		private readonly owner: MachineMutationStorage,
		private readonly resolver: TrustedSshTargetResolver,
		private readonly tokens: SessionTokens,
	) {}

	ownExecution(work: () => Promise<void>): Promise<void> {
		return this.owner.ownExecution(work);
	}

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

	acquire(
		claim: MachineMutationClaim,
		maxClaims: number,
		maxHistory: number,
		actor?: MutationRecoveryActor,
	): Promise<'acquired' | 'conflict' | 'limit_exceeded'> {
		return storage(() =>
			this.owner.acquire(
				{
					id: claim.id,
					keys: claim.keys.map((key) => key),
					ownerId: claim.ownerId,
					origin: claim.origin,
					targets: claim.targets.map((target) => ({
						targetId: target.targetId,
						fingerprint: target.fingerprint,
					})),
					now: Date.now(),
				},
				maxClaims,
				maxHistory,
				actor
					? {
							digest: actor.digest,

							admit: (identity) => {
								if (identity === null || identity !== actor.userId) {
									throw new RemoteFileFailure(identity === null ? 'unauthenticated' : 'forbidden');
								}
							},
						}
					: undefined,
			),
		);
	}

	settle(claim: MachineMutationClaim, blocked: boolean): Promise<void> {
		return storage(() =>
			this.owner.settle(
				claim.id,
				claim.keys.map((key) => key),
				blocked,
				Date.now(),
			),
		);
	}

	reconcile(): Promise<void> {
		return storage(() => this.owner.reconcile(Date.now()));
	}

	actor(userId: number, token: string): MutationRecoveryActor {
		try {
			return { userId, digest: this.tokens.digest(token) };
		} catch (cause) {
			throw new MutationRecoveryFailure('storage_unavailable', { cause });
		}
	}

	list(
		actor: MutationRecoveryActor,
		after: string | null,
		limit: number,
		admit: (identity: number | null) => void,
	): Promise<MutationObservation[]> {
		return this.recovery(async () => (await this.owner.list(actor.digest, after, limit, admit)).map(fromStorage));
	}

	get(
		actor: MutationRecoveryActor,
		id: string,
		admit: (identity: number | null) => void,
	): Promise<MutationObservation | null> {
		return this.recovery(async () => {
			const value = await this.owner.get(actor.digest, id, admit);
			return value === null ? null : fromStorage(value);
		});
	}

	recover(
		actor: MutationRecoveryActor,
		id: string,
		revision: number,
		admit: (identity: number | null) => void,
		decide: (current: MutationObservation) => MutationRecoveryTask,
	): Promise<MutationObservation> {
		return this.recovery(async () =>
			fromStorage(
				await this.owner.recover(actor.digest, id, revision, admit, (current) => {
					const task = decide(fromStorage(current));
					if (task.kind === 'release') {
						return { kind: 'release', evidenceId: task.evidenceId, releasedAt: task.releasedAt };
					}
					const e = task.evidence;
					return {
						kind: 'evidence',
						evidence: {
							id: e.id,
							claimRevision: e.claimRevision,
							outcome: e.outcome,
							observedAt: e.observedAt,
							note: e.note,
							recordedBy: e.recordedBy,
							createdAt: e.createdAt,
						},
					};
				}),
			),
		);
	}

	private async recovery<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (cause) {
			if (cause instanceof MutationRecoveryFailure) {
				throw cause;
			}
			if (cause instanceof MutationStorageRefusal) {
				throw new MutationRecoveryFailure(cause.kind, { cause });
			}
			const unknown =
				cause instanceof SqliteFailure && (cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed');
			throw new MutationRecoveryFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
	}
}

function fromStorage(value: StoredMutationObservation): MutationObservation {
	return {
		id: value.id,
		origin: value.origin,
		ownerId: value.ownerId,
		state: value.state,
		revision: value.revision,
		createdAt: value.createdAt,
		blockedAt: value.blockedAt,
		releasedAt: value.releasedAt,
		targets: value.targets.map((target) => ({ targetId: target.targetId, fingerprint: target.fingerprint })),
		evidence: value.evidence.map((e) => ({
			id: e.id,
			claimRevision: e.claimRevision,
			outcome: e.outcome,
			observedAt: e.observedAt,
			note: e.note,
			recordedBy: e.recordedBy,
			createdAt: e.createdAt,
		})),
	};
}
