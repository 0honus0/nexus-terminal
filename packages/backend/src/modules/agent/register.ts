import { TitleModel } from './scope/model/title-model.js';
import { SqliteTitleStorage } from './scope/adapters/sqlite/title-sql.js';
import { CompactionModel } from './context/model/compaction-model.js';
import { SqliteCompactionStorage } from './context/adapters/sqlite/compaction-sql.js';
import { RunStreamService } from './runs/service/run-stream-service.js';
import { RunChanges } from './runs/model/run-changes.js';
import { createRunChangesWebSocketRoute } from './interfaces/ws/run-changes-ws.js';
import { ProviderImageService } from './providers/service/provider-image-service.js';
import type { Logger } from '../../platform/logging/logger.js';
import { logDiagnostic } from '../../platform/logging/diagnostic-log.js';
import { registerAgentSnapshot } from './snapshots/adapters/sqlite/snapshot-registration.js';
import type { SnapshotRegistration } from '../../platform/storage/sqlite/snapshot-types.js';
import { toRunUsageView, toRunView } from './interfaces/http/run-mapper.js';
import { encodeAgentToolListCursor } from '@nexus-terminal/shared/agent/tools/http-codec';
import { toThreadView, toDefinitionView } from './interfaces/http/scope-mapper.js';
import { ThreadModel } from './scope/model/thread-model.js';
import { ThreadService } from './scope/service/thread-service.js';
import { SqliteThreadStorage } from './scope/adapters/sqlite/thread-sql.js';
import { WorkspaceService } from './scope/service/workspace-service.js';
import { createWorkspaceHttpRoute } from './interfaces/http/workspace-http.js';
import { PluginIntentModel } from './plugins/model/plugin-intent-model.js';
import { PluginIntentService } from './plugins/service/plugin-intent-service.js';
import { SqlitePluginIntentStorage } from './plugins/adapters/sqlite/plugin-intent-sql.js';
import {
	readGrantedArtifactSource,
	publishArtifactGrants,
	revokeArtifactGrants,
	readGrantedArtifact,
} from './artifacts/adapters/sqlite/artifact-grant-sql.js';
import { createPluginIntentHttpRoutes } from './interfaces/http/plugin-intent-http.js';
import { PluginRepositoryService } from './plugins/service/plugin-repository-service.js';
import { PluginRepositoryModel } from './plugins/model/plugin-repository-model.js';
import { SqlitePluginRepositoryStorage } from './plugins/adapters/sqlite/plugin-repository-sql.js';
import { HttpPluginCatalog } from './plugins/adapters/repository/http-plugin-catalog.js';
import { NativeBoundedFetch } from '../../platform/network/adapters/native-bounded-fetch.js';
import { NodeModuleRuntime } from '../../platform/isolation/adapters/node-module-runtime.js';
import { NativePluginBackendRuntime } from './plugins/adapters/runtime/plugin-backend-runtime.js';
import { activatePluginScope, retirePluginScope } from './scope/adapters/sqlite/plugin-scope-sql.js';
import { NativePackageReader } from '../../platform/packages/adapters/native-package-reader.js';
import { NativePackageSignature } from '../../platform/packages/adapters/native-package-signature.js';
import { BuiltPluginSdkAssets } from './plugins/adapters/frontend/plugin-sdk-assets.js';
import { NativePluginPackageDecoder } from './plugins/adapters/package/plugin-package-decoder.js';
import { SqlitePluginStorage } from './plugins/adapters/sqlite/plugin-sql.js';
import { PluginModel, fromPluginSkillFiles } from './plugins/model/plugin-model.js';
import { parsePluginSkills } from './plugins/plugin-skill-rules.js';
import { PluginService } from './plugins/service/plugin-service.js';
import { createPluginHttpRoutes, createPluginContentRoutes } from './interfaces/http/plugin-http.js';
import { NativeBrowserClient } from '../../platform/browser/adapters/native-browser-client.js';
import { SqliteBrowserStorage } from './integrations/adapters/sqlite/browser-sql.js';
import { BrowserModel } from './integrations/model/browser-model.js';
import { BrowserService } from './integrations/service/browser-service.js';
import { createBrowserHttpRoutes } from './interfaces/http/browser-http.js';
import { NativeMcpClient } from '../../platform/mcp/adapters/native-mcp-client.js';
import { SqliteIntegrationStorage } from './integrations/adapters/sqlite/integration-sql.js';
import { IntegrationModel } from './integrations/model/integration-model.js';
import { IntegrationService } from './integrations/service/integration-service.js';
import { createIntegrationHttpRoutes } from './interfaces/http/integration-http.js';
import type { HostDiagnostics } from '../system/public.js';
import type { OperationsEvents } from '../operations/public.js';
import { SqliteExecutionStorage } from './execution/adapters/sqlite/execution-sql.js';
import { ExecutionModel } from './execution/model/execution-model.js';
import { ExecutionService } from './execution/service/execution-service.js';
import { createExecutionHttpRoutes } from './interfaces/http/execution-http.js';
import { SqliteCheckpointStorage } from './context/adapters/sqlite/checkpoint-sql.js';
import { CheckpointModel } from './context/model/checkpoint-model.js';
import { CheckpointService } from './context/service/checkpoint-service.js';
import { SqliteArtifactStorage } from './artifacts/adapters/sqlite/artifact-sql.js';
import { ArtifactModel } from './artifacts/model/artifact-model.js';
import { ArtifactService } from './artifacts/service/artifact-service.js';
import { createArtifactHttpRoutes } from './interfaces/http/artifact-http.js';
import type { BlobStore } from '../../platform/blobs/blob-store.js';
import { SqliteMemoryStorage } from './memory/adapters/sqlite/memory-sql.js';
import { MemoryModel } from './memory/model/memory-model.js';
import { MemoryService } from './memory/service/memory-service.js';
import { SecureSessionTokens } from '../../platform/security/adapters/secure-session-tokens.js';
import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { createMemoryHttpRoutes } from './interfaces/http/memory-http.js';
import { AGENT_CHILD_PROFILES } from '@nexus-terminal/shared/agent/collaboration/values';
import { ToolProjectService } from './tools/service/tool-project-service.js';
import { ToolProjectModel } from './tools/model/tool-project-model.js';
import { SqliteToolProjectStorage } from './tools/adapters/sqlite/tool-project-sql.js';
import { SqliteRunCollaborationStorage } from './runs/adapters/sqlite/run-collaboration-sql.js';
import { RunCollaborationModel } from './runs/model/run-collaboration-model.js';
import { RunCollaborationService } from './runs/service/run-collaboration-service.js';
import { AcpPermissionService } from './tools/service/acp-permission-service.js';
import { ToolJobService } from './tools/service/tool-job-service.js';
import { ToolJobModel } from './tools/model/tool-job-model.js';
import { SqliteToolJobStorage } from './tools/adapters/sqlite/tool-job-sql.js';
import type { TrustedSshTargetResolver } from '../targets/public.js';
import type { RemoteMachineOperations } from '../remote/public.js';
import { ToolService } from './tools/service/tool-service.js';
import { ToolModel } from './tools/model/tool-model.js';
import { AGENT_APP_EXECUTION_STATE } from '@nexus-terminal/shared/agent/scope/values';
import type { RunRevocationRequest } from './runs/model/run-types.js';
import { builtinAppDefinitions } from './scope/service/app-definitions.js';
import type { ConnectionCatalog } from '../targets/public.js';
import { AgentFailure } from './agent-failure.js';
import type { AgentAppView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentRunEventView } from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../../platform/security/secret-box.js';
import { OpenAiCompatibleAdapter } from '../../platform/ai/adapters/openai-compatible.js';
import { SqliteProviderStorage } from './providers/adapters/sqlite/provider-sql.js';
import { ProviderModel } from './providers/model/provider-model.js';
import { ProviderService } from './providers/service/provider-service.js';
import type { AgentProviderApi } from './providers/model/provider-api-types.js';
import { createAgentProviderHttpRoutes } from './interfaces/http/provider-http.js';
import { SqliteCapabilityRegistryStorage } from './providers/registry/adapters/sqlite/registry-sql.js';
import { CapabilityRegistryModel } from './providers/registry/model/registry-model.js';
import { CapabilityRegistryService } from './providers/registry/service/registry-service.js';
import { ModelsDevCatalogAdapter } from '../../platform/ai/adapters/model-catalog.js';
import { SqliteScopeStorage } from './scope/adapters/sqlite/scope-sql.js';
import { ScopeModel, toStoredDefinition } from './scope/model/scope-model.js';
import { ScopeService } from './scope/service/scope-service.js';
import { SqliteRunStorage } from './runs/adapters/sqlite/run-sql.js';
import { SqliteRunStepStorage } from './runs/adapters/sqlite/run-step-sql.js';
import { SqliteRunToolStorage } from './runs/adapters/sqlite/run-tool-sql.js';
import { RunToolModel } from './runs/model/run-tool-model.js';
import type { ToolOperation } from './runs/model/run-tool-types.js';
import type { AgentToolView } from '@nexus-terminal/shared/agent/tools/model';
import { RunModel } from './runs/model/run-model.js';
import { RunStepModel } from './runs/model/run-step-model.js';
import { ContextModel } from './context/model/context-model.js';
import { ContextHistoryService } from './context/service/context-history-service.js';
import { ResultService } from './context/service/result-service.js';
import { SqliteContextStorage } from './context/adapters/sqlite/context-history-sql.js';
import { RunModelStream } from './runs/model/run-model-stream.js';
import { RunExecutionOwner } from './runs/service/run-execution-owner.js';
import { RunService } from './runs/service/run-service.js';
import type { AgentApp } from './scope/model/scope-types.js';
import type { AgentRunEvent, CreateRunResult, CancelRunResult, RunEventPage } from './runs/model/run-types.js';
import type { AgentStateApi, AgentCreateRunResult, AgentCancelRunResult, AgentCancelRunInput } from './public.js';
import { AgentRequestOwner } from './service/agent-request-owner.js';
import type { ResourceCollector } from '../../platform/system/resource-diagnostic.js';
import { agentBoundary } from './agent-errors.js';
import type { AccessPublicApi } from '../access/public.js';
import type { HttpRoute, HttpWebSocketRoute } from '../../platform/http/http-types.js';
import { createAgentHttpRoutes } from './interfaces/http/agent-http.js';
import { SqliteGovernanceStorage } from './governance/adapters/sqlite/governance-sql.js';
import { GovernanceModel } from './governance/model/governance-model.js';
import { GovernanceService } from './governance/service/governance-service.js';
import { createGovernanceHttpRoutes } from './interfaces/http/governance-http.js';

