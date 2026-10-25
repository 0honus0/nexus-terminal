import type { AgentRunUsageView, AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { RunUsage, AgentRun } from '../../runs/model/run-types.js';

export function toRunView(value: AgentRun): AgentRunView {
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

export function toRunUsageView(value: RunUsage): AgentRunUsageView {
	return {
		runId: value.runId,
		runVersion: value.runVersion,
		inputTokens: value.inputTokens,
		outputTokens: value.outputTokens,
		reportedModelRequests: value.reportedModelRequests,
		modelRequests: value.modelRequests,
		toolExecutions: value.toolExecutions,
	};
}
