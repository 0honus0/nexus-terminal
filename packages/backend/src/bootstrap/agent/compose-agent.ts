import { logger } from '../../shared/logging/logger';
import { LocalArtifactStore } from '../../infrastructure/agent/artifacts/local-artifact-store';
import { AppIntentArtifactAdapter } from '../../infrastructure/agent/artifacts/app-intent-artifact.adapter';
import { MachineCapabilityAdapter } from '../../infrastructure/agent/capabilities/machine-capability.adapter';
import { SshFileTargetAdapter } from '../../infrastructure/agent/capabilities/ssh-file-target.adapter';
import { SshShellTargetAdapter } from '../../infrastructure/agent/capabilities/ssh-shell-target.adapter';
import { SshTargetAdapter } from '../../infrastructure/agent/capabilities/ssh-target.adapter';
import { WorkspaceFileTargetAdapter } from '../../infrastructure/agent/workspace-runtime/workspace-file-target.adapter';
import { WorkspaceShellTargetAdapter } from '../../infrastructure/agent/workspace-runtime/workspace-shell-target.adapter';
import { FileCapabilityService } from '../../modules/agent/capabilities/file-capability.service';
import { ShellCapabilityService } from '../../modules/agent/capabilities/shell-capability.service';
import { AgentTargetResolver } from '../../modules/agent/capabilities/target-resolver';
import { AgentMutationLeaseGuardAdapter } from '../../infrastructure/agent/capabilities/agent-mutation-lease-guard.adapter';
import { NodeCryptoHashAdapter } from '../../infrastructure/agent/capabilities/node-crypto-hash.adapter';
import { SqliteAgentSettingsRepository } from '../../infrastructure/agent/repositories/sqlite-agent-settings.repository';
import { SqliteHardLimitConfirmationRepository } from '../../infrastructure/agent/repositories/sqlite-hard-limit-confirmation.repository';
import { SqliteHardLimitUsageAdapter } from '../../infrastructure/agent/repositories/sqlite-hard-limit-usage.adapter';
import { SqliteAppGrantRepository } from '../../infrastructure/agent/repositories/sqlite-app-grant.repository';
import { SqliteAppStateRepository } from '../../infrastructure/agent/repositories/sqlite-app-state.repository';
import { SqliteConversationRepository } from '../../infrastructure/agent/repositories/sqlite-conversation.repository';
import { SqliteContextCheckpointRepository } from '../../infrastructure/agent/repositories/sqlite-context-checkpoint.repository';
import { SqliteApprovalRepository } from '../../infrastructure/agent/repositories/sqlite-approval.repository';
import { SqliteAppIntentRepository } from '../../infrastructure/agent/repositories/sqlite-app-intent.repository';
import { SqliteSubagentRepository } from '../../infrastructure/agent/repositories/sqlite-subagent.repository';
import { SqliteMemoryRepository } from '../../infrastructure/agent/repositories/sqlite-memory.repository';
import { SqliteMemoryProvenanceAdapter } from '../../infrastructure/agent/repositories/sqlite-memory-provenance.adapter';
import { SqliteModelContinuationRepository } from '../../infrastructure/agent/repositories/sqlite-model-continuation.repository';
import { InstalledPluginSkillSourceAdapter } from '../../infrastructure/agent/plugins/installed-plugin-skill-source.adapter';
import { OpenAiProviderAdapter } from '../../infrastructure/agent/providers/openai-provider.adapter';
import {
  LocalModelCapabilityRegistryStore,
  ModelsDevCapabilityRegistrySource,
} from '../../infrastructure/agent/providers/model-capability-registry.adapter';
import { McpAdapter } from '../../infrastructure/agent/integrations/mcp.adapter';
import { AcpAdapter } from '../../infrastructure/agent/integrations/acp.adapter';
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
import type { WorkspaceRuntimeInteractiveSessionPort } from '../../modules/agent/workspace-runtime/workspace-runtime-interactive-session.port';
import { AGENT_DEFAULTS } from '../../modules/agent/agent-defaults';
import { systemClock, type Scope } from '../../modules/agent/agent.types';
import { ArtifactService } from '../../modules/agent/ai/artifact.service';
import { IntegrationService } from '../../modules/agent/ai/integration.service';
import type { AcpTransportPort, BrowserGatewayPort } from '../../modules/agent/ai/integrations.types';
import type { ArtifactLimitPolicyPort } from '../../modules/agent/ai/artifact.port';
import { ConversationService } from '../../modules/agent/ai/conversation.service';
import { ContextCheckpointService } from '../../modules/agent/ai/context-checkpoint.service';
import { ContextService } from '../../modules/agent/ai/context.service';
import { ProviderService } from '../../modules/agent/ai/provider.service';
import { ModelCapabilityRegistryService } from '../../modules/agent/ai/model-capability-registry.service';
import { snapshotProviderModelCapabilities } from '../../modules/agent/ai/model-capability-resolver';
import { missingRequiredModelCapabilities } from '../../modules/agent/ai/model-capability-requirements';
import { RecallService } from '../../modules/agent/ai/recall.service';
import { MemoryService } from '../../modules/agent/ai/memory.service';
import { SkillRegistry } from '../../modules/agent/ai/skill-registry';
import type { AgentDiagnosticsPort } from '../../modules/agent/capabilities/machine.port';
import type { AgentConnectionResolverPort } from '../../modules/agent/capabilities/ssh-target-resolver.port';
import { ApprovalService } from '../../modules/agent/runtime/approvals/approval.service';
import { AcpPermissionBroker } from '../../modules/agent/runtime/approvals/acp-permission-broker';
import { PolicyService } from '../../modules/agent/capabilities/policy.service';
import { ToolCatalog } from '../../modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../modules/agent/capabilities/tool-executor';
import type { LeasePort } from '../../modules/agent/capabilities/lease.port';
import { AgentSettingsService } from '../../modules/agent/host/agent-settings.service';
import { AgentOnboardingService } from '../../modules/agent/host/agent-onboarding.service';
import { AppCapabilityBroker } from '../../modules/agent/host/app-capability-broker';
import { CapabilityRegistry } from '../../modules/agent/host/capability-registry';
import { AppLifecycleService } from '../../modules/agent/host/app-lifecycle.service';
import { AppIntentService } from '../../modules/agent/host/app-intent.service';
import { AppRegistryService } from '../../modules/agent/host/app-registry.service';
import type { OfficialAgentPluginSource } from '../../modules/agent/host/official-plugin-source';
import { AgentDefinitionRegistry } from '../../modules/agent/runtime/definitions/agent-definition.registry';
import { AgentEventHub } from '../../modules/agent/runtime/events/event-hub';
import { NativeAgentBackend } from '../../modules/agent/runtime/execution/native-agent-backend';
import { LeaseCoordinator } from '../../modules/agent/runtime/execution/lease-coordinator';
import { ModelCallLimiter } from '../../modules/agent/runtime/execution/model-call-limiter';
import { ModelStepRunner } from '../../modules/agent/runtime/execution/model-step-runner';
import { ToolCallRunner } from '../../modules/agent/runtime/execution/tool-call-runner';
import { RunService } from '../../modules/agent/runtime/runs/run.service';
import { CheckpointService } from '../../modules/agent/runtime/recovery/checkpoint.service';
import { WorkspaceCheckpointService } from '../../modules/agent/runtime/recovery/workspace-checkpoint.service';
import { AgentScheduler } from '../../modules/agent/runtime/scheduling/scheduler';
import { SubagentCompletionCoordinator } from '../../modules/agent/runtime/collaboration/subagent-completion-coordinator';
import { SubagentContextBuilder } from '../../modules/agent/runtime/collaboration/subagent-context-builder';
import { SubagentPolicyService } from '../../modules/agent/runtime/collaboration/subagent-policy';
import type { SubagentExecutionHost } from '../../modules/agent/runtime/collaboration/subagent-execution-host.port';
import { SubagentModelStepExecutor } from '../../modules/agent/runtime/collaboration/subagent-model-step-executor';
import { SubagentParticipantExecutor } from '../../modules/agent/runtime/collaboration/subagent-participant-executor';
import { SubagentToolStepExecutor } from '../../modules/agent/runtime/collaboration/subagent-tool-step-executor';
import { SubagentService } from '../../modules/agent/runtime/collaboration/subagent.service';
import { SubagentScheduler } from '../../modules/agent/runtime/collaboration/subagent-scheduler';
import { MailboxService } from '../../modules/agent/runtime/collaboration/mailbox.service';
import { SharedFactsService } from '../../modules/agent/runtime/collaboration/shared-facts.service';
import type {
  DelegationCancellationPort,
  DelegationReaderPort,
  DelegationRepositoryPort,
  MailboxConsumerPort,
  MailboxReaderPort,
  MailboxRepositoryPort,
  RunScopeRepositoryPort,
  RuntimeParticipantRepositoryPort,
  SchedulerWorkClaimPort,
  SchedulerWorkExecutionPort,
  SharedFactRepositoryPort,
} from '../../modules/agent/runtime/collaboration/subagent.repository.port';
import { PlanService } from '../../modules/agent/runtime/planning/plan.service';
import { AgentExecutionPolicyService } from '../../modules/agent/host/agent-execution-policy.service';
import type { AgentServices } from '../../modules/agent/public';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { RemoteDockerService } from '../../platform/docker/remote-docker.service';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../shared/security/crypto.port';
import type { AuditLogService } from '../../modules/audit/audit.service';
import type { NotificationService } from '../../modules/notifications/notification.service';
import { AgentNotificationBridge } from './agent-notification-bridge';
import { composePlugins } from './compose-plugins';
import { composeWorkspaceRuntime } from './compose-workspace-runtime';
import { createAgentLifecycleSweeps } from './lifecycle-sweeps';
import {
  createMcpToolContributionHooks,
  registerFileToolContributions,
  registerMachineToolContributions,
  registerShellToolContributions,
  registerAcpToolContribution,
  registerBrowserToolContribution,
  registerRuntimeToolContributions,
  registerWorkspaceToolContributions,
} from './tool-contributions';

