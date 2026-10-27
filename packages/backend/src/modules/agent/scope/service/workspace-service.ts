import { AgentFailure } from '../../agent-failure.js';
import { AGENT_WORKSPACE_MAX_SELECTABLE_MODELS } from '@nexus-terminal/shared/agent/scope/values';
import type { ThreadAccess } from '../model/thread-types.js';
import type { ThreadService } from './thread-service.js';
import type { ScopeService } from './scope-service.js';
import type { ProviderService } from '../../providers/service/provider-service.js';
import type { RunService } from '../../runs/service/run-service.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ContextHistoryService } from '../../context/service/context-history-service.js';
import type { WorkspaceInput, WorkspaceResult, WorkspaceMutation } from '../model/workspace-types.js';

function required<T>(value: T | null): T {
	if (value === null) {
		throw new AgentFailure('not_found');
	}
	return value;
}

export class WorkspaceService {
	constructor(
		private readonly scope: ScopeService,
		private readonly threads: ThreadService,
		private readonly providers: ProviderService,
		private readonly runs: RunService,
		private readonly collaboration: RunCollaborationService,
		private readonly governance: GovernanceService,
		private readonly contexts: ContextHistoryService,
	) {}

	async rpc(access: ThreadAccess, input: WorkspaceInput, withMutation: WorkspaceMutation): Promise<WorkspaceResult> {
		access.assertCurrent();
		switch (input.method) {
			case 'agent.threads.entries':
				return {
					method: input.method,
					value: required(
						await this.contexts.entries(
							access.userId,
							access.appId,
							input.threadId,
							input.after,
							input.limit,
						),
					),
				};
			case 'agent.runs.create':
			case 'agent.runs.appendInput': {
				const request = {
					userId: access.userId,
					appId: access.appId,
					threadId: input.threadId,
					operationKey: input.operationId,
					prompt: input.input.prompt,
					approvalMode: input.input.approvalMode,
					connectionIds: input.input.connectionIds.map((id) => id),
					model: {
						providerId: input.input.model.providerId,
						modelId: input.input.model.modelId,
						configurationVersion: input.input.model.configurationVersion,
						...(input.input.model.reasoningEffort === undefined
							? {}
							: { reasoningEffort: input.input.model.reasoningEffort }),
					},
				};
				const value = await withMutation(() =>
					input.method === 'agent.runs.create'
						? this.runs.create(request)
						: this.runs.appendInput(request, input.runId, input.expectedVersion),
				);
				if (!('run' in value)) {
					throw new AgentFailure(value.status === 'scope_not_found' ? 'not_found' : value.status);
				}
				return { method: input.method, value };
			}
			case 'agent.runs.cancel':
			case 'agent.subagents.cancel': {
				const request = {
					userId: access.userId,
					appId: access.appId,
					runId: input.runId,
					expectedVersion: input.expectedVersion,
					operationKey: input.operationId,
				};
				const value = await withMutation(() =>
					input.method === 'agent.runs.cancel'
						? this.runs.cancel(request)
						: this.runs.cancelChild(request, input.childId),
				);
				if (!('run' in value)) {
					throw new AgentFailure(value.status);
				}
				return { method: input.method, value };
			}
			case 'agent.approvals.resolve':
				return {
					method: input.method,
					value: await withMutation(() =>
						this.governance.resolve({
							userId: access.userId,
							appId: access.appId,
							approvalId: input.approvalId,
							operationKey: input.operationId,
							decision: input.input.decision,
							operationHash: input.input.operationHash,
							expectedVersion: input.input.expectedVersion,
							feedback: input.input.feedback,
						}),
					),
				};
			case 'agent.definitions.list':
				return { method: input.method, value: await this.scope.declarations(access.userId) };
			case 'agent.providers.list': {
				const value = await this.providers.available(access.userId);
				if (value.length > AGENT_WORKSPACE_MAX_SELECTABLE_MODELS) {
					throw new AgentFailure('limit_exceeded');
				}
				return { method: input.method, value };
			}
			case 'agent.threads.list':
				return { method: input.method, value: await this.threads.list(access, input.after, input.limit) };
			case 'agent.threads.create':
				return {
					method: input.method,
					value: await this.threads.mutate(access, {
						kind: 'create',
						autoTitle: input.autoTitle,
						operationId: input.operationId,
						title: input.title,
					}),
				};
			case 'agent.threads.rename':
				return {
					method: input.method,
					value: await this.threads.mutate(access, {
						kind: 'rename',
						threadId: input.threadId,
						expectedVersion: input.expectedVersion,
						operationId: input.operationId,
						title: input.title,
					}),
				};
			case 'agent.threads.delete': {
				const value = await this.threads.remove(access, {
					threadId: input.threadId,
					expectedVersion: input.expectedVersion,
				});
				return { method: input.method, value: { appId: value.appId, threadId: value.id } };
			}
			case 'agent.runs.list':
				return {
					method: input.method,
					threadId: input.threadId,
					value: required(
						await this.runs.list(access.userId, access.appId, input.threadId, input.after, input.limit),
					),
				};
			case 'agent.runs.get':
				return { method: input.method, value: await this.runs.get(access.userId, access.appId, input.runId) };
			case 'agent.runs.events':
				return {
					method: input.method,
					value: required(
						await this.runs.listEvents(access.userId, access.appId, input.runId, input.after, input.limit),
					),
				};
			case 'agent.subagents.list':
				return {
					method: input.method,
					value: required(
						await this.collaboration.listChildren({
							userId: access.userId,
							appId: access.appId,
							runId: input.runId,
						}),
					),
				};
			case 'agent.subagents.messages':
				return {
					method: input.method,
					value: required(
						await this.collaboration.messageMetadata(
							{ userId: access.userId, appId: access.appId, runId: input.runId },
							input.childId,
							input.after,
							input.limit,
						),
					),
				};
			case 'agent.approvals.list':
				return {
					method: input.method,
					value: required(
						await this.governance.approvals(access.userId, access.appId, input.runId, input.after),
					),
				};
		}
	}
}
