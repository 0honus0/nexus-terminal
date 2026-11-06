export { useSystemOverview } from './composables/useSystemOverview';

export type { SystemOverviewController, SshResourceTarget } from './model/system-overview-types';

export const loadHostDiagnosticsPanel = () => import('./components/HostDiagnosticsPanel.vue');
