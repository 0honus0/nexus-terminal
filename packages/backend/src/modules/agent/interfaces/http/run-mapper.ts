import type { AgentRunUsageView, AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { RunUsage, AgentRun } from '../../runs/model/run-types.js';
import type { RunSuspension } from '../../runs/model/run-resume-types.js';
import type { AgentRunSuspensionView } from '@nexus-terminal/shared/agent/runs/http';

export function toRunSuspension(value: RunSuspension): AgentRunSuspensionView {
	return {
		runId: value.runId,
		runVersion: value.runVersion,
		checkpointVersion: value.checkpointVersion,
		suspendedAt: value.suspendedAt,
		inputRequest: {
			id: value.inputRequest.id,
			sha256: value.inputRequest.sha256,
			sizeBytes: value.inputRequest.sizeBytes,
			mediaType: value.inputRequest.mediaType,
		},
	};
}

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
