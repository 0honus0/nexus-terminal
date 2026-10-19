import { computed } from 'vue';
import type { SshKeysController } from '../model/ssh-key-types';
import { useSshKeysStore } from '../store/sshKeys.store';

export function useSshKeys(): SshKeysController {
	const store = useSshKeysStore();
	return {
		keys: computed(() => store.items),
		loaded: computed(() => store.loaded),
		busy: computed(() => store.busy),
		needsRefresh: computed(() => store.needsRefresh),
		load: store.load,
		create: store.create,
		update: store.update,
		remove: store.remove,
	};
}
