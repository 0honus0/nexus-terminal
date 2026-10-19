import { defineAsyncComponent } from 'vue';

export const AgentSettingsPanel = defineAsyncComponent(() => import('./settings/AgentSettingsPanel.vue'));

export { loadAgentNextDevView } from './next/public';

export const AgentSurfaceHost = defineAsyncComponent(() => import('./host/AgentSurfaceHost.vue'));
