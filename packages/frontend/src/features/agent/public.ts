import { defineAsyncComponent } from 'vue';

export const AgentSettingsPanel = defineAsyncComponent(() => import('./settings/AgentSettingsPanel.vue'));

export const AgentMaintenancePanel = defineAsyncComponent(() => import('./settings/AgentMaintenancePanel.vue'));

export { loadAgentNextDevView } from './next/public';

export const AgentSurfaceHost = defineAsyncComponent(() => import('./host/AgentSurfaceHost.vue'));
