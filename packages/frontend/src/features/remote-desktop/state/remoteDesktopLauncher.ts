import { computed, shallowReadonly, shallowRef } from 'vue';
import type { RemoteDesktopConnection } from '../model/remote-desktop-types';

const connection = shallowRef<RemoteDesktopConnection | null>(null);

export const remoteDesktopLauncher = {
	connection: shallowReadonly(connection),
	visible: computed(() => connection.value !== null),

	open(next: RemoteDesktopConnection): void {
		connection.value = { id: next.id, name: next.name, type: next.type };
	},

	close(): void {
		connection.value = null;
	},
};
