import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import { createHash, randomUUID } from 'node:crypto';
import type { MutationOrigin } from '@nexus-terminal/shared/remote/mutations/values';
import type { MachineMutationModel } from '../model/mutation-model.js';
import type { MachineMutationTarget, MutationRecoveryActor } from '../model/mutation-types.js';
import { MachineMutationRejection } from '../model/mutation-types.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { ArchiveRejection } from '../../files/model/file-task-types.js';
import { RemoteHostKeyUntrustedError } from '../model/machine-errors.js';
import { ObservationFailure } from '../../monitoring/model/observation-types.js';

function isUncertain(error: unknown): boolean {
	if (error instanceof MachineMutationRejection) {
		return error.outcome === 'unknown';
	}
	if (error instanceof RemoteResourceCleanupFailure) {
		return true;
	}
	if (error instanceof ArchiveRejection || error instanceof RemoteHostKeyUntrustedError) {
		return false;
	}
	if (error instanceof AggregateError) {
		return error.errors.length === 0 || error.errors.some(isUncertain);
	}
	if (error instanceof RemoteFileFailure || error instanceof ObservationFailure) {
		return error.code === 'operation_unknown';
	}
	return true;
}

/** Durable claims never expire while remote effects or resource cleanup remain unconfirmed. */
export class MachineMutationService {
	readonly ownerId = randomUUID();

	constructor(
		private readonly model: MachineMutationModel,
		private readonly logger?: Logger,
	) {}

	ownExecution(work: () => Promise<void>): Promise<void> {
		return this.model.ownExecution(work);
	}

	async run<T>(
		id: string,
		origin: MutationOrigin,
		targets: MachineMutationTarget[],
		work: () => Promise<T>,
		actor?: MutationRecoveryActor,
	): Promise<T> {
		if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(id) || !targets.length || targets.length > 2) {
			throw new RemoteFileFailure('invalid_input');
		}
		const endpoints = await Promise.all(targets.map((target) => this.model.endpoint(target)));
		const keys = [
			...new Set(
				endpoints.map((value) =>
					createHash('sha256')
						.update(JSON.stringify([value.host.toLowerCase(), value.port]))
						.digest('hex'),
				),
			),
		].sort();
		const claim = {
			id,
			keys,
			origin,
			ownerId: this.ownerId,
			targets: targets.map((target) => ({ targetId: target.targetId, fingerprint: target.fingerprint })),
		};
		const acquired = await this.model.acquire(claim, actor);
		if (acquired !== 'acquired') {
			logDiagnostic(this.logger, 'warn', 'MUTATION_ADMISSION_REJECTED', {
				claimId: id,
				origin,
				reason: acquired,
			});
			throw new RemoteFileFailure(acquired);
		}
		logDiagnostic(this.logger, 'info', 'MUTATION_CLAIM_ACQUIRED', {
			claimId: id,
			origin,
			targetCount: targets.length,
		});
		let result: T;
		try {
			result = await work();
		} catch (error) {
			logDiagnostic(
				this.logger,
				isUncertain(error) ? 'error' : 'warn',
				'MUTATION_EXECUTION_FAILED',
				{ claimId: id, origin, uncertain: isUncertain(error) },
				error,
			);
			try {
				await this.model.settle(claim, isUncertain(error));
			} catch (settlement) {
				logDiagnostic(this.logger, 'error', 'MUTATION_SETTLEMENT_FAILED', { claimId: id, origin }, settlement);
				if (error instanceof RemoteResourceCleanupFailure) {
					throw new RemoteResourceCleanupFailure([error, settlement]);
				}
				throw new RemoteFileFailure('operation_unknown', {
					cause: new AggregateError([error, settlement], 'Mutation and claim settlement failed'),
				});
			}
			throw error;
		}
		// This write is outside the execution catch: an uncertain release is never followed by a guessed block write.
		try {
			await this.model.settle(claim, false);
		} catch (cause) {
			logDiagnostic(this.logger, 'error', 'MUTATION_RELEASE_UNCONFIRMED', { claimId: id, origin }, cause);
			throw new RemoteFileFailure('operation_unknown', { cause });
		}
		logDiagnostic(this.logger, 'info', 'MUTATION_COMPLETED', { claimId: id, origin });
		return result;
	}

	initialize(): Promise<void> {
		return this.model.reconcile();
	}
}
