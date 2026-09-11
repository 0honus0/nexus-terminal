import type { AgentSettingsDocument } from './agent-defaults';
import type {
  WorkspaceRuntimeAvailability,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeCommandView,
  AgentWorkspaceCreateSpec,
  AgentWorkspaceView,
  ToolchainPackUninstallPreview,
  WorkspaceRuntimeCleanupPreview,
  WorkspaceRuntimeSettingsResetPreview,
  WorkspaceRuntimeSetupPreview,
  WorkspaceRuntimeStorageView,
  WorkspaceToolchainSwitchView,
  PluginWorkspaceGrant,
  PluginWorkspaceGrantInput,
} from './workspace-runtime/workspace-runtime.types';
import type {
  WorkspaceArtifactExportInput,
  WorkspaceArtifactImportInput,
  WorkspaceArtifactImportResult,
} from './exchange/workspace-artifact.types';
import type { JsonValue, Scope } from './agent.types';
import type {
  ArtifactAttachResult,
  ArtifactCleanupPreview,
  ArtifactCleanupResult,
  ArtifactLibraryPage,
  ArtifactLibraryQuery,
  ArtifactReadRange,
  ArtifactRef,
  ArtifactStorageSummary,
  UploadReservation,
} from './ai/artifact.port';
import type {
  LedgerEntryKind,
  LedgerEntryView,
  LedgerPage,
  ThreadPage,
  ThreadView,
} from './ai/conversation.repository.port';
import type { ContextPlan, ContextRequest } from './ai/context.types';
import type { LanguageModelPort } from './ai/language-model.port';
import type { IntegrationKind, IntegrationRefreshView, IntegrationView } from './ai/integrations.types';
import type { ProviderTestResult, ProviderView } from './ai/model.types';
import type { MemoryImportConfirmation, MemoryStatus, MemoryView } from './ai/memory.repository.port';
import type { ApprovalView } from './runtime/approvals/approval.repository.port';
import type { CheckpointView } from './runtime/recovery/checkpoint.repository.port';
import type { AgentDefinitionView } from './runtime/definitions/agent-definition.port';
import type { TransientRunEvent } from './runtime/events/event.types';
import type { RunPage } from './runtime/runs/run.repository.port';
import type {
  CreateRunCommand,
  HostEvent,
  RunBudgetIncrease,
  RunEvent,
  RunSnapshot,
  RunView,
  UserInputData,
} from './runtime/runs/run.types';
import type { CapabilityResource, GrantDecision } from './host/app-capability-broker';
import type { AppView, AgentCapability, CapabilityGrant } from './host/app.types';
import type { AppIntentReceipt } from './host/app-intent.repository.port';
import type { AppIntentArtifactReadRange, AppIntentArtifactView } from './host/app-intent-artifact.port';
import type { CreateAppIntentInput } from './host/app-intent.service';
import type { AgentSettingsView, HardLimitPreview } from './host/agent-settings.service';
import type { TargetDenylistSnapshot } from './host/target-denylist.repository.port';
import type { SharedFactView } from './runtime/collaboration/subagent.repository.port';
import type {
  PluginInstallationRecord,
  PluginStageRecord,
  PluginVersionRecord,
  TrustedPublisherKey,
} from './host/plugin-install.repository.port';
import type {
  PluginInstallResult,
  PluginStageInput,
  PluginFrontendDescriptor,
  PluginFrontendRpcRequest,
  PluginUninstallResult,
  PluginUpgradeResult,
} from './host/plugin-install.service';
import type {
  AgentMessage,
  DelegationView,
  JoinResult,
  SubagentSettingsView,
} from './runtime/collaboration/subagent.types';

export interface AgentPluginFacade {
  listPublisherKeys(userId: number): Promise<TrustedPublisherKey[]>;
  trustPublisherKey(userId: number, publicKeyPem: string, label: string): Promise<TrustedPublisherKey>;
  revokePublisherKey(userId: number, keyId: string): Promise<void>;
  stage(userId: number, input: PluginStageInput): Promise<PluginStageRecord>;
  verify(userId: number, stageId: string): Promise<{ stage: PluginStageRecord; plugin: PluginVersionRecord }>;
  install(userId: number, stageId: string): Promise<PluginInstallResult>;
  upgrade(userId: number, appId: string, stageId: string, expectedVersion: number): Promise<PluginUpgradeResult>;
  uninstall(userId: number, appId: string, expectedVersion: number): Promise<PluginUninstallResult>;
  deleteData(userId: number, appId: string): Promise<void>;
  frontendDescriptor(userId: number, appId: string): Promise<PluginFrontendDescriptor | null>;
  frontendRpc(userId: number, appId: string, request: PluginFrontendRpcRequest): Promise<JsonValue>;
  listVersions(userId: number, appId?: string): Promise<PluginVersionRecord[]>;
  listInstallations(userId: number): Promise<PluginInstallationRecord[]>;
}

