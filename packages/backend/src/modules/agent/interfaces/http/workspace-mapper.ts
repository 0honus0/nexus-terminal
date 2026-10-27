import type { ThreadEntries } from '../../context/model/context-types.js';
import type { RunEventPage } from '../../runs/model/run-types.js';
import type { Participant } from '../../runs/model/run-collaboration-types.js';
import type { AgentThreadEntries } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { AgentChildrenResponse } from '@nexus-terminal/shared/agent/collaboration/http';
import type { AgentWorkspaceInput, AgentWorkspaceResult } from '@nexus-terminal/shared/agent/scope/workspace-http';
import { AGENT_CHILD_PROFILES } from '@nexus-terminal/shared/agent/collaboration/values';
import { AgentFailure } from '../../agent-failure.js';
import type { WorkspaceInput, WorkspaceResult } from '../../scope/model/workspace-types.js';
import { toThreadView, toDefinitionView } from './scope-mapper.js';
import { toRunView } from './run-mapper.js';
import { toApproval, toApprovalPage } from './governance-mapper.js';

export function fromWorkspace(value: AgentWorkspaceInput): WorkspaceInput {
	switch (value.method) {
		case 'agent.runs.appendInput': {
			const p = value.params;
			return {
				method: value.method,
				runId: p.runId,
				expectedVersion: p.expectedVersion,
				threadId: p.threadId,
				operationId: p.operationId,
				input: {
					prompt: p.input.prompt,
					approvalMode: p.input.approvalMode,
					connectionIds: p.input.connectionIds.map((id) => id),
					model: {
						providerId: p.input.model.providerId,
						modelId: p.input.model.modelId,
						configurationVersion: p.input.model.configurationVersion,
						...(p.input.model.reasoningEffort === undefined
							? {}
							: { reasoningEffort: p.input.model.reasoningEffort }),
					},
				},
			};
		}
		case 'agent.threads.entries':
			return {
				method: value.method,
				threadId: value.params.threadId,
				limit: value.params.limit,
				after: {
					runSequence: value.params.after.runSequence,
					stepIndex: value.params.after.stepIndex,
					eventSequence: value.params.after.eventSequence,
					textOffset: value.params.after.textOffset,
				},
			};
		case 'agent.runs.create': {
			const p = value.params;
			return {
				method: value.method,
				threadId: p.threadId,
				operationId: p.operationId,
				input: {
					prompt: p.input.prompt,
					approvalMode: p.input.approvalMode,
					connectionIds: p.input.connectionIds.map((id) => id),
					model: {
						providerId: p.input.model.providerId,
						modelId: p.input.model.modelId,
						configurationVersion: p.input.model.configurationVersion,
						...(p.input.model.reasoningEffort === undefined
							? {}
							: { reasoningEffort: p.input.model.reasoningEffort }),
					},
				},
			};
		}
		case 'agent.runs.cancel':
			return {
				method: value.method,
				runId: value.params.runId,
				operationId: value.params.operationId,
				expectedVersion: value.params.expectedVersion,
			};
		case 'agent.subagents.cancel':
			return {
				method: value.method,
				runId: value.params.runId,
				childId: value.params.childId,
				operationId: value.params.operationId,
				expectedVersion: value.params.expectedVersion,
			};
		case 'agent.approvals.resolve':
			return {
				method: value.method,
				approvalId: value.params.approvalId,
				operationId: value.params.operationId,
				input: {
					decision: value.params.input.decision,
					operationHash: value.params.input.operationHash,
					expectedVersion: value.params.input.expectedVersion,
					feedback: value.params.input.feedback,
				},
			};
		case 'agent.definitions.list':
		case 'agent.providers.list':
			return { method: value.method };
		case 'agent.threads.list':
			return { method: value.method, after: value.params.after, limit: value.params.limit };
		case 'agent.threads.create':
			return {
				method: value.method,
				operationId: value.params.operationId,
				title: value.params.title,
				autoTitle: value.params.autoTitle,
			};
		case 'agent.threads.rename':
			return {
				method: value.method,
				operationId: value.params.operationId,
				title: value.params.title,
				threadId: value.params.threadId,
				expectedVersion: value.params.expectedVersion,
			};
		case 'agent.threads.delete':
			return {
				method: value.method,
				threadId: value.params.threadId,
				expectedVersion: value.params.expectedVersion,
			};
		case 'agent.runs.list':
			return {
				method: value.method,
				threadId: value.params.threadId,
				after: value.params.after,
				limit: value.params.limit,
			};
		case 'agent.runs.get':
		case 'agent.subagents.list':
			return { method: value.method, runId: value.params.runId };
		case 'agent.approvals.list':
			return { method: value.method, runId: value.params.runId, after: value.params.after };
		case 'agent.runs.events':
			return {
				method: value.method,
				runId: value.params.runId,
				after: value.params.after,
				limit: value.params.limit,
			};
		case 'agent.subagents.messages':
			return {
				method: value.method,
				runId: value.params.runId,
				childId: value.params.childId,
				after: value.params.after,
				limit: value.params.limit,
			};
	}
}

