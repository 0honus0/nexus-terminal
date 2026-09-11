import { LocalArtifactStore } from '../../infrastructure/agent/artifacts/local-artifact-store';
import { AppIntentArtifactAdapter } from '../../infrastructure/agent/artifacts/app-intent-artifact.adapter';
import { MachineCapabilityAdapter } from '../../infrastructure/agent/capabilities/machine-capability.adapter';
import { NodeCryptoHashAdapter } from '../../infrastructure/agent/capabilities/node-crypto-hash.adapter';
import { SqliteAgentSettingsRepository } from '../../infrastructure/agent/repositories/sqlite-agent-settings.repository';
import { SqliteHardLimitConfirmationRepository } from '../../infrastructure/agent/repositories/sqlite-hard-limit-confirmation.repository';
import { SqliteHardLimitUsageAdapter } from '../../infrastructure/agent/repositories/sqlite-hard-limit-usage.adapter';
import { SqliteAppGrantRepository } from '../../infrastructure/agent/repositories/sqlite-app-grant.repository';
import { SqliteAppStateRepository } from '../../infrastructure/agent/repositories/sqlite-app-state.repository';
import { SqliteConversationRepository } from '../../infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteApprovalRepository } from '../../infrastructure/agent/repositories/sqlite-approval.repository';
import { SqliteAppIntentRepository } from '../../infrastructure/agent/repositories/sqlite-app-intent.repository';
import { SqliteSubagentRepository } from '../../infrastructure/agent/repositories/sqlite-subagent.repository';
import { SqliteMemoryRepository } from '../../infrastructure/agent/repositories/sqlite-memory.repository';
import { SqliteMemoryProvenanceAdapter } from '../../infrastructure/agent/repositories/sqlite-memory-provenance.adapter';
import { InstalledPluginSkillSourceAdapter } from '../../infrastructure/agent/plugins/installed-plugin-skill-source.adapter';
import { OpenAiCompatibleAdapter } from '../../infrastructure/agent/providers/openai-compatible.adapter';
import { McpAdapter } from '../../infrastructure/agent/integrations/mcp.adapter';
import { OutboundPolicyAdapter } from '../../infrastructure/agent/providers/outbound-policy.adapter';
import { ProviderSecretAdapter } from '../../infrastructure/agent/providers/provider-secret.adapter';
import { SqliteProviderRepository } from '../../infrastructure/agent/repositories/sqlite-provider.repository';
import { SqliteIntegrationRepository } from '../../infrastructure/agent/repositories/sqlite-integration.repository';
import { SqliteRecallRepository } from '../../infrastructure/agent/repositories/sqlite-recall.repository';
import { SqliteRunRepository } from '../../infrastructure/agent/repositories/sqlite-run.repository';
import { SqliteCheckpointRepository } from '../../infrastructure/agent/repositories/sqlite-checkpoint.repository';
import { SqliteTargetDenylistRepository } from '../../infrastructure/agent/repositories/sqlite-target-denylist.repository';
import { SqliteStateCommitAdapter } from '../../infrastructure/agent/runtime/sqlite-state-commit.adapter';
import type { WorkspaceRuntimeControllerPort } from '../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type { WorkspaceRuntimeGatewayPort } from '../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import { AGENT_DEFAULTS } from '../../modules/agent/agent-defaults';
import { systemClock } from '../../modules/agent/agent.types';
import { ArtifactService } from '../../modules/agent/ai/artifact.service';
import { IntegrationService } from '../../modules/agent/ai/integration.service';
import type { ArtifactLimitPolicyPort } from '../../modules/agent/ai/artifact.port';
import { ConversationService } from '../../modules/agent/ai/conversation.service';
import { ContextService } from '../../modules/agent/ai/context.service';
import { ProviderService } from '../../modules/agent/ai/provider.service';
import { RecallService } from '../../modules/agent/ai/recall.service';
import { MemoryService } from '../../modules/agent/ai/memory.service';
import { SkillRegistry } from '../../modules/agent/ai/skill-registry';
import { OPERATIONS_AGENT_DEFINITIONS } from '../../modules/agent/apps/operations/agent-definitions';
import { createOperationsAppContribution } from '../../modules/agent/apps/operations/public';
import { createWorkspaceJobTool } from '../../modules/agent/apps/operations/workspace-tools';
import {
  createWorkspaceControlTool,
  createWorkspaceCreateTool,
  createWorkspaceSwitchToolVersionsTool,
} from '../../modules/agent/apps/operations/workspace-runtime-management-tools';
import { createDiagnosticsTool, createReadFileTool } from '../../modules/agent/apps/operations/tools';
import { createMcpTools } from '../../modules/agent/apps/operations/mcp-tools';
import { createCollaborationTools } from '../../modules/agent/apps/operations/collaboration-tools';
import {
  createDockerMutationTool,
  createShellTool,
  createWriteFileTool,
} from '../../modules/agent/apps/operations/mutation-tools';
import type { AgentConnectionResolverPort, AgentDiagnosticsPort } from '../../modules/agent/capabilities/machine.port';
import { ApprovalService } from '../../modules/agent/runtime/approvals/approval.service';
import { PolicyService } from '../../modules/agent/capabilities/policy.service';
import { ToolCatalog } from '../../modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../modules/agent/capabilities/tool-executor';
import type { LeasePort } from '../../modules/agent/capabilities/lease.port';
import { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import { AppLifecycleService } from '../../modules/agent/host/app-lifecycle.service';
import { AppIntentService } from '../../modules/agent/host/app-intent.service';
import { validateManifest } from '../../modules/agent/host/app-manifest-validator';
import { AppRegistryService } from '../../modules/agent/host/app-registry.service';
import { AgentDefinitionRegistry } from '../../modules/agent/runtime/definitions/agent-definition.registry';
import { AgentEventHub } from '../../modules/agent/runtime/events/event-hub';
import { NativeAgentBackend } from '../../modules/agent/runtime/execution/native-agent-backend';
import { LeaseCoordinator } from '../../modules/agent/runtime/execution/lease-coordinator';
import { ModelCallLimiter } from '../../modules/agent/runtime/execution/model-call-limiter';
import { RunService } from '../../modules/agent/runtime/runs/run.service';
import { CheckpointService } from '../../modules/agent/runtime/recovery/checkpoint.service';
import { AgentScheduler } from '../../modules/agent/runtime/scheduling/scheduler';
import { SubagentPolicyService } from '../../modules/agent/runtime/collaboration/subagent-policy';
import { SubagentService } from '../../modules/agent/runtime/collaboration/subagent.service';
import { SubagentScheduler } from '../../modules/agent/runtime/collaboration/subagent-scheduler';
import { MailboxService } from '../../modules/agent/runtime/collaboration/mailbox.service';
import { SharedFactsService } from '../../modules/agent/runtime/collaboration/shared-facts.service';
import type {
  DelegationRepositoryPort,
  MailboxRepositoryPort,
  RunScopeRepositoryPort,
  RuntimeParticipantRepositoryPort,
  SchedulerWorkRepositoryPort,
  SharedFactRepositoryPort,
} from '../../modules/agent/runtime/collaboration/subagent.repository.port';
import { PlanService } from '../../modules/agent/runtime/planning/plan.service';
import { createPlanUpdateTool } from '../../modules/agent/runtime/planning/plan-tool';
import type { AgentServices } from '../../modules/agent/public';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { RemoteDockerService } from '../../platform/docker/remote-docker.service';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../shared/security/crypto.port';
import type { AuditLogService } from '../../modules/audit/audit.service';
import { composePlugins } from './compose-plugins';
import { composeWorkspaceRuntime } from './compose-workspace-runtime';
import { createAgentLifecycleSweeps } from './lifecycle-sweeps';

export interface ComposeAgentOptions {
  database: RelationalDatabase;
  cipher: SecretCipher;
  dataDirectory: string;
  nexusVersion: string;
  nodeEnv: string;
  publicOrigin?: string;
  pluginFrontendOrigin?: string;
  connectionResolver: AgentConnectionResolverPort;
  diagnostics: AgentDiagnosticsPort;
  executionSessions: ExecutionSessionManager;
  docker: RemoteDockerService;
  leases: LeasePort;
  workspaceRuntimeController: WorkspaceRuntimeControllerPort & WorkspaceRuntimeGatewayPort;
  audit: AuditLogService;
}

export const composeAgent = ({
  database,
  cipher,
  dataDirectory,
  nexusVersion,
  nodeEnv,
  publicOrigin,
  pluginFrontendOrigin,
  connectionResolver,
  diagnostics,
  executionSessions,
  docker,
  leases,
  workspaceRuntimeController,
  audit,
}: ComposeAgentOptions): AgentServices => {
  const registry = new AppRegistryService();
  const appStates = new SqliteAppStateRepository(database);
  const appGrants = new SqliteAppGrantRepository(database);
  const targetDenylist = new SqliteTargetDenylistRepository(database);
  const settingsRepository = new SqliteAgentSettingsRepository(database);
  const hardLimitConfirmations = new SqliteHardLimitConfirmationRepository(database);
  const hardLimitUsage = new SqliteHardLimitUsageAdapter(database);
  const lifecycle = new AppLifecycleService(registry, appStates, appGrants, systemClock);
  const settings = new AgentSettingsService(settingsRepository, hardLimitConfirmations, hardLimitUsage, systemClock);
  const capabilityBroker = new AppCapabilityBroker(registry, appStates, appGrants, targetDenylist);
  const providerRepository = new SqliteProviderRepository(database, cipher);
  const outboundPolicy = new OutboundPolicyAdapter(nodeEnv);
  const integrationRepository = new SqliteIntegrationRepository(database, cipher);
  const mcpRuntime = new McpAdapter(integrationRepository, outboundPolicy);
  const providerSecrets = new ProviderSecretAdapter(database, cipher);
  const languageModel = new OpenAiCompatibleAdapter(providerRepository, providerSecrets, outboundPolicy);
  const providers = new ProviderService(providerRepository, outboundPolicy, languageModel, systemClock, (userId) =>
    lifecycle.refreshHealth(userId),
  );
  const artifactLimits: ArtifactLimitPolicyPort = {
    forUser: async (userId) => {
      const view = await settings.get(userId);
      return {
        maxSingleArtifactBytes: view.hardLimits.maxSingleArtifactBytes,
        maxGlobalArtifactBytes: view.hardLimits.maxGlobalArtifactBytes,
        minFreeDiskBytes: AGENT_DEFAULTS.minFreeDiskBytes,
      };
    },
  };
  const artifactStore = new LocalArtifactStore(database, artifactLimits, { dataDirectory });
  const artifacts = new ArtifactService(artifactStore);
  const appIntents = new AppIntentService(
    new SqliteAppIntentRepository(database),
    registry,
    appStates,
    appGrants,
    new AppIntentArtifactAdapter(artifactStore),
    systemClock,
  );
  const { appStorage, plugins } = composePlugins({
    database,
    dataDirectory,
    nexusVersion,
    publicOrigin,
    pluginFrontendOrigin,
    registry,
    appStates,
    capabilityBroker,
    artifactStore,
    clock: systemClock,
  });
  const conversationRepository = new SqliteConversationRepository(database);
  const conversations = new ConversationService(conversationRepository, systemClock, settings, lifecycle);
  const recall = new RecallService(new SqliteRecallRepository(database), systemClock);
  const skills = new SkillRegistry(new InstalledPluginSkillSourceAdapter(database, dataDirectory));
  const context = new ContextService(conversations, recall, skills);
  const runRepository = new SqliteRunRepository(database);
  const stateCommit = new SqliteStateCommitAdapter(database);
  const subagentRepository = new SqliteSubagentRepository(database);
  const runScopes: RunScopeRepositoryPort = subagentRepository;
  const runtimeParticipants: RuntimeParticipantRepositoryPort = subagentRepository;
  const delegationRepository: DelegationRepositoryPort = subagentRepository;
  const mailboxRepository: MailboxRepositoryPort = subagentRepository;
  const schedulerWork: SchedulerWorkRepositoryPort = subagentRepository;
  const sharedFactRepository: SharedFactRepositoryPort = subagentRepository;
  const subagentPolicy = new SubagentPolicyService(appStorage, settings, providers);
  let subagentScheduler: SubagentScheduler | null = null;
  const mailbox = new MailboxService(
    mailboxRepository,
    runtimeParticipants,
    delegationRepository,
    settings,
    systemClock,
    () => subagentScheduler?.wake(),
  );
  const sharedFacts = new SharedFactsService(sharedFactRepository, systemClock);
  const memories = new MemoryService(
    new SqliteMemoryRepository(database),
    registry,
    new SqliteMemoryProvenanceAdapter(database),
    audit,
    systemClock,
  );
  const definitions = new AgentDefinitionRegistry();
  for (const definition of OPERATIONS_AGENT_DEFINITIONS) definitions.register('nexus.operations', definition);
  const eventHub = new AgentEventHub();
  const subagents = new SubagentService(
    delegationRepository,
    runtimeParticipants,
    runRepository,
    subagentPolicy,
    providers,
    capabilityBroker,
    eventHub,
    systemClock,
    () => subagentScheduler?.wake(),
  );
  const machine = new MachineCapabilityAdapter(connectionResolver, diagnostics, executionSessions, docker);
  const cryptoHash = new NodeCryptoHashAdapter();
  const plans = new PlanService(runRepository, stateCommit, () => systemClock.nowUnixSeconds());
  const composedWorkspaceRuntime = composeWorkspaceRuntime({
    database,
    controller: workspaceRuntimeController,
    pluginTargets: plugins,
    settings,
    lifecycle,
    capabilities: capabilityBroker,
    cryptoHash,
    artifacts,
    now: () => systemClock.nowUnixSeconds(),
  });
  const workspaceRepository = composedWorkspaceRuntime.repository;
  const workspaceRuntime = composedWorkspaceRuntime.service;
  const workspaceRuntimeFacade = composedWorkspaceRuntime.facade;
  const toolCatalog = new ToolCatalog();
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.diagnostics',
    capability: 'machine.diagnostics.read',
    tools: [createDiagnosticsTool(machine, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.files.read',
    capability: 'machine.files.read',
    tools: [createReadFileTool(machine, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.files.write',
    capability: 'machine.files.write',
    tools: [createWriteFileTool(machine, artifacts, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.shell',
    capability: 'machine.shell.execute',
    tools: [createShellTool(machine, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'machine.docker',
    capability: 'machine.docker.mutate',
    tools: [createDockerMutationTool(machine, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'workspace.runtime.execute',
    capability: 'workspace.runtime.execute',
    tools: [createWorkspaceJobTool(workspaceRepository, workspaceRuntimeController, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'workspace.runtime.manage',
    capability: 'workspace.runtime.manage',
    tools: [
      createWorkspaceCreateTool(workspaceRuntime, workspaceRepository, cryptoHash),
      createWorkspaceControlTool(workspaceRuntime, workspaceRepository, cryptoHash),
      createWorkspaceSwitchToolVersionsTool(workspaceRuntime, workspaceRepository, cryptoHash),
    ],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.plan',
    capability: 'runs.execute',
    tools: [createPlanUpdateTool(plans, runRepository, cryptoHash)],
  });
  toolCatalog.registerContribution({
    schemaVersion: 1,
    id: 'runtime.collaboration',
    capability: 'runs.execute',
    tools: createCollaborationTools(subagents, mailbox, sharedFacts, memories, cryptoHash),
  });
  const integrations = new IntegrationService(
    integrationRepository,
    outboundPolicy,
    mcpRuntime,
    lifecycle,
    cryptoHash,
    systemClock,
    {
      mcpRefreshed: (scope, integration, snapshot, schemaHash) => {
        toolCatalog.replaceOwnedContribution(scope, `mcp:${integration.id}`, {
          schemaVersion: 1,
          id: `integration.mcp.${integration.id}`,
          capability: 'integration.mcp.invoke',
          tools: createMcpTools(
            scope,
            integration,
            schemaHash,
            snapshot.tools,
            integrationRepository,
            mcpRuntime,
            cryptoHash,
          ),
        });
      },
      removed: (scope, integrationId) => toolCatalog.removeOwned(scope, `mcp:${integrationId}`),
    },
  );
  const toolExecutor = new ToolExecutor(toolCatalog, capabilityBroker);
  const policy = new PolicyService();
  const modelCalls = new ModelCallLimiter(settings);
  const leaseCoordinator = new LeaseCoordinator(leases, systemClock);
  const nativeBackend = new NativeAgentBackend(
    runRepository,
    delegationRepository,
    providers,
    context,
    languageModel,
    stateCommit,
    toolCatalog,
    toolExecutor,
    leaseCoordinator,
    leases,
    policy,
    modelCalls,
    systemClock,
  );
  const scheduler = new AgentScheduler(
    settings,
    nativeBackend,
    eventHub,
    (userId) => runRepository.hostCursor(userId),
    (userId) => subagentScheduler?.activeCountForUser(userId) ?? 0,
  );
  subagentScheduler = new SubagentScheduler(
    settings,
    runScopes,
    schedulerWork,
    delegationRepository,
    runtimeParticipants,
    mailboxRepository,
    runRepository,
    providers,
    languageModel,
    modelCalls,
    stateCommit,
    toolCatalog,
    toolExecutor,
    leaseCoordinator,
    mailbox,
    eventHub,
    {
      get activeCount() {
        return scheduler.activeCount;
      },
      hasActiveRun: (runId) => scheduler.hasActiveRun(runId),
      activeRunIds: () => scheduler.activeRunIds(),
      enqueueRun: async (runId, scope) => {
        const run = await runRepository.snapshot(scope, runId);
        if (run && ['created', 'running'].includes(run.status)) scheduler.enqueue(run);
      },
      wake: () => scheduler.wake(),
    },
    systemClock,
  );
  const notifyCommitted = (run: Parameters<AgentScheduler['enqueue']>[0]) => {
    eventHub.publishRunWake(run.id, run.eventCursor);
    void runRepository.hostCursor(run.userId).then((cursor) => eventHub.publishHostWake(run.userId, cursor));
  };
  const runs = new RunService(
    settings,
    lifecycle,
    providers,
    definitions,
    stateCommit,
    runRepository,
    systemClock,
    (run) => scheduler.enqueue(run),
    (run) => notifyCommitted(run),
    (run) => scheduler.signalInput(run),
    (runId) => scheduler.cancel(runId),
    (userId, cursor) => eventHub.publishHostWake(userId, cursor),
  );
  const checkpointRepository = new SqliteCheckpointRepository(database);
  const checkpoints = new CheckpointService(
    checkpointRepository,
    runRepository,
    settings,
    lifecycle,
    providers,
    definitions,
    targetDenylist,
    stateCommit,
    systemClock,
    (run) => scheduler.enqueue(run),
    (run) => notifyCommitted(run),
  );
  const lifecycleSweeps = createAgentLifecycleSweeps({
    stateCommit,
    workspaceRuntime,
    scheduler,
    clock: systemClock,
    notifyCommitted,
  });

  const approvalRepository = new SqliteApprovalRepository(database);
  const approvals = new ApprovalService(approvalRepository, runRepository, stateCommit, systemClock, (run) => {
    notifyCommitted(run);
    scheduler.enqueue(run);
  });

  const contributions = [
    createOperationsAppContribution({
      hasEnabledProvider: async (userId) =>
        (await providerRepository.list(userId)).some((provider) => provider.enabled),
      quiesce: async (deadlineUnixSeconds) => {
        await Promise.all([
          scheduler.quiesce(deadlineUnixSeconds),
          subagentScheduler?.quiesce(deadlineUnixSeconds) ?? Promise.resolve(),
        ]);
        await stateCommit.quiesceApp('nexus.operations', systemClock.nowUnixSeconds());
      },
    }),
  ];
  for (const contribution of contributions) {
    const manifest = validateManifest(contribution.rawManifest, { nexusVersion, supportedSdkMajor: 1 });
    registry.register(contribution.create(manifest));
  }

  return {
    host: {
      listApps: (userId) => lifecycle.list(userId),
      getApp: (userId, appId) => lifecycle.get({ userId, appId }),
      setAppEnabled: async (userId, appId, enabled, expectedVersion) => {
        const scope = { userId, appId };
        const updated = await lifecycle.setEnabled(scope, enabled, expectedVersion);
        if (enabled) {
          scheduler.resume();
          subagentScheduler?.resume();
          await integrations.syncEnabled(scope);
        } else {
          await integrations.deactivate(scope);
        }
        return updated;
      },
      listAppGrants: async (userId, appId) => {
        await lifecycle.initializeDefaults(userId);
        return appGrants.list({ userId, appId });
      },
      replaceAppGrants: async (userId, appId, capabilities, expectedPolicyRevision) => {
        await lifecycle.initializeDefaults(userId);
        const scope = { userId, appId };
        const app = await lifecycle.get(scope);
        const declared = new Set(registry.get(appId, app.activeVersion).manifest.capabilities);
        const unique = [...new Set(capabilities)];
        if (unique.some((capability) => !declared.has(capability))) throw new Error('APP_CAPABILITY_UNDECLARED');
        await appGrants.replace(
          scope,
          expectedPolicyRevision,
          unique.map((capability) => ({
            capability,
            schemaVersion: 1,
            scope: { targetSelection: 'all-except-denylist' },
            grantedAt: systemClock.nowUnixSeconds(),
          })),
        );
        return { app: await lifecycle.get(scope), grants: await appGrants.list(scope) };
      },
      createAppIntent: (scope, input) => appIntents.createConfirmed(scope, input),
      listReceivedAppIntents: (scope, limit) => appIntents.listReceived(scope, limit),
      revokeAppIntent: (scope, receiptId) => appIntents.revoke(scope, receiptId),
      getReceivedAppIntentArtifact: (scope, receiptId, artifactId) =>
        appIntents.getReceivedArtifact(scope, receiptId, artifactId),
      readReceivedAppIntentArtifact: (scope, receiptId, artifactId, range) =>
        appIntents.readReceivedArtifact(scope, receiptId, artifactId, range),
      authorize: async (scope, capability, resource) => {
        await lifecycle.initializeDefaults(scope.userId);
        return capabilityBroker.authorize(scope, capability, resource);
      },
      getSettings: (userId) => settings.get(userId),
      patchSettings: async (userId, patch, expectedRevision) => {
        const before = await settings.get(userId);
        const updated = await settings.patch(userId, patch, expectedRevision);
        if (before.effectiveSettings.feature.enabled && !updated.effectiveSettings.feature.enabled) {
          const deadline = systemClock.nowUnixSeconds() + 10;
          for (const definition of registry.list()) await lifecycle.quiesce(definition.manifest.id, deadline);
        } else if (!before.effectiveSettings.feature.enabled && updated.effectiveSettings.feature.enabled) {
          scheduler.resume();
          subagentScheduler?.resume();
        }
        return updated;
      },
      previewHardLimits: (userId, proposed, expectedRevision) =>
        settings.previewHardLimits(userId, proposed, expectedRevision),
      confirmHardLimits: (userId, confirmationId, expectedRevision) =>
        settings.confirmHardLimits(userId, confirmationId, expectedRevision),
      getTargetDenylist: () => targetDenylist.snapshot(),
      replaceTargetDenylist: async (userId, connectionIds, reason, expectedRevision) => {
        const updated = await targetDenylist.replace(
          expectedRevision,
          connectionIds,
          reason,
          userId,
          systemClock.nowUnixSeconds(),
        );
        if (updated.eventCursor !== undefined) eventHub.publishHostWake(userId, updated.eventCursor);
        return updated;
      },
    },
    plugins: {
      listPublisherKeys: (userId) => plugins.listPublisherKeys(userId),
      trustPublisherKey: (userId, publicKeyPem, label) => plugins.trustPublisherKey(userId, publicKeyPem, label),
      revokePublisherKey: (userId, keyId) => plugins.revokePublisherKey(userId, keyId),
      stage: (userId, input) => plugins.stage(userId, input),
      verify: (userId, stageId) => plugins.verify(userId, stageId),
      install: (userId, stageId) => plugins.install(userId, stageId),
      upgrade: (userId, appId, stageId, expectedVersion) => plugins.upgrade(userId, appId, stageId, expectedVersion),
      uninstall: (userId, appId, expectedVersion) => plugins.uninstall(userId, appId, expectedVersion),
      deleteData: (userId, appId) => plugins.deleteData(userId, appId),
      frontendDescriptor: (userId, appId) => plugins.frontendDescriptor(userId, appId),
      frontendRpc: (userId, appId, request) => plugins.frontendRpc(userId, appId, request),
      listVersions: (userId, appId) => plugins.listVersions(userId, appId),
      listInstallations: (userId) => plugins.listInstallations(userId),
    },
    ai: {
      providers,
      integrations: {
        list: (scope, kind) => integrations.list(scope, kind),
        get: (scope, integrationId) => integrations.get(scope, integrationId),
        create: (scope, input) => integrations.create(scope, input),
        update: (scope, integrationId, expectedVersion, input) =>
          integrations.update(scope, integrationId, expectedVersion, input),
        remove: (scope, integrationId, expectedVersion) => integrations.remove(scope, integrationId, expectedVersion),
        refresh: (scope, integrationId, signal) => integrations.refresh(scope, integrationId, signal),
      },
      artifacts,
      conversations,
      context,
      memories: {
        list: (scope, status, limit) => memories.list(scope, status, limit),
        propose: (scope, input, provenance) => memories.propose(scope, input, provenance),
        review: (scope, memoryId, input) => memories.review(scope, memoryId, input),
        previewImport: (scope, sourceAppId, sourceMemoryId) =>
          memories.previewImport(scope, sourceAppId, sourceMemoryId),
        confirmImport: (scope, confirmationId) => memories.confirmImport(scope, confirmationId),
      },
      languageModel,
    },
    runtime: {
      runs: {
        definitions: (appId) => definitions.list(appId),
        create: (scope, command) => runs.create(scope, command),
        get: (scope, runId) => runs.get(scope, runId),
        rootRuntimeId: (scope, runId) => runRepository.rootRuntimeId(scope, runId),
        list: (scope, threadId, limit, before) => runs.list(scope, threadId, limit, before),
        appendInput: (scope, runId, input, expectedVersion, idempotencyKey) =>
          runs.appendInput(scope, runId, input, expectedVersion, idempotencyKey),
        increaseBudget: (scope, runId, increase, expectedVersion, idempotencyKey) =>
          runs.increaseBudget(scope, runId, increase, expectedVersion, idempotencyKey),
        cancel: (scope, runId, expectedVersion, idempotencyKey) =>
          runs.cancel(scope, runId, expectedVersion, idempotencyKey),
        listCheckpoints: (scope, runId) => checkpoints.list(scope, runId),
        saveCheckpoint: (scope, runId, expectedVersion) => checkpoints.save(scope, runId, expectedVersion),
        resume: (scope, runId, checkpointId, expectedVersion, idempotencyKey) =>
          checkpoints.resume(scope, runId, checkpointId, expectedVersion, idempotencyKey),
        delete: (scope, runId, expectedVersion, idempotencyKey) =>
          runs.delete(scope, runId, expectedVersion, idempotencyKey),
      },
      collaboration: {
        getSettings: (scope) => subagentPolicy.get(scope),
        replaceProfiles: (scope, input, expectedVersion) =>
          subagentPolicy.replaceProfiles(scope, input, expectedVersion),
        createSubagent: (scope, runId, parentRuntimeId, input, idempotencyKey) =>
          subagents.create(scope, runId, parentRuntimeId, input, idempotencyKey),
        listSubagents: (scope, runId, parentRuntimeId, limit, before) =>
          subagents.list(scope, runId, parentRuntimeId, limit, before),
        cancelSubagent: (scope, runId, delegationId, expectedVersion) =>
          subagents.cancelTree(scope, runId, delegationId, expectedVersion),
        joinSubagents: (scope, runId, callerRuntimeId, delegationIds, mode, deadlineAt, signal) =>
          subagents.join(scope, runId, callerRuntimeId, delegationIds, mode, deadlineAt, signal),
        sendMessage: (scope, runId, senderRuntimeId, input, idempotencyKey) =>
          mailbox.send(scope, runId, senderRuntimeId, input, idempotencyKey),
        readMessages: (scope, runId, runtimeId, after, limit) => mailbox.read(scope, runId, runtimeId, after, limit),
        listSubagentMessages: (scope, runId, delegationId, limit, before) =>
          mailboxRepository.listDelegationMessages(scope, runId, delegationId, limit, before),
        consumeMessages: (scope, runId, runtimeId, through, expectedConsumedSequence) =>
          mailbox.consume(scope, runId, runtimeId, through, expectedConsumedSequence),
        getFact: (scope, runId, key) => sharedFacts.get(scope, runId, key),
        compareAndSetFact: (scope, runId, runtimeId, key, value, expectedVersion) =>
          sharedFacts.compareAndSet(scope, runId, runtimeId, key, value, expectedVersion),
      },
      events: {
        readRun: (scope, runId, after, limit) => runRepository.readEvents(scope, runId, after, limit),
        readHost: (userId, after, limit) => runRepository.readHostEvents(userId, after, limit),
        hostCursor: (userId) => runRepository.hostCursor(userId),
        onRunWake: (runId, listener) => eventHub.onRunWake(runId, listener),
        onHostWake: (userId, listener) => eventHub.onHostWake(userId, listener),
        onTransient: (runId, listener) => eventHub.onTransient(runId, listener),
      },
      workspaceRuntime: workspaceRuntimeFacade,
      approvals: {
        get: (scope, approvalId) => approvals.get(scope, approvalId),
        list: (scope, runId) => approvals.list(scope, runId),
        resolve: (scope, approvalId, decision, operationHash, expectedVersion, actorUserId, idempotencyKey) =>
          approvals.resolve(scope, approvalId, decision, operationHash, expectedVersion, actorUserId, idempotencyKey),
      },
    },
    initialize: async () => {
      await plugins.initializeInstalledVersions();
      await stateCommit.interruptNonTerminalRuns(systemClock.nowUnixSeconds());
      scheduler.resume();
      await subagentScheduler?.initialize();
      lifecycleSweeps.start();
    },
    initializeForUser: async (userId) => {
      await settings.get(userId);
      await lifecycle.initializeDefaults(userId);
      await plugins.reconcileUserRuntime(userId);
      for (const definition of registry.list()) {
        await integrations.syncEnabled({ userId, appId: definition.manifest.id });
      }
    },
    quiesce: async (deadlineUnixSeconds) => {
      await Promise.all([
        scheduler.quiesce(deadlineUnixSeconds),
        subagentScheduler?.quiesce(deadlineUnixSeconds) ?? Promise.resolve(),
      ]);
      for (const definition of registry.list()) await lifecycle.quiesce(definition.manifest.id, deadlineUnixSeconds);
    },
    dispose: async () => {
      await Promise.all([
        lifecycleSweeps.stop(),
        subagentScheduler?.dispose() ?? Promise.resolve(),
        mcpRuntime.closeAll(),
      ]);
      eventHub.clear();
      await lifecycle.dispose();
    },
  };
};
