import type { RunStorage } from '../storage/run-storage.js';
import { mayCreateRootRun, decideCancelRootRun } from '../run-rules.js';
import { resolveFrozenModel } from '../../providers/provider-capability-rules.js';
import { fromStoredProvider } from '../../providers/model/provider-projection.js';
import { fromStoredRun, fromStoredEvent, fromStoredFrozen, toStoredFrozen } from './run-projection.js';
import type { RunFrozenInput } from './run-types.js';

import type {
	CreateRootRunCommand,
	CancelRootRunCommand,
	AgentRun,
	CreateRunResult,
	CancelRunResult,
	RunEventPage,
} from './run-types.js';

export class RunModel {
	constructor(private readonly storage: RunStorage) {}

	async create(command: CreateRootRunCommand): Promise<CreateRunResult> {
		const result = await this.storage.create(
			{
				model: {
					providerId: command.model.providerId,
					modelId: command.model.modelId,
					configurationVersion: command.model.configurationVersion,
				},
				id: command.id,
				userId: command.userId,
				appId: command.appId,
				threadId: command.threadId,
				inputText: command.prompt,
				operationKey: command.operationKey,
				requestHash: command.requestHash,
				createdAt: command.createdAt,
			},
			(active) => mayCreateRootRun(active === null ? null : { status: active.status, version: active.version }),
			(provider, reference) => {
				const frozen = resolveFrozenModel(fromStoredProvider(provider), {
					providerId: reference.providerId,
					modelId: reference.modelId,
					configurationVersion: reference.configurationVersion,
				});
				return frozen === null ? null : toStoredFrozen(frozen);
			},
		);
		if (result.status === 'replayed') {
			return { status: 'replayed', originalStatus: result.originalStatus, run: fromStoredRun(result.run) };
		}
		if (result.status === 'created') {
			return { status: 'created', run: fromStoredRun(result.run) };
		}
		return { status: result.status };
	}

	async cancel(command: CancelRootRunCommand): Promise<CancelRunResult> {
		// Frozen definition remains immutable even when Run cancellation succeeds.
		const result = await this.storage.cancel(
			{
				userId: command.userId,
				appId: command.appId,
				runId: command.runId,
				expectedVersion: command.expectedVersion,
				operationKey: command.operationKey,
				requestHash: command.requestHash,
				now: command.requestedAt,
			},
			(run) => decideCancelRootRun({ status: run.status, version: run.version }, command.expectedVersion),
		);
		if (result.status === 'replayed') {
			return { status: 'replayed', originalStatus: result.originalStatus, run: fromStoredRun(result.run) };
		}
		if (result.status === 'cancelled' || result.status === 'already_cancelled') {
			return { status: result.status, run: fromStoredRun(result.run) };
		}
		return { status: result.status };
	}

	async get(userId: number, appId: string, runId: string): Promise<AgentRun | null> {
		const value = await this.storage.get(userId, appId, runId);
		return value === null ? null : fromStoredRun(value);
	}

	async frozen(userId: number, appId: string, runId: string): Promise<RunFrozenInput | null> {
		const stored = await this.storage.frozen(userId, appId, runId);
		return stored === null ? null : fromStoredFrozen(stored);
	}

	async listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPage | null> {
		const result = await this.storage.listEvents(userId, appId, runId, after, limit);
		if (result === null) {
			return null;
		}
		return { items: result.items.map(fromStoredEvent), nextCursor: result.nextCursor };
	}
}
