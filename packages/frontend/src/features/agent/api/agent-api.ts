import type {
  AgentSubagentCancelRequestDto,
  AgentSubagentListQueryDto,
  AgentSubagentMessageDto,
  AgentSubagentMessageListQueryDto,
  AgentSubagentMessagePageDto,
  AgentSubagentPageDto,
  AgentSubagentProfileDto,
  AgentSubagentProfileTemplateDto,
  AgentSubagentSettingsReplaceRequestDto,
  AgentSubagentSettingsViewDto,
  AgentSubagentViewDto,
} from '@nexus-terminal/protocol/agent-collaboration';
import type {
  AgentMemoryImportConfirmRequestDto,
  AgentMemoryImportConfirmationDto,
  AgentMemoryImportPreviewRequestDto,
  AgentMemoryListQueryDto,
  AgentMemoryReviewActionDto,
  AgentMemoryReviewRequestDto,
  AgentMemoryStatusDto,
  AgentMemoryViewDto,
} from '@nexus-terminal/protocol/agent-memories';
import type {
  AgentAcpIntegrationConfigurationDto,
  AgentIntegrationCreateRequestDto,
  AgentIntegrationDeleteQueryDto,
  AgentIntegrationKindDto,
  AgentIntegrationListQueryDto,
  AgentIntegrationRefreshDto,
  AgentIntegrationUpdateFieldsDto,
  AgentIntegrationViewDto,
  AgentMcpIntegrationConfigurationDto,
} from '@nexus-terminal/protocol/agent-integrations';
import type {
  AgentArtifactCleanupPreviewDto,
  AgentArtifactCleanupResultDto,
  AgentArtifactPageDto,
  AgentArtifactStorageSummaryDto,
} from '@nexus-terminal/protocol/agent-artifacts';
import type {
  AgentApprovalResolveFieldsDto,
  AgentApprovalResolveRequestDto,
  AgentApprovalViewDto,
  AgentToolInspectionDto,
} from '@nexus-terminal/protocol/agent-approvals';
import type { AgentToolRiskDto } from '@nexus-terminal/protocol/agent-common';
import type {
  AgentAppGrantReplaceRequestDto,
  AgentAppGrantViewDto,
  AgentAppStateUpdateRequestDto,
  AgentAppSummaryDto,
  AgentApprovalModeDto,
  AgentCapabilityDefinitionDto,
  AgentCapabilityGrantDto,
  AgentCapabilityGrantInputDto,
  AgentCapabilityScopeDto,
  AgentContextCompactionModeDto,
  AgentContextProfileDto,
  AgentExecutionPolicyOverridesDto,
  AgentExecutionPolicyReplaceRequestDto,
  AgentExecutionPolicyViewDto,
  AgentHardLimitConfirmRequestDto,
  AgentHostSummaryDto,
  AgentHardLimitPreviewDto,
  AgentHardLimitPreviewRequestDto,
  AgentSettingsPatchDto,
  AgentSettingsPatchRequestDto,
  AgentSettingsViewDto,
  AgentTargetGrantSelectionDto,
  AgentTargetKindDto,
} from '@nexus-terminal/protocol/agent-host';
import type {
  AgentDiscoveredProviderModelDto,
  AgentModelCapabilityDefaultsDto,
  AgentModelCapabilityDto,
  AgentModelCapabilityOverridesDto,
  AgentModelReasoningDefaultsDto,
  AgentModelRegistryStatusDto,
  AgentProviderCreateRequestDto,
  AgentProviderModelCapabilityObservationDto,
  AgentProviderModelDto,
  AgentProviderPatchFieldsDto,
  AgentProviderViewDto,
  AgentReasoningEffortDto,
} from '@nexus-terminal/protocol/agent-providers';
import type {
  AgentCheckpointViewDto,
  AgentCreateRunFieldsDto,
  AgentCreateRunRequestDto,
  AgentDefinitionModelCompatibilityDto,
  AgentDefinitionViewDto,
  AgentExecutionModeDto,
  AgentExpectedVersionRequestDto,
  AgentPendingRunInputDto,
  AgentPendingRunInputPageDto,
  AgentPendingUserInputRequestDto,
  AgentPlanItemDto,
  AgentPlanItemStatusDto,
  AgentRunAppendInputFieldsDto,
  AgentRunAppendInputRequestDto,
  AgentRunAppendInputResponseDto,
  AgentRunBudgetIncreaseDto,
  AgentRunBudgetIncreaseFieldsDto,
  AgentRunBudgetIncreaseRequestDto,
  AgentRunDeleteQueryDto,
  AgentRunEnvironmentSelectionDto,
  AgentRunListQueryDto,
  AgentRunPageDto,
  AgentRunPendingInputMutationFieldsDto,
  AgentRunPendingInputMutationRequestDto,
  AgentRunPlanDto,
  AgentRunReconciliationResolveFieldsDto,
  AgentRunReconciliationResolveRequestDto,
  AgentRunReconciliationResourceDto,
  AgentRunReconciliationViewDto,
  AgentRunResumeFieldsDto,
  AgentRunResumeRequestDto,
  AgentRunSetGoalFieldsDto,
  AgentRunSetGoalRequestDto,
  AgentRunSnapshotDto,
  AgentRunStatusDto,
  AgentRunTerminalIssueDto,
  AgentRunViewDto,
  AgentUserInputChoiceDto,
  AgentUserInputQuestionDto,
} from '@nexus-terminal/protocol/agent-runs';
import type {
  AgentLedgerPageDto,
  AgentLedgerEntryDto,
  AgentLedgerQueryDto,
  AgentThreadCreateRequestDto,
  AgentThreadDeleteAllRequestDto,
  AgentThreadDeleteAllResultDto,
  AgentThreadDeleteRequestDto,
  AgentThreadDeleteResultDto,
  AgentThreadListQueryDto,
  AgentThreadPageDto,
  AgentThreadRenameRequestDto,
  AgentThreadViewDto,
} from '@nexus-terminal/protocol/agent-threads';
import { agentRuntimeRequest } from './agent-http-client';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';
import { createPluginApi } from './plugin-api';
import { createProviderApi } from './provider-api';
import { createArtifactApi } from './artifact-api';
import type { AgentArtifactRef, AgentEnvelope, AgentHardLimits, AgentSettingsView } from './agent-api.types';
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

