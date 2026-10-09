import type { RunStorage, StoredRun, StoredRunEvent } from '../storage/run-storage.js';
import { mayCreateRootRun, decideCancelRootRun } from './run-rules.js';

import type {
	CreateRootRunCommand,
	CancelRootRunCommand,
	AgentRun,
	AgentRunEvent,
	CreateRunResult,
	CancelRunResult,
	RunEventPage,
} from './run-types.js';

export type {
	CreateRootRunCommand,
	CancelRootRunCommand,
	AgentRun,
	AgentRunEvent,
	CreateRunResult,
	CancelRunResult,
	RunEventPage,
} from './run-types.js';

function toRun(value: StoredRun): AgentRun {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		status: value.status,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toEvent(value: StoredRunEvent): AgentRunEvent {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

export class RunModel {
	constructor(private readonly storage: RunStorage) {}

	async create(command: CreateRootRunCommand): Promise<CreateRunResult> {
		const result = await this.storage.create(
			{
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
		);
		if (result.status === 'replayed') {
			return { status: 'replayed', originalStatus: result.originalStatus, run: toRun(result.run) };
		}
		if (result.status === 'created') {
			return { status: 'created', run: toRun(result.run) };
		}
		return { status: result.status };
	}

	async cancel(command: CancelRootRunCommand): Promise<CancelRunResult> {
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
			return { status: 'replayed', originalStatus: result.originalStatus, run: toRun(result.run) };
		}
		if (result.status === 'cancelled' || result.status === 'already_cancelled') {
			return { status: result.status, run: toRun(result.run) };
		}
		return { status: result.status };
	}

	async get(userId: number, appId: string, runId: string): Promise<AgentRun | null> {
		const value = await this.storage.get(userId, appId, runId);
		return value === null ? null : toRun(value);
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
		return { items: result.items.map(toEvent), nextCursor: result.nextCursor };
	}
}
