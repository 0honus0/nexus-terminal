import { computed } from 'vue';
import type { ProxiesController } from '../model/proxy-types';
import { useProxiesStore } from '../store/proxies.store';

export function useProxies(): ProxiesController {
	const store = useProxiesStore();
	return {
		proxies: computed(() => store.items),
		loaded: computed(() => store.loaded),
		busy: computed(() => store.busy),
		needsRefresh: computed(() => store.needsRefresh),
		load: store.load,
		create: store.create,
		update: store.update,
		remove: store.remove,
	};
}

export const resetProxiesCache = (): void => useProxiesStore().reset();