export function toWorkspace(value: WorkspaceResult): AgentWorkspaceResult {
	switch (value.method) {
		case 'agent.threads.entries':
			return { method: value.method, value: toThreadEntries(value.value) };
		case 'agent.runs.create':
		case 'agent.runs.appendInput': {
			const result = value.value;
			if (result.status === 'replayed') {
				return {
					method: value.method,
					value: { status: result.status, originalStatus: result.originalStatus, run: toRunView(result.run) },
				};
			}
			if (result.status !== 'created') {
				throw new AgentFailure('internal_failure');
			}
			return { method: value.method, value: { status: result.status, run: toRunView(result.run) } };
		}
		case 'agent.runs.cancel':
		case 'agent.subagents.cancel': {
			const result = value.value;
			if (result.status === 'replayed') {
				return {
					method: value.method,
					value: { status: result.status, originalStatus: result.originalStatus, run: toRunView(result.run) },
				};
			}
			if (!('run' in result)) {
				throw new AgentFailure('internal_failure');
			}
			return { method: value.method, value: { status: result.status, run: toRunView(result.run) } };
		}
		case 'agent.approvals.resolve':
			return { method: value.method, value: toApproval(value.value) };
		case 'agent.definitions.list':
			return { method: value.method, value: value.value.map(toDefinitionView) };
		case 'agent.providers.list':
			return {
				method: value.method,
				value: value.value.map((item) => ({
					providerId: item.providerId,
					providerDisplayName: item.providerDisplayName,
					configurationVersion: item.configurationVersion,
					modelId: item.model.id,
					protocol: item.protocol,
					reasoningEfforts:
						item.protocol === 'images' ? [] : (item.model.reasoningEfforts?.map((effort) => effort) ?? []),
					reasoningMandatory: item.protocol !== 'images' && item.model.reasoningMandatory === true,
					...(item.protocol === 'images' || item.model.defaultReasoningEffort === undefined
						? {}
						: { defaultReasoningEffort: item.model.defaultReasoningEffort }),
				})),
			};
		case 'agent.threads.list':
			return {
				method: value.method,
				value: { items: value.value.items.map(toThreadView), nextCursor: value.value.nextCursor },
			};
		case 'agent.threads.create':
		case 'agent.threads.rename':
			return { method: value.method, value: toThreadView(value.value) };
		case 'agent.threads.delete':
			return { method: value.method, value: { appId: value.value.appId, threadId: value.value.threadId } };
		case 'agent.runs.list':
			return {
				method: value.method,
				value: {
					threadId: value.threadId,
					items: value.value.items.map(toRunView),
					nextCursor: value.value.nextCursor,
				},
			};
		case 'agent.runs.get':
			return { method: value.method, value: value.value === null ? null : toRunView(value.value) };
		case 'agent.runs.events':
			return { method: value.method, value: toRunEvents(value.value) };
		case 'agent.subagents.list':
			return { method: value.method, value: toChildren(value.value) };
		case 'agent.subagents.messages':
			return {
				method: value.method,
				value: {
					items: value.value.items.map((item) => ({
						sequence: item.sequence,
						senderId: item.senderId,
						bodyBytes: item.bodyBytes,
						expiresAt: item.expiresAt,
					})),
					nextCursor: value.value.nextCursor,
				},
			};
		case 'agent.approvals.list':
			return { method: value.method, value: toApprovalPage(value.value) };
	}
}

export function toThreadEntries(value: ThreadEntries): AgentThreadEntries {
	return {
		appId: value.appId,
		threadId: value.threadId,
		items: value.items.map((item) => ({
			runId: item.runId,
			role: item.role,
			text: item.text,
			position: {
				runSequence: item.position.runSequence,
				stepIndex: item.position.stepIndex,
				eventSequence: item.position.eventSequence,
				textOffset: item.position.textOffset,
			},
		})),
		nextCursor: {
			runSequence: value.nextCursor.runSequence,
			stepIndex: value.nextCursor.stepIndex,
			eventSequence: value.nextCursor.eventSequence,
			textOffset: value.nextCursor.textOffset,
		},
	};
}

export function toRunEvents(value: RunEventPage): AgentRunEventsResponse {
	return {
		items: value.items.map((item) => ({
			runId: item.runId,
			sequence: item.sequence,
			type: item.type,
			runVersion: item.runVersion,
			createdAt: item.createdAt,
		})),
		nextCursor: value.nextCursor,
	};
}

export function toChildren(value: Participant[]): AgentChildrenResponse {
	return {
		items: value.map((item) => {
			const profile = AGENT_CHILD_PROFILES.find((profile) => profile === item.profile);
			if (item.parentId === null || !profile) {
				throw new AgentFailure('internal_failure');
			}
			return {
				id: item.id,
				parentId: item.parentId,
				status: item.status,
				version: item.version,
				profile,
				deadlineAt: item.deadline,
			};
		}),
	};
}