export interface AgentHostFacade {
  listApps(userId: number): Promise<AppView[]>;
  getApp(userId: number, appId: string): Promise<AppView>;
  setAppEnabled(userId: number, appId: string, enabled: boolean, expectedVersion: number): Promise<AppView>;
  listAppGrants(userId: number, appId: string): Promise<CapabilityGrant[]>;
  replaceAppGrants(
    userId: number,
    appId: string,
    capabilities: readonly AgentCapability[],
    expectedPolicyRevision: number,
  ): Promise<{ app: AppView; grants: CapabilityGrant[] }>;
  createAppIntent(scope: Scope, input: CreateAppIntentInput): Promise<AppIntentReceipt>;
  listReceivedAppIntents(scope: Scope, limit?: number): Promise<AppIntentReceipt[]>;
  revokeAppIntent(scope: Scope, receiptId: string): Promise<void>;
  getReceivedAppIntentArtifact(scope: Scope, receiptId: string, artifactId: string): Promise<AppIntentArtifactView>;
  readReceivedAppIntentArtifact(
    scope: Scope,
    receiptId: string,
    artifactId: string,
    range: AppIntentArtifactReadRange,
  ): Promise<{ artifact: AppIntentArtifactView; source: AsyncIterable<Uint8Array> }>;
  authorize(scope: Scope, capability: AgentCapability, resource?: CapabilityResource): Promise<GrantDecision>;
  getSettings(userId: number): Promise<AgentSettingsView>;
  patchSettings(userId: number, patch: unknown, expectedRevision: number): Promise<AgentSettingsView>;
  previewHardLimits(userId: number, proposed: unknown, expectedRevision: number): Promise<HardLimitPreview>;
  confirmHardLimits(userId: number, confirmationId: string, expectedRevision: number): Promise<AgentSettingsView>;
  getTargetDenylist(): Promise<TargetDenylistSnapshot>;
  replaceTargetDenylist(
    userId: number,
    connectionIds: readonly number[],
    reason: string,
    expectedRevision: number,
  ): Promise<TargetDenylistSnapshot>;
}

export interface AgentIntegrationFacade {
  list(scope: Scope, kind?: IntegrationKind): Promise<IntegrationView[]>;
  get(scope: Scope, integrationId: string): Promise<IntegrationView>;
  create(scope: Scope, input: unknown): Promise<IntegrationView>;
  update(scope: Scope, integrationId: string, expectedVersion: number, input: unknown): Promise<IntegrationView>;
  remove(scope: Scope, integrationId: string, expectedVersion: number): Promise<void>;
  refresh(scope: Scope, integrationId: string, signal?: AbortSignal): Promise<IntegrationRefreshView>;
}

export interface AgentProviderFacade {
  list(userId: number): Promise<ProviderView[]>;
  get(userId: number, providerId: string): Promise<ProviderView>;
  create(userId: number, input: unknown): Promise<ProviderView>;
  update(userId: number, providerId: string, expectedVersion: number, input: unknown): Promise<ProviderView>;
  remove(userId: number, providerId: string, expectedVersion: number): Promise<void>;
  test(userId: number, providerId: string, modelId: string): Promise<ProviderTestResult>;
}

