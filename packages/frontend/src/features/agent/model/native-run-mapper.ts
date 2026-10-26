import { fromNativeThread } from './native-thread-mapper';
import type { AgentRunStreamUpdate } from '@nexus-terminal/shared/agent/runs/events';
import type { NativeRunUpdate } from './native-run-types';
import type { AgentRunUsageView } from '@nexus-terminal/shared/agent/runs/model';
import type { NativeRunUsage } from './native-run-types';
import type { AgentRunView, AgentRunEventView } from '@nexus-terminal/shared/agent/runs/model';
import type { AgentApprovalView } from '@nexus-terminal/shared/agent/governance/model';
import type { AgentChildView, AgentMessageMetadata } from '@nexus-terminal/shared/agent/collaboration/model';
import type { AgentSelectableModel, AgentWorkspaceRequest } from '@nexus-terminal/shared/agent/scope/workspace-http';
import type { AgentThreadEntry, AgentThreadEntryCursor } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentToolView } from '@nexus-terminal/shared/agent/tools/model';
import type { AgentCreateRunRequest } from '@nexus-terminal/shared/agent/runs/http';
import type {
	NativeRun,
	NativeModel,
	NativeEvent,
	NativeApproval,
	NativeChild,
	NativeMessage,
	NativeEntry,
	NativeEntryCursor,
	NativeRunInput,
	NativeRunAction,
	NativeRunIntent,
	NativeTool,
} from './native-run-types';

export function fromNativeRun(value: AgentRunView): NativeRun {
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

export function fromNativeModel(value: AgentSelectableModel): NativeModel {
	return {
		providerId: value.providerId,
		providerName: value.providerDisplayName,
		configurationVersion: value.configurationVersion,
		modelId: value.modelId,
		protocol: value.protocol,
		reasoningEfforts: value.reasoningEfforts.map((effort) => effort),
		reasoningMandatory: value.reasoningMandatory,
		...(value.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: value.defaultReasoningEffort }),
	};
}

