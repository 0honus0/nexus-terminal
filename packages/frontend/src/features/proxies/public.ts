export const loadProxiesView = () => import('./views/ProxiesView.vue');
export { useProxies } from './composables/useProxies';
export type { Proxy, ProxyAuthMethod, ProxyInput, ProxyType } from './model/proxy';
