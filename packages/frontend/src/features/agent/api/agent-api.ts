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
  AgentAppIntentArtifactDto,
  AgentAppIntentReceiptDto,
  AgentPluginAppStateDto,
  AgentPluginFrontendDescriptorDto,
  AgentPluginInstallationDto,
  AgentPluginManifestDto,
  AgentPluginPublisherKeyDto,
  AgentPluginStageDto,
  AgentPluginUninstallResultDto,
  AgentPluginUpgradeResultDto,
  AgentPluginVerifyResultDto,
  AgentPluginVersionDto,
  AgentRemotePluginCatalogDto,
  AgentRemotePluginPackageDto,
  AgentRemotePluginPublisherDto,
} from '@nexus-terminal/protocol/agent-plugins';
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
  AgentArtifactRefDto,
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
import type { AgentEnvelopeDto, AgentToolRiskDto } from '@nexus-terminal/protocol/agent-common';
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
  AgentHardLimitsDto,
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
export type * from '@nexus-terminal/protocol/agent-approvals';
export type * from '@nexus-terminal/protocol/agent-artifacts';
export type * from '@nexus-terminal/protocol/agent-collaboration';
export type * from '@nexus-terminal/protocol/agent-common';
export type * from '@nexus-terminal/protocol/agent-host';
export type * from '@nexus-terminal/protocol/agent-integrations';
export type * from '@nexus-terminal/protocol/agent-memories';
export type * from '@nexus-terminal/protocol/agent-plugins';
export type * from '@nexus-terminal/protocol/agent-providers';
export type * from '@nexus-terminal/protocol/agent-runs';
export type * from '@nexus-terminal/protocol/agent-threads';

import { agentRuntimeRequest } from './agent-http-client';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';
import { createPluginApi } from './plugin-api';
import { createProviderApi } from './provider-api';
import { createArtifactApi } from './artifact-api';
import { createWorkspaceRuntimeApi } from './workspace-runtime-api';
import type { WorkspaceProfileView } from './workspace-runtime-api';

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
  app: AgentAppSummaryDto;
  installedNow: boolean;
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






export type AgentCreateRunInput = Omit<AgentCreateRunFieldsDto, 'input' | 'connectionIds'> & {
  text: string;
  artifactRefs?: string[];
  connectionIds?: number[];
};





export interface AgentServerClockAnchor {
  serverUnixMilliseconds: number;
  clientMonotonicMilliseconds: number;
}

