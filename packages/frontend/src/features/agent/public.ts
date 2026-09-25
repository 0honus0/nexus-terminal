import { defineAsyncComponent } from 'vue';

export const AgentSettingsPanel = defineAsyncComponent(() => import('./settings/AgentSettingsPanel.vue'));
export const AgentSurfaceHost = defineAsyncComponent(() => import('./host/AgentSurfaceHost.vue'));
export { agentApi, resetAgentCsrf } from './api/agent-api';
export type {
  AgentAppSummaryDto,
  AgentHardLimitsDto,
  AgentProviderViewDto,
  AgentSettingsDocumentDto,
  AgentSettingsViewDto,
  AgentArtifactStorageSummaryDto,
  AgentWorkspaceRuntimeAvailabilityDto,
  AgentHardLimitPreviewDto,
  AgentTargetDenylistViewDto,
  AgentApprovalBatchViewModel,
  AgentServerClockAnchorViewModel,
} from './api/agent-api';
