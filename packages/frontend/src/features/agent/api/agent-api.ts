import { agentHttpClient as httpClient, agentRuntimeRequest } from './agent-http-client';
import type {
  AgentArtifactRef,
  AgentEnvelope,
  AgentHardLimits,
  AgentSettingsDocument,
  AgentSettingsView,
} from './agent-api.types';
import { createWorkspaceRuntimeApi } from './workspace-runtime-api';
import type { WorkspaceProfileView } from './workspace-runtime-api';

export type {
  AgentArtifactRef,
  AgentEnvelope,
  AgentHardLimits,
  AgentSettingsDocument,
  AgentSettingsView,
} from './agent-api.types';
export { AgentApiError, formatAgentApiError, toAgentApiError } from './agent-api-error';

export interface RecommendedAgentPluginView {
  appId: string;
  installed: boolean;
  installedVersion: string | null;
  enabled: boolean;
  availableVersion: string;
  displayName: string;
  description: string;
  catalogUrl: string;
  publisherKeyId: string;
}

export interface RecommendedAgentPluginInstallResult {
  app: AgentAppSummary;
  installedNow: boolean;
}

export type AgentContextCompactionMode = 'aggressive' | 'balanced' | 'conservative';

export interface AgentExecutionPolicyOverrides {
  maxRunSteps?: number;
  maxActiveExecutionSeconds?: number;
  toolTimeoutSeconds?: number;
  maxToolOutputBytes?: number;
  maxRecallItems?: number;
  maxRecallBytes?: number;
  maxSubagentMessages?: number;
  maxSubagentMessageBytes?: number;
  contextCompactionMode?: AgentContextCompactionMode;
}

export interface AgentExecutionPolicyView {
  overrides: AgentExecutionPolicyOverrides;
  effective: Required<AgentExecutionPolicyOverrides>;
  version: number;
}

export interface AgentAppSummary {
  id: string;
  displayName: string;
  version: string;
  surface: 'builtin' | 'agent' | 'custom' | 'none';
  defaultApprovalMode: AgentApprovalMode;
  stateVersion: number;
  enabled: boolean;
  health: string;
  healthReason: string | null;
  runningRuns: number;
  pendingApprovals: number;
  pendingBudgetRequests: number;
}

export interface AgentRunEnvironmentSelection {
  recipeId: string;
  versions?: Record<string, string>;
  runnerPluginIds?: string[];
  acpProfileIds?: string[];
  browserTargetId?: string;
  catalogRevision?: string;
}

