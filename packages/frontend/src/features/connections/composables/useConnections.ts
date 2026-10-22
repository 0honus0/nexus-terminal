import { computed } from 'vue';
import { useConnectionsStore } from '../store/connections.store';
import type { ConnectionsController } from '../model/connection-types';

export function useConnections(): ConnectionsController {
	const store = useConnectionsStore();
	return {
		connections: computed(() => store.connections),
		loaded: computed(() => store.loaded),
		busy: computed(() => store.busy),
		needsRefresh: computed(() => store.needsRefresh),
		load: store.load,
		revalidate: store.revalidate,
		refresh: store.refresh,
		create: store.create,
		importMany: store.importMany,
		update: store.update,
		remove: store.remove,
		clone: store.clone,
		setCredential: store.setCredential,
		addTag: store.addTag,
	};
}

export const refreshConnection = (id: number) => useConnectionsStore().refresh(id);

export const resetConnectionsCache = (): void => useConnectionsStore().reset();
