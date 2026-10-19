import { computed } from 'vue';
import type { ConnectionTagsController } from '../model/tag-types';
import { useTagsStore } from '../store/tags.store';

export function useConnectionTags(): ConnectionTagsController {
	const store = useTagsStore();
	return {
		tags: computed(() => store.items),
		loaded: computed(() => store.loaded),
		busy: computed(() => store.busy),
		needsRefresh: computed(() => store.needsRefresh),
		load: store.load,
		revalidate: store.revalidate,
		create: store.create,
		rename: store.rename,
		remove: store.remove,
		ensure: store.ensure,
		setConnections: store.setConnections,
	};
}

export const resetConnectionTagsCache = (): void => useTagsStore().reset();
