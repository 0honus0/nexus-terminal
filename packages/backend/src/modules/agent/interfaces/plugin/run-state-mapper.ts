import type { AgentPluginRunInfo, AgentPluginCheckpoint } from '@nexus-terminal/shared/agent/plugins/run-context';
import type { AppRunInfo, AppCheckpoint } from '../../runs/model/run-app-state-types.js';

export function toPluginRunInfo(value: AppRunInfo, outputPreviewBytes: number): AgentPluginRunInfo {
	return {
		runId: value.runId,
		threadId: value.threadId,
		threadVersion: value.threadVersion,
		autoTitle: value.autoTitle,
		inputJson: value.inputJson,
		resumeInputJson: value.resumeInputJson,
		prompt: value.prompt,
		sequence: value.sequence,
		deadlineUnixMs: value.deadlineUnixMs,
		outputPreviewBytes,
	};
}

export function toPluginCheckpoint(value: AppCheckpoint): AgentPluginCheckpoint {
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