export interface AgentApprovalBatch {
  items: AgentApprovalViewDto[];
  clock: AgentServerClockAnchor;
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

export { resetAgentCsrf } from './agent-api-common';

export const agentApi = {
  async recommendedPlugin(): Promise<RecommendedAgentPluginView> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<RecommendedAgentPluginView>>('/agent/onboarding/recommended-plugin')).data,
    );
  },
  async installRecommendedPlugin(): Promise<RecommendedAgentPluginInstallResult> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<RecommendedAgentPluginInstallResult>>(
          '/agent/onboarding/recommended-plugin/install',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async settings(): Promise<AgentSettingsViewDto> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentSettingsViewDto>>('/agent/settings')).data);
  },
  async patchSettings(patch: AgentSettingsPatchDto, expectedVersion: number): Promise<AgentSettingsViewDto> {
    const input: AgentSettingsPatchRequestDto = { patch, expectedVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentSettingsViewDto>>(
          '/agent/settings',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async previewHardLimits(proposed: Partial<AgentHardLimitsDto>, expectedVersion: number): Promise<AgentHardLimitPreviewDto> {
    const input: AgentHardLimitPreviewRequestDto = { proposed, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentHardLimitPreviewDto>>(
          '/agent/settings/hard-limits/preview',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmHardLimits(confirmationId: string, expectedVersion: number): Promise<AgentSettingsViewDto> {
    const input: AgentHardLimitConfirmRequestDto = { confirmationId, expectedVersion };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentSettingsViewDto>>(
          '/agent/settings/hard-limits/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async apps(): Promise<AgentAppSummaryDto[]> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentAppSummaryDto[]>>('/agent/apps')).data);
  },
  async setAppEnabled(app: AgentAppSummaryDto, enabled: boolean): Promise<AgentAppSummaryDto> {
    const input: AgentAppStateUpdateRequestDto = { enabled, expectedVersion: app.stateVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentAppSummaryDto>>(
          `/agent/apps/${encodeURIComponent(app.id)}`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async appExecutionPolicy(appId: string): Promise<AgentExecutionPolicyViewDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentExecutionPolicyViewDto>>(
          `/agent/apps/${encodeURIComponent(appId)}/execution-policy`,
        )
      ).data,
    );
  },
  async replaceAppExecutionPolicy(
    appId: string,
    overrides: AgentExecutionPolicyOverridesDto,
    expectedVersion: number,
  ): Promise<AgentExecutionPolicyViewDto> {
    const input: AgentExecutionPolicyReplaceRequestDto = { overrides, expectedVersion };
    return unwrap(
      (
        await httpClient.put<AgentEnvelopeDto<AgentExecutionPolicyViewDto>>(
          `/agent/apps/${encodeURIComponent(appId)}/execution-policy`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async appGrants(appId: string): Promise<AgentAppGrantViewDto> {
    return unwrap(
      (await httpClient.get<AgentEnvelopeDto<AgentAppGrantViewDto>>(`/agent/apps/${encodeURIComponent(appId)}/grants`)).data,
    );
  },
  async replaceAppGrants(
    appId: string,
    grants: AgentCapabilityGrantInputDto[],
    expectedPolicyRevision: number,
  ): Promise<AgentAppGrantViewDto> {
    const input: AgentAppGrantReplaceRequestDto = { grants, expectedPolicyRevision };
    return unwrap(
      (
        await httpClient.put<AgentEnvelopeDto<AgentAppGrantViewDto>>(
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
  async integrations(appId: string, kind?: AgentIntegrationKindDto): Promise<AgentIntegrationViewDto[]> {
    const params: AgentIntegrationListQueryDto | undefined = kind ? { kind } : undefined;
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentIntegrationViewDto[]>>(`/apps/${encodeURIComponent(appId)}/integrations`, {
          params,
        })
      ).data,
    );
  },
  async createIntegration(appId: string, input: AgentIntegrationCreateRequestDto): Promise<AgentIntegrationViewDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentIntegrationViewDto>>(
          `/apps/${encodeURIComponent(appId)}/integrations`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async updateIntegration(
    appId: string,
    integration: AgentIntegrationViewDto,
    input: AgentIntegrationUpdateFieldsDto,
  ): Promise<AgentIntegrationViewDto> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentIntegrationViewDto>>(
          `/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integration.id)}`,
          { ...input, expectedVersion: integration.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteIntegration(appId: string, integration: AgentIntegrationViewDto): Promise<void> {
    const params: AgentIntegrationDeleteQueryDto = { expectedVersion: integration.version };
    await httpClient.delete(`/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integration.id)}`, {
      params,
      headers: await mutationHeaders(),
    });
  },
  async refreshIntegration(appId: string, integrationId: string): Promise<AgentIntegrationRefreshDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentIntegrationRefreshDto>>(
          `/apps/${encodeURIComponent(appId)}/integrations/${encodeURIComponent(integrationId)}/refresh`,
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async targetDenylist(): Promise<TargetDenylistView> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<TargetDenylistView>>('/agent/target-denylist')).data);
  },
  async replaceTargetDenylist(
    connectionIds: number[],
    reason: string,
    expectedRevision: number,
  ): Promise<TargetDenylistView> {
    return unwrap(
      (
        await httpClient.put<AgentEnvelopeDto<TargetDenylistView>>(
          '/agent/target-denylist',
          { connectionIds, reason, expectedRevision },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async summary(): Promise<AgentHostSummaryDto> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentHostSummaryDto>>('/agent/summary')).data);
  },
  async threads(appId: string, before?: string, limit = 50): Promise<AgentThreadPageDto> {
    const params: AgentThreadListQueryDto = { limit, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentThreadPageDto>>(`/apps/${encodeURIComponent(appId)}/threads`, {
          params,
        })
      ).data,
    );
  },
  async createThread(appId: string, title?: string): Promise<AgentThreadViewDto> {
    const input: AgentThreadCreateRequestDto = title ? { title } : {};
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentThreadViewDto>>(
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
  ): Promise<AgentThreadViewDto> {
    const input: AgentThreadRenameRequestDto = { title, expectedVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentThreadViewDto>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(threadId)}`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteThread(appId: string, thread: AgentThreadViewDto): Promise<AgentThreadDeleteResultDto> {
    const data: AgentThreadDeleteRequestDto = { expectedVersion: thread.version };
    return unwrap(
      (
        await httpClient.delete<AgentEnvelopeDto<AgentThreadDeleteResultDto>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(thread.id)}`,
          {
            headers: await mutationHeaders(),
            data,
          },
        )
      ).data,
    );
  },
  async deleteAllThreads(appId: string): Promise<AgentThreadDeleteAllResultDto> {
    const data: AgentThreadDeleteAllRequestDto = { confirmation: 'delete_all_threads' };
    return unwrap(
      (
        await httpClient.delete<AgentEnvelopeDto<AgentThreadDeleteAllResultDto>>(
          `/apps/${encodeURIComponent(appId)}/threads`,
          {
            headers: await mutationHeaders(),
            data,
          },
        )
      ).data,
    );
  },
  async ledger(appId: string, threadId: string, before?: string): Promise<AgentLedgerPageDto> {
    const params: AgentLedgerQueryDto = { limit: 50, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentLedgerPageDto>>(
          `/apps/${encodeURIComponent(appId)}/threads/${encodeURIComponent(threadId)}/entries`,
          { params },
        )
      ).data,
    );
  },
  async definitions(appId: string): Promise<AgentDefinitionViewDto[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentDefinitionViewDto[]>>(
          `/apps/${encodeURIComponent(appId)}/agent-definitions`,
        )
      ).data,
    );
  },
  async runs(appId: string, threadId?: string): Promise<AgentRunPageDto> {
    const params: AgentRunListQueryDto = { limit: 50, ...(threadId ? { threadId } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentRunPageDto>>(`/apps/${encodeURIComponent(appId)}/runs`, {
          params,
        })
      ).data,
    );
  },
  async run(appId: string, runId: string): Promise<AgentRunSnapshotDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentRunSnapshotDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}`,
        )
      ).data,
    );
  },
  async runReconciliation(appId: string, runId: string): Promise<AgentRunReconciliationViewDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentRunReconciliationViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/reconciliation`,
        )
      ).data,
    );
  },
  async resolveRunReconciliation(
    appId: string,
    run: AgentRunViewDto,
    reconciliation: AgentRunReconciliationViewDto,
    note: string,
  ): Promise<AgentRunViewDto> {
    const fields: AgentRunReconciliationResolveFieldsDto = {
      expectedVersion: run.version,
      note,
      resources: reconciliation.resources.map(({ resourceKey, version }) => ({ resourceKey, version })),
    };
    const input: AgentRunReconciliationResolveRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/reconciliation/resolve`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagentSettings(appId: string): Promise<AgentSubagentSettingsViewDto> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentSubagentSettingsViewDto>>(
          `/apps/${encodeURIComponent(appId)}/subagent-settings`,
        )
      ).data,
    );
  },
  async replaceSubagentProfiles(
    appId: string,
    profiles: AgentSubagentProfileDto[],
    expectedVersion: number,
  ): Promise<AgentSubagentSettingsViewDto> {
    const input: AgentSubagentSettingsReplaceRequestDto = { profiles, expectedVersion };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentSubagentSettingsViewDto>>(
          `/apps/${encodeURIComponent(appId)}/subagent-settings`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async memories(appId: string, status: AgentMemoryStatusDto | 'all' = 'all', limit = 100): Promise<AgentMemoryViewDto[]> {
    const params: AgentMemoryListQueryDto = { status, limit };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentMemoryViewDto[]>>(`/apps/${encodeURIComponent(appId)}/memories`, {
          params,
        })
      ).data,
    );
  },
  async reviewMemory(
    appId: string,
    memory: AgentMemoryViewDto,
    decision: AgentMemoryReviewActionDto,
    content?: string,
  ): Promise<AgentMemoryViewDto> {
    const input: AgentMemoryReviewRequestDto = {
      decision,
      expectedVersion: memory.version,
      ...(content === undefined ? {} : { content }),
    };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentMemoryViewDto>>(
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
  ): Promise<AgentMemoryImportConfirmationDto> {
    const input: AgentMemoryImportPreviewRequestDto = { sourceAppId, sourceMemoryId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentMemoryImportConfirmationDto>>(
          `/apps/${encodeURIComponent(appId)}/memories/imports/preview`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmMemoryImport(appId: string, confirmationId: string): Promise<AgentMemoryViewDto> {
    const input: AgentMemoryImportConfirmRequestDto = {};
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentMemoryViewDto>>(
          `/apps/${encodeURIComponent(appId)}/memories/imports/${encodeURIComponent(confirmationId)}/confirm`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async subagents(appId: string, runId: string, before?: string): Promise<AgentSubagentPageDto> {
    const params: AgentSubagentListQueryDto = { limit: 50, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentSubagentPageDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents`,
          { params },
        )
      ).data,
    );
  },
  async cancelSubagent(appId: string, runId: string, delegation: AgentSubagentViewDto): Promise<AgentSubagentViewDto> {
    const input: AgentSubagentCancelRequestDto = { expectedVersion: delegation.version };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentSubagentViewDto>>(
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
  ): Promise<AgentSubagentMessagePageDto> {
    const params: AgentSubagentMessageListQueryDto = { limit: 50, ...(before ? { before } : {}) };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentSubagentMessagePageDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(delegationId)}/messages`,
          { params },
        )
      ).data,
    );
  },
  async approvals(appId: string, runId: string): Promise<AgentApprovalBatch> {
    const response = await httpClient.get<AgentEnvelopeDto<AgentApprovalViewDto[]>>(
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
    approval: AgentApprovalViewDto,
    decision: 'approved' | 'denied',
    feedback?: string,
  ): Promise<AgentApprovalViewDto> {
    const fields: AgentApprovalResolveFieldsDto = {
      decision,
      operationHash: approval.operationHash,
      expectedVersion: approval.version,
      ...(feedback ? { feedback } : {}),
    };
    const input: AgentApprovalResolveRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentApprovalViewDto>>(
          `/apps/${encodeURIComponent(appId)}/approvals/${encodeURIComponent(approval.id)}/resolve`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async createRun(appId: string, input: AgentCreateRunInput): Promise<AgentRunViewDto> {
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
        await httpClient.post<AgentEnvelopeDto<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs`,
          request,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async appendRunInput(appId: string, run: AgentRunViewDto, text: string, artifactRefs: string[] = []): Promise<void> {
    const fields: AgentRunAppendInputFieldsDto = { text, artifactRefs, expectedVersion: run.version };
    const request: AgentRunAppendInputRequestDto = agentRuntimeRequest(fields);
    await httpClient.post<AgentEnvelopeDto<AgentRunAppendInputResponseDto>>(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/inputs`,
      request,
      { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
    );
  },
  async interruptRun(appId: string, run: AgentRunViewDto, text: string): Promise<void> {
    const fields: AgentRunAppendInputFieldsDto = { text, artifactRefs: [], expectedVersion: run.version };
    const request: AgentRunAppendInputRequestDto = agentRuntimeRequest(fields);
    await httpClient.post<AgentEnvelopeDto<AgentRunAppendInputResponseDto>>(
      `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/interrupt`,
      request,
      { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
    );
  },
  async setRunGoal(appId: string, run: AgentRunViewDto, text: string): Promise<AgentRunViewDto> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(run.id) + '/goal';
    const fields: AgentRunSetGoalFieldsDto = { text, expectedVersion: run.version };
    const input: AgentRunSetGoalRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentRunViewDto>>(
          path,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async pendingRunInputs(appId: string, runId: string): Promise<AgentPendingRunInputPageDto> {
    const path = '/apps/' + encodeURIComponent(appId) + '/runs/' + encodeURIComponent(runId) + '/pending-inputs';
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentPendingRunInputPageDto>>(path)).data);
  },
  async mutatePendingRunInput(
    appId: string,
    run: AgentRunViewDto,
    action: 'remove' | 'move',
    inputId: string,
    beforeInputId: string | null,
  ): Promise<AgentRunViewDto> {
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
        await httpClient.patch<AgentEnvelopeDto<AgentRunViewDto>>(
          path,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async increaseRunBudget(
    appId: string,
    run: AgentRunViewDto,
    increase: AgentRunBudgetIncreaseDto,
  ): Promise<AgentRunViewDto> {
    const fields: AgentRunBudgetIncreaseFieldsDto = { increase, expectedVersion: run.version };
    const input: AgentRunBudgetIncreaseRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/budget`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async checkpoints(appId: string, runId: string): Promise<AgentCheckpointViewDto[]> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentCheckpointViewDto[]>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(runId)}/checkpoints`,
        )
      ).data,
    );
  },
  async saveCheckpoint(appId: string, run: AgentRunViewDto): Promise<AgentCheckpointViewDto> {
    const input: AgentExpectedVersionRequestDto = agentRuntimeRequest({ expectedVersion: run.version });
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentCheckpointViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/checkpoints`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async resumeRun(appId: string, run: AgentRunViewDto, checkpointId: string): Promise<AgentRunViewDto> {
    const fields: AgentRunResumeFieldsDto = { checkpointId, expectedVersion: run.version };
    const input: AgentRunResumeRequestDto = agentRuntimeRequest(fields);
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/resume`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async cancelRun(appId: string, run: AgentRunViewDto): Promise<AgentRunViewDto> {
    const input: AgentExpectedVersionRequestDto = agentRuntimeRequest({ expectedVersion: run.version });
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentRunViewDto>>(
          `/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}/cancel`,
          input,
          { headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() } },
        )
      ).data,
    );
  },
  async deleteRun(appId: string, run: AgentRunViewDto): Promise<void> {
    const params: AgentRunDeleteQueryDto = { expectedVersion: run.version };
    await httpClient.delete(`/apps/${encodeURIComponent(appId)}/runs/${encodeURIComponent(run.id)}`, {
      params,
      headers: { ...(await mutationHeaders()), 'Idempotency-Key': crypto.randomUUID() },
    });
  },
};
