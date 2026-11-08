import { appsWithPluginInstanceSettings } from './plugins/adapters/sqlite/plugin-instance-clear.js';
import { OperationActivityModel } from './operations/model/operation-activity-model.js';
import { SqliteOperationActivityStorage } from './operations/adapters/sqlite/operation-activity-sql.js';
import { RunAppDrivers } from './runs/drivers/run-app-drivers.js';
import { OperationModel } from './operations/model/operation-model.js';
import { OperationService } from './operations/service/operation-service.js';
import { SqliteOperationStorage } from './operations/adapters/sqlite/operation-sql.js';
import { OperationContentModel } from './operations/model/operation-content-model.js';
import { OperationContentService } from './operations/service/operation-content-service.js';
import { SqliteOperationContentStorage } from './operations/adapters/sqlite/operation-content-sql.js';
import { RunAppStateModel } from './runs/model/run-app-state-model.js';
import { RunAppStateService } from './runs/service/run-app-state-service.js';
import { SqliteRunAppStateStorage } from './runs/adapters/sqlite/run-app-state-sql.js';
import { ModelInvocationModel } from './providers/model/model-invocation-model.js';
import { ModelInvocationService } from './providers/service/model-invocation-service.js';
import { OperationApprovalModel } from './governance/model/operation-approval-model.js';
import { OperationApprovalService } from './governance/service/operation-approval-service.js';
import { SqliteOperationApprovalStorage } from './governance/adapters/sqlite/operation-approval-sql.js';
import { RunPluginCapabilities } from './interfaces/plugin/run-capabilities.js';
import { RunConfigurationCapabilities } from './interfaces/plugin/run-configuration-capabilities.js';
import { RunNativeCapabilities } from './interfaces/plugin/run-native-capabilities.js';
import { RunTransportCapabilities } from './interfaces/plugin/run-transport-capabilities.js';
import { PluginLifecycleCapabilities } from './interfaces/plugin/plugin-lifecycle-capabilities.js';
import { PluginConnectionService } from './plugins/service/plugin-connection-service.js';
import { PluginConnectionModel } from './plugins/model/plugin-connection-model.js';
import { SqlitePluginConnectionStorage } from './plugins/adapters/sqlite/plugin-connection-sql.js';
import { RunToolResources } from './tools/service/run-tool-resources.js';
import { PluginInstanceService } from './plugins/service/plugin-instance-service.js';
import { PluginInstanceModel } from './plugins/model/plugin-instance-model.js';
import { SqlitePluginInstanceStorage } from './plugins/adapters/sqlite/plugin-instance-sql.js';
import { ToolContentService } from './tools/service/tool-content-service.js';
import { ToolRemoteService } from './tools/service/tool-remote-service.js';
import { HostToolContributions } from './tools/service/host-tool-contributions.js';
import { DefaultToolResources } from './tools/service/default-tool-resources.js';
import { RunAppDriver } from './runs/drivers/run-app-driver.js';
import type { TextLogStore } from '../../platform/blobs/text-log-store.js';
import { RunResourceService } from './runs/service/run-resource-service.js';
import { createRunResourceHttpRoute } from './interfaces/http/run-resource-http.js';
import { NativeContentInspector } from '../../platform/blobs/adapters/native-content-inspector.js';
import { RunStreamService } from './runs/service/run-stream-service.js';
import { RunChanges } from './runs/model/run-changes.js';
import { createAgentStreamWebSocketRoute } from './interfaces/ws/run-changes-ws.js';
import { AgentStreamSources } from './interfaces/ws/agent-stream-sources.js';
import { createRunStreamSources } from './interfaces/ws/run-stream-sources.js';
import { createMemoryStreamSource } from './interfaces/ws/memory-stream-source.js';
import { ProviderImageService } from './providers/service/provider-image-service.js';
import type { Logger } from '../../platform/logging/logger.js';
import { logDiagnostic } from '../../platform/logging/diagnostic-log.js';
import { registerAgentSnapshot } from './snapshots/adapters/sqlite/snapshot-registration.js';
import type { SnapshotRegistration } from '../../platform/storage/sqlite/snapshot-types.js';
import { toRunSuspension, toRunUsageView, toRunView } from './interfaces/http/run-mapper.js';
import { toToolView } from './interfaces/http/tool-mapper.js';
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

