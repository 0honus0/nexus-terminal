import { computed, type ComputedRef } from 'vue';
import type { ProxyCreateRequestDto, ProxyDto } from '../model/proxy';
import { useProxiesStore } from '../store/proxies.store';

export interface ProxiesController {
  proxies: ComputedRef<ProxyDto[]>;
  load(force?: boolean): Promise<ProxyDto[]>;
  create(input: ProxyCreateRequestDto): Promise<ProxyDto>;
  update(id: number, input: Partial<ProxyCreateRequestDto>): Promise<ProxyDto>;
  remove(id: number): Promise<void>;
}

export function useProxies(): ProxiesController {
  const store = useProxiesStore();
  return {
    proxies: computed(() => store.items),
    load: store.load.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
  };
}

export const resetProxiesCache = (): void => useProxiesStore().reset();