export function fromNativeEvent(value: AgentRunEventView): NativeEvent {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

export function fromNativeApproval(value: AgentApprovalView): NativeApproval {
	return {
		id: value.id,
		appId: value.appId,
		runId: value.runId,
		toolCallId: value.toolCallId,
		operationHash: value.operationHash,
		kind: value.kind,
		status: value.status,
		policyRevision: value.policyRevision,
		inputRevision: value.inputRevision,
		version: value.version,
		requestedAt: value.requestedAt,
		expiresAt: value.expiresAt,
		decidedAt: value.decidedAt,
		decidedByUserId: value.decidedByUserId,
		consumedAt: value.consumedAt,
		inspection: {
			toolName: value.inspection.toolName,
			toolVersion: value.inspection.toolVersion,
			risk: value.inspection.risk,
			mutation: value.inspection.mutation,
			targetConnectionId: value.inspection.targetConnectionId,
			summary: value.inspection.summary,
		},
	};
}

export function fromNativeChild(value: AgentChildView): NativeChild {
	return {
		id: value.id,
		parentId: value.parentId,
		status: value.status,
		version: value.version,
		profile: value.profile,
		deadlineAt: value.deadlineAt,
	};
}

export function fromNativeMessage(value: AgentMessageMetadata): NativeMessage {
	return {
		sequence: value.sequence,
		senderId: value.senderId,
		bodyBytes: value.bodyBytes,
		expiresAt: value.expiresAt,
	};
}

export function fromNativeCursor(value: AgentThreadEntryCursor): NativeEntryCursor {
	return {
		runSequence: value.runSequence,
		stepIndex: value.stepIndex,
		eventSequence: value.eventSequence,
		textOffset: value.textOffset,
	};
}

export function fromNativeEntry(value: AgentThreadEntry): NativeEntry {
	return { runId: value.runId, role: value.role, position: fromNativeCursor(value.position), text: value.text };
}

export function toNativeRunInput(value: NativeRunInput): AgentCreateRunRequest {
	return {
		approvalMode: value.approvalMode,
		prompt: value.prompt,
		connectionIds: value.connectionIds.map((id) => id),
		model: {
			providerId: value.model.providerId,
			modelId: value.model.modelId,
			configurationVersion: value.model.configurationVersion,
			...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
		},
	};
}

export function toNativeRunMutation(value: NativeRunIntent): AgentWorkspaceRequest {
	const action = value.action;
	const operationId = value.operationId;
	const appVersion = value.scope.appVersion;
	switch (action.kind) {
		case 'create':
			return {
				appVersion,
				request: {
					method: 'agent.runs.create',
					params: { threadId: action.threadId, operationId, input: toNativeRunInput(action.input) },
				},
			};
		case 'append':
			return {
				appVersion,
				request: {
					method: 'agent.runs.appendInput',
					params: {
						threadId: action.run.threadId,
						runId: action.run.id,
						expectedVersion: action.run.version,
						operationId,
						input: toNativeRunInput(action.input),
					},
				},
			};
		case 'cancel':
			return {
				appVersion,
				request: {
					method: 'agent.runs.cancel',
					params: { runId: action.run.id, expectedVersion: action.run.version, operationId },
				},
			};
		case 'cancelChild':
			return {
				appVersion,
				request: {
					method: 'agent.subagents.cancel',
					params: {
						runId: action.run.id,
						childId: action.child.id,
						expectedVersion: action.child.version,
						operationId,
					},
				},
			};
		case 'approve':
			return {
				appVersion,
				request: {
					method: 'agent.approvals.resolve',
					params: {
						approvalId: action.approval.id,
						operationId,
						input: {
							decision: action.decision,
							expectedVersion: action.approval.version,
							operationHash: action.approval.operationHash,
							...(action.feedback ? { feedback: action.feedback } : {}),
						},
					},
				},
			};
	}
}

export function fromNativeTool(value: AgentToolView): NativeTool {
	return {
		id: value.id,
		appId: value.appId,
		runId: value.runId,
		modelStepIndex: value.modelStepIndex,
		toolName: value.toolName,
		toolVersion: value.toolVersion,
		capability: value.capability,
		targetId: value.targetId,
		targetVersion: value.targetVersion,
		risk: value.risk,
		mutation: value.mutation,
		summary: value.summary,
		operationHash: value.operationHash,
		operationRevision: value.operationRevision,
		revision: value.revision,
		state: value.state,
		generatedImageId: value.generatedImageId,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

/** Freeze nested reactive editor objects before the first dispatch. */
export function snapshotNativeRunAction(value: NativeRunAction): NativeRunAction {
	function input(value: NativeRunInput): NativeRunInput {
		return {
			...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }),
			approvalMode: value.approvalMode,
			prompt: value.prompt,
			connectionIds: value.connectionIds.map((id) => id),
			model: {
				providerId: value.model.providerId,
				providerName: value.model.providerName,
				configurationVersion: value.model.configurationVersion,
				modelId: value.model.modelId,
				protocol: value.model.protocol,
				reasoningEfforts: value.model.reasoningEfforts.map((effort) => effort),
				reasoningMandatory: value.model.reasoningMandatory,
				...(value.model.defaultReasoningEffort === undefined
					? {}
					: { defaultReasoningEffort: value.model.defaultReasoningEffort }),
			},
		};
	}

	if (value.kind === 'create') return { kind: value.kind, threadId: value.threadId, input: input(value.input) };
	if (value.kind === 'append') return { kind: value.kind, run: fromNativeRun(value.run), input: input(value.input) };
	if (value.kind === 'cancel') return { kind: value.kind, run: fromNativeRun(value.run) };
	if (value.kind === 'cancelChild')
		return { kind: value.kind, run: fromNativeRun(value.run), child: fromNativeChild(value.child) };
	return {
		kind: value.kind,
		approval: fromNativeApproval(value.approval),
		decision: value.decision,
		feedback: value.feedback,
	};
}

export function fromNativeRunUsage(value: AgentRunUsageView): NativeRunUsage {
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

export function fromNativeRunUpdate(value: AgentRunStreamUpdate): NativeRunUpdate {
	return {
		body: { items: value.body.items.map(fromNativeEntry), nextCursor: fromNativeCursor(value.body.nextCursor) },
		state:
			value.state === null
				? null
				: {
						thread: fromNativeThread(value.state.thread),
						run: fromNativeRun(value.state.run),
						usage: fromNativeRunUsage(value.state.usage),
						events: {
							items: value.state.events.items.map(fromNativeEvent),
							nextCursor: value.state.events.nextCursor,
						},
						approvals: value.state.approvals.items.map(fromNativeApproval),
						children: value.state.children.items.map(fromNativeChild),
					},
		more: value.more,
	};
}