export type AgentContextCompactionMode = AgentContextCompactionModeDto;
export type AgentContextProfile = AgentContextProfileDto;
export type AgentExecutionPolicyOverrides = AgentExecutionPolicyOverridesDto;
export type AgentExecutionPolicyView = AgentExecutionPolicyViewDto;
export type AgentAppSummary = AgentAppSummaryDto;

export type AgentRunEnvironmentSelection = AgentRunEnvironmentSelectionDto;

export type AgentIntegrationKind = AgentIntegrationKindDto;
export type AgentMcpIntegrationConfiguration = AgentMcpIntegrationConfigurationDto;
export type AgentAcpIntegrationConfiguration = AgentAcpIntegrationConfigurationDto;
export type AgentIntegrationView = AgentIntegrationViewDto;

export type AgentTargetKind = AgentTargetKindDto;
export type AgentTargetGrantSelection = AgentTargetGrantSelectionDto;
export type AgentCapabilityScope = AgentCapabilityScopeDto;
export type AgentCapabilityDefinition = AgentCapabilityDefinitionDto;
export type AgentCapabilityGrantInput = AgentCapabilityGrantInputDto;
export type AgentCapabilityGrant = AgentCapabilityGrantDto;
export type AgentAppGrantView = AgentAppGrantViewDto;

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