export interface AgentArtifactFacade {
  begin(scope: Scope, input: unknown): Promise<UploadReservation>;
  get(scope: Scope, artifactId: string): Promise<ArtifactRef | null>;
  write(scope: Scope, artifactId: string, source: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<ArtifactRef>;
  read(scope: Scope, artifactId: string, range: ArtifactReadRange): AsyncIterable<Uint8Array>;
  retain(scope: Scope, artifactId: string, retained: boolean, expectedVersion: number): Promise<ArtifactRef>;
  delete(scope: Scope, artifactId: string, expectedVersion: number): Promise<void>;
  listLibrary(userId: number, query: ArtifactLibraryQuery): Promise<ArtifactLibraryPage>;
  storageSummary(userId: number): Promise<ArtifactStorageSummary>;
  cleanupPreview(userId: number): Promise<ArtifactCleanupPreview>;
  cleanupConfirm(userId: number, confirmationId: string): Promise<ArtifactCleanupResult>;
  attach(userId: number, artifactId: string, input: unknown): Promise<ArtifactAttachResult>;
}

export interface AgentConversationFacade {
  createThread(scope: Scope, title?: unknown): Promise<ThreadView>;
  getThread(scope: Scope, threadId: string): Promise<ThreadView>;
  listThreads(scope: Scope, limit?: number, before?: string): Promise<ThreadPage>;
  readPage(scope: Scope, threadId: string, limit?: number, before?: string): Promise<LedgerPage>;
  append(
    scope: Scope,
    threadId: string,
    kind: LedgerEntryKind,
    payload: JsonValue,
    runId?: string,
  ): Promise<LedgerEntryView>;
}

export interface AgentContextFacade {
  compose(input: ContextRequest): Promise<ContextPlan>;
}

export interface AgentMemoryFacade {
  list(scope: Scope, status?: MemoryStatus | 'all', limit?: number): Promise<MemoryView[]>;
  propose(scope: Scope, input: unknown, provenance?: { runId: string; runtimeId: string }): Promise<MemoryView>;
  review(scope: Scope, memoryId: string, input: unknown): Promise<MemoryView>;
  previewImport(scope: Scope, sourceAppId: string, sourceMemoryId: string): Promise<MemoryImportConfirmation>;
  confirmImport(scope: Scope, confirmationId: string): Promise<MemoryView>;
}

export interface AgentCollaborationFacade {
  getSettings(scope: Scope): Promise<SubagentSettingsView>;
  replaceProfiles(scope: Scope, input: unknown, expectedVersion: number): Promise<SubagentSettingsView>;
  createSubagent(
    scope: Scope,
    runId: string,
    parentRuntimeId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<DelegationView>;
  listSubagents(
    scope: Scope,
    runId: string,
    parentRuntimeId?: string,
    limit?: number,
    before?: { createdAt: number; id: string },
  ): Promise<DelegationView[]>;
  cancelSubagent(scope: Scope, runId: string, delegationId: string, expectedVersion: number): Promise<DelegationView>;
  joinSubagents(
    scope: Scope,
    runId: string,
    callerRuntimeId: string,
    delegationIds: readonly string[],
    mode: 'all' | 'any',
    deadlineAt: number,
    signal: AbortSignal,
  ): Promise<JoinResult>;
  sendMessage(
    scope: Scope,
    runId: string,
    senderRuntimeId: string,
    input: unknown,
    idempotencyKey: string,
  ): Promise<{ messageId: string; recipientSequence: number; replayed: boolean }>;
  readMessages(scope: Scope, runId: string, runtimeId: string, after: number, limit: number): Promise<AgentMessage[]>;
  listSubagentMessages(
    scope: Scope,
    runId: string,
    delegationId: string,
    limit: number,
    before?: { createdAt: number; id: string },
  ): Promise<AgentMessage[]>;
  consumeMessages(
    scope: Scope,
    runId: string,
    runtimeId: string,
    through: number,
    expectedConsumedSequence: number,
  ): Promise<number>;
  getFact(scope: Scope, runId: string, key: string): Promise<SharedFactView | null>;
  compareAndSetFact(
    scope: Scope,
    runId: string,
    runtimeId: string,
    key: string,
    value: unknown,
    expectedVersion: number | null,
  ): Promise<SharedFactView>;
}

export interface AgentRunFacade {
  definitions(appId: string): readonly AgentDefinitionView[];
  create(scope: Scope, command: CreateRunCommand): Promise<RunView>;
  get(scope: Scope, runId: string): Promise<RunSnapshot>;
  rootRuntimeId(scope: Scope, runId: string): Promise<string>;
  list(scope: Scope, threadId: string | undefined, limit?: number, before?: string): Promise<RunPage>;
  appendInput(
    scope: Scope,
    runId: string,
    input: UserInputData,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<{ inputId: string; sequence: number; runVersion: number }>;
  increaseBudget(
    scope: Scope,
    runId: string,
    increase: RunBudgetIncrease,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RunView>;
  cancel(scope: Scope, runId: string, expectedVersion: number, idempotencyKey: string): Promise<RunView>;
  listCheckpoints(scope: Scope, runId: string): Promise<CheckpointView[]>;
  saveCheckpoint(scope: Scope, runId: string, expectedVersion: number): Promise<CheckpointView>;
  resume(
    scope: Scope,
    runId: string,
    checkpointId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RunView>;
  delete(scope: Scope, runId: string, expectedVersion: number, idempotencyKey: string): Promise<void>;
}

export interface AgentEventFacade {
  readRun(scope: Scope, runId: string, after: number, limit: number): Promise<RunEvent[]>;
  readHost(userId: number, after: number, limit: number): Promise<HostEvent[]>;
  hostCursor(userId: number): Promise<number>;
  onRunWake(runId: string, listener: (cursor: number) => void): () => void;
  onHostWake(userId: number, listener: (cursor: number) => void): () => void;
  onTransient(runId: string, listener: (event: TransientRunEvent) => void): () => void;
}

export interface AgentWorkspaceRuntimeFacade {
  availability(signal?: AbortSignal): Promise<WorkspaceRuntimeAvailability>;
  catalog(signal?: AbortSignal): Promise<WorkspaceRuntimeCatalog>;
  storage(signal?: AbortSignal): Promise<WorkspaceRuntimeStorageView>;
  listWorkspaces(scope: Scope, runId?: string): Promise<AgentWorkspaceView[]>;
  getWorkspace(scope: Scope, workspaceId: string): Promise<AgentWorkspaceView>;
  workspaceGrants(scope: Scope, workspaceId: string, targetPluginId: string): Promise<PluginWorkspaceGrant[]>;
  replaceWorkspaceGrants(
    scope: Scope,
    workspaceId: string,
    targetPluginId: string,
    grants: readonly PluginWorkspaceGrantInput[],
  ): Promise<PluginWorkspaceGrant[]>;
  exportWorkspaceArtifact(scope: Scope, input: WorkspaceArtifactExportInput, signal: AbortSignal): Promise<ArtifactRef>;
  importArtifactToWorkspace(
    scope: Scope,
    input: WorkspaceArtifactImportInput,
    signal: AbortSignal,
  ): Promise<WorkspaceArtifactImportResult>;
  createWorkspace(
    scope: Scope,
    runId: string,
    agentRuntimeId: string,
    workspace: AgentWorkspaceCreateSpec,
    retained: boolean,
    idempotencyKey: string,
    expectedCatalogRevision?: string,
  ): Promise<AgentWorkspaceView>;
  action(
    scope: Scope,
    workspaceId: string,
    action: 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize',
    expectedVersion: number,
    parameters: JsonValue,
  ): Promise<WorkspaceRuntimeCommandView>;
  switchToolVersions(
    scope: Scope,
    workspaceId: string,
    versions: Record<string, string>,
    expectedVersion: number,
    expectedCatalogRevision?: string,
  ): Promise<WorkspaceToolchainSwitchView>;
  getCommand(scope: Scope, commandId: string): Promise<WorkspaceRuntimeCommandView>;
  previewSetup(userId: number, selections: unknown, expectedVersion: number): Promise<WorkspaceRuntimeSetupPreview>;
  confirmSetup(userId: number, confirmationId: string, expectedVersion: number): Promise<WorkspaceRuntimeCommandView>;
  installPack(userId: number, familyId: string, versionId: string): Promise<WorkspaceRuntimeCommandView>;
  previewPackUninstall(
    userId: number,
    familyId: string,
    versionId: string,
    expectedVersion: number,
  ): Promise<ToolchainPackUninstallPreview>;
  confirmPackUninstall(
    userId: number,
    confirmationId: string,
    expectedVersion: number,
  ): Promise<WorkspaceRuntimeCommandView>;
  previewRuntimeCleanup(userId: number, expectedVersion: number): Promise<WorkspaceRuntimeCleanupPreview>;
  confirmRuntimeCleanup(
    userId: number,
    confirmationId: string,
    expectedVersion: number,
  ): Promise<WorkspaceRuntimeCommandView>;
  previewSettingsReset(userId: number, expectedVersion: number): Promise<WorkspaceRuntimeSettingsResetPreview>;
  confirmSettingsReset(userId: number, confirmationId: string, expectedVersion: number): Promise<AgentSettingsView>;
  adminAction(userId: number, action: string, payload: JsonValue): Promise<WorkspaceRuntimeCommandView>;
}

export interface AgentApprovalFacade {
  get(scope: Scope, approvalId: string): Promise<ApprovalView>;
  list(scope: Scope, runId: string): Promise<ApprovalView[]>;
  resolve(
    scope: Scope,
    approvalId: string,
    decision: 'approved' | 'denied',
    operationHash: string,
    expectedVersion: number,
    actorUserId: number,
    idempotencyKey: string,
  ): Promise<ApprovalView>;
}

export interface AgentServices {
  host: AgentHostFacade;
  plugins: AgentPluginFacade;
  ai: {
    providers: AgentProviderFacade;
    integrations: AgentIntegrationFacade;
    artifacts: AgentArtifactFacade;
    conversations: AgentConversationFacade;
    context: AgentContextFacade;
    memories: AgentMemoryFacade;
    languageModel: LanguageModelPort;
  };
  runtime: {
    runs: AgentRunFacade;
    collaboration: AgentCollaborationFacade;
    events: AgentEventFacade;
    approvals: AgentApprovalFacade;
    workspaceRuntime: AgentWorkspaceRuntimeFacade;
  };
  initialize(): Promise<void>;
  initializeForUser(userId: number): Promise<void>;
  quiesce(deadlineUnixSeconds: number): Promise<void>;
  dispose(): Promise<void>;
}

export type { AgentSettingsDocument, AgentSettingsView, AppView, CapabilityGrant };
