import type { AgentRunUsageView, AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { RunUsage, AgentRun } from '../../runs/model/run-types.js';

export function toRunView(value: AgentRun): AgentRunView {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		approvalMode: value.approvalMode,
		status: value.status,
		failure: value.failure === null ? null : { code: value.failure.code, toolName: value.failure.toolName },
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
