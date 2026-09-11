import { defineAsyncComponent } from 'vue';

export const AgentSettingsPanel = defineAsyncComponent(() => import('./settings/AgentSettingsPanel.vue'));
export const AgentSurfaceHost = defineAsyncComponent(() => import('./host/AgentSurfaceHost.vue'));
export { agentApi, resetAgentCsrf } from './api/agent-api';
export type {
  AgentAppSummary,
  AgentHardLimits,
  AgentProviderView,
  AgentSettingsDocument,
  AgentSettingsView,
  ArtifactStorageSummary,
  WorkspaceRuntimeAvailability,
  HardLimitPreview,
  TargetDenylistView,
} from './api/agent-api';
