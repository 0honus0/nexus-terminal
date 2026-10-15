import { createHash } from 'node:crypto';
import type { MachineMutationModel } from '../model/mutation-model.js';
import type { MachineMutationTarget } from '../model/mutation-types.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { ArchiveRejection } from '../../files/model/file-task-types.js';
import { RemoteHostKeyUntrustedError } from '../model/machine-errors.js';
import { ObservationFailure } from '../../monitoring/model/observation-types.js';

function isUncertain(error: unknown): boolean {
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
	constructor(private readonly model: MachineMutationModel) {}

	async run<T>(id: string, targets: MachineMutationTarget[], work: () => Promise<T>): Promise<T> {
		if (!id || id.length > 128 || !targets.length || targets.length > 2) {
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
		const claim = { id, keys };
		const acquired = await this.model.acquire(claim, 128);
		if (acquired !== 'acquired') {
			throw new RemoteFileFailure(acquired);
		}
		let result: T;
		try {
			result = await work();
		} catch (error) {
			try {
				await this.model.settle(claim, isUncertain(error));
			} catch (settlement) {
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
			throw new RemoteFileFailure('operation_unknown', { cause });
		}
		return result;
	}

	initialize(): Promise<void> {
		return this.model.reconcile();
	}
}
