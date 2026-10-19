import { randomUUID } from 'node:crypto';
import type { AccessPublicApi } from '../../../access/public.js';
import type { OperationsEvents } from '../../../operations/public.js';
import type { MachineMutationModel } from '../model/mutation-model.js';
import type {
	MutationObservation,
	MutationRecoveryActor,
	MutationEvidenceInput,
	MutationReleaseInput,
	MutationRecoveryView,
} from '../model/mutation-types.js';
import { MutationRecoveryFailure } from '../../mutation-failure.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import {
	MUTATION_MAX_EVIDENCE,
	MUTATION_PAGE_MAX_ITEMS,
	MUTATION_NOTE_MAX_BYTES,
} from '@nexus-terminal/shared/remote/mutations/values';

/** Human evidence authorizes new admission; it never rewrites the original operation outcome. */
export class MutationRecoveryService {
	private closing = false;
	private writesBlocked = false;
	private readonly pending = new Set<Promise<unknown>>();
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: MachineMutationModel,
		private readonly ownerId: string,
		private readonly access: AccessPublicApi,
		private readonly events: OperationsEvents,
	) {}

	private async actor(token: string | null): Promise<MutationRecoveryActor> {
		const identity = await this.access.authenticate(token);
		if (!identity || !token) {
			throw new MutationRecoveryFailure('unauthenticated');
		}
		if (identity.userId !== 1) {
			throw new MutationRecoveryFailure('forbidden');
		}
		return this.model.actor(identity.userId, token);
	}

	private admit(actor: MutationRecoveryActor, identity: number | null, mode: 'read' | 'write' = 'read'): void {
		if (identity === null || identity !== actor.userId) {
			throw new MutationRecoveryFailure('unauthenticated');
		}
		if (identity !== 1) {
			throw new MutationRecoveryFailure('forbidden');
		}
		if (mode === 'write' && this.writesBlocked) {
			throw new MutationRecoveryFailure('storage_unavailable');
		}
		if (this.closing) {
			throw new MutationRecoveryFailure('shutting_down');
		}
	}

	private view(claim: MutationObservation): MutationRecoveryView {
		return { claim, recoveryAllowed: claim.state === 'blocked' && claim.ownerId !== this.ownerId };
	}

	list(
		token: string | null,
		after: string | null,
		limit: number,
	): Promise<{ items: MutationRecoveryView[]; nextCursor: string | null }> {
		return this.task(async () => {
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > MUTATION_PAGE_MAX_ITEMS) {
				throw new MutationRecoveryFailure('invalid_input');
			}
			const actor = await this.actor(token);
			const items = await this.model.list(actor, after, limit, (identity) => this.admit(actor, identity));
			return {
				items: items.map((item) => this.view(item)),
				nextCursor: items.length === limit ? items[items.length - 1].id : null,
			};
		});
	}

	get(token: string | null, id: string): Promise<MutationRecoveryView> {
		return this.task(async () => {
			const actor = await this.actor(token);
			const current = await this.model.get(actor, id, (identity) => this.admit(actor, identity));
			if (!current) {
				throw new MutationRecoveryFailure('not_found');
			}
			return this.view(current);
		});
	}

	private recoverable(current: MutationObservation): void {
		if (current.state !== 'blocked') {
			throw new MutationRecoveryFailure('version_conflict');
		}
		if (current.ownerId === this.ownerId) {
			throw new MutationRecoveryFailure('resource_active');
		}
	}

	recordEvidence(token: string | null, id: string, input: MutationEvidenceInput): Promise<MutationRecoveryView> {
		return this.task(async () => {
			const actor = await this.actor(token),
				evidenceId = randomUUID();
			if (
				!input.note.trim() ||
				Buffer.byteLength(input.note) > MUTATION_NOTE_MAX_BYTES ||
				!Number.isSafeInteger(input.observedAt) ||
				input.observedAt < 0
			) {
				throw new MutationRecoveryFailure('invalid_input');
			}
			const result = await this.model.recover(
				actor,
				id,
				input.expectedRevision,
				(identity) => this.admit(actor, identity, 'write'),
				(current) => {
					const now = Date.now();
					this.recoverable(current);
					if (input.observedAt < (current.blockedAt ?? current.createdAt) || input.observedAt > now) {
						throw new MutationRecoveryFailure('invalid_input');
					}
					if (current.evidence.length >= MUTATION_MAX_EVIDENCE) {
						throw new MutationRecoveryFailure('limit_exceeded');
					}
					return {
						kind: 'evidence',
						evidence: {
							id: evidenceId,
							claimRevision: current.revision,
							outcome: input.outcome,
							observedAt: input.observedAt,
							note: input.note,
							recordedBy: actor.userId,
							createdAt: now,
						},
					};
				},
			);
			await this.publish('REMOTE_MUTATION_EVIDENCE_RECORDED', evidenceId, id, actor.userId);
			return this.view(result);
		}, 'write');
	}

	release(token: string | null, id: string, input: MutationReleaseInput): Promise<MutationRecoveryView> {
		return this.task(async () => {
			const actor = await this.actor(token);
			const result = await this.model.recover(
				actor,
				id,
				input.expectedRevision,
				(identity) => this.admit(actor, identity, 'write'),
				(current) => {
					this.recoverable(current);
					const latest = current.evidence.at(-1);
					if (!latest || latest.id !== input.evidenceId || latest.claimRevision + 1 !== current.revision) {
						throw new MutationRecoveryFailure('version_conflict');
					}
					const releasedAt = Date.now();
					if (releasedAt < latest.createdAt) {
						throw new MutationRecoveryFailure('invalid_input');
					}
					return { kind: 'release', evidenceId: latest.id, releasedAt };
				},
			);
			await this.publish('REMOTE_MUTATION_RELEASED', id + ':' + result.revision, id, actor.userId);
			return this.view(result);
		}, 'write');
	}

	private async publish(
		event: 'REMOTE_MUTATION_EVIDENCE_RECORDED' | 'REMOTE_MUTATION_RELEASED',
		key: string,
		id: string,
		userId: number,
	): Promise<void> {
		try {
			await this.events.publish({
				key: event + ':' + key,
				event,
				userId,
				subjectId: id,
				sourceIp: null,
				route: null,
				statusCode: 200,
			});
		} catch (cause) {
			throw new MutationRecoveryFailure('operation_unknown', { cause });
		}
	}

	private task<T>(work: () => Promise<T>, mode: 'read' | 'write' = 'read'): Promise<T> {
		if (this.closing || this.pending.size >= 8) {
			return Promise.reject(new MutationRecoveryFailure(this.closing ? 'shutting_down' : 'limit_exceeded'));
		}
		if (mode === 'write' && this.writesBlocked) {
			return Promise.reject(new MutationRecoveryFailure('storage_unavailable'));
		}
		const task = Promise.resolve().then(work);
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			(error) => {
				this.pending.delete(task);
				if (
					!(error instanceof MutationRecoveryFailure) ||
					error.code === 'operation_unknown' ||
					error.code === 'storage_unavailable'
				) {
					this.failures.record(error);
					this.writesBlocked = true;
				}
			},
		);
		return task;
	}

	quiesce(): void {
		this.closing = true;
	}

	close(): Promise<void> {
		this.closePromise ??= Promise.resolve().then(async () => {
			await Promise.allSettled([...this.pending]);
			const failures = this.failures.errors();
			if (failures.length) {
				throw new AggregateError(failures, 'Mutation recovery failed to drain');
			}
		});
		this.quiesce();
		return this.closePromise;
	}
}
