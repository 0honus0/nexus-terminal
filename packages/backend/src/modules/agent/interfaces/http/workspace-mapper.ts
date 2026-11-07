import { toToolView } from './tool-mapper.js';
import { toMemoryView } from './memory-mapper.js';
import { parseAgentToolListCursor, encodeAgentToolListCursor } from '@nexus-terminal/shared/agent/tools/http-codec';
import { toArtifactView } from './artifact-mapper.js';
import type { ThreadEntries } from '../../context/model/context-types.js';
import type { RunEventPage } from '../../runs/model/run-types.js';
import type { Participant } from '../../runs/model/run-collaboration-types.js';
import type { AgentThreadEntries } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { AgentChildrenResponse } from '@nexus-terminal/shared/agent/collaboration/http';
import type { AgentWorkspaceInput, AgentWorkspaceResult } from '@nexus-terminal/shared/agent/scope/workspace-http';
import { AGENT_CHILD_PROFILES } from '@nexus-terminal/shared/agent/collaboration/values';
import { AgentFailure } from '../../agent-failure.js';
import type {
	CoreWorkspaceInput,
	CoreWorkspaceResult,
	UiWorkspaceInput,
	UiWorkspaceResult,
} from '../../scope/model/workspace-types.js';
import { toThreadView, toDefinitionView } from './scope-mapper.js';
import { toRunView, toRunSuspension } from './run-mapper.js';
import { toOperationApproval, toOperationApprovalPage } from './operation-approval-mapper.js';

