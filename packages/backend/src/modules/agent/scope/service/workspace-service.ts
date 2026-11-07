import type { OperationContentService } from '../../operations/service/operation-content-service.js';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { AgentFailure } from '../../agent-failure.js';
import type { ThreadAccess } from '../model/thread-types.js';
import type { ThreadService } from './thread-service.js';
import type { ScopeService } from './scope-service.js';
import type { ProviderService } from '../../providers/service/provider-service.js';
import type { RunService } from '../../runs/service/run-service.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import type { OperationApprovalService } from '../../governance/service/operation-approval-service.js';
import type { ContextHistoryService } from '../../context/service/context-history-service.js';
import { isUiWorkspaceInput } from '../model/workspace-types.js';
import type { PluginThreadAccess } from '../model/thread-types.js';
import type { MemoryService } from '../../memory/service/memory-service.js';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactRecord, ArtifactActor } from '../../artifacts/model/artifact-types.js';
import type {
	CoreWorkspaceInput,
	CoreWorkspaceResult,
	UiWorkspaceInput,
	UiWorkspaceResult,
	WorkspaceInput,
	WorkspaceResult,
	WorkspaceMutation,
} from '../model/workspace-types.js';

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
		private readonly approvals: OperationApprovalService,
		private readonly contexts: ContextHistoryService,
		private readonly memories: MemoryService,
		private readonly artifacts: ArtifactService,
		private readonly contents: OperationContentService,
	) {}

	rpc(access: ThreadAccess, input: CoreWorkspaceInput, withMutation: WorkspaceMutation): Promise<CoreWorkspaceResult>;

	rpc(access: ThreadAccess, input: UiWorkspaceInput, withMutation: WorkspaceMutation): Promise<UiWorkspaceResult>;

	rpc(access: ThreadAccess, input: WorkspaceInput, withMutation: WorkspaceMutation): Promise<WorkspaceResult>;

	async rpc(access: ThreadAccess, input: WorkspaceInput, withMutation: WorkspaceMutation): Promise<WorkspaceResult> {
		access.assertCurrent();
		if (isUiWorkspaceInput(input)) {
			if (access.kind !== 'plugin') {
				throw new AgentFailure('forbidden');
			}
			const result = await this.uiRpc(access, input, withMutation);
			try {
				await this.revalidate(access);
			} catch (cause) {
				if (
					input.method === 'agent.memories.review' ||
					input.method === 'agent.artifacts.begin' ||
					input.method === 'agent.artifacts.retain' ||
					input.method === 'agent.artifacts.delete' ||
					input.method === 'agent.artifacts.attach'
				) {
					throw new AgentFailure('operation_unknown', { cause });
				}
				throw cause;
			}
			return result;
		}
		switch (input.method) {
			case 'agent.threads.history':
				return {
					method: input.method,
					value: required(
						await this.contexts.previousEntries(
							access.userId,
							access.appId,
							input.threadId,
							input.before,
							input.limit,
						),
					),
				};
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
			case 'agent.runs.outputs':
				return {
					method: input.method,
					value: await this.contents.outputs({
						userId: access.userId,
						appId: access.appId,
						runId: input.runId,
					}),
				};
			case 'agent.content.read':
				return {
					method: input.method,
					value: await this.contents.readExport(
						{ userId: access.userId, appId: access.appId, runId: input.runId },
						input.reference,
						input.index,
					),
				};
			case 'agent.runs.suspension':
				return {
					method: input.method,
					value: await this.runs.suspension(access.userId, access.appId, input.runId),
				};
			case 'agent.runs.resume': {
				const value = await withMutation(() =>
					this.runs.resume({
						userId: access.userId,
						appId: access.appId,
						runId: input.runId,
						expectedVersion: input.expectedVersion,
						operationKey: input.operationId,
						inputJson: input.inputJson,
					}),
				);
				if (!('run' in value)) {
					throw new AgentFailure(value.status);
				}
				return { method: input.method, value };
			}
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
					inputJson: input.input.inputJson,
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
						this.approvals.resolve(
							{ userId: access.userId, token: access.token },
							{
								appId: access.appId,
								approvalId: input.approvalId,
								operationKey: input.operationId,
								decision: input.input.decision,
								operationHash: input.input.operationHash,
								expectedVersion: input.input.expectedVersion,
								feedback: input.input.feedback,
							},
						),
					),
				};
			case 'agent.definitions.list':
				return { method: input.method, value: await this.scope.declarations(access.userId) };
			case 'agent.providers.list': {
				const value = await this.providers.available(access.userId);
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
					value: required(await this.approvals.page(access.userId, access.appId, input.runId, input.after)),
				};
		}
	}

	private revalidate(access: PluginThreadAccess): Promise<void> {
		return this.threads.withState(access, async () => {
			access.assertCurrent();
		});
	}

	private artifactActor(access: PluginThreadAccess): ArtifactActor {
		return {
			kind: 'plugin-ui',
			userId: access.userId,
			appId: access.appId,
			token: access.token,

			assertCurrent: () => access.assertCurrent(),
		};
	}

	async uploadUiArtifact(
		access: PluginThreadAccess,
		artifactId: string,
		expectedVersion: number,
		source: AsyncIterable<Uint8Array>,
		signal: AbortSignal,
		withMutation: WorkspaceMutation,
	): Promise<ArtifactRecord> {
		await this.revalidate(access);
		const self = this;

		async function* authorizedSource(): AsyncIterable<Uint8Array> {
			for await (const chunk of source) {
				signal.throwIfAborted();
				await self.revalidate(access);
				yield Uint8Array.from(chunk);
			}
		}

		const value = await withMutation(() =>
			this.artifacts.upload(this.artifactActor(access), artifactId, expectedVersion, authorizedSource(), signal),
		);
		try {
			await this.revalidate(access);
		} catch (cause) {
			throw new AgentFailure('operation_unknown', { cause });
		}
		return value;
	}

	private async uiRpc(
		access: PluginThreadAccess,
		input: UiWorkspaceInput,
		withMutation: WorkspaceMutation,
	): Promise<UiWorkspaceResult> {
		await this.revalidate(access);
		const scope = { userId: access.userId, appId: access.appId };
		switch (input.method) {
			case 'agent.runs.usage':
				return {
					appId: access.appId,
					method: input.method,
					value: required(await this.runs.getUsage(access.userId, access.appId, input.runId)),
				};
			case 'agent.tools.list':
				return {
					appId: access.appId,
					method: input.method,
					value: required(
						await this.runs.listThreadTools(
							access.userId,
							access.appId,
							input.threadId,
							input.before,
							input.limit,
						),
					),
				};
			case 'agent.tools.details':
				return {
					appId: access.appId,
					method: input.method,
					value: required(
						await this.runs.getToolCall(access.userId, access.appId, input.runId, input.toolId),
					),
				};
			case 'agent.memories.list':
				return {
					appId: access.appId,
					method: input.method,
					value: await this.memories.list(scope, input.query),
				};
			case 'agent.memories.get':
				return {
					appId: access.appId,
					method: input.method,
					value: required(await this.memories.get(scope, input.memoryId)),
				};
			case 'agent.memories.review':
				return {
					appId: access.appId,
					method: input.method,
					value: await withMutation(() =>
						this.memories.review(
							{
								kind: 'plugin-ui',
								userId: access.userId,
								appId: access.appId,
								token: access.token,

								assertCurrent: () => access.assertCurrent(),
							},
							input.memoryId,
							input.input,
						),
					),
				};
			case 'agent.artifacts.list':
				return {
					appId: access.appId,
					method: input.method,
					value: await this.artifacts.list(access.userId, {
						appId: access.appId,
						retained: input.query.retained,
						kind: input.query.kind,
						q: input.query.q,
						offset: input.query.offset,
						limit: input.query.limit,
					}),
				};
			case 'agent.artifacts.get':
				return {
					appId: access.appId,
					method: input.method,
					value: required(await this.artifacts.get(scope, input.artifactId)),
				};
			case 'agent.artifacts.begin':
				return {
					appId: access.appId,
					method: input.method,
					value: await withMutation(() => this.artifacts.begin(this.artifactActor(access), input.input)),
				};
			case 'agent.artifacts.retain':
				return {
					appId: access.appId,
					method: input.method,
					value: await withMutation(() =>
						this.artifacts.retain(
							this.artifactActor(access),
							input.artifactId,
							input.expectedVersion,
							input.retained,
						),
					),
				};
			case 'agent.artifacts.delete':
				await withMutation(() =>
					this.artifacts.delete(this.artifactActor(access), input.artifactId, input.expectedVersion),
				);
				return { appId: access.appId, method: input.method, value: { deleted: true } };
			case 'agent.artifacts.attach': {
				const artifact = await withMutation(() =>
					this.artifacts.attach(this.artifactActor(access), input.artifactId, {
						expectedVersion: input.expectedVersion,
						targetAppId: access.appId,
						threadId: input.threadId,
						runId: input.runId,
					}),
				);
				return {
					appId: access.appId,
					method: input.method,
					value: { artifact, targetAppId: access.appId, threadId: input.threadId, runId: input.runId },
				};
			}
			case 'agent.artifacts.readRange': {
				const authorize = async () => {
					await this.revalidate(access);
					const artifact = required(await this.artifacts.get(scope, input.artifactId));
					await this.revalidate(access);
					if (artifact.version !== input.expectedVersion) {
						throw new AgentFailure('version_conflict');
					}
					return artifact;
				};

				const artifact = await authorize();
				const size = input.endInclusive - input.start + 1;
				if (
					!Number.isSafeInteger(input.start) ||
					input.start < 0 ||
					!Number.isSafeInteger(input.endInclusive) ||
					input.endInclusive < input.start ||
					!Number.isSafeInteger(size)
				) {
					throw new AgentFailure('invalid_input');
				}
				// Reject ranges that cannot fit the existing frontend protocol before reading or allocating.
				const encodedBytes = 4 * Math.ceil(size / 3);
				const envelopeBytes = Buffer.byteLength(
					JSON.stringify({
						appId: access.appId,
						method: input.method,
						value: {
							artifactId: artifact.id,
							start: input.start,
							endInclusive: input.endInclusive,
							dataBase64: '',
							version: artifact.version,
							totalBytes: artifact.sizeBytes,
						},
					}),
					'utf8',
				);
				if (encodedBytes > AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES - envelopeBytes) {
					throw new AgentFailure('limit_exceeded');
				}
				const bytes = new Uint8Array(size);
				let offset = 0;
				for await (const chunk of this.artifacts.readGranted(
					input.artifactId,
					{ start: input.start, endInclusive: input.endInclusive },
					new AbortController().signal,
					authorize,
				)) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return {
					appId: access.appId,
					method: input.method,
					value: {
						artifactId: artifact.id,
						start: input.start,
						endInclusive: input.endInclusive,
						bytes,
						version: artifact.version,
						totalBytes: artifact.sizeBytes,
					},
				};
			}
		}
	}
}
