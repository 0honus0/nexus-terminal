import { agentStorage } from '../../agent-storage-failure.js';
import type { CheckpointStorage, StoredCheckpoint } from '../storage/checkpoint-storage.js';
import type { ContextCheckpoint, CheckpointScope, CheckpointAdmission } from './checkpoint-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';

function fromStorage(value: StoredCheckpoint): ContextCheckpoint {
	return {
		id: value.id,
		runId: value.runId,
		stepIndex: value.stepIndex,
		sourceHash: value.sourceHash,
		sourceMessages: value.sourceMessages,
		summary: value.summary,
		createdAt: value.createdAt,
	};
}

export class CheckpointModel {
	constructor(private readonly storage: CheckpointStorage) {}

	async create(
		operation: ToolOperation,
		id: string,
		summary: string,
		now: number,
		admit: (facts: CheckpointAdmission) => void,
	): Promise<ContextCheckpoint | null> {
		const value = await agentStorage(() =>
			this.storage.create(
				{
					userId: operation.userId,
					appId: operation.appId,
					runId: operation.runId,
					operationId: operation.id,
					operationHash: operation.operationHash,
					stepIndex: operation.modelStepIndex,
				},
				id,
				summary,
				now,
				(sourceMessages, sourceBytes) => admit({ sourceMessages, sourceBytes }),
			),
		);
		return value === null ? null : fromStorage(value);
	}

	async get(scope: CheckpointScope, stepIndex: number): Promise<ContextCheckpoint | null> {
		const value = await agentStorage(() => this.storage.get(scope.userId, scope.appId, scope.runId, stepIndex));
		return value === null ? null : fromStorage(value);
	}
}
