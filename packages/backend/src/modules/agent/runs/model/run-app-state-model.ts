import { createHash } from 'node:crypto';
import { AgentFailure } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { OperationScope } from '../../operations/model/operation-types.js';
import type { StoredOperationScope } from '../../operations/storage/operation-storage.js';
import type { RunAppStateStorage, StoredAppCheckpoint } from '../storage/run-app-state-storage.js';
import { RunAppStateRefusal } from '../storage/run-app-state-storage.js';
import type { AppCheckpoint, AppMessageAppend, AppRunHistory, AppRunInfo } from './run-app-state-types.js';
import type { RunChanges } from './run-changes.js';

function scope(value: OperationScope): StoredOperationScope {
	return {
		userId: value.userId,
		appId: value.appId,
		runId: value.runId,
		executionGeneration: value.executionGeneration,
	};
}

function fromCheckpoint(value: StoredAppCheckpoint): AppCheckpoint {
	return {
		version: value.version,
		state: {
			id: value.state.id,
			sha256: value.state.sha256,
			sizeBytes: value.state.sizeBytes,
			mediaType: value.state.mediaType,
		},
		consumedOperationIds: value.consumedOperationIds.map((id) => id),
		pendingIntents: value.pendingIntents.map((intent) => ({
			operationKey: intent.operationKey,
			requestSha256: intent.requestSha256,
		})),
	};
}

export class RunAppStateModel {
	constructor(
		private readonly storage: RunAppStateStorage,
		private readonly changes: RunChanges,
	) {}

	private work<T>(task: () => Promise<T>): Promise<T> {
		return agentStorage(async () => {
			try {
				return await task();
			} catch (error) {
				if (error instanceof RunAppStateRefusal) {
					throw new AgentFailure(error.code, { cause: error });
				}
				throw error;
			}
		});
	}

	async describe(value: OperationScope): Promise<AppRunInfo> {
		const result = await this.work(() => this.storage.describe(scope(value)));
		if (!result) {
			throw new AgentFailure('not_found');
		}
		return {
			runId: result.runId,
			threadId: result.threadId,
			prompt: result.prompt,
			threadVersion: result.threadVersion,
			autoTitle: result.autoTitle,
			inputJson: result.inputJson,
			resumeInputJson: result.resumeInputJson,
			sequence: result.sequence,
			deadlineUnixMs: result.deadlineUnixMs,
		};
	}

	async read(value: OperationScope): Promise<AppCheckpoint | null> {
		const result = await this.work(() => this.storage.read(scope(value)));
		return result === null ? null : fromCheckpoint(result);
	}

	async write(value: OperationScope, input: AppCheckpoint): Promise<AppCheckpoint> {
		const result = await this.work(() =>
			this.storage.write(
				scope(value),
				{
					version: input.version,
					state: {
						id: input.state.id,
						sha256: input.state.sha256,
						sizeBytes: input.state.sizeBytes,
						mediaType: input.state.mediaType,
					},
					consumedOperationIds: input.consumedOperationIds.map((id) => id),
					pendingIntents: input.pendingIntents.map((intent) => ({
						operationKey: intent.operationKey,
						requestSha256: intent.requestSha256,
					})),
				},
				Date.now(),
			),
		);
		return fromCheckpoint(result);
	}

	async history(value: OperationScope, before: number | null, maxBytes: number): Promise<AppRunHistory> {
		const result = await this.work(() => this.storage.history(scope(value), before, maxBytes));
		return {
			items: result.items.map((item) => ({
				runId: item.runId,
				sequence: item.sequence,
				checkpoint: fromCheckpoint(item.checkpoint),
			})),
			nextBefore: result.nextBefore,
		};
	}

	append(value: OperationScope, input: AppMessageAppend): Promise<void> {
		return this.changes.after(
			value,
			() =>
				this.work(() =>
					this.storage.append(
						scope(value),
						{
							ownerId: input.ownerId,
							key: input.key,
							operationId: input.operationId,
							index: input.index,
							text: input.text,
							sha256: createHash('sha256').update(input.text).digest('hex'),
						},
						Date.now(),
					),
				),
			'text',
		);
	}

	setTitle(
		value: OperationScope,
		operationId: string,
		operationHash: string,
		expectedThreadVersion: number,
		title: string,
	): Promise<boolean> {
		return this.changes.after(value, () =>
			this.work(() =>
				this.storage.setTitle(
					scope(value),
					operationId,
					operationHash,
					expectedThreadVersion,
					title,
					Date.now(),
				),
			),
		);
	}
}
