import { computed, type ComputedRef } from 'vue';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import type { ConnectionDto, ConnectionFormInput, ConnectionFormUpdate } from '../model/connection';
import { useConnectionsStore } from '../store/connections.store';

export interface ConnectionsController {
  connections: ComputedRef<ConnectionDto[]>;
  loaded: ComputedRef<boolean>;
  load(force?: boolean): Promise<ConnectionDto[]>;
  revalidate(maxAgeMs?: number): Promise<ConnectionDto[]>;
  refresh(id: number): Promise<ConnectionDto>;
  markConnected(id: number, timestamp: number): ConnectionDto | null;
  create(input: ConnectionFormInput): Promise<ConnectionDto>;
  update(id: number, input: ConnectionFormUpdate): Promise<ConnectionDto>;
  remove(id: number): Promise<void>;
  clone(id: number, name: string): Promise<ConnectionDto>;
}

export function useConnections(): ConnectionsController {
  const store = useConnectionsStore();
  return {
    connections: computed(() => store.items),
    loaded: computed(() => store.loaded),
    load: store.load.bind(store),
    revalidate: store.revalidate.bind(store),
    refresh: store.refresh.bind(store),
    markConnected: store.markConnected.bind(store),
    create: store.create.bind(store),
    update: store.update.bind(store),
    remove: store.remove.bind(store),
    clone: store.clone.bind(store),
  };
}

export const refreshConnection = (id: number) => useConnectionsStore().refresh(id);
export const markConnectionConnected = (id: number, timestamp: number) =>
  useConnectionsStore().markConnected(id, timestamp);
export const resetConnectionsCache = (): void => useConnectionsStore().reset();

registerAuthenticatedSessionReset('connections-cache', resetConnectionsCache);
