export const loadProxiesView = () => import('./views/ProxiesView.vue');

export { resetProxiesCache, useProxies } from './composables/useProxies';

export type { ProxiesController, ProxySummary } from './model/proxy-types';
