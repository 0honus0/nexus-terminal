export const loadProxiesView = () => import('./views/ProxiesView.vue');
export { resetProxiesCache, useProxies } from './composables/useProxies';
export type { ProxiesController } from './composables/useProxies';
export type { ProxyDto, ProxyAuthMethodDto, ProxyCreateRequestDto, ProxyTypeDto } from './model/proxy';