export type AgentIntegrationKind = 'mcp' | 'acp';
export interface AgentMcpIntegrationConfiguration {
  displayName: string;
  transport: 'streamable-http';
  endpoint: string;
  privateHostExceptions: string[];
  protocolVersion: '2026-07-28';
  trustToolAnnotations?: boolean;
}
export interface AgentAcpIntegrationConfiguration {
  displayName: string;
  transport: 'workspace-profile';
  profileId: string;
  protocolVersion: '1';
}
export interface AgentIntegrationView {
  id: string;
  userId: number;
  appId: string;
  kind: AgentIntegrationKind;
  configuration: AgentMcpIntegrationConfiguration | AgentAcpIntegrationConfiguration;
  hasCredential: boolean;
  credentialRevision: number;
  schemaHash: string | null;
  enabled: boolean;
  refreshState: 'idle' | 'refreshing' | 'ready' | 'error';
  lastErrorCode: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  nextRetryAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentCapabilityGrant {
  capability: string;
  schemaVersion: number;
  scope: unknown;
  grantedAt: number;
}

export interface AgentAppGrantView {
  app: AgentAppSummary;
  policyRevision: number;
  declaredCapabilities: string[];
  grants: AgentCapabilityGrant[];
}

export interface PluginFrontendDescriptor {
  appId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 1;
  url: string;
  sandbox: 'allow-scripts';
  maxMessageBytes: 256_000;
  requestTimeoutMs: 15_000;
}

export type {
  AgentWorkspaceView,
  PluginRunnerTargetView,
  ToolchainCatalogPack,
  ToolchainPackRef,
  ToolchainPackUninstallPreview,
  WorkspaceArtifactImportResult,
  WorkspaceProfileView,
  WorkspaceRecipe,
  WorkspaceRuntimeAvailability,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeCleanupPreview,
  WorkspaceRuntimeCommandView,
  WorkspaceRuntimeSettingsResetPreview,
  WorkspaceRuntimeSetupPreview,
  WorkspaceRuntimeStorageView,
  WorkspaceToolchainSwitchView,
} from './workspace-runtime-api';

export interface PluginPublisherKey {
  userId: number;
  keyId: string;
  label: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface PluginInstallation {
  userId: number;
  appId: string;
  version: string;
  status: 'installed' | 'removed';
  retainedDataEntries: number;
  retainedDataBytes: number;
  createdAt: number;
  updatedAt: number;
}

export interface PluginManifestView {
  schemaVersion: 1;
  id: string;
  version: string;
  displayName: string;
  sdkVersion: string;
  capabilities: string[];
  intents: Array<{ id: string; schemaVersion: number }>;
  agents?: Array<{
    id: string;
    version: string;
    displayName: string;
    description: string;
    requiredModelCapabilities: AgentModelCapability[];
  }>;
  targets?: {
    frontend?: { entry: string };
    backend?: { entry: string };
    runner?: { entry: string };
  };
}

export interface PluginVersionView {
  appId: string;
  version: string;
  packageHash: string;
  publisherKeyId: string;
  manifest: PluginManifestView;
  frontendEntry: string | null;
  backendEntry: string | null;
  runnerEntry: string | null;
  skillFiles: string[];
  status: 'verified' | 'installed' | 'failed' | 'removed';
  installedAt: number | null;
  updatedAt: number;
}

export interface RemotePluginPublisher {
  keyId: string;
  label: string;
  publicKeyPem: string;
}

export interface RemotePluginPackageEntry {
  appId: string;
  version: string;
  sdkVersion: string;
  nexus: { minVersion: string; maxVersion: string };
  compatible: boolean;
  displayName: string;
  description: string;
  packageUrl: string;
  sha256: string;
  sizeBytes: number;
  publisherKeyId: string;
}

export interface RemotePluginCatalog {
  schemaVersion: 1;
  repositoryUrl: string;
  publishers: RemotePluginPublisher[];
  packages: RemotePluginPackageEntry[];
}

export interface PluginStageView {
  id: string;
  packageHash: string;
  sizeBytes: number;
  publisherKeyId: string | null;
  appId: string | null;
  version: string | null;
  manifest: PluginManifestView | null;
  status: 'staged' | 'verified' | 'failed' | 'installed';
  errorCode: string | null;
  versionNumber: number;
}

export interface PluginVerifyResult {
  stage: PluginStageView;
  plugin: PluginVersionView;
}

export interface PluginAppStateView {
  userId: number;
  appId: string;
  activeVersion: string;
  desiredState: 'enabled' | 'disabled';
  observedState: string;
  healthReason: string | null;
  policyRevision: number;
  runningCount: number;
  approvalCount: number;
  budgetRequestCount: number;
  acceptNewRuns: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
  displayName: string;
  capabilities: string[];
}

export interface PluginUpgradeResult {
  state: 'draining' | 'completed';
  targetVersion: string;
  app: PluginAppStateView;
  plugin: PluginVersionView;
}

export interface PluginUninstallResult {
  state: 'draining' | 'removed';
  app: PluginAppStateView;
}

export type AgentReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AgentModelCapability = 'tools' | 'image_input' | 'file_input' | 'reasoning';

export interface ModelReasoningDefaults {
  supportedEfforts: AgentReasoningEffort[];
  defaultEffort?: AgentReasoningEffort;
  mandatory?: boolean;
}

export interface ModelCapabilityDefaults {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsImageInput?: boolean;
  supportsFileInput?: boolean;
  supportsPromptCacheKey?: boolean;
  reasoning?: ModelReasoningDefaults;
}

export interface ModelCapabilityOverrides {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsImageInput?: boolean;
  supportsFileInput?: boolean;
  supportsPromptCacheKey?: boolean;
  reasoning?: ModelReasoningDefaults;
}

export interface ProviderModelCapabilityObservation {
  modelId: string;
  source: string;
  sourceVersion: string;
  capabilities: ModelCapabilityDefaults;
  updatedAt: number;
}

export interface ProviderModel {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsPromptCacheKey?: boolean;
  capabilitySources: {
    contextWindow: 'registry' | 'provider' | 'manual';
    maxOutputTokens: 'registry' | 'provider' | 'manual';
    supportsTools: 'registry' | 'provider' | 'manual';
    supportsImageInput?: 'registry' | 'provider' | 'manual';
    supportsFileInput?: 'registry' | 'provider' | 'manual';
    supportsPromptCacheKey?: 'registry' | 'provider' | 'manual';
    reasoning?: 'registry' | 'provider' | 'manual';
  };
  registryDefaults?: ModelCapabilityDefaults;
  providerCapabilities?: ProviderModelCapabilityObservation;
  capabilityConflicts?: Array<
    | 'contextWindow'
    | 'maxOutputTokens'
    | 'supportsTools'
    | 'supportsImageInput'
    | 'supportsFileInput'
    | 'supportsPromptCacheKey'
    | 'reasoning'
  >;
  capabilityOverrides?: ModelCapabilityOverrides;
  reasoningEfforts?: AgentReasoningEffort[];
  defaultReasoningEffort?: AgentReasoningEffort;
  reasoningSource?: 'provider' | 'registry' | 'manual';
  reasoningMandatory?: boolean;
}

export interface AgentDiscoveredProviderModel {
  id: string;
  ownedBy?: string;
  createdAt?: number;
  registryDefaults?: ModelCapabilityDefaults;
  providerCapabilities?: ProviderModelCapabilityObservation;
}

export interface AgentProviderView {
  id: string;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: 'chat-completions' | 'responses';
  hasCredential: boolean;
  credentialRevision: number;
  models: ProviderModel[];
  enabled: boolean;
  version: number;
}

export interface ArtifactStorageSummary {
  totalBytes: number;
  retainedBytes: number;
  protectedBytes: number;
  reclaimableBytes: number;
  stagingBytes: number;
  unavailableBytes: number;
  reservedBytes: number;
  limitBytes: number;
}

export interface AgentArtifactPage {
  items: AgentArtifactRef[];
  nextCursor: string | null;
}

export interface ArtifactCleanupPreview {
  confirmationId: string;
  expiresAt: number;
  selectedCount: number;
  selectedBytes: number;
  protectedCount: number;
  byApp: Array<{ appId: string; count: number; bytes: number }>;
}

export interface ArtifactCleanupResult {
  deletedCount: number;
  deletedBytes: number;
  skippedCount: number;
  failedCount: number;
  partial: boolean;
}

export interface HardLimitPreview {
  confirmationId: string;
  expectedVersion: number;
  current: AgentHardLimits;
  proposed: AgentHardLimits;
  impact: {
    changes: Array<{
      key: keyof AgentHardLimits;
      current: number | null;
      proposed: number | null;
      direction: 'increase' | 'decrease';
    }>;
    hasIncrease: boolean;
    hasDecrease: boolean;
    usage: {
      artifactUsedBytes: number;
      artifactReservedBytes: number;
      executingRuntimes: number;
      activeWorkspaces: number;
    };
  };
  runtimeCapabilities: { workspaceRuntimeController: boolean };
  expiresAt: number;
}

export interface HostSummaryView {
  featureEnabled: boolean;
  hostState: 'enabled' | 'disabling' | 'disabled' | string;
  apps: AgentAppSummary[];
  totalRunningRuns: number;
  totalPendingApprovals: number;
  totalPendingBudgetRequests: number;
  eventCursor: number;
}

export interface AgentThreadView {
  id: string;
  appId: string;
  title: string;
  titleSource: 'placeholder' | 'auto' | 'manual';
  version: number;
  createdAt: number;
  updatedAt: number;
  latestRunId: string | null;
}

export interface AgentThreadPage {
  items: AgentThreadView[];
  nextCursor: string | null;
}

export interface AgentThreadDeleteResult {
  threadId: string;
  deleted: true;
}

export interface AgentThreadDeleteAllResult {
  deletedCount: number;
}

export interface AgentLedgerEntry {
  id: string;
  threadId: string;
  runId: string | null;
  sequence: number;
  kind: 'user_input' | 'assistant_message' | 'tool_result' | 'system_notice';
  payload: unknown;
  createdAt: number;
}

export interface AgentLedgerPage {
  items: AgentLedgerEntry[];
  nextCursor: string | null;
}

export type AgentRunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_budget'
  | 'awaiting_input'
  | 'cancelling'
  | 'completed'
  | 'completed_unverified'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentApprovalMode = 'ask' | 'full_access';
export type AgentExecutionMode = 'execute' | 'plan';
export type AgentToolRisk = 'read' | 'control' | 'mutate' | 'destructive' | 'forbidden';

export type AgentPlanItemStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface AgentPlanItem {
  id: string;
  title: string;
  detail: string | null;
  status: AgentPlanItemStatus;
  dependsOn: string[];
  evidenceRefs: string[];
}

export interface AgentRunPlan {
  schemaVersion: 1;
  revision: number;
  items: AgentPlanItem[];
}

export interface AgentRunTerminalIssue {
  eventType: string;
  errorCode: string | null;
  reason: string | null;
  occurredAt: number;
}

export interface AgentUserInputChoice {
  value: string;
  label: string;
  description?: string;
}

export interface AgentUserInputQuestion {
  id: string;
  prompt: string;
  kind: 'text' | 'choice';
  choices?: AgentUserInputChoice[];
  recommendedChoice?: string;
  context?: string;
}

export interface AgentPendingUserInputRequest {
  id: string;
  runtimeId: string;
  questions: AgentUserInputQuestion[];
  requestedAt: number;
}

export interface AgentRunView {
  id: string;
  userId: number;
  appId: string;
  threadId: string;
  parentRunId: string | null;
  status: AgentRunStatus;
  terminalIssue?: AgentRunTerminalIssue | null;
  goalStatus: string;
  goal: { text: string | null; revision: number; updatedAt: number | null };
  verificationStatus: string;
  needsReconciliation: boolean;
  budget: {
    maxContextTokens: number;
    maxOutputTokens: number;
    maxRunSteps: number;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
    maxRecallItems: number;
    maxRecallBytes: number;
    maxSubagentMessages: number;
    maxSubagentMessageBytes: number;
    contextCompactionMode?: AgentContextCompactionMode;
    revision: number;
  };
  definition: {
    schemaVersion: 1;
    agentDefinitionId: string;
    model: {
      providerId: string;
      modelId: string;
      configurationVersion: number;
    };
    reasoningEffort?: AgentReasoningEffort;
    approvalMode?: AgentApprovalMode;
    executionMode?: AgentExecutionMode;
    connectionIds: number[];
    environment?: WorkspaceProfileView | null;
    policyRevision: number;
    settingsRevision: number;
    contextBoundary?: {
      baseThrough: number;
      runThrough: Record<string, number>;
    };
  };
  plan: AgentRunPlan;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    steps: number;
    subagentMessages: number;
    subagentMessageBytes: number;
    context?: {
      inputTokens: number;
      heuristicInputTokens?: number;
      reservedOutputTokens: number;
      contextWindowTokens: number;
      source: 'estimated' | 'anchored_estimate' | 'provider';
      model?: {
        providerId: string;
        modelId: string;
        configurationVersion: number;
      };
      contextEpoch?: string;
      updatedAt: number;
    };
  };
  activeExecutionSeconds: number;
  consumedInputSequence: number;
  inputRevision: number;
  eventCursor: number;
  version: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface AgentRunReconciliationResource {
  resourceKey: string;
  toolCallId: string | null;
  reason: string;
  version: number;
  createdAt: number;
}

export interface AgentRunReconciliationView {
  runId: string;
  required: boolean;
  resources: AgentRunReconciliationResource[];
}

export interface AgentPendingRunInput {
  id: string;
  sequence: number;
  text: string;
  artifactRefs: string[];
  createdAt: number;
}

export interface AgentPendingRunInputPage {
  items: AgentPendingRunInput[];
  total: number;
  hasMore: boolean;
}

export interface AgentCheckpointView {
  id: string;
  runId: string;
  kind: 'user' | 'recovery';
  schemaVersion: 1;
  ledgerThrough: number;
  eventThrough: number;
  snapshot: {
    schemaVersion: 1;
    runId: string;
    ledgerThrough: number;
    planVersion: number;
    inputRevision?: number;
    settingsRevision?: number;
    plan: AgentRunPlan;
    goal?: { text: string | null; revision: number; updatedAt: number | null };
    completedStepIds: string[];
    evidenceRefs: string[];
    checkpointArtifactRefs?: string[];
    modelConfigurationVersion: number;
    activeModel?: {
      providerId: string;
      modelId: string;
      configurationVersion: number;
    };
    definitionVersion: string;
    policyRevision: number;
    workspaceArtifactManifestRefs: string[];
    workspaceArtifactRefs?: string[];
    recoveryManifest?: {
      schemaVersion: 1;
      eventThrough: number;
      contextBoundary: {
        baseThrough: number;
        runThrough: Record<string, number>;
      };
      tools: Array<{
        toolCallId: string;
        operationHash: string;
        risk: AgentToolRisk;
        status: string;
        sideEffectStatus: 'not_started' | 'confirmed' | 'unknown';
        verificationStatus: 'not_started' | 'verified' | 'unverified' | 'failed';
        quarantinedResourceKeys: string[];
      }>;
      delegations: Array<{ delegationId: string; status: string }>;
      backgroundJobs: Array<{
        jobId: string;
        workspaceId: string;
        generation: number;
        status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
      }>;
      quarantinedResourceKeys: string[];
    };
  };
  createdAt: number;
}

export interface AgentRunSnapshot extends AgentRunView {
  pendingInputRequest: AgentPendingUserInputRequest | null;
  recentEntries: Array<{
    id: string;
    sequence: number;
    kind: string;
    payload: unknown;
    createdAt: number;
  }>;
}

export interface AgentRunPage {
  items: AgentRunView[];
  nextCursor: string | null;
}

export interface AgentSubagentView {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  parentRuntimeId: string;
  childRuntimeId: string;
  profileId: string;
  capabilities: string[];
  peerMessaging: 'parent-child' | 'same-run';
  mutationMode: 'read-only' | 'governed';
  modelRef: {
    providerId: string;
    modelId: string;
    configurationVersion: number;
  };
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  completionCriteria: string[];
  dependencyMode: 'success' | 'settled';
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  depth: number;
  failureMode: 'isolate' | 'failFast';
  budget: { maxSteps: number };
  usage: { tokens: number; steps: number };
  result: unknown;
  evidenceRefs: string[];
  deadlineAt: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface AgentSubagentMessage {
  id: string;
  runId: string;
  senderRuntimeId: string;
  recipientRuntimeId: string;
  delegationId: string;
  recipientSequence: number;
  kind: 'request' | 'reply' | 'progress' | 'evidence' | 'completion';
  correlationId: string;
  replyTo: string | null;
  causationId: string | null;
  taskRevision: number;
  body: unknown;
  artifactRefs: string[];
  status: 'accepted' | 'delivered' | 'consumed' | 'expired' | 'rejected';
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface AgentSubagentProfile {
  id: string;
  role: string;
  defaultModel: {
    providerId: string;
    modelId: string;
    configurationVersion: number;
  } | null;
  allowedModels: Array<{
    providerId: string;
    modelId: string;
    configurationVersion: number;
  }>;
  capabilities: string[];
  peerMessaging: 'parent-child' | 'same-run';
  mutationMode: 'read-only' | 'governed';
  maxSteps: number;
  failureMode: 'isolate' | 'failFast';
}

export interface AgentSubagentProfileTemplate {
  id: 'explore' | 'scout' | 'review' | 'general' | 'worker';
  role: string;
  delegationHint: string;
  capabilities: string[];
  peerMessaging: 'parent-child' | 'same-run';
  mutationMode: 'read-only' | 'governed';
  maxSteps: number;
  failureMode: 'isolate' | 'failFast';
}

export interface AgentSubagentSettingsView {
  policy: {
    maxDelegationDepth: number;
    maxMessagesPerRun: number;
    maxMessageBytesPerRun: number;
    profiles: AgentSubagentProfile[];
  };
  templates: AgentSubagentProfileTemplate[];
  version: number;
}

export interface AgentSubagentPage {
  items: AgentSubagentView[];
  nextCursor: string | null;
}

export interface AgentSubagentMessagePage {
  items: AgentSubagentMessage[];
  nextCursor: string | null;
}

export interface AgentToolInspection {
  toolName: string;
  toolVersion: string;
  normalizedArguments: unknown;
  target: {
    connectionId: number;
    targetIdentity: string;
    endpoint: string;
    loginUser: string;
    configurationHash: string;
    hostKeyTrust: string;
  };
  resourceKeys: string[];
  risk: AgentToolRisk;
  mutation: boolean;
  operationHash: string;
  operationHashVersion: 1;
  preconditions: Array<{ kind: string; key: string; observedValue: unknown }>;
  secretRefs: Array<{ id: string; version: number }>;
  policyRevision: number;
  inputRevision: number;
}

export interface AgentServerClockAnchor {
  serverUnixMilliseconds: number;
  clientMonotonicMilliseconds: number;
}

export interface AgentApprovalBatch {
  items: AgentApprovalView[];
  clock: AgentServerClockAnchor;
}

export interface AgentApprovalView {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  toolCallId: string;
  requestedByRuntimeId: string;
  operationHash: string;
  operationHashVersion: 1;
  kind: 'tool' | 'acp_permission';
  status: 'requested' | 'approved' | 'denied' | 'expired' | 'superseded';
  policyRevision: number;
  inputRevision: number;
  decidedByUserId: number | null;
  decidedAt: number | null;
  consumedAt: number | null;
  requestedAt: number;
  expiresAt: number;
  version: number;
  inspection: AgentToolInspection;
}

export interface AgentDefinitionModelCompatibility {
  providerId: string;
  modelId: string;
  configurationVersion: number;
  compatible: boolean;
  missingCapabilities: AgentModelCapability[];
}

export interface AgentDefinitionView {
  id: string;
  version: string;
  displayName: string;
  description: string;
  requiredModelCapabilities: AgentModelCapability[];
  modelCompatibility: AgentDefinitionModelCompatibility[];
}

export interface TargetDenylistEntry {
  connectionId: number;
  reason: string;
  changedBy: number;
  changedAt: number;
}

export interface TargetDenylistView {
  revision: number;
  list: TargetDenylistEntry[];
}

let csrfToken: string | null = null;

const unwrap = <T>(envelope: AgentEnvelope<T>): T => envelope.data;

const csrf = async (): Promise<string> => {
  if (csrfToken) return csrfToken;
  const response = await httpClient.get<AgentEnvelope<{ token: string }>>('/agent/security/csrf');
  csrfToken = response.data.data.token;
  return csrfToken;
};

const mutationHeaders = async (): Promise<Record<string, string>> => ({
  'X-Nexus-CSRF': await csrf(),
});

export const resetAgentCsrf = (): void => {
  csrfToken = null;
};

export const agentApi = {
  async recommendedPlugin(): Promise<RecommendedAgentPluginView> {
    return unwrap(
      (await httpClient.get<AgentEnvelope<RecommendedAgentPluginView>>('/agent/onboarding/recommended-plugin')).data,
    );
  },
  async installRecommendedPlugin(): Promise<RecommendedAgentPluginInstallResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<RecommendedAgentPluginInstallResult>>(
          '/agent/onboarding/recommended-plugin/install',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async settings(): Promise<AgentSettingsView> {
    return unwrap((await httpClient.get<AgentEnvelope<AgentSettingsView>>('/agent/settings')).data);
  },
  async patchSettings(patch: Record<string, unknown>, expectedVersion: number): Promise<AgentSettingsView> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentSettingsView>>(
          '/agent/settings',
          { patch, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewHardLimits(proposed: Partial<AgentHardLimits>, expectedVersion: number): Promise<HardLimitPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<HardLimitPreview>>(
          '/agent/settings/hard-limits/preview',
          { proposed, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmHardLimits(confirmationId: string, expectedVersion: number): Promise<AgentSettingsView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentSettingsView>>(
          '/agent/settings/hard-limits/confirm',
          { confirmationId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async apps(): Promise<AgentAppSummary[]> {
    return unwrap((await httpClient.get<AgentEnvelope<AgentAppSummary[]>>('/agent/apps')).data);
  },
  async setAppEnabled(app: AgentAppSummary, enabled: boolean): Promise<AgentAppSummary> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentAppSummary>>(
          `/agent/apps/${encodeURIComponent(app.id)}`,
          { enabled, expectedVersion: app.stateVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async appExecutionPolicy(appId: string): Promise<AgentExecutionPolicyView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentExecutionPolicyView>>(
          `/agent/apps/${encodeURIComponent(appId)}/execution-policy`,
        )
      ).data,
    );
  },
  async replaceAppExecutionPolicy(
    appId: string,
    overrides: AgentExecutionPolicyOverrides,
    expectedVersion: number,
  ): Promise<AgentExecutionPolicyView> {
    return unwrap(
      (
        await httpClient.put<AgentEnvelope<AgentExecutionPolicyView>>(
          `/agent/apps/${encodeURIComponent(appId)}/execution-policy`,
          { overrides, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async appGrants(appId: string): Promise<AgentAppGrantView> {
    return unwrap(
      (await httpClient.get<AgentEnvelope<AgentAppGrantView>>(`/agent/apps/${encodeURIComponent(appId)}/grants`)).data,
    );
  },
  async replaceAppGrants(
    appId: string,
    capabilities: string[],
    expectedPolicyRevision: number,
  ): Promise<AgentAppGrantView> {
    return unwrap(
      (
        await httpClient.put<AgentEnvelope<AgentAppGrantView>>(
          `/agent/apps/${encodeURIComponent(appId)}/grants`,
          { capabilities, expectedPolicyRevision },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async pluginPublishers(): Promise<PluginPublisherKey[]> {
    return unwrap((await httpClient.get<AgentEnvelope<PluginPublisherKey[]>>('/agent/plugins/publishers')).data);
  },
  async trustPluginPublisher(publicKeyPem: string, label: string): Promise<PluginPublisherKey> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginPublisherKey>>(
          '/agent/plugins/publishers',
          { publicKeyPem, label },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async revokePluginPublisher(keyId: string): Promise<void> {
    await httpClient.delete(`/agent/plugins/publishers/${encodeURIComponent(keyId)}`, {
      headers: await mutationHeaders(),
    });
  },
  async pluginInstallations(): Promise<PluginInstallation[]> {
    return unwrap((await httpClient.get<AgentEnvelope<PluginInstallation[]>>('/agent/plugins/installations')).data);
  },
  async pluginVersions(appId?: string): Promise<PluginVersionView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<PluginVersionView[]>>('/agent/plugins/versions', {
          params: appId ? { appId } : undefined,
        })
      ).data,
    );
  },
  async officialPluginCatalog(): Promise<RemotePluginCatalog> {
    return unwrap((await httpClient.get<AgentEnvelope<RemotePluginCatalog>>('/agent/plugins/official/catalog')).data);
  },
  async stageOfficialPlugin(appId: string, version: string): Promise<PluginStageView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginStageView>>(
          '/agent/plugins/official/stage',
          { appId, version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async remotePluginCatalog(repositoryUrl: string): Promise<RemotePluginCatalog> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<RemotePluginCatalog>>('/agent/plugins/remote/catalog', {
          params: { repositoryUrl },
        })
      ).data,
    );
  },
  async stageRemotePlugin(repositoryUrl: string, appId: string, version: string): Promise<PluginStageView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginStageView>>(
          '/agent/plugins/remote/stage',
          { repositoryUrl, appId, version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async stagePlugin(artifact: AgentArtifactRef): Promise<PluginStageView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginStageView>>(
          '/agent/plugins/stage',
          { artifactRef: { appId: artifact.appId, id: artifact.id } },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async verifyPlugin(stageId: string): Promise<PluginVerifyResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginVerifyResult>>(
          '/agent/plugins/verify',
          { stageId },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async installPlugin(stageId: string): Promise<{
    stage: PluginStageView;
    plugin: PluginVersionView;
    app: PluginAppStateView;
  }> {
    return unwrap(
      (
        await httpClient.post<
          AgentEnvelope<{
            stage: PluginStageView;
            plugin: PluginVersionView;
            app: PluginAppStateView;
          }>
        >('/agent/plugins/install', { stageId }, { headers: await mutationHeaders() })
      ).data,
    );
  },
  async upgradePlugin(appId: string, stageId: string, expectedVersion: number): Promise<PluginUpgradeResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginUpgradeResult>>(
          `/agent/plugins/${encodeURIComponent(appId)}/upgrade`,
          { stageId, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async uninstallPlugin(appId: string, expectedVersion: number): Promise<PluginUninstallResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<PluginUninstallResult>>(
          `/agent/plugins/${encodeURIComponent(appId)}/uninstall`,
          { deleteData: false, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deletePluginData(appId: string, confirmed: true): Promise<void> {
    await httpClient.post(
      `/agent/plugins/${encodeURIComponent(appId)}/delete-data`,
      { confirmed },
      { headers: await mutationHeaders() },
    );
  },
  async pluginFrontend(appId: string): Promise<PluginFrontendDescriptor> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<PluginFrontendDescriptor>>(
          `/agent/plugins/${encodeURIComponent(appId)}/frontend`,
        )
      ).data,
    );
  },
  async pluginFrontendRpc(
    appId: string,
    method: 'host.appInfo' | 'storage.get' | 'storage.put' | 'storage.delete',
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<unknown>>(
          `/agent/plugins/${encodeURIComponent(appId)}/frontend/rpc`,
          { method, params },
          { headers: await mutationHeaders(), signal },
        )
      ).data,
    );
  },
  async providers(): Promise<AgentProviderView[]> {
    return unwrap((await httpClient.get<AgentEnvelope<AgentProviderView[]>>('/agent/ai/providers')).data);
  },
  async createProvider(input: Record<string, unknown>): Promise<AgentProviderView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentProviderView>>('/agent/ai/providers', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async updateProvider(provider: AgentProviderView, input: Record<string, unknown>): Promise<AgentProviderView> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentProviderView>>(
          `/agent/ai/providers/${encodeURIComponent(provider.id)}`,
          { ...input, expectedVersion: provider.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async discoverProviderModels(providerId: string): Promise<AgentDiscoveredProviderModel[]> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentDiscoveredProviderModel[]>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}/discover-models`,
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteProvider(providerId: string, expectedVersion: number): Promise<{ deleted: boolean }> {
    return unwrap(
      (
        await httpClient.delete<AgentEnvelope<{ deleted: boolean }>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}?expectedVersion=${encodeURIComponent(expectedVersion)}`,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async testProvider(providerId: string, modelId: string): Promise<{ ok: boolean; latencyMs: number }> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<{ ok: boolean; latencyMs: number }>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}/test`,
          { modelId },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async storage(): Promise<ArtifactStorageSummary> {
    return unwrap((await httpClient.get<AgentEnvelope<ArtifactStorageSummary>>('/agent/files/storage')).data);
  },
  async files(
    query: {
      before?: string;
      q?: string;
      appId?: string;
      retained?: boolean;
      kind?: 'image' | 'document' | 'code' | 'archive' | 'media' | 'other';
    } = {},
  ): Promise<AgentArtifactPage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentArtifactPage>>('/agent/files', {
          params: { limit: 100, ...query },
        })
      ).data,
    );
  },
  async uploadArtifact(appId: string, file: File): Promise<AgentArtifactRef> {
    const reservation = unwrap(
      (
        await httpClient.post<
          AgentEnvelope<{
            artifactId: string;
            uploadUrl: string;
            expiresAt: number;
          }>
        >(
          `/apps/${encodeURIComponent(appId)}/artifacts`,
          {
            name: file.name,
            mediaType: file.type || 'application/octet-stream',
            declaredBytes: file.size,
          },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
    const uploadPath = reservation.uploadUrl.replace(/^\/api\/v1/, '');
    await httpClient.put(uploadPath, file, {
      headers: {
        ...(await mutationHeaders()),
        'Content-Type': file.type || 'application/octet-stream',
      },
      timeout: 120_000,
    });
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentArtifactRef>>(
          `/apps/${encodeURIComponent(appId)}/artifacts/${encodeURIComponent(reservation.artifactId)}`,
        )
      ).data,
    );
  },
  async retainArtifact(artifact: AgentArtifactRef, retained: boolean): Promise<AgentArtifactRef> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentArtifactRef>>(
          `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
          { retained, expectedVersion: artifact.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteArtifact(artifact: AgentArtifactRef): Promise<void> {
    await httpClient.delete(
      `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
      {
        params: { expectedVersion: artifact.version },
        headers: await mutationHeaders(),
      },
    );
  },
  async previewArtifactCleanup(): Promise<ArtifactCleanupPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<ArtifactCleanupPreview>>(
          '/agent/files/cleanup/preview',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmArtifactCleanup(confirmationId: string): Promise<ArtifactCleanupResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<ArtifactCleanupResult>>(
          '/agent/files/cleanup/confirm',
          { confirmationId },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async attachArtifact(
    artifact: AgentArtifactRef,
    input: { targetAppId: string; threadId: string; runId?: string },
  ): Promise<{ artifact: AgentArtifactRef; crossApp: boolean }> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<{ artifact: AgentArtifactRef; crossApp: boolean }>>(
          `/agent/files/${encodeURIComponent(artifact.id)}/attach`,
          {
            targetAppId: input.targetAppId,
            threadId: input.threadId,
            ...(input.runId ? { runId: input.runId } : {}),
            role: 'input',
            expectedVersion: artifact.version,
          },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  ...createWorkspaceRuntimeApi(mutationHeaders),
  async integrations(appId: string, kind?: AgentIntegrationKind): Promise<AgentIntegrationView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentIntegrationView[]>>(`/apps/${encodeURIComponent(appId)}/integrations`, {
          params: kind ? { kind } : undefined,
        })
      ).data,
    );
  },
  async createIntegration(appId: string, input: Record<string, unknown>): Promise<AgentIntegrationView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentIntegrationView>>(
          `/apps/${encodeURIComponent(appId)}/integrations`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async updateIntegration(
    appId: string,
    integration: AgentIntegrationView,
    input: Record<string, unknown>,
  ): Promise<AgentIntegrationView> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentIntegrationView>>(
          `/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integration.id)}`,
          { ...input, expectedVersion: integration.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteIntegration(appId: string, integration: AgentIntegrationView): Promise<void> {
    await httpClient.delete(`/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integration.id)}`, {
      params: { expectedVersion: integration.version },
      headers: await mutationHeaders(),
    });
  },
  async refreshIntegration(appId: string, integrationId: string): Promise<unknown> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<unknown>>(
          `/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integrationId)}/refresh`,
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async targetDenylist(): Promise<TargetDenylistView> {
    return unwrap((await httpClient.get<AgentEnvelope<TargetDenylistView>>('/agent/target-denylist')).data);
  },
  async replaceTargetDenylist(
    connectionIds: number[],
    reason: string,
    expectedRevision: number,
  ): Promise<TargetDenylistView> {
    return unwrap(
      (
        await httpClient.put<AgentEnvelope<TargetDenylistView>>(
          '/agent/target-denylist',
          { connectionIds, reason, expectedRevision },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async summary(): Promise<HostSummaryView> {
    return unwrap((await httpClient.get<AgentEnvelope<HostSummaryView>>('/agent/summary')).data);
  },
  async threads(appId: string, before?: string, limit = 50): Promise<AgentThreadPage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentThreadPage>>(`/apps/${encodeURIComponent(appId)}/threads`, {
          params: { limit, ...(before ? { before } : {}) },
        })
      ).data,
    );
  },
  async createThread(appId: string, title?: string): Promise<AgentThreadView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentThreadView>>(
          `/apps/${encodeURIComponent(appId)}/threads`,
          title ? { title } : {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async renameThread(
    appId: string,
    threadId: string,
    title: string,
    expectedVersion: number,
  ): Promise<AgentThreadView> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentThreadView>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(threadId)}`,
          { title, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteThread(appId: string, thread: AgentThreadView): Promise<AgentThreadDeleteResult> {
    return unwrap(
      (
        await httpClient.delete<AgentEnvelope<AgentThreadDeleteResult>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(thread.id)}`,
          {
            headers: await mutationHeaders(),
            data: { expectedVersion: thread.version },
          },
        )
      ).data,
    );
  },
  async deleteAllThreads(appId: string): Promise<AgentThreadDeleteAllResult> {
    return unwrap(
      (
        await httpClient.delete<AgentEnvelope<AgentThreadDeleteAllResult>>(
          `/apps/${encodeURIComponent(appId)}/threads`,
          {
            headers: await mutationHeaders(),
            data: { confirmation: 'delete_all_threads' },
          },
        )
      ).data,
    );
  },
  async ledger(appId: string, threadId: string, before?: string): Promise<AgentLedgerPage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentLedgerPage>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(threadId)}/entries`,
          { params: { limit: 50, ...(before ? { before } : {}) } },
        )
      ).data,
    );
  },
  async definitions(appId: string): Promise<AgentDefinitionView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentDefinitionView[]>>(
          `/apps/${encodeURIComponent(appId)}/agent-definitions`,
        )
      ).data,
    );
  },
  async runs(appId: string, threadId?: string): Promise<AgentRunPage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentRunPage>>(`/apps/${encodeURIComponent(appId)}/runs`, {
          params: { limit: 50, ...(threadId ? { threadId } : {}) },
        })
      ).data,
    );
  },
  async run(appId: string, runId: string): Promise<AgentRunSnapshot> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentRunSnapshot>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}`,
        )
      ).data,
    );
  },
  async runReconciliation(appId: string, runId: string): Promise<AgentRunReconciliationView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentRunReconciliationView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/reconciliation`,
        )
      ).data,
    );
  },
  async resolveRunReconciliation(
    appId: string,
    run: AgentRunView,
    reconciliation: AgentRunReconciliationView,
    note: string,
  ): Promise<AgentRunView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/reconciliation/resolve`,
          agentRuntimeRequest({
            expectedVersion: run.version,
            note,
            resources: reconciliation.resources.map(({ resourceKey, version }) => ({ resourceKey, version })),
          }),
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagentSettings(appId: string): Promise<AgentSubagentSettingsView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentSubagentSettingsView>>(
          `/apps/${encodeURIComponent(appId)}/subagent-settings`,
        )
      ).data,
    );
  },
  async replaceSubagentProfiles(
    appId: string,
    profiles: AgentSubagentProfile[],
    expectedVersion: number,
  ): Promise<AgentSubagentSettingsView> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentSubagentSettingsView>>(
          `/apps/${encodeURIComponent(appId)}/subagent-settings`,
          { profiles, expectedVersion },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagents(appId: string, runId: string, before?: string): Promise<AgentSubagentPage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentSubagentPage>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents`,
          { params: { limit: 50, ...(before ? { before } : {}) } },
        )
      ).data,
    );
  },
  async cancelSubagent(appId: string, runId: string, delegation: AgentSubagentView): Promise<AgentSubagentView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentSubagentView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(delegation.id)}/cancel`,
          { expectedVersion: delegation.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagentMessages(
    appId: string,
    runId: string,
    delegationId: string,
    before?: string,
  ): Promise<AgentSubagentMessagePage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentSubagentMessagePage>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(delegationId)}/messages`,
          { params: { limit: 50, ...(before ? { before } : {}) } },
        )
      ).data,
    );
  },
  async approvals(appId: string, runId: string): Promise<AgentApprovalBatch> {
    const response = await httpClient.get<AgentEnvelope<AgentApprovalView[]>>(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/approvals`,
    );
    const serverUnixMilliseconds = Number(response.headers['x-agent-server-time-ms']);
    if (!Number.isSafeInteger(serverUnixMilliseconds) || serverUnixMilliseconds <= 0) {
      throw new Error('AGENT_SERVER_TIME_INVALID');
    }
    return {
      items: unwrap(response.data),
      clock: {
        serverUnixMilliseconds,
        clientMonotonicMilliseconds: performance.now(),
      },
    };
  },
  async resolveApproval(
    appId: string,
    approval: AgentApprovalView,
    decision: 'approved' | 'denied',
    feedback?: string,
  ): Promise<AgentApprovalView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentApprovalView>>(
          `/apps/${encodeURIComponent(appId)}/approvals/${encodeURIComponent(approval.id)}/resolve`,
          agentRuntimeRequest({
            decision,
            operationHash: approval.operationHash,
            expectedVersion: approval.version,
            ...(feedback ? { feedback } : {}),
          }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async createRun(
    appId: string,
    input: {
      threadId: string;
      text: string;
      artifactRefs?: string[];
      agentDefinitionId: string;
      model: {
        providerId: string;
        modelId: string;
        configurationVersion: number;
      };
      reasoningEffort?: AgentReasoningEffort;
      approvalMode: AgentApprovalMode;
      executionMode?: AgentExecutionMode;
      plannedFromRunId?: string;
      connectionIds?: number[];
      environment?: AgentRunEnvironmentSelection | null;
      initialGoal?: string;
    },
  ): Promise<AgentRunView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunView>>(
          `/apps/${encodeURIComponent(appId)}/runs`,
          agentRuntimeRequest({
            threadId: input.threadId,
            input: { text: input.text, artifactRefs: input.artifactRefs ?? [] },
            agentDefinitionId: input.agentDefinitionId,
            model: input.model,
            ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
            approvalMode: input.approvalMode,
            ...(input.executionMode === undefined ? {} : { executionMode: input.executionMode }),
            ...(input.plannedFromRunId === undefined ? {} : { plannedFromRunId: input.plannedFromRunId }),
            connectionIds: input.connectionIds ?? [],
            ...(input.environment === undefined ? {} : { environment: input.environment }),
            ...(input.initialGoal ? { initialGoal: input.initialGoal } : {}),
          }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async appendRunInput(appId: string, run: AgentRunView, text: string, artifactRefs: string[] = []): Promise<void> {
    await httpClient.post(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/inputs`,
      agentRuntimeRequest({ text, artifactRefs, expectedVersion: run.version }),
      {
        headers: {
          ...(await mutationHeaders()),
          'Idempotency-Key': crypto.randomUUID(),
        },
      },
    );
  },
  async interruptRun(appId: string, run: AgentRunView, text: string): Promise<void> {
    await httpClient.post(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/interrupt`,
      agentRuntimeRequest({
        text,
        artifactRefs: [],
        expectedVersion: run.version,
      }),
      {
        headers: {
          ...(await mutationHeaders()),
          'Idempotency-Key': crypto.randomUUID(),
        },
      },
    );
  },
  async setRunGoal(appId: string, run: AgentRunView, text: string): Promise<AgentRunView> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(run.id) + '/goal';
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunView>>(
          path,
          agentRuntimeRequest({ text, expectedVersion: run.version }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async pendingRunInputs(appId: string, runId: string): Promise<AgentPendingRunInputPage> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(runId) + '/pending-inputs';
    return unwrap((await httpClient.get<AgentEnvelope<AgentPendingRunInputPage>>(path)).data);
  },
  async mutatePendingRunInput(
    appId: string,
    run: AgentRunView,
    action: 'remove' | 'move',
    inputId: string,
    beforeInputId: string | null,
  ): Promise<AgentRunView> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(run.id) + '/pending-inputs';
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentRunView>>(
          path,
          agentRuntimeRequest({
            action,
            inputId,
            beforeInputId,
            expectedVersion: run.version,
          }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async increaseRunBudget(
    appId: string,
    run: AgentRunView,
    increase: Partial<{
      maxRunSteps: number;
      maxActiveExecutionSeconds: number;
      maxSubagentMessages: number;
      maxSubagentMessageBytes: number;
    }>,
  ): Promise<AgentRunView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/budget`,
          agentRuntimeRequest({
            scope: 'run',
            increase,
            expectedVersion: run.version,
          }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async checkpoints(appId: string, runId: string): Promise<AgentCheckpointView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentCheckpointView[]>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/checkpoints`,
        )
      ).data,
    );
  },
  async saveCheckpoint(appId: string, run: AgentRunView): Promise<AgentCheckpointView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentCheckpointView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/checkpoints`,
          agentRuntimeRequest({ expectedVersion: run.version }),
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async resumeRun(appId: string, run: AgentRunView, checkpointId: string): Promise<AgentRunView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/resume`,
          agentRuntimeRequest({ checkpointId, expectedVersion: run.version }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async cancelRun(appId: string, run: AgentRunView): Promise<AgentRunView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunView>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/cancel`,
          agentRuntimeRequest({ expectedVersion: run.version }),
          {
            headers: {
              ...(await mutationHeaders()),
              'Idempotency-Key': crypto.randomUUID(),
            },
          },
        )
      ).data,
    );
  },
  async deleteRun(appId: string, run: AgentRunView): Promise<void> {
    await httpClient.delete(`/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}`, {
      params: { expectedVersion: run.version },
      headers: {
        ...(await mutationHeaders()),
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
  },
};
