export function toMemoryView(
	value: import('../../memory/model/memory-types.js').MemoryRecord,
): import('@nexus-terminal/shared/agent/memory/model').AgentMemoryView {
	return {
		id: value.id,
		appId: value.appId,
		content: value.content,
		confidence: value.confidence,
		status: value.status,
		sourceRunId: value.sourceRunId,
		expiresAt: value.expiresAt,
		reviewAction: value.reviewAction,
		reviewedAt: value.reviewedAt,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
