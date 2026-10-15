import { toPolicyOverrides } from '../../governance/model/governance-model.js';
import type { PolicyOverrides } from '../../governance/model/governance-types.js';
import type { ExecutionSettings } from '../../execution/model/execution-types.js';
import { fromSettings, toSettings } from '../../execution/model/execution-projection.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { RunAppAuthority } from './run-types.js';
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
	RunPage,
} from './run-types.js';

export class RunModel {
	constructor(private readonly storage: RunStorage) {}

	ownExecutionTask(work: () => Promise<void>): Promise<void> {
		try {
			return this.storage.ownExecution(work);
		} catch (error) {
			return agentStorage(async () => {
				throw error;
			});
		}
	}

	async list(userId: number, appId: string, threadId: string, after: number, limit: number): Promise<RunPage | null> {
		const value = await agentStorage(() => this.storage.list(userId, appId, threadId, after, limit));
		return value === null ? null : { items: value.items.map(fromStoredRun), nextCursor: value.nextCursor };
	}

	async create(
		command: CreateRootRunCommand,
		authorizeApp: (current: RunAppAuthority) => void,
		authorizeOrigin: (current: AgentRun | null) => void,
		freezeExecution: (
			current: ExecutionSettings | null,
			activeRuns: number,
			overrides: PolicyOverrides,
		) => ExecutionSettings,
	): Promise<CreateRunResult> {
		const result = await agentStorage(() =>
			this.storage.create(
				{
					origin:
						command.origin === null
							? null
							: { runId: command.origin.runId, expectedVersion: command.origin.expectedVersion },
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
					connectionIds: command.connectionIds.map((id) => id),
					operationKey: command.operationKey,
					requestHash: command.requestHash,
					createdAt: command.createdAt,
				},
				(active) =>
					mayCreateRootRun(active === null ? null : { status: active.status, version: active.version }),
				(provider, reference) => {
					const frozen = resolveFrozenModel(fromStoredProvider(provider), {
						providerId: reference.providerId,
						modelId: reference.modelId,
						configurationVersion: reference.configurationVersion,
					});
					return frozen === null ? null : toStoredFrozen(frozen);
				},
				(current) => authorizeApp({ enabled: current.enabled, declared: current.declared }),
				(current) => authorizeOrigin(current === null ? null : fromStoredRun(current)),
				(current, activeRuns, overrides) =>
					toSettings(
						freezeExecution(
							current === null ? null : fromSettings(current),
							activeRuns,
							toPolicyOverrides(overrides),
						),
					),
			),
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
		const result = await agentStorage(() =>
			this.storage.cancel(
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
			),
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
		const value = await agentStorage(() => this.storage.get(userId, appId, runId));
		return value === null ? null : fromStoredRun(value);
	}

	async frozen(userId: number, appId: string, runId: string): Promise<RunFrozenInput | null> {
		const stored = await agentStorage(() => this.storage.frozen(userId, appId, runId));
		return stored === null ? null : fromStoredFrozen(stored);
	}

	async listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPage | null> {
		const result = await agentStorage(() => this.storage.listEvents(userId, appId, runId, after, limit));
		if (result === null) {
			return null;
		}
		return { items: result.items.map(fromStoredEvent), nextCursor: result.nextCursor };
	}
}
