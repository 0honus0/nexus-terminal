import { copyToolIdentity } from '../../agent-tool-identity.js';

export function toToolView(
	value: import('../../operations/model/operation-activity-types.js').OperationActivity,
): import('@nexus-terminal/shared/agent/tools/model').AgentToolView {
	return {
		id: value.id,
		appId: value.appId,
		runId: value.runId,
		sequence: value.sequence,
		parentOperationId: value.parentOperationId,
		toolName: value.toolName,
		toolVersion: value.toolVersion,
		identity: copyToolIdentity(value.identity),
		capability: value.capability,
		targetId: value.targetId,
		targetVersion: value.targetVersion,
		risk: value.risk,
		mutation: value.mutation,
		summary: value.summary,
		operationHash: value.operationHash,
		effects: value.effects.map((effect) => ({ id: effect.id, operationHash: effect.operationHash })),
		revision: value.revision,
		state: value.state,
		outputArtifactIds: value.outputArtifactIds.map((id) => id),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