export interface AgentAppIntentReceipt {
  id: string;
  userId: number;
  senderAppId: string;
  receiverAppId: string;
  intentId: string;
  schemaVersion: number;
  input: unknown;
  artifactIds: string[];
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AgentAppIntentArtifactView {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
}

export type AgentMemoryStatus = AgentMemoryStatusDto;
export type AgentMemoryReviewAction = AgentMemoryReviewActionDto;
export type AgentMemoryView = AgentMemoryViewDto;
export type AgentMemoryImportConfirmation = AgentMemoryImportConfirmationDto;


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

export type AgentReasoningEffort = AgentReasoningEffortDto;
export type AgentModelCapability = AgentModelCapabilityDto;
export type ModelReasoningDefaults = AgentModelReasoningDefaultsDto;
export type ModelCapabilityDefaults = AgentModelCapabilityDefaultsDto;
export type ModelCapabilityOverrides = AgentModelCapabilityOverridesDto;
export type ProviderModelCapabilityObservation = AgentProviderModelCapabilityObservationDto;
export type ProviderModel = AgentProviderModelDto;
export type AgentDiscoveredProviderModel = AgentDiscoveredProviderModelDto;
export type AgentModelRegistryStatus = AgentModelRegistryStatusDto;
export type AgentProviderView = AgentProviderViewDto;
export type AgentProviderCreateInput = AgentProviderCreateRequestDto;
export type AgentProviderPatchInput = AgentProviderPatchFieldsDto;

export type ArtifactStorageSummary = AgentArtifactStorageSummaryDto;
export type AgentArtifactPage = AgentArtifactPageDto;
export type ArtifactCleanupPreview = AgentArtifactCleanupPreviewDto;
export type ArtifactCleanupResult = AgentArtifactCleanupResultDto;

export type HardLimitPreview = AgentHardLimitPreviewDto;
export type HostSummaryView = AgentHostSummaryDto;

export type AgentThreadView = AgentThreadViewDto;
export type AgentThreadPage = AgentThreadPageDto;
export type AgentThreadDeleteResult = AgentThreadDeleteResultDto;
export type AgentThreadDeleteAllResult = AgentThreadDeleteAllResultDto;
export type AgentLedgerEntry = AgentLedgerEntryDto;
export type AgentLedgerPage = AgentLedgerPageDto;

export type AgentRunStatus = AgentRunStatusDto;
export type AgentApprovalMode = AgentApprovalModeDto;
export type AgentExecutionMode = AgentExecutionModeDto;
export type AgentToolRisk = AgentToolRiskDto;
export type AgentPlanItemStatus = AgentPlanItemStatusDto;
export type AgentPlanItem = AgentPlanItemDto;
export type AgentRunPlan = AgentRunPlanDto;
export type AgentRunTerminalIssue = AgentRunTerminalIssueDto;
export type AgentUserInputChoice = AgentUserInputChoiceDto;
export type AgentUserInputQuestion = AgentUserInputQuestionDto;
export type AgentPendingUserInputRequest = AgentPendingUserInputRequestDto;
export type AgentRunView = AgentRunViewDto;
export type AgentRunReconciliationResource = AgentRunReconciliationResourceDto;
export type AgentRunReconciliationView = AgentRunReconciliationViewDto;
export type AgentPendingRunInput = AgentPendingRunInputDto;
export type AgentPendingRunInputPage = AgentPendingRunInputPageDto;
export type AgentCheckpointView = AgentCheckpointViewDto;
export type AgentRunSnapshot = AgentRunSnapshotDto;
export type AgentRunPage = AgentRunPageDto;
export type AgentCreateRunInput = Omit<AgentCreateRunFieldsDto, 'input' | 'connectionIds'> & {
  text: string;
  artifactRefs?: string[];
  connectionIds?: number[];
};


export type AgentSubagentView = AgentSubagentViewDto;
export type AgentSubagentMessage = AgentSubagentMessageDto;
export type AgentSubagentProfile = AgentSubagentProfileDto;
export type AgentSubagentProfileTemplate = AgentSubagentProfileTemplateDto;
export type AgentSubagentSettingsView = AgentSubagentSettingsViewDto;
export type AgentSubagentPage = AgentSubagentPageDto;
export type AgentSubagentMessagePage = AgentSubagentMessagePageDto;


export type AgentToolInspection = AgentToolInspectionDto;

export interface AgentServerClockAnchor {
  serverUnixMilliseconds: number;
  clientMonotonicMilliseconds: number;
}

export interface AgentApprovalBatch {
  items: AgentApprovalView[];
  clock: AgentServerClockAnchor;
}

export type AgentApprovalView = AgentApprovalViewDto;

export type AgentDefinitionModelCompatibility = AgentDefinitionModelCompatibilityDto;
export type AgentDefinitionView = AgentDefinitionViewDto;

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

export { resetAgentCsrf } from './agent-api-common';

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
    return unwrap((await httpClient.get<AgentEnvelope<AgentSettingsViewDto>>('/agent/settings')).data);
  },
  async patchSettings(patch: AgentSettingsPatchDto, expectedVersion: number): Promise<AgentSettingsView> {
    const input: AgentSettingsPatchRequestDto = { patch, expectedVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentSettingsViewDto>>(
          '/agent/settings',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewHardLimits(proposed: Partial<AgentHardLimits>, expectedVersion: number): Promise<HardLimitPreview> {
    const input: AgentHardLimitPreviewRequestDto = { proposed, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentHardLimitPreviewDto>>(
          '/agent/settings/hard-limits/preview',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmHardLimits(confirmationId: string, expectedVersion: number): Promise<AgentSettingsView> {
    const input: AgentHardLimitConfirmRequestDto = { confirmationId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentSettingsViewDto>>(
          '/agent/settings/hard-limits/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async apps(): Promise<AgentAppSummary[]> {
    return unwrap((await httpClient.get<AgentEnvelope<AgentAppSummaryDto[]>>('/agent/apps')).data);
  },
  async setAppEnabled(app: AgentAppSummary, enabled: boolean): Promise<AgentAppSummary> {
    const input: AgentAppStateUpdateRequestDto = { enabled, expectedVersion: app.stateVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentAppSummaryDto>>(
          `/agent/apps/${encodeURIComponent(app.id)}`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async appExecutionPolicy(appId: string): Promise<AgentExecutionPolicyView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentExecutionPolicyViewDto>>(
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
    const input: AgentExecutionPolicyReplaceRequestDto = { overrides, expectedVersion };
    return unwrap(
      (
        await httpClient.put<AgentEnvelope<AgentExecutionPolicyViewDto>>(
          `/agent/apps/${encodeURIComponent(appId)}/execution-policy`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async appGrants(appId: string): Promise<AgentAppGrantView> {
    return unwrap(
      (await httpClient.get<AgentEnvelope<AgentAppGrantViewDto>>(`/agent/apps/${encodeURIComponent(appId)}/grants`)).data,
    );
  },
  async replaceAppGrants(
    appId: string,
    grants: AgentCapabilityGrantInput[],
    expectedPolicyRevision: number,
  ): Promise<AgentAppGrantView> {
    const input: AgentAppGrantReplaceRequestDto = { grants, expectedPolicyRevision };
    return unwrap(
      (
        await httpClient.put<AgentEnvelope<AgentAppGrantViewDto>>(
          `/agent/apps/${encodeURIComponent(appId)}/grants`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  ...createPluginApi(),
  ...createProviderApi(),
  ...createArtifactApi(),
  ...createWorkspaceRuntimeApi(mutationHeaders),
  async integrations(appId: string, kind?: AgentIntegrationKind): Promise<AgentIntegrationView[]> {
    const params: AgentIntegrationListQueryDto | undefined = kind ? { kind } : undefined;
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentIntegrationView[]>>(`/apps/${encodeURIComponent(appId)}/integrations`, {
          params,
        })
      ).data,
    );
  },
  async createIntegration(appId: string, input: AgentIntegrationCreateRequestDto): Promise<AgentIntegrationView> {
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
    input: AgentIntegrationUpdateFieldsDto,
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
    const params: AgentIntegrationDeleteQueryDto = { expectedVersion: integration.version };
    await httpClient.delete(`/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integration.id)}`, {
      params,
      headers: await mutationHeaders(),
    });
  },
  async refreshIntegration(appId: string, integrationId: string): Promise<AgentIntegrationRefreshDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentIntegrationRefreshDto>>(
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
    return unwrap((await httpClient.get<AgentEnvelope<AgentHostSummaryDto>>('/agent/summary')).data);
  },
  async threads(appId: string, before?: string, limit = 50): Promise<AgentThreadPage> {
    const params: AgentThreadListQueryDto = { limit, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentThreadPageDto>>(`/apps/${encodeURIComponent(appId)}/threads`, {
          params,
        })
      ).data,
    );
  },
  async createThread(appId: string, title?: string): Promise<AgentThreadView> {
    const input: AgentThreadCreateRequestDto = title ? { title } : {};
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentThreadViewDto>>(
          `/apps/${encodeURIComponent(appId)}/threads`,
          input,
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
    const input: AgentThreadRenameRequestDto = { title, expectedVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentThreadViewDto>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(threadId)}`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteThread(appId: string, thread: AgentThreadView): Promise<AgentThreadDeleteResult> {
    const data: AgentThreadDeleteRequestDto = { expectedVersion: thread.version };
    return unwrap(
      (
        await httpClient.delete<AgentEnvelope<AgentThreadDeleteResultDto>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(thread.id)}`,
          {
            headers: await mutationHeaders(),
            data,
          },
        )
      ).data,
    );
  },
  async deleteAllThreads(appId: string): Promise<AgentThreadDeleteAllResult> {
    const data: AgentThreadDeleteAllRequestDto = { confirmation: 'delete_all_threads' };
    return unwrap(
      (
        await httpClient.delete<AgentEnvelope<AgentThreadDeleteAllResultDto>>(
          `/apps/${encodeURIComponent(appId)}/threads`,
          {
            headers: await mutationHeaders(),
            data,
          },
        )
      ).data,
    );
  },
  async ledger(appId: string, threadId: string, before?: string): Promise<AgentLedgerPage> {
    const params: AgentLedgerQueryDto = { limit: 50, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentLedgerPageDto>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(threadId)}/entries`,
          { params },
        )
      ).data,
    );
  },
  async definitions(appId: string): Promise<AgentDefinitionView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentDefinitionViewDto[]>>(
          `/apps/${encodeURIComponent(appId)}/agent-definitions`,
        )
      ).data,
    );
  },
  async runs(appId: string, threadId?: string): Promise<AgentRunPage> {
    const params: AgentRunListQueryDto = { limit: 50, ...(threadId ? { threadId } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentRunPageDto>>(`/apps/${encodeURIComponent(appId)}/runs`, {
          params,
        })
      ).data,
    );
  },
  async run(appId: string, runId: string): Promise<AgentRunSnapshot> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentRunSnapshotDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}`,
        )
      ).data,
    );
  },
  async runReconciliation(appId: string, runId: string): Promise<AgentRunReconciliationView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentRunReconciliationViewDto>>(
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
    const fields: AgentRunReconciliationResolveFieldsDto = {
      expectedVersion: run.version,
      note,
      resources: reconciliation.resources.map(({ resourceKey, version }) => ({ resourceKey, version })),
    };
    const input: AgentRunReconciliationResolveRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/reconciliation/resolve`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagentSettings(appId: string): Promise<AgentSubagentSettingsView> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentSubagentSettingsViewDto>>(
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
    const input: AgentSubagentSettingsReplaceRequestDto = { profiles, expectedVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentSubagentSettingsViewDto>>(
          `/apps/${encodeURIComponent(appId)}/subagent-settings`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async memories(appId: string, status: AgentMemoryStatus | 'all' = 'all', limit = 100): Promise<AgentMemoryView[]> {
    const params: AgentMemoryListQueryDto = { status, limit };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentMemoryViewDto[]>>(`/apps/${encodeURIComponent(appId)}/memories`, {
          params,
        })
      ).data,
    );
  },
  async reviewMemory(
    appId: string,
    memory: AgentMemoryView,
    decision: AgentMemoryReviewAction,
    content?: string,
  ): Promise<AgentMemoryView> {
    const input: AgentMemoryReviewRequestDto = {
      decision,
      expectedVersion: memory.version,
      ...(content === undefined ? {} : { content }),
    };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentMemoryViewDto>>(
          `/apps/${encodeURIComponent(appId)}/memories/${encodeURIComponent(memory.id)}/review`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewMemoryImport(
    appId: string,
    sourceAppId: string,
    sourceMemoryId: string,
  ): Promise<AgentMemoryImportConfirmation> {
    const input: AgentMemoryImportPreviewRequestDto = { sourceAppId, sourceMemoryId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentMemoryImportConfirmationDto>>(
          `/apps/${encodeURIComponent(appId)}/memories/imports/preview`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmMemoryImport(appId: string, confirmationId: string): Promise<AgentMemoryView> {
    const input: AgentMemoryImportConfirmRequestDto = {};
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentMemoryViewDto>>(
          `/apps/${encodeURIComponent(appId)}/memories/imports/${encodeURIComponent(confirmationId)}/confirm`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagents(appId: string, runId: string, before?: string): Promise<AgentSubagentPage> {
    const params: AgentSubagentListQueryDto = { limit: 50, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentSubagentPageDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents`,
          { params },
        )
      ).data,
    );
  },
  async cancelSubagent(appId: string, runId: string, delegation: AgentSubagentView): Promise<AgentSubagentView> {
    const input: AgentSubagentCancelRequestDto = { expectedVersion: delegation.version };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentSubagentViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(delegation.id)}/cancel`,
          input,
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
    const params: AgentSubagentMessageListQueryDto = { limit: 50, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentSubagentMessagePageDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(delegationId)}/messages`,
          { params },
        )
      ).data,
    );
  },
  async approvals(appId: string, runId: string): Promise<AgentApprovalBatch> {
    const response = await httpClient.get<AgentEnvelope<AgentApprovalViewDto[]>>(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/approvals`,
    );
    const serverUnixMilliseconds = Number(response.headers['x-agent-server-time-ms']);
    if (!Number.isSafeInteger(serverUnixMilliseconds) || serverUnixMilliseconds <= 0) {
      throw new Error('AGENT_SERVER_TIME_INVALID');
    }
    return {
      items: unwrap(response.data),
      clock: { serverUnixMilliseconds, clientMonotonicMilliseconds: performance.now() },
    };
  },
  async resolveApproval(
    appId: string,
    approval: AgentApprovalView,
    decision: 'approved' | 'denied',
    feedback?: string,
  ): Promise<AgentApprovalView> {
    const fields: AgentApprovalResolveFieldsDto = {
      decision,
      operationHash: approval.operationHash,
      expectedVersion: approval.version,
      ...(feedback ? { feedback } : {}),
    };
    const input: AgentApprovalResolveRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentApprovalViewDto>>(
          `/apps/${encodeURIComponent(appId)}/approvals/${encodeURIComponent(approval.id)}/resolve`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async createRun(appId: string, input: AgentCreateRunInput): Promise<AgentRunView> {
    const fields: AgentCreateRunFieldsDto = {
      threadId: input.threadId,
      input: { text: input.text, artifactRefs: input.artifactRefs ?? [] },
      agentDefinitionId: input.agentDefinitionId,
      model: input.model,
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      approvalMode: input.approvalMode,
      executionMode: input.executionMode,
      ...(input.plannedFromRunId === undefined ? {} : { plannedFromRunId: input.plannedFromRunId }),
      connectionIds: input.connectionIds ?? [],
      ...(input.environment === undefined ? {} : { environment: input.environment }),
      ...(input.initialGoal ? { initialGoal: input.initialGoal } : {}),
    };
    const request: AgentCreateRunRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs`,
          request,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async appendRunInput(appId: string, run: AgentRunView, text: string, artifactRefs: string[] = []): Promise<void> {
    const fields: AgentRunAppendInputFieldsDto = { text, artifactRefs, expectedVersion: run.version };
    const request: AgentRunAppendInputRequestDto = agentRuntimeRequest(fields);
    await httpClient.post<AgentEnvelope<AgentRunAppendInputResponseDto>>(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/inputs`,
      request,
      { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
    );
  },
  async interruptRun(appId: string, run: AgentRunView, text: string): Promise<void> {
    const fields: AgentRunAppendInputFieldsDto = { text, artifactRefs: [], expectedVersion: run.version };
    const request: AgentRunAppendInputRequestDto = agentRuntimeRequest(fields);
    await httpClient.post<AgentEnvelope<AgentRunAppendInputResponseDto>>(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/interrupt`,
      request,
      { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
    );
  },
  async setRunGoal(appId: string, run: AgentRunView, text: string): Promise<AgentRunView> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(run.id) + '/goal';
    const fields: AgentRunSetGoalFieldsDto = { text, expectedVersion: run.version };
    const input: AgentRunSetGoalRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunViewDto>>(
          path,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async pendingRunInputs(appId: string, runId: string): Promise<AgentPendingRunInputPage> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(runId) + '/pending-inputs';
    return unwrap((await httpClient.get<AgentEnvelope<AgentPendingRunInputPageDto>>(path)).data);
  },
  async mutatePendingRunInput(
    appId: string,
    run: AgentRunView,
    action: 'remove' | 'move',
    inputId: string,
    beforeInputId: string | null,
  ): Promise<AgentRunView> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(run.id) + '/pending-inputs';
    const fields: AgentRunPendingInputMutationFieldsDto = {
      action,
      inputId,
      beforeInputId,
      expectedVersion: run.version,
    };
    const input: AgentRunPendingInputMutationRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentRunViewDto>>(
          path,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async increaseRunBudget(
    appId: string,
    run: AgentRunView,
    increase: AgentRunBudgetIncreaseDto,
  ): Promise<AgentRunView> {
    const fields: AgentRunBudgetIncreaseFieldsDto = { increase, expectedVersion: run.version };
    const input: AgentRunBudgetIncreaseRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/budget`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async checkpoints(appId: string, runId: string): Promise<AgentCheckpointView[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentCheckpointViewDto[]>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/checkpoints`,
        )
      ).data,
    );
  },
  async saveCheckpoint(appId: string, run: AgentRunView): Promise<AgentCheckpointView> {
    const input: AgentExpectedVersionRequestDto = agentRuntimeRequest({ expectedVersion: run.version });
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentCheckpointViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/checkpoints`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async resumeRun(appId: string, run: AgentRunView, checkpointId: string): Promise<AgentRunView> {
    const fields: AgentRunResumeFieldsDto = { checkpointId, expectedVersion: run.version };
    const input: AgentRunResumeRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/resume`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async cancelRun(appId: string, run: AgentRunView): Promise<AgentRunView> {
    const input: AgentExpectedVersionRequestDto = agentRuntimeRequest({ expectedVersion: run.version });
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/cancel`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async deleteRun(appId: string, run: AgentRunView): Promise<void> {
    const params: AgentRunDeleteQueryDto = { expectedVersion: run.version };
    await httpClient.delete(`/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}`, {
      params,
      headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() },
    });
  },
};