export function fromWorkspace(value: AgentWorkspaceInput): CoreWorkspaceInput {
	switch (value.method) {
		case 'agent.content.read':
			return {
				method: value.method,
				runId: value.params.runId,
				index: value.params.index,
				reference: {
					id: value.params.reference.id,
					sha256: value.params.reference.sha256,
					sizeBytes: value.params.reference.sizeBytes,
					mediaType: value.params.reference.mediaType,
				},
			};
		case 'agent.runs.resume':
			return {
				method: value.method,
				runId: value.params.runId,
				operationId: value.params.operationId,
				expectedVersion: value.params.input.expectedVersion,
				inputJson: value.params.input.inputJson,
			};
		case 'agent.runs.outputs':
		case 'agent.runs.suspension':
			return { method: value.method, runId: value.params.runId };
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
					inputJson: p.input.inputJson,
				},
			};
		}
		case 'agent.threads.history':
			return {
				method: value.method,
				threadId: value.params.threadId,
				limit: value.params.limit,
				before:
					value.params.before === null
						? null
						: {
								runSequence: value.params.before.runSequence,
								messageOrdinal: value.params.before.messageOrdinal,
								chunkIndex: value.params.before.chunkIndex,
								textOffset: value.params.before.textOffset,
							},
			};
		case 'agent.threads.entries':
			return {
				method: value.method,
				threadId: value.params.threadId,
				limit: value.params.limit,
				after: {
					runSequence: value.params.after.runSequence,
					messageOrdinal: value.params.after.messageOrdinal,
					chunkIndex: value.params.after.chunkIndex,
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
					inputJson: p.input.inputJson,
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

export function toWorkspace(value: CoreWorkspaceResult): AgentWorkspaceResult {
	switch (value.method) {
		case 'agent.runs.suspension': {
			const item = value.value;
			return { method: value.method, value: item === null ? null : toRunSuspension(item) };
		}
		case 'agent.runs.outputs':
			return {
				method: value.method,
				value:
					value.value === null
						? null
						: value.value.map((ref) => ({
								id: ref.id,
								sha256: ref.sha256,
								sizeBytes: ref.sizeBytes,
								mediaType: ref.mediaType,
							})),
			};
		case 'agent.content.read':
			return {
				method: value.method,
				value: {
					reference: {
						id: value.value.reference.id,
						sha256: value.value.reference.sha256,
						sizeBytes: value.value.reference.sizeBytes,
						mediaType: value.value.reference.mediaType,
					},
					index: value.value.index,
					text: value.value.text,
					nextIndex: value.value.nextIndex,
				},
			};
		case 'agent.runs.resume': {
			const result = value.value;
			if (result.status === 'resumed') {
				return { method: value.method, value: { status: 'resumed', run: toRunView(result.run) } };
			}
			if (result.status === 'replayed') {
				return {
					method: value.method,
					value: { status: 'replayed', originalStatus: 'resumed', run: toRunView(result.run) },
				};
			}
			throw new AgentFailure('internal_failure');
		}
		case 'agent.threads.history':
			return {
				method: value.method,
				value: {
					body: toThreadEntries(value.value.body),
					hasEarlier: value.value.hasEarlier,
					startCursor: {
						runSequence: value.value.startCursor.runSequence,
						messageOrdinal: value.value.startCursor.messageOrdinal,
						chunkIndex: value.value.startCursor.chunkIndex,
						textOffset: value.value.startCursor.textOffset,
					},
				},
			};
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
			return { method: value.method, value: toOperationApproval(value.value) };
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
			return { method: value.method, value: toOperationApprovalPage(value.value) };
	}
}

export function toThreadEntries(value: ThreadEntries): AgentThreadEntries {
	return {
		appId: value.appId,
		threadId: value.threadId,
		items: value.items.map((item) => ({
			runId: item.runId,
			operationSequence: item.operationSequence,
			role: item.role,
			text: item.text,
			position: {
				runSequence: item.position.runSequence,
				messageOrdinal: item.position.messageOrdinal,
				chunkIndex: item.position.chunkIndex,
				textOffset: item.position.textOffset,
			},
		})),
		nextCursor: {
			runSequence: value.nextCursor.runSequence,
			messageOrdinal: value.nextCursor.messageOrdinal,
			chunkIndex: value.nextCursor.chunkIndex,
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

export function fromUiWorkspace(
	value: import('@nexus-terminal/shared/agent/plugins/ui-http').AgentPluginUiInput,
): UiWorkspaceInput {
	switch (value.method) {
		case 'agent.runs.usage':
			return { method: value.method, runId: value.params.runId };
		case 'agent.tools.list':
			return {
				method: value.method,
				threadId: value.params.threadId,
				before: value.params.before === null ? null : fromToolCursor(value.params.before),
				limit: value.params.limit,
			};
		case 'agent.tools.details':
			return { method: value.method, runId: value.params.runId, toolId: value.params.toolId };
		case 'agent.memories.list':
			return {
				method: value.method,
				query: {
					status: value.params.status,
					offset: value.params.offset,
					limit: value.params.limit,
					...(value.params.threadId === undefined ? {} : { threadId: value.params.threadId }),
				},
			};
		case 'agent.memories.get':
			return { method: value.method, memoryId: value.params.memoryId };
		case 'agent.memories.review':
			return {
				method: value.method,
				memoryId: value.params.memoryId,
				input: {
					expectedVersion: value.params.input.expectedVersion,
					decision: value.params.input.decision,
					content: value.params.input.content,
				},
			};
		case 'agent.artifacts.list':
			return {
				method: value.method,
				query: {
					retained: value.params.retained,
					kind: value.params.kind,
					q: value.params.q,
					offset: value.params.offset,
					limit: value.params.limit,
				},
			};
		case 'agent.artifacts.get':
			return { method: value.method, artifactId: value.params.artifactId };
		case 'agent.artifacts.begin':
			return {
				method: value.method,
				input: {
					name: value.params.name,
					mediaType: value.params.mediaType,
					declaredBytes: value.params.declaredBytes,
				},
			};
		case 'agent.artifacts.retain':
			return {
				method: value.method,
				artifactId: value.params.artifactId,
				expectedVersion: value.params.input.expectedVersion,
				retained: value.params.input.retained,
			};
		case 'agent.artifacts.delete':
			return {
				method: value.method,
				artifactId: value.params.artifactId,
				expectedVersion: value.params.input.expectedVersion,
			};
		case 'agent.artifacts.attach':
			return {
				method: value.method,
				artifactId: value.params.artifactId,
				expectedVersion: value.params.expectedVersion,
				threadId: value.params.threadId,
				runId: value.params.runId,
			};
		case 'agent.artifacts.readRange':
			return {
				method: value.method,
				artifactId: value.params.artifactId,
				expectedVersion: value.params.expectedVersion,
				start: value.params.start,
				endInclusive: value.params.endInclusive,
			};
	}
}

export function toUiWorkspace(
	value: UiWorkspaceResult,
): import('@nexus-terminal/shared/agent/plugins/ui-http').AgentPluginUiResult {
	const appId = value.appId;
	switch (value.method) {
		case 'agent.runs.usage':
			return {
				appId,
				method: value.method,
				value: {
					runId: value.value.runId,
					runVersion: value.value.runVersion,
					inputTokens: value.value.inputTokens,
					outputTokens: value.value.outputTokens,
					reportedModelRequests: value.value.reportedModelRequests,
					modelRequests: value.value.modelRequests,
					toolExecutions: value.value.toolExecutions,
				},
			};
		case 'agent.tools.list':
			return {
				appId,
				method: value.method,
				value: {
					items: value.value.items.map(toToolView),
					nextCursor:
						value.value.nextCursor === null
							? null
							: encodeAgentToolListCursor(value.value.nextCursor.createdAt, value.value.nextCursor.id),
				},
			};
		case 'agent.tools.details':
			return {
				appId,
				method: value.method,
				value: {
					tool: toToolView(value.value),
					argumentsJson: value.value.argumentsJson,
					failureCode: value.value.failureCode,
				},
			};
		case 'agent.memories.list':
			return {
				appId,
				method: value.method,
				value: { items: value.value.items.map(toMemoryView), nextOffset: value.value.nextOffset },
			};
		case 'agent.memories.get':
		case 'agent.memories.review':
			return { appId, method: value.method, value: { memory: toMemoryView(value.value) } };
		case 'agent.artifacts.list':
			return {
				appId,
				method: value.method,
				value: { items: value.value.items.map(toArtifactView), nextOffset: value.value.nextOffset },
			};
		case 'agent.artifacts.get':
		case 'agent.artifacts.begin':
		case 'agent.artifacts.retain':
			return { appId, method: value.method, value: { artifact: toArtifactView(value.value) } };
		case 'agent.artifacts.delete':
			return { appId, method: value.method, value: { deleted: true } };
		case 'agent.artifacts.attach':
			return {
				appId,
				method: value.method,
				value: {
					attachment: {
						artifact: toArtifactView(value.value.artifact),
						sourceAppId: value.value.artifact.appId,
						targetAppId: value.value.targetAppId,
						threadId: value.value.threadId,
						runId: value.value.runId,
						role: 'input',
						crossApp: value.value.artifact.appId !== value.value.targetAppId,
					},
				},
			};
		case 'agent.artifacts.readRange':
			return {
				appId,
				method: value.method,
				value: {
					artifactId: value.value.artifactId,
					start: value.value.start,
					endInclusive: value.value.endInclusive,
					dataBase64: Buffer.from(value.value.bytes).toString('base64'),
					version: value.value.version,
					totalBytes: value.value.totalBytes,
				},
			};
	}
}

function fromToolCursor(
	value: string,
): import('../../operations/model/operation-activity-types.js').OperationActivityCursor {
	const cursor = parseAgentToolListCursor(value);
	return { createdAt: cursor.createdAt, id: cursor.id };
}
