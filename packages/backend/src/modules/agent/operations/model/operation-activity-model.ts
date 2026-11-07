import { agentStorage } from '../../agent-storage-failure.js';
import { copyToolIdentity } from '../../agent-tool-identity.js';
import type { OperationActivityStorage, StoredOperationActivity } from '../storage/operation-activity-storage.js';
import type { OperationActivity, OperationActivityCursor, OperationActivityPage } from './operation-activity-types.js';

function fromActivity(value: StoredOperationActivity): OperationActivity {
	const operation = value.operation;
	return {
		id: operation.id,
		sequence: operation.sequence,
		appId: operation.scope.appId,
		runId: operation.scope.runId,
		parentOperationId: operation.parentId,
		toolName: value.name,
		toolVersion: value.version,
		identity: copyToolIdentity(value.identity),
		capability: value.capability,
		targetId: value.target?.id ?? null,
		targetVersion: value.target?.version ?? null,
		risk: value.risk,
		mutation: value.mutation,
		summary: value.summary,
		argumentsJson: operation.argumentsJson,
		operationHash: operation.requestHash,
		revision: value.revision,
		state: operation.state,
		effects: value.effects.map((effect) => ({ id: effect.id, operationHash: effect.requestHash })),
		outputArtifactIds: value.outputArtifactIds.map((id) => id),
		failureCode: operation.failureCode,
		createdAt: operation.createdAt,
		updatedAt: value.updatedAt,
	};
}

export class OperationActivityModel {
	constructor(private readonly storage: OperationActivityStorage) {}

	async list(
		userId: number,
		appId: string,
		threadId: string,
		before: OperationActivityCursor | null,
		limit: number,
	): Promise<OperationActivityPage | null> {
		const page = await agentStorage(() =>
			this.storage.list(
				userId,
				appId,
				threadId,
				before === null ? null : { createdAt: before.createdAt, id: before.id },
				limit,
			),
		);
		if (!page) {
			return null;
		}
		const items = page.items.map(fromActivity);
		return {
			items,
			nextCursor: page.hasMore && items.length ? { createdAt: items[0].createdAt, id: items[0].id } : null,
		};
	}

	async get(userId: number, appId: string, runId: string, id: string): Promise<OperationActivity | null> {
		const value = await agentStorage(() => this.storage.get(userId, appId, runId, id));
		return value === null ? null : fromActivity(value);
	}
}