function toAppView(value: AgentApp): AgentAppView {
	return {
		id: value.id,
		name: value.name,
		definitionId: value.definitionId,
		definitionVersion: value.definitionVersion,
		capabilities: value.capabilities.map((capability) => capability),
		enabled: value.enabled,
		version: value.version,
		executionState: AGENT_APP_EXECUTION_STATE,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toToolView(value: ToolOperation): AgentToolView {
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

function toEventView(value: AgentRunEvent): AgentRunEventView {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

function toCreateResult(value: CreateRunResult): AgentCreateRunResult {
	if (value.status === 'replayed') {
		return { status: 'replayed', originalStatus: value.originalStatus, run: toRunView(value.run) };
	}
	if (value.status === 'created') {
		return { status: 'created', run: toRunView(value.run) };
	}
	return { status: value.status };
}

function toCancelResult(value: CancelRunResult): AgentCancelRunResult {
	if (value.status === 'replayed') {
		return { status: 'replayed', originalStatus: value.originalStatus, run: toRunView(value.run) };
	}
	if (value.status === 'cancelled' || value.status === 'already_cancelled') {
		return { status: value.status, run: toRunView(value.run) };
	}
	return { status: value.status };
}

function toEventPage(value: RunEventPage): AgentRunEventsResponse {
	return { items: value.items.map(toEventView), nextCursor: value.nextCursor };
}

export interface AgentRegistration {
	resourceCollector: ResourceCollector;
	publicApi: AgentStateApi;
	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void;
	initialize(mode: 'startup' | 'restore'): Promise<void>;
	quiesce(): void;
	close(): Promise<void>;
	routes(access: AccessPublicApi): HttpRoute[];
	webSocketRoutes(access: AccessPublicApi): HttpWebSocketRoute[];
}

export function registerAgent(
	sqlite: SqliteRuntime,
	secrets: SecretBox | null,
	targets: ConnectionCatalog,
	resolver: TrustedSshTargetResolver,
	remoteOperations: RemoteMachineOperations,
	blobs: BlobStore,
	events: OperationsEvents,
	diagnostics: HostDiagnostics,
	pluginBlobs: BlobStore,
	productVersion: string,
	logger?: Logger,
): AgentRegistration {
	const browserStorage = new SqliteBrowserStorage(sqlite);
	const integrationStorage = new SqliteIntegrationStorage(sqlite);
	const integrations = new IntegrationService(
		new IntegrationModel(integrationStorage, secrets, new SecureSessionTokens(), new NativeMcpClient(), {
			name: 'nexus-terminal',
			version: productVersion,
		}),
	);
	const executionStorage = new SqliteExecutionStorage(sqlite);
	const executionSettings = new ExecutionService(
		new ExecutionModel(executionStorage, new SecureSessionTokens()),
		(request) => execution.abortRevoked(request),
	);
	const checkpoints = new CheckpointService(
		new CheckpointModel(new SqliteCheckpointStorage(sqlite)),
		executionSettings,
	);
	const artifactStorage = new SqliteArtifactStorage(sqlite);
	const artifacts = new ArtifactService(
		new ArtifactModel(artifactStorage, blobs, new SecureSessionTokens()),
		executionSettings,
		events,
	);
	const pluginIntentStorage = new SqlitePluginIntentStorage(sqlite, {
		source: readGrantedArtifactSource,
		publish: publishArtifactGrants,
		revoke: revokeArtifactGrants,
		read: readGrantedArtifact,
	});
	const pluginIntents = new PluginIntentService(
		new PluginIntentModel(pluginIntentStorage, new SecureSessionTokens()),
		artifacts,
	);
	const browser = new BrowserService(
		new BrowserModel(browserStorage, new SecureSessionTokens(), new NativeBrowserClient()),
		artifacts,
	);
	const pluginStorage = new SqlitePluginStorage(sqlite);
	pluginStorage.installScopeLifecycle(
		(tx, input) =>
			activatePluginScope(tx, {
				userId: input.userId,
				appId: input.appId,
				definitionId: input.definitionId,
				definitionVersion: input.definitionVersion,
				displayName: input.displayName,
				contentHash: input.contentHash,
				capabilities: input.capabilities.map((item) => item),
				now: input.now,
			}),
		retirePluginScope,
	);
	const plugins = new PluginService(
		new PluginModel(
			pluginStorage,
			new SecureSessionTokens(),
			pluginBlobs,
			new NativePackageSignature(),
			new NativePluginPackageDecoder(new NativePackageReader(), new NativePackageSignature()),
			new BuiltPluginSdkAssets(),
			new NativePluginBackendRuntime(new NodeModuleRuntime(sqlite.path + '.modules')),
		),
		artifacts,
		(request) => execution.abortRevoked(request),
		(userId, appId) => execution.drainRevokedApp(userId, appId),
		pluginIntents,
		(access, input, withMutation) => workspace.rpc(access, input, withMutation),
		logger,
	);
	const pluginRepositoryStorage = new SqlitePluginRepositoryStorage(sqlite);
	const pluginRepositories = new PluginRepositoryService(
		new PluginRepositoryModel(
			pluginRepositoryStorage,
			new HttpPluginCatalog(new NativeBoundedFetch(logger)),
			new SecureSessionTokens(),
		),
		plugins,
		productVersion,
	);

	const memoryStorage = new SqliteMemoryStorage(sqlite);
	const memory = new MemoryService(
		new MemoryModel(memoryStorage, new SecureSessionTokens()),
		executionSettings,
		events,
	);
	const providerStorage = new SqliteProviderStorage(sqlite);
	const network = new OpenAiCompatibleAdapter(logger);
	const providerModel = new ProviderModel(providerStorage, secrets, network);
	const registryService = new CapabilityRegistryService(
		new CapabilityRegistryModel(new SqliteCapabilityRegistryStorage(sqlite), new ModelsDevCatalogAdapter()),
	);
	const changes = new RunChanges();
	const steps = new RunStepModel(new SqliteRunStepStorage(sqlite, providerStorage), changes);
	const tools = new RunToolModel(
		new SqliteRunToolStorage(sqlite),
		(settings, usage) => executionSettings.admitTool(settings, usage),
		changes,
	);
	const runModel = new RunModel(new SqliteRunStorage(sqlite, providerStorage), changes);

	const revoke = async (request: RunRevocationRequest): Promise<void> => {
		const results = await Promise.allSettled([
			execution.abortRevoked(request),
			plugins.revokeRuntimes(request.userId, request.appId),
		]);
		const failures = results.flatMap((item) => (item.status === 'rejected' ? [item.reason] : []));
		if (failures.length) {
			throw new AggregateError(failures, 'Agent revocation failed');
		}
	};

	const governance = new GovernanceService(
		new GovernanceModel(new SqliteGovernanceStorage(sqlite, providerStorage), targets, changes),
		revoke,
		events,
		executionSettings,
	);
	const jobModel = new ToolJobModel(new SqliteToolJobStorage(sqlite));
	const collaboration = new RunCollaborationService(
		new RunCollaborationModel(new SqliteRunCollaborationStorage(sqlite), changes),
		{
			occupiedChildIds: (scope) => execution.occupiedChildIds(scope),

			admit: (work, maxRuns) => execution.admitCreate(work, maxRuns),

			start: (command, parentId) => execution.start(command, parentId),

			abort: (scope, id) => execution.abort(scope.userId, scope.appId, id),

			wait: (ids) => execution.waitChildren(ids),

			drain: (scope) => execution.drainChildren(scope),
		},
		executionSettings,
	);
	const toolModel = new ToolModel(targets, resolver, remoteOperations, diagnostics);
	const providerService = new ProviderService(providerModel, (userId, providerId) =>
		execution.abortProvider(userId, providerId),
	);
	const images = new ProviderImageService(providerService, artifacts);
	const toolService = new ToolService(
		toolModel,
		tools,
		governance,
		new ToolJobService(jobModel, logger),
		new AcpPermissionService(tools, governance),
		collaboration,
		new ToolProjectService(new ToolProjectModel(new SqliteToolProjectStorage(sqlite)), toolModel),
		new ResultService(tools, governance),
		memory,
		artifacts,
		checkpoints,
		executionSettings,
		integrations,
		browser,
		plugins,
		providerService,
		images,
	);
	const contexts = new ContextHistoryService(new ContextModel(new SqliteContextStorage(sqlite)));
	const execution = new RunExecutionOwner(
		runModel,
		steps,
		new RunModelStream(network),
		providerModel,
		toolService,
		collaboration,
		contexts,
		checkpoints,
		executionSettings,
		events,
		images,
		new CompactionModel(new SqliteCompactionStorage(sqlite, providerStorage)),
		new TitleModel(new SqliteTitleStorage(sqlite, providerStorage), changes),
		logger,
	);
	const runs = new RunService(runModel, steps, execution, tools, collaboration, governance, executionSettings);

	const scope = new ScopeService(
		new ScopeModel(new SqliteScopeStorage(sqlite)),
		builtinAppDefinitions(),
		revoke,
		(userId, appId) => plugins.reconcileApp(userId, appId),
	);
	const threadStorage = new SqliteThreadStorage(sqlite);
	threadStorage.installAuthorityReader(async (tx, access) => {
		const facts = await pluginStorage.frontendAuthority(tx, access.userId, access.digest, access.appId);
		return {
			kind: 'plugin',
			identityUserId: facts.identityUserId,
			revision: facts.revision,
			installed: facts.installed,
			enabled: facts.enabled,
			trusted: facts.trusted,
		};
	});
	const threadModel = new ThreadModel(threadStorage, new SecureSessionTokens());
	const threads = new ThreadService(threadModel);
	const stream = new RunStreamService(runs, contexts, governance, collaboration, threadModel);
	const workspace = new WorkspaceService(scope, threads, providerService, runs, collaboration, governance, contexts);

	const requests = new AgentRequestOwner([
		changes,
		execution,
		providerService,
		registryService,
		governance,
		artifacts,
		integrations,
		browser,
		plugins,
		pluginRepositories,
	]);

	function boundary<T>(work: () => Promise<T>): Promise<T> {
		return agentBoundary(() => requests.run(work));
	}

	const providerApi: AgentProviderApi = {
		registryStatus: (userId) => boundary(() => registryService.status(userId)),

		registryResolve: (userId, modelId) => boundary(() => registryService.resolve(userId, modelId)),

		registryRefresh: (userId, signal) => boundary(() => registryService.refresh(userId, signal)),

		list: (userId) => boundary(() => providerService.list(userId)),

		get: (userId, id) => boundary(() => providerService.get(userId, id)),

		create: (userId, input) => boundary(() => providerService.create(userId, input)),

		update: (userId, id, version, input) => boundary(() => providerService.update(userId, id, version, input)),

		remove: (userId, id, version) => boundary(() => providerService.remove(userId, id, version)),

		available: (userId) => boundary(() => providerService.available(userId)),

		discover: (userId, id, authorizeBeforeWrite, signal) =>
			boundary(() => providerService.discover(userId, id, authorizeBeforeWrite, signal)),

		discoverEndpoint: (userId, url, credential, signal) =>
			boundary(() => providerService.discoverEndpoint(userId, url, credential, signal)),

		test: (userId, id, modelId, signal) => boundary(() => providerService.test(userId, id, modelId, signal)),
	};

	async function cancelRun(input: AgentCancelRunInput, childId?: string): Promise<AgentCancelRunResult> {
		const command = {
			userId: input.userId,
			appId: input.appId,
			runId: input.runId,
			expectedVersion: input.expectedVersion,
			operationKey: input.operationKey,
		};
		const result = childId === undefined ? await runs.cancel(command) : await runs.cancelChild(command, childId);
		return toCancelResult(result);
	}

	const publicApi: AgentStateApi = {
		listChildren: (userId, appId, runId) =>
			boundary(async () => {
				const items = await collaboration.listChildren({ userId, appId, runId });
				return items === null
					? null
					: {
							items: items.map((child) => {
								const profile = AGENT_CHILD_PROFILES.find((value) => value === child.profile);
								if (child.parentId === null || !profile) {
									throw new AgentFailure('internal_failure');
								}
								return {
									id: child.id,
									parentId: child.parentId,
									status: child.status,
									version: child.version,
									profile,
									deadlineAt: child.deadline,
								};
							}),
						};
			}),

		listChildMessages: (userId, appId, runId, childId, after, limit) =>
			boundary(async () => {
				const page = await collaboration.messageMetadata({ userId, appId, runId }, childId, after, limit);
				return page === null
					? null
					: {
							items: page.items.map((item) => ({
								sequence: item.sequence,
								senderId: item.senderId,
								bodyBytes: item.bodyBytes,
								expiresAt: item.expiresAt,
							})),
							nextCursor: page.nextCursor,
						};
			}),

		cancelChild: (input, childId) => boundary(() => cancelRun(input, childId)),

		listApps: (userId) => boundary(async () => (await scope.list(userId)).map(toAppView)),

		getApp: (userId, appId) =>
			boundary(async () => {
				const value = await scope.get(userId, appId);
				return value === null ? null : toAppView(value);
			}),

		setAppEnabled: (userId, appId, enabled, version) =>
			boundary(async () => {
				const value = await scope.setEnabled(userId, appId, enabled, version);
				return value === null ? null : toAppView(value);
			}),

		listAppDefinitions: () => boundary(async () => scope.definitions().map(toDefinitionView)),

		createApp: (userId, name, definitionId) =>
			boundary(async () => toAppView(await scope.createApp(userId, name, definitionId))),

		createThread: (userId, appId, title) =>
			boundary(async () => {
				const result = await scope.createThread(userId, appId, title);
				return result === null ? null : toThreadView(result);
			}),

		createRun: (input) =>
			boundary(async () => {
				const result = await runs.create({
					userId: input.userId,
					appId: input.appId,
					threadId: input.threadId,
					prompt: input.prompt,
					approvalMode: input.approvalMode,
					connectionIds: input.connectionIds.map((id) => id),
					model: {
						providerId: input.model.providerId,
						modelId: input.model.modelId,
						configurationVersion: input.model.configurationVersion,
						...(input.model.reasoningEffort === undefined
							? {}
							: { reasoningEffort: input.model.reasoningEffort }),
					},
					operationKey: input.operationKey,
				});
				// Only a newly committed Run enters the execution owner; its frozen
				// policy is checked again at dispatch. Replays never restart it.
				return toCreateResult(result);
			}),

		cancelRun: (input) => boundary(() => cancelRun(input)),

		getRun: (userId, appId, id) =>
			boundary(async () => {
				const run = await runs.get(userId, appId, id);
				return run === null ? null : toRunView(run);
			}),

		listThreadTools: (userId, appId, threadId, before, limit) =>
			boundary(async () => {
				const result = await runs.listThreadTools(userId, appId, threadId, before, limit);
				return result === null
					? null
					: {
							items: result.items.map(toToolView),
							nextCursor:
								result.nextCursor === null
									? null
									: encodeAgentToolListCursor(result.nextCursor.createdAt, result.nextCursor.id),
						};
			}),

		listEvents: (userId, appId, id, after, limit) =>
			boundary(async () => {
				const result = await runs.listEvents(userId, appId, id, after, limit);
				return result === null ? null : toEventPage(result);
			}),

		getUsage: (userId, appId, runId) =>
			boundary(async () => {
				const result = await runs.getUsage(userId, appId, runId);
				return result === null ? null : toRunUsageView(result);
			}),
	};
	return {
		publicApi,
		resourceCollector: {
			id: 'agent',

			collect: () => [
				{ name: 'active_runs', unit: 'count', value: execution.getActiveRunCount() },
				{ name: 'pending_run_writes', unit: 'count', value: execution.getPendingWriteCount() },
				{ name: 'pending_requests', unit: 'count', value: requests.getPendingRequestCount() },
			],
		},

		installTransactionIdentityReader: (read) => {
			threadStorage.installTransactionIdentityReader(read);
			pluginStorage.installTransactionIdentityReader(read);
			pluginRepositoryStorage.installIdentityReader(read);
			pluginIntentStorage.installIdentityReader(read);
			browserStorage.installTransactionIdentityReader(read);
			integrationStorage.installTransactionIdentityReader(read);
			memoryStorage.installTransactionIdentityReader(read);
			artifactStorage.installTransactionIdentityReader(read);
			executionStorage.installTransactionIdentityReader(read);
		},

		// Reconcile persisted incomplete dispatches BEFORE accepting requests;
		// never redispatch a request whose upstream effects are unknown.
		initialize: async (mode) => {
			await scope.initialize();
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'scope', mode });
			await steps.reconcileUnsettled(Date.now());
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'steps', mode });
			await tools.reconcileUnsettled();
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'tools', mode });
			await jobModel.reconcile();
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'jobs', mode });
			await artifacts.initialize();
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'artifacts', mode });
			await plugins.initialize(mode === 'startup');
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'plugins', mode });
		},

		quiesce: () => requests.quiesce(),

		close: () => requests.close(),

		webSocketRoutes: (access) => [createRunChangesWebSocketRoute(access, threads, runs, changes, stream, boundary)],

		routes: (access) => [
			createWorkspaceHttpRoute(access, threads, workspace, boundary),
			...createAgentHttpRoutes(access, publicApi),
			...createAgentProviderHttpRoutes(access, providerApi),
			...createGovernanceHttpRoutes(access, governance, boundary),
			...createMemoryHttpRoutes(access, memory, boundary),
			...createArtifactHttpRoutes(access, artifacts, boundary),
			...createExecutionHttpRoutes(access, executionSettings, boundary),
			...createIntegrationHttpRoutes(access, integrations, boundary),
			...createBrowserHttpRoutes(access, browser, boundary),
			...createPluginHttpRoutes(access, plugins, pluginRepositories, boundary),
			...createPluginIntentHttpRoutes(access, pluginIntents, boundary),
			...createPluginContentRoutes(plugins, boundary),
		],
	};
}

/** Installation-only fixed storage coverage; no business records leave the adapter. */
export function registerAgentBackup(secrets: SecretBox | null): SnapshotRegistration {
	return registerAgentSnapshot(secrets, builtinAppDefinitions().map(toStoredDefinition), (value) => {
		parsePluginSkills(fromPluginSkillFiles(value.files), value.manifest.version);
	});
}
