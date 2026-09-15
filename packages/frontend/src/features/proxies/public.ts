export const loadProxiesView = () => import('./views/ProxiesView.vue');
export { resetProxiesCache, useProxies } from './composables/useProxies';
export type { Proxy, ProxyAuthMethod, ProxyInput, ProxyType } from './model/proxy';
