import { computed, shallowReadonly, shallowRef } from 'vue';
import type { RemoteDesktopConnection } from '../model/remoteDesktop';

const connection = shallowRef<RemoteDesktopConnection | null>(null);

export const remoteDesktopLauncher = {
  connection: shallowReadonly(connection),
  visible: computed(() => connection.value !== null),
  open(next: RemoteDesktopConnection): void {
    connection.value = next;
  },
  close(): void {
    connection.value = null;
  },
};