export interface ComposeAgentOptions {
  database: RelationalDatabase;
  cipher: SecretCipher;
  dataDirectory: string;
  nexusVersion: string;
  nodeEnv: string;
  e2eResetEnabled: boolean;
  publicOrigin?: string;
  officialPluginSource: OfficialAgentPluginSource;
  connectionResolver: AgentConnectionResolverPort;
  diagnostics: AgentDiagnosticsPort;
  executionSessions: ExecutionSessionManager;
  docker: RemoteDockerService;
  leases: LeasePort;
  workspaceRuntimeController: WorkspaceRuntimeControllerPort & WorkspaceRuntimeGatewayPort;
  workspaceInteractiveSessions: WorkspaceRuntimeInteractiveSessionPort;
  acpTransport: AcpTransportPort;
  browserGateway: BrowserGatewayPort;
  audit: AuditLogService;
  notifications: NotificationService;
}

export const composeAgent = ({
  database,
  cipher,
  dataDirectory,
  nexusVersion,
  nodeEnv,
  e2eResetEnabled,
  publicOrigin,
  officialPluginSource,
  connectionResolver,
  diagnostics,
  executionSessions,
  docker,
  leases,
  workspaceRuntimeController,
  workspaceInteractiveSessions,
  acpTransport,
  browserGateway,
  audit,
  notifications,
}: ComposeAgentOptions): AgentServices => {
  const registry = new AppRegistryService();
  const runRepository = new SqliteRunRepository(database);
  const eventHub = new AgentEventHub();
  const publishHostWake = (userId: number): void => {
    void runRepository
      .hostCursor(userId)
      .then((cursor) => eventHub.publishHostWake(userId, cursor))
      .catch((error) => logger.warn({ err: error, userId }, 'Agent Host wake publication failed'));
  };
  const appStates = new SqliteAppStateRepository(database);
  const capabilityRegistry = new CapabilityRegistry();
  const appGrants = new SqliteAppGrantRepository(database, capabilityRegistry);
  const targetDenylist = new SqliteTargetDenylistRepository(database);
  const settingsRepository = new SqliteAgentSettingsRepository(database);
  const hardLimitConfirmations = new SqliteHardLimitConfirmationRepository(database);
  const hardLimitUsage = new SqliteHardLimitUsageAdapter(database);
  let quiesceHostExecution: (scope: Scope, deadlineUnixSeconds: number) => Promise<void> = async () => {
    throw new Error('AGENT_HOST_NOT_READY');
  };
  const lifecycle = new AppLifecycleService(
    registry,
    appStates,
    appGrants,
    systemClock,
    publishHostWake,
    (scope, deadlineUnixSeconds) => quiesceHostExecution(scope, deadlineUnixSeconds),
  );
  const settings = new AgentSettingsService(settingsRepository, hardLimitConfirmations, hardLimitUsage, systemClock);
  const capabilityBroker = new AppCapabilityBroker(registry, appStates, appGrants, targetDenylist, capabilityRegistry);
  const providerRepository = new SqliteProviderRepository(database, cipher);
  const modelRegistry = new ModelCapabilityRegistryService(
    new LocalModelCapabilityRegistryStore(dataDirectory),
    new ModelsDevCapabilityRegistrySource(),
    systemClock,
  );
  const outboundPolicy = new OutboundPolicyAdapter(nodeEnv, e2eResetEnabled);
  const integrationRepository = new SqliteIntegrationRepository(database, cipher);
  const mcpRuntime = new McpAdapter(integrationRepository, outboundPolicy);
  const providerSecrets = new ProviderSecretAdapter(database, cipher);
  let providers: ProviderService;
  const languageModel = new OpenAiProviderAdapter(
    { get: (userId, providerId) => providers.get(userId, providerId) },
    providerSecrets,
  );
  providers = new ProviderService(providerRepository, languageModel, systemClock, (userId) =>
    lifecycle.refreshHealth(userId),
  );
  const artifactLimits: ArtifactLimitPolicyPort = {
    forUser: async (userId) => {
      const view = await settings.get(userId);
      return {
        maxSingleArtifactBytes: view.effectiveSettings.storage.maxSingleArtifactBytes,
        maxGlobalArtifactBytes: view.effectiveSettings.storage.maxGlobalArtifactBytes,
        unretainedArtifactTtlSeconds: view.effectiveSettings.storage.unretainedArtifactTtlSeconds,
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
  const definitions = new AgentDefinitionRegistry();
  const { appStorage, plugins } = composePlugins({
    database,
    dataDirectory,
    nexusVersion,
    publicOrigin,
    registry,
    appStates,
    capabilityBroker,
    appIntents,
    artifactStore,
    settings,
    definitions,
    clock: systemClock,
    onHostStateCommitted: publishHostWake,
  });
  const onboarding = new AgentOnboardingService(
    plugins,
    lifecycle,
    appGrants,
    capabilityRegistry,
    officialPluginSource,
  );
  const executionPolicies = new AgentExecutionPolicyService(appStorage, settings);
  const conversationRepository = new SqliteConversationRepository(database);
  const conversations = new ConversationService(conversationRepository, systemClock, settings, lifecycle);
  const recall = new RecallService(new SqliteRecallRepository(database), systemClock);
  const skills = new SkillRegistry(new InstalledPluginSkillSourceAdapter(database, dataDirectory));
  const modelContinuations = new SqliteModelContinuationRepository(database);
  const contextCheckpoints = new ContextCheckpointService(
    new SqliteContextCheckpointRepository(database),
    conversations,
    systemClock,
  );
  const context = new ContextService(conversations, recall, skills, modelContinuations, artifacts, contextCheckpoints);
  const notificationBridge = new AgentNotificationBridge(notifications, conversationRepository);
  const stateCommit = new SqliteStateCommitAdapter(database, (run, events) => {
    void notificationBridge
      .project(run, events)
      .catch((error) =>
        logger.warn({ err: error, runId: run.id, appId: run.appId }, 'Agent notification projection failed'),
      );
  });
  const subagentRepository = new SqliteSubagentRepository(database);
  const runScopes: RunScopeRepositoryPort = subagentRepository;
  const runtimeParticipants: RuntimeParticipantRepositoryPort = subagentRepository;
  const delegationReader: DelegationReaderPort = subagentRepository;
  const delegationCancellation: DelegationCancellationPort = subagentRepository;
  const delegationRepository: DelegationRepositoryPort = subagentRepository;
  const mailboxReader: MailboxReaderPort = subagentRepository;
  const mailboxConsumer: MailboxConsumerPort = subagentRepository;
  const mailboxRepository: MailboxRepositoryPort = subagentRepository;
  const schedulerClaims: SchedulerWorkClaimPort = subagentRepository;
  const schedulerExecution: SchedulerWorkExecutionPort = subagentRepository;
  const sharedFactRepository: SharedFactRepositoryPort = subagentRepository;
  const subagentPolicy = new SubagentPolicyService(appStorage, settings, providers);
  let subagentScheduler: SubagentScheduler | null = null;
  const mailbox = new MailboxService(
    mailboxRepository,
    runtimeParticipants,
    delegationReader,
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
    {
      memoryChanged: (memory, action, provenance) => {
        publishHostWake(memory.userId);
        if (action !== 'proposed' || !provenance) return;
        void notificationBridge.projectMemoryCandidate(memory, provenance);
      },
    },
  );
  const subagents = new SubagentService(
    delegationRepository,
    runtimeParticipants,
    runRepository,
    subagentPolicy,
    providers,
    appGrants,
    capabilityRegistry,
    eventHub,
    systemClock,
    () => subagentScheduler?.wake(),
    (runId, runtimeId) => {
      subagentScheduler?.cancelRuntime(runId, runtimeId);
    },
  );
  const machine = new MachineCapabilityAdapter(
    connectionResolver,
    diagnostics,
    executionSessions,
    docker,
    targetDenylist,
  );
  const sshTargets = new SshTargetAdapter(connectionResolver, targetDenylist);
  const sshFiles = new SshFileTargetAdapter(connectionResolver, executionSessions);
  const sshShell = new SshShellTargetAdapter(connectionResolver, executionSessions);
  const cryptoHash = new NodeCryptoHashAdapter();
  const acpPermissions = new AcpPermissionBroker(stateCommit, cryptoHash, systemClock, (runId, approvalId) => {
    eventHub.publishTransient({
      runId,
      type: 'approval.changed',
      payload: { approvalId },
      occurredAt: systemClock.nowUnixSeconds(),
    });
  });
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
    interactiveSessions: workspaceInteractiveSessions,
    browserGateway,
    now: () => systemClock.nowUnixSeconds(),
  });
  const workspaceRepository = composedWorkspaceRuntime.repository;
  const targets = new AgentTargetResolver(workspaceRepository, sshTargets, cryptoHash);
  const workspaceRuntime = composedWorkspaceRuntime.service;
  const workspaceFiles = new WorkspaceFileTargetAdapter(workspaceRepository, workspaceRuntimeController);
  const workspaceShell = new WorkspaceShellTargetAdapter(workspaceRepository, workspaceRuntimeController);
  const files = new FileCapabilityService(targets, workspaceFiles, sshFiles);
  const shell = new ShellCapabilityService(targets, workspaceShell, sshShell, cryptoHash);
  const workspaceRuntimeFacade = composedWorkspaceRuntime.facade;
  const acpRuntime = new AcpAdapter(acpTransport);
  const toolCatalog = new ToolCatalog();
  registerFileToolContributions({ catalog: toolCatalog, files, cryptoHash });
  registerShellToolContributions({ catalog: toolCatalog, shell, cryptoHash });
  registerMachineToolContributions({ catalog: toolCatalog, machine, sshTargets, cryptoHash });
  registerWorkspaceToolContributions({
    catalog: toolCatalog,
    repository: workspaceRepository,
    targets,
    runtime: workspaceRuntime,
    cryptoHash,
  });
  registerAcpToolContribution({
    catalog: toolCatalog,
    repository: integrationRepository,
    workspaces: workspaceRepository,
    runtime: acpRuntime,
    cryptoHash,
    permissionRequests: acpPermissions,
  });
  registerBrowserToolContribution({
    catalog: toolCatalog,
    workspaces: workspaceRepository,
    settings,
    gateway: browserGateway,
    cryptoHash,
    artifacts,
  });
  registerRuntimeToolContributions({
    catalog: toolCatalog,
    artifacts,
    plans,
    runs: runRepository,
    subagents,
    mailbox,
    facts: sharedFacts,
    memories,
    skills,
    cryptoHash,
  });
  const integrations = new IntegrationService(
    integrationRepository,
    outboundPolicy,
    mcpRuntime,
    lifecycle,
    cryptoHash,
    systemClock,
    createMcpToolContributionHooks({
      catalog: toolCatalog,
      repository: integrationRepository,
      runtime: mcpRuntime,
      artifacts,
      cryptoHash,
    }),
  );
  const toolExecutor = new ToolExecutor(toolCatalog, capabilityBroker);
  const policy = new PolicyService();
  const modelCalls = new ModelCallLimiter(settings);
  const leaseCoordinator = new LeaseCoordinator(leases, systemClock);
  const mutationLeaseGuard = new AgentMutationLeaseGuardAdapter(leases, systemClock);
  const modelSteps = new ModelStepRunner(providers, context, languageModel, modelCalls, {
    load: (scope, runId, runtimeId, targetDirectories, signal) =>
      workspaceRuntime.loadProjectInstructions(scope, runId, runtimeId, targetDirectories, signal),
  });
  const toolCalls = new ToolCallRunner(toolCatalog, toolExecutor, policy, leaseCoordinator, mutationLeaseGuard);
  let recordRecoverySafePoint: (
    run: Parameters<AgentScheduler['enqueue']>[0],
    reason: 'model_boundary' | 'read_batch' | 'mutation_confirmed',
  ) => Promise<void> = async () => undefined;
  const nativeBackend = new NativeAgentBackend(
    runRepository,
    delegationReader,
    stateCommit,
    modelSteps,
    toolCalls,
    systemClock,
    (run, reason) => recordRecoverySafePoint(run, reason),
    subagentPolicy,
  );
  const scheduler = new AgentScheduler(
    settings,
    nativeBackend,
    eventHub,
    systemClock,
    (userId) => runRepository.hostCursor(userId),
    (userId) => subagentScheduler?.activeCountForUser(userId) ?? 0,
    (runId) => subagentScheduler?.hasActiveRun(runId) ?? false,
  );
  const subagentContext = new SubagentContextBuilder(
    runtimeParticipants,
    mailboxReader,
    toolCatalog,
    capabilityRegistry,
    modelContinuations,
    artifacts,
    systemClock,
    {
      load: (scope, runId, runtimeId, targetDirectories, signal) =>
        workspaceRuntime.loadProjectInstructions(scope, runId, runtimeId, targetDirectories, signal),
    },
  );
  const subagentHost: SubagentExecutionHost = {
    enqueueRootRun: async (runId, scope) => {
      const run = await runRepository.snapshot(scope, runId);
      if (run && ['created', 'running'].includes(run.status)) scheduler.enqueue(run);
    },
    wakeChildScheduler: () => subagentScheduler?.wake(),
    cancelChildRuntime: (runId, runtimeId) => {
      subagentScheduler?.cancelRuntime(runId, runtimeId);
    },
  };
  const subagentCompletion = new SubagentCompletionCoordinator(
    schedulerExecution,
    delegationCancellation,
    runtimeParticipants,
    stateCommit,
    mailbox,
    eventHub,
    subagentHost,
    systemClock,
  );
  const subagentTools = new SubagentToolStepExecutor(
    schedulerExecution,
    delegationCancellation,
    runtimeParticipants,
    runRepository,
    stateCommit,
    subagentContext,
    toolCalls,
    subagentCompletion,
    eventHub,
    systemClock,
    (run, reason) => recordRecoverySafePoint(run, reason),
  );
  const subagentModels = new SubagentModelStepExecutor(
    schedulerExecution,
    delegationCancellation,
    runtimeParticipants,
    mailboxConsumer,
    runRepository,
    providers,
    languageModel,
    modelCalls,
    stateCommit,
    subagentContext,
    toolExecutor,
    subagentCompletion,
    eventHub,
    systemClock,
  );
  const subagentParticipant = new SubagentParticipantExecutor(
    schedulerExecution,
    delegationCancellation,
    subagentCompletion,
    subagentTools,
    subagentModels,
    subagentHost,
    systemClock,
  );
  subagentScheduler = new SubagentScheduler(
    settings,
    runScopes,
    schedulerClaims,
    subagentParticipant,
    {
      activeCountForUser: (userId) => scheduler.activeCountForUser(userId),
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
  quiesceHostExecution = async (scope, deadlineUnixSeconds) => {
    const stopped = await Promise.allSettled([
      scheduler.quiesceScope(scope, deadlineUnixSeconds),
      subagentScheduler!.quiesceScope(scope, deadlineUnixSeconds),
    ]);
    await stateCommit.quiesceApp(scope, systemClock.nowUnixSeconds());
    publishHostWake(scope.userId);
    const failure = stopped.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  };
  const notifyCommitted = (run: Parameters<AgentScheduler['enqueue']>[0]) => {
    eventHub.publishRunWake(run.id, run.eventCursor);
    publishHostWake(run.userId);
  };
  const runs = new RunService(
    settings,
    lifecycle,
    providers,
    executionPolicies,
    definitions,
    (scope, selection, expectedSettingsRevision) => {
      const { catalogRevision, ...workspace } = selection;
      return workspaceRuntime.resolveRunEnvironment(scope, workspace, catalogRevision, expectedSettingsRevision);
    },
    stateCommit,
    runRepository,
    systemClock,
    (run) => scheduler.enqueue(run),
    (run) => notifyCommitted(run),
    (run) => scheduler.signalInput(run),
    (run) => scheduler.signalInput(run, 'GOAL_UPDATED'),
    (runId) => {
      scheduler.cancel(runId);
      subagentScheduler?.cancel(runId);
    },
    (userId, cursor) => eventHub.publishHostWake(userId, cursor),
  );
  const checkpointRepository = new SqliteCheckpointRepository(database);
  const workspaceCheckpoints = new WorkspaceCheckpointService(
    workspaceRepository,
    workspaceRuntime,
    workspaceRuntimeController,
    artifacts,
  );
  let recoveringStartup = false;
  const startupRecoveredRuns: Parameters<AgentScheduler['enqueue']>[0][] = [];
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
    (run) => {
      if (recoveringStartup) startupRecoveredRuns.push(run);
      else scheduler.enqueue(run);
    },
    (run) => notifyCommitted(run),
    workspaceCheckpoints,
    workspaceRuntimeController,
  );
  recordRecoverySafePoint = async (run, reason) => {
    await checkpoints.recordSafePoint(run, reason);
  };
  const lifecycleSweeps = createAgentLifecycleSweeps({
    stateCommit,
    workspaceRuntime,
    artifactMaintenance: artifactStore,
    mailbox,
    scheduler,
    clock: systemClock,
    notifyCommitted,
    retryRestartRecovery: () => checkpoints.retryDeferredRecoveries(),
    retryMcpIntegrations: () => integrations.retryDue(),
  });

  const approvalRepository = new SqliteApprovalRepository(database);
  const approvals = new ApprovalService(
    approvalRepository,
    runRepository,
    stateCommit,
    systemClock,
    (run) => {
      notifyCommitted(run);
      scheduler.enqueue(run);
    },
    acpPermissions,
  );

  return {
    host: {
      listApps: (userId) => lifecycle.list(userId),
      getApp: (userId, appId) => lifecycle.get({ userId, appId }),
      setAppEnabled: async (userId, appId, enabled, expectedVersion) => {
        const scope = { userId, appId };
        const updated = await lifecycle.setEnabled(scope, enabled, expectedVersion);
        if (enabled) {
          try {
            scheduler.resumeScope(scope);
            subagentScheduler?.resumeScope(scope);
            scheduler.resume();
            subagentScheduler?.resume();
            await integrations.syncEnabled(scope);
          } catch (error) {
            logger.warn({ err: error, ...scope }, 'Agent app enable post-commit runtime sync failed');
          }
        } else {
          try {
            await integrations.deactivate(scope);
          } catch (error) {
            logger.warn({ err: error, ...scope }, 'Agent app disable post-commit integration deactivation failed');
          }
        }
        return updated;
      },
      listCapabilityDefinitions: () => capabilityRegistry.list(),
      listAppGrants: async (userId, appId) => {
        await lifecycle.initializeDefaults(userId);
        return appGrants.list({ userId, appId });
      },
      getAppExecutionPolicy: (scope) => executionPolicies.get(scope),
      replaceAppExecutionPolicy: (scope, overrides, expectedVersion) =>
        executionPolicies.replace(scope, overrides, expectedVersion),
      replaceAppGrants: async (userId, appId, requestedGrants, expectedPolicyRevision) => {
        await lifecycle.initializeDefaults(userId);
        const scope = { userId, appId };
        const app = await lifecycle.get(scope);
        const declared = new Set(registry.get(appId, app.activeVersion).manifest.capabilities);
        if (new Set(requestedGrants.map((grant) => grant.capability)).size !== requestedGrants.length) {
          throw new Error('APP_GRANT_SCOPE_INVALID');
        }
        const now = systemClock.nowUnixSeconds();
        const normalized = requestedGrants.map((grant) => {
          if (!declared.has(grant.capability)) throw new Error('APP_CAPABILITY_UNDECLARED');
          return capabilityRegistry.grant(grant.capability, grant.scope, now);
        });
        await appGrants.replace(scope, expectedPolicyRevision, normalized);
        publishHostWake(userId);
        return { app: await lifecycle.get(scope), grants: await appGrants.list(scope) };
      },
      createAppIntent: (scope, input, idempotencyKey) => appIntents.createConfirmed(scope, input, idempotencyKey),
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
      getRecommendedPlugin: (userId, signal) => onboarding.recommended(userId, signal),
      installRecommendedPlugin: (userId, signal) => onboarding.installRecommended(userId, signal),
      patchSettings: async (userId, patch, expectedRevision) => {
        const before = await settings.get(userId);
        const updated = await settings.patch(userId, patch, expectedRevision);
        const featureChanged = before.effectiveSettings.feature.enabled !== updated.effectiveSettings.feature.enabled;
        if (featureChanged) publishHostWake(userId);
        if (before.effectiveSettings.feature.enabled && !updated.effectiveSettings.feature.enabled) {
          const deadline = systemClock.nowUnixSeconds() + 10;
          for (const definition of registry.list()) {
            try {
              await lifecycle.quiesceScope({ userId, appId: definition.manifest.id }, deadline);
            } catch (error) {
              logger.warn(
                { err: error, userId, appId: definition.manifest.id },
                'Agent feature disable post-commit quiesce failed',
              );
            }
          }
        } else if (!before.effectiveSettings.feature.enabled && updated.effectiveSettings.feature.enabled) {
          for (const definition of registry.list()) {
            const scope = { userId, appId: definition.manifest.id };
            try {
              await lifecycle.resumeScope(scope);
              scheduler.resumeScope(scope);
              subagentScheduler?.resumeScope(scope);
            } catch (error) {
              logger.warn({ err: error, ...scope }, 'Agent feature enable post-commit resume failed');
            }
          }
          try {
            scheduler.resume();
            subagentScheduler?.resume();
          } catch (error) {
            logger.warn({ err: error, userId }, 'Agent feature enable post-commit scheduler resume failed');
          }
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
      officialCatalog: (signal) => plugins.officialCatalog(officialPluginSource, signal),
      stageOfficial: (userId, appId, version, signal) =>
        plugins.stageOfficial(userId, officialPluginSource, appId, version, signal),
      remoteCatalog: (userId, repositoryUrl, signal) => plugins.remoteCatalog(userId, repositoryUrl, signal),
      stageRemote: (userId, input, signal) => plugins.stageRemote(userId, input, signal),
      verify: (userId, stageId) => plugins.verify(userId, stageId),
      install: (userId, stageId) => plugins.install(userId, stageId),
      listPendingUpgrades: (userId) => plugins.listPendingUpgrades(userId),
      cancelPendingUpgrade: (userId, appId, expectedVersion) =>
        plugins.cancelPendingUpgrade(userId, appId, expectedVersion),
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
      modelRegistry,
      integrations: {
        list: (scope, kind) => integrations.list(scope, kind),
        get: (scope, integrationId) => integrations.get(scope, integrationId),
        create: (scope, input, idempotencyKey) => integrations.create(scope, input, idempotencyKey),
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
        definitions: async (scope) => {
          const [app, providerViews] = await Promise.all([lifecycle.get(scope), providers.list(scope.userId)]);
          return definitions.list(scope.appId, app.activeVersion).map((definition) => ({
            ...definition,
            modelCompatibility: providerViews.flatMap((provider) =>
              provider.models.map((model) => {
                const missingCapabilities = missingRequiredModelCapabilities(
                  definition.requiredModelCapabilities,
                  snapshotProviderModelCapabilities(model),
                );
                return {
                  providerId: provider.id,
                  modelId: model.id,
                  configurationVersion: provider.version,
                  compatible: missingCapabilities.length === 0,
                  missingCapabilities,
                };
              }),
            ),
          }));
        },
        create: (scope, command) => runs.create(scope, command),
        get: (scope, runId) => runs.get(scope, runId),
        rootRuntimeId: (scope, runId) => runRepository.rootRuntimeId(scope, runId),
        list: (scope, threadId, limit, before) => runs.list(scope, threadId, limit, before),
        appendInput: (scope, runId, input, expectedVersion, idempotencyKey) =>
          runs.appendInput(scope, runId, input, expectedVersion, idempotencyKey),
        interrupt: (scope, runId, input, expectedVersion, idempotencyKey) =>
          runs.interrupt(scope, runId, input, expectedVersion, idempotencyKey),
        setGoal: (scope, runId, text, expectedVersion, idempotencyKey) =>
          runs.setGoal(scope, runId, text, expectedVersion, idempotencyKey),
        pendingInputs: (scope, runId) => runs.pendingInputs(scope, runId),
        mutatePendingInput: (scope, runId, action, inputId, beforeInputId, expectedVersion, idempotencyKey) =>
          runs.mutatePendingInput(scope, runId, action, inputId, beforeInputId, expectedVersion, idempotencyKey),
        increaseBudget: (scope, runId, increase, expectedVersion, idempotencyKey) =>
          runs.increaseBudget(scope, runId, increase, expectedVersion, idempotencyKey),
        cancel: (scope, runId, expectedVersion, idempotencyKey) =>
          runs.cancel(scope, runId, expectedVersion, idempotencyKey),
        reconciliation: (scope, runId) => runs.reconciliation(scope, runId),
        resolveReconciliation: (scope, runId, expectedVersion, note, resources) =>
          runs.resolveReconciliation(scope, runId, expectedVersion, note, resources),
        listCheckpoints: (scope, runId) => checkpoints.list(scope, runId),
        saveCheckpoint: (scope, runId, expectedVersion) => checkpoints.save(scope, runId, expectedVersion),
        deleteCheckpoint: (scope, runId, checkpointId) => checkpoints.deleteUser(scope, runId, checkpointId),
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
        hostCursorWindow: (userId) => runRepository.hostCursorWindow(userId),
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
      await modelRegistry.initialize();
      await plugins.initializeInstalledVersions();
      const interrupted = await stateCommit.interruptNonTerminalRuns(systemClock.nowUnixSeconds());
      recoveringStartup = true;
      try {
        await checkpoints.recoverInterrupted(interrupted);
        await subagentScheduler?.initialize();
      } finally {
        recoveringStartup = false;
      }
      scheduler.resume();
      for (const run of startupRecoveredRuns.splice(0)) scheduler.enqueue(run);
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
      modelRegistry.dispose();
      await Promise.all([
        lifecycleSweeps.stop(),
        subagentScheduler?.dispose() ?? Promise.resolve(),
        mcpRuntime.closeAll(),
        workspaceInteractiveSessions.closeAll(),
        browserGateway.closeAll(),
      ]);
      eventHub.clear();
      await lifecycle.dispose();
    },
  };
};