import { appsWithPolicySettings, clearAppPolicySettings } from './governance/adapters/sqlite/policy-write.js';
import type { HostDiagnostics } from '../system/public.js';
import type { OperationsEvents } from '../operations/public.js';
import { SqliteExecutionStorage } from './execution/adapters/sqlite/execution-sql.js';
import { ExecutionModel } from './execution/model/execution-model.js';
import { ExecutionService } from './execution/service/execution-service.js';
import { createExecutionHttpRoutes } from './interfaces/http/execution-http.js';
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
import { ToolJobService } from './tools/service/tool-job-service.js';
import { ToolJobModel } from './tools/model/tool-job-model.js';
import { SqliteToolJobStorage } from './tools/adapters/sqlite/tool-job-sql.js';
import type { TrustedSshTargetResolver } from '../targets/public.js';
import type { RemoteMachineOperationFactory } from '../remote/public.js';
import { ToolModel } from './tools/model/tool-model.js';
import { AGENT_APP_EXECUTION_STATE } from '@nexus-terminal/shared/agent/scope/values';
import type { RunRevocationRequest } from './runs/model/run-types.js';
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
import { ScopeModel } from './scope/model/scope-model.js';
import { ScopeService } from './scope/service/scope-service.js';
import { SqliteRunStorage } from './runs/adapters/sqlite/run-sql.js';
import { RunModel } from './runs/model/run-model.js';
import { ContextModel } from './context/model/context-model.js';
import { ContextHistoryService } from './context/service/context-history-service.js';
import { ResultService } from './context/service/result-service.js';
import { SqliteContextStorage } from './context/adapters/sqlite/context-history-sql.js';
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
	remoteOperations: RemoteMachineOperationFactory,
	blobs: BlobStore,
	toolLogs: TextLogStore,
	events: OperationsEvents,
	diagnostics: HostDiagnostics,
	pluginBlobs: BlobStore,
	productVersion: string,
	logger?: Logger,
): AgentRegistration {
	const browserStorage = new SqliteBrowserStorage(sqlite);
	const executionStorage = new SqliteExecutionStorage(sqlite);
	const executionSettings = new ExecutionService(
		new ExecutionModel(executionStorage, new SecureSessionTokens()),
		(request) => execution.abortRevoked(request),
	);
	const artifactStorage = new SqliteArtifactStorage(sqlite);
	const artifacts = new ArtifactService(
		new ArtifactModel(artifactStorage, blobs, new SecureSessionTokens(), new NativeContentInspector()),
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
	const pluginInstanceStorage = new SqlitePluginInstanceStorage(sqlite);
	const pluginConnectionStorage = new SqlitePluginConnectionStorage(sqlite);
	const pluginConnections = new PluginConnectionService(
		new PluginConnectionModel(pluginConnectionStorage, new SecureSessionTokens(), secrets),
		(error) => logDiagnostic(logger, 'error', 'PLUGIN_CONNECTION_OBSERVER_FAILED', {}, error),
	);
	const pluginInstances = new PluginInstanceService(
		new PluginInstanceModel(pluginInstanceStorage, new SecureSessionTokens()),
		(error) => logDiagnostic(logger, 'error', 'PLUGIN_INSTANCE_OBSERVER_FAILED', {}, error),
	);
	pluginStorage.installConfigurationLifecycle({
		async retainedApps(tx, userId) {
			const policies = await appsWithPolicySettings(tx, userId);
			return [...policies, ...(await appsWithPluginInstanceSettings(tx, userId))];
		},

		async clear(tx, userId, appId) {
			await clearAppPolicySettings(tx, userId, appId);
		},
	});
	pluginStorage.installScopeLifecycle(
		(tx, input) =>
			activatePluginScope(tx, {
				mode: input.mode,
				userId: input.userId,
				appId: input.appId,
				definitionId: input.definitionId,
				definitionVersion: input.definitionVersion,
				displayName: input.displayName,
				contentHash: input.contentHash,
				capabilities: input.capabilities.map((item) => item),
				executionPackages: input.executionPackages.map((item) => ({
					packageId: item.packageId,
					kind: item.kind,
					version: item.version,
					packageHash: item.packageHash,
					publisherKeyId: item.publisherKeyId,
				})),
				enabled: input.enabled,
				grantedCapabilities: input.grantedCapabilities?.map((capability) => capability) ?? null,
				now: input.now,
			}),
		retirePluginScope,
	);
	const plugins: PluginService = new PluginService(
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
		pluginInstances,
		(access, input, withMutation) => workspace.rpc(access, input, withMutation),
		(access, artifactId, expectedVersion, source, signal, withMutation) =>
			workspace.uploadUiArtifact(access, artifactId, expectedVersion, source, signal, withMutation),
		productVersion,
		{
			open: (input) =>
				new PluginLifecycleCapabilities(pluginInstances, pluginConnections, governance, executionSettings).open(
					input,
				),
		},
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
	const stopPluginChanges = pluginInstances.subscribe((scope) => changes.notify(scope));
	const stopConnectionChanges = pluginConnections.subscribe((scope) =>
		pluginInstances.changed(scope.userId, scope.appId, scope.instanceId),
	);
	const runModel = new RunModel(new SqliteRunStorage(sqlite), changes);

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
		new GovernanceModel(new SqliteGovernanceStorage(sqlite), targets, changes),
		revoke,
		executionSettings,
	);
	const jobModel = new ToolJobModel(new SqliteToolJobStorage(sqlite), toolLogs);
	const collaboration = new RunCollaborationService(
		new RunCollaborationModel(new SqliteRunCollaborationStorage(sqlite), changes),
		{
			occupiedChildIds: (scope) => execution.occupiedChildIds(scope),

			admit: (work, maxRuns) => execution.admitCreate(work, maxRuns),

			start: (command, parentId) => appDrivers.start(execution, command, parentId),

			abort: (scope, id) => execution.abort(scope.userId, scope.appId, id),

			wait: (ids) => execution.waitChildren(ids),

			drain: (scope) => execution.drainChildren(scope),
		},
		executionSettings,
	);
	let resources: RunResourceService | null = null;

	const toolChanged = (scope: { userId: number; appId: string; runId: string }) => {
		changes.notify(scope);
		resources?.changed(scope);
	};

	const toolModel = new ToolModel(targets, resolver, remoteOperations, diagnostics, toolChanged);
	const providerService = new ProviderService(providerModel);
	const operationModel = new OperationModel(
		new SqliteOperationStorage(sqlite),
		(settings, usage, kind, tokens) => {
			if (kind === 'model') {
				if (tokens === null) {
					throw new AgentFailure('internal_failure');
				}
				executionSettings.admitReservation(settings, usage, tokens);
			} else if (kind === 'tool') {
				executionSettings.admitTool(settings, usage);
			}
		},
		changes,
	);
	const operationService = new OperationService(operationModel);
	const operationContents = new OperationContentService(
		new OperationContentModel(new SqliteOperationContentStorage(sqlite)),
	);
	const appState = new RunAppStateService(new RunAppStateModel(new SqliteRunAppStateStorage(sqlite), changes));
	const operationApprovalStorage = new SqliteOperationApprovalStorage(sqlite);
	const operationApprovals = new OperationApprovalService(
		new OperationApprovalModel(operationApprovalStorage, new SecureSessionTokens()),
		changes,
	);

	const images = new ProviderImageService(providerService, artifacts);
	const jobs = new ToolJobService(jobModel, changes, logger, (scope) => toolModel.touch(scope));
	const hostTools = new HostToolContributions(
		toolModel,
		jobs,
		new ToolContentService(
			new ResultService(operationModel, operationContents, governance, toolModel),
			memory,
			artifacts,
			providerService,
			images,
		),
		new ToolRemoteService(
			toolModel,
			jobs,
			new ToolProjectService(new ToolProjectModel(new SqliteToolProjectStorage(sqlite)), toolModel),
			artifacts,
		),
		collaboration,
		browser,
		plugins,
	);
	const transportCapabilities = new RunTransportCapabilities(
		pluginConnections,
		governance,
		operationApprovals,
		plugins,
		toolModel,
		changes,
	);
	const toolResources = new RunToolResources(
		new DefaultToolResources(toolModel, jobs, transportCapabilities, browser),
	);
	const contexts = new ContextHistoryService(new ContextModel(new SqliteContextStorage(sqlite)));
	const nativeCapabilities = new RunNativeCapabilities(
		hostTools,
		operationService,
		governance,
		operationApprovals,
		toolResources,
		plugins,
		executionSettings,
		collaboration,
		changes,
		transportCapabilities,
	);
	const capabilities = new RunPluginCapabilities(
		governance,
		executionSettings,
		operationContents,
		new ModelInvocationService(
			new ModelInvocationModel(providerModel, network),
			operationContents,
			providerService,
			artifacts,
		),
		appState,
		plugins,
		new RunConfigurationCapabilities(pluginInstances, governance, operationApprovals),
		nativeCapabilities,
		collaboration,
	);
	const appDriver = new RunAppDriver(
		runModel,
		operationService,
		capabilities,
		(input) => plugins.runRegisteredApp(input),
		logger,
	);
	const appDrivers = new RunAppDrivers(runModel, [
		{
			id: 'app',

			supports: (input) => input.appExecution.kind === 'plugin',

			driver: appDriver,
		},
	]);

	const execution: RunExecutionOwner = new RunExecutionOwner(runModel, runModel, events, logger);
	const runs = new RunService(
		runModel,
		execution,
		appDrivers,
		new OperationActivityModel(new SqliteOperationActivityStorage(sqlite)),
		collaboration,
		executionSettings,
	);

	const scope = new ScopeService(new ScopeModel(new SqliteScopeStorage(sqlite)), revoke, (userId, appId) =>
		plugins.reconcileApp(userId, appId),
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
	const threads = new ThreadService(threadModel, (scope) => memory.changes.notify(scope));
	resources = new RunResourceService(runs, execution, toolResources, collaboration, changes, logger);
	const stream = new RunStreamService(runs, contexts, operationApprovals, collaboration, threadModel, resources);
	const workspace: WorkspaceService = new WorkspaceService(
		scope,
		threads,
		providerService,
		runs,
		collaboration,
		operationApprovals,
		contexts,
		memory,
		artifacts,
		operationContents,
	);
	const streamSources = new AgentStreamSources([
		...createRunStreamSources(threads, runs, changes, stream, plugins, boundary),
		createMemoryStreamSource(memory.changes, threads, plugins, boundary),
	]);

	const requests = new AgentRequestOwner([
		{
			quiesce: stopPluginChanges,

			close: async () => {
				stopPluginChanges();
			},
		},
		{
			quiesce: stopConnectionChanges,

			close: async () => {
				stopConnectionChanges();
			},
		},
		changes,
		resources,
		execution,
		providerService,
		registryService,
		governance,
		artifacts,
		jobs,
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

		listAppDefinitions: (userId) => boundary(async () => (await scope.declarations(userId)).map(toDefinitionView)),

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
					inputJson: input.inputJson,
					operationKey: input.operationKey,
				});
				// Only a newly committed Run enters the execution owner; its frozen
				// policy is checked again at dispatch. Replays never restart it.
				return toCreateResult(result);
			}),

		resumeRun: (input) =>
			boundary(async () => {
				const result = await runs.resume({
					userId: input.userId,
					appId: input.appId,
					runId: input.runId,
					expectedVersion: input.expectedVersion,
					operationKey: input.operationKey,
					inputJson: input.inputJson,
				});
				if (result.status === 'resumed') {
					return { status: 'resumed', run: toRunView(result.run) };
				}
				if (result.status === 'replayed') {
					return { status: 'replayed', originalStatus: 'resumed', run: toRunView(result.run) };
				}
				return { status: result.status };
			}),

		getRunSuspension: (userId, appId, runId) =>
			boundary(async () => {
				const value = await runs.suspension(userId, appId, runId);
				return value === null ? null : toRunSuspension(value);
			}),

		cancelRun: (input) => boundary(() => cancelRun(input)),

		getRun: (userId, appId, id) =>
			boundary(async () => {
				const run = await runs.get(userId, appId, id);
				return run === null ? null : toRunView(run);
			}),

		getToolCall: (userId, appId, runId, toolId) =>
			boundary(async () => {
				const value = await runs.getToolCall(userId, appId, runId, toolId);
				return value === null
					? null
					: {
							tool: toToolView(value),
							argumentsJson: value.argumentsJson,
							failureCode: value.failureCode,
						};
			}),

		listThreadTools: (userId, appId, threadId, before, limit) =>
			boundary(async () => {
				const result = await runs.listThreadTools(
					userId,
					appId,
					threadId,
					before === null ? null : { createdAt: before.createdAt, id: before.id },
					limit,
				);
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
			pluginInstanceStorage.installIdentityReader(read);
			pluginConnectionStorage.installIdentityReader(read);
			pluginRepositoryStorage.installIdentityReader(read);
			pluginIntentStorage.installIdentityReader(read);
			browserStorage.installTransactionIdentityReader(read);
			memoryStorage.installTransactionIdentityReader(read);
			artifactStorage.installTransactionIdentityReader(read);
			executionStorage.installTransactionIdentityReader(read);
			operationApprovalStorage.installIdentityReader(read);
		},

		// Reconcile persisted incomplete dispatches BEFORE accepting requests;
		// never redispatch a request whose upstream effects are unknown.
		initialize: async (mode) => {
			await operationModel.interrupt();
			await jobModel.reconcile();
			await runModel.recover(Date.now());
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'executions', mode });
			await jobs.initialize();
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'jobs', mode });
			await artifacts.initialize();
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'artifacts', mode });
			await plugins.initialize(mode === 'startup');
			logDiagnostic(logger, 'info', 'AGENT_RECOVERY_STAGE_COMPLETED', { stage: 'plugins', mode });
		},

		quiesce: () => requests.quiesce(),

		close: () => requests.close(),

		webSocketRoutes: (access) => [createAgentStreamWebSocketRoute(access, streamSources, logger)],

		routes: (access) => [
			createWorkspaceHttpRoute(access, threads, workspace, boundary),
			createRunResourceHttpRoute(access, threads, resources, boundary),
			...createAgentHttpRoutes(access, publicApi),
			...createAgentProviderHttpRoutes(access, providerApi),
			...createGovernanceHttpRoutes(access, governance, operationApprovals, boundary),
			...createMemoryHttpRoutes(access, memory, boundary),
			...createArtifactHttpRoutes(access, artifacts, boundary),
			...createExecutionHttpRoutes(access, executionSettings, boundary),
			...createBrowserHttpRoutes(access, browser, boundary),
			...createPluginHttpRoutes(
				access,
				plugins,
				pluginRepositories,
				pluginInstances,
				pluginConnections,
				boundary,
			),
			...createPluginIntentHttpRoutes(access, pluginIntents, boundary),
			...createPluginContentRoutes(plugins, boundary),
		],
	};
}

/** Installation-only fixed storage coverage; no business records leave the adapter. */
export function registerAgentBackup(secrets: SecretBox | null): SnapshotRegistration {
	return registerAgentSnapshot(secrets, (value) => {
		parsePluginSkills(
			fromPluginSkillFiles(value.files, value.manifest.contributions.skills),
			value.manifest.version,
		);
	});
}
