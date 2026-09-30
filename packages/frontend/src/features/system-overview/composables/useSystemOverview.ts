import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue';
import { apiErrorMessage } from '@/client/http';
import { systemOverviewApi } from '../api/systemOverviewApi';
import type { ResourceStatusDto, SshResourceStatusDto } from '../model/systemOverview';

export interface SshResourceTarget {
  id: number;
  name: string | null;
  username: string;
  host: string;
  port: number;
}

export interface SystemOverviewController {
  local: Ref<ResourceStatusDto | null>;
  remote: Ref<SshResourceStatusDto[]>;
  loading: ComputedRef<boolean>;
  localLoading: Ref<boolean>;
  remoteLoading: Ref<boolean>;
  localError: Ref<string | null>;
  remoteError: Ref<string | null>;
  loadLocal(): Promise<void>;
  loadRemote(targets: () => Promise<SshResourceTarget[]>): Promise<void>;
}

export const useSystemOverview = (): SystemOverviewController => {
  const local = ref<ResourceStatusDto | null>(null);
  const remote = ref<SshResourceStatusDto[]>([]);
  const localLoading = ref(false);
  const remoteLoading = ref(false);
  const localError = ref<string | null>(null);
  const remoteError = ref<string | null>(null);
  const loading = computed(() => localLoading.value || remoteLoading.value);
  const remoteAbort = new AbortController();
  onScopeDispose(() => remoteAbort.abort());
  const waitForNextHost = (): Promise<void> =>
    new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        remoteAbort.signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, 200);
      remoteAbort.signal.addEventListener('abort', finish, { once: true });
    });

  const loadLocal = async (): Promise<void> => {
    if (localLoading.value) return;
    localLoading.value = true;
    localError.value = null;
    try {
      local.value = await systemOverviewApi.local();
    } catch (cause) {
      localError.value = apiErrorMessage(cause, '');
    } finally {
      localLoading.value = false;
    }
  };

  const loadRemote = async (targets: () => Promise<SshResourceTarget[]>): Promise<void> => {
    if (remoteLoading.value || remoteAbort.signal.aborted) return;
    remoteLoading.value = true;
    remoteError.value = null;
    try {
      const unique = new Map<string, SshResourceTarget>();
      const items = await targets();
      if (remoteAbort.signal.aborted) return;
      for (const target of items) {
        const key = `${target.host.trim().toLowerCase()}:${target.port}`;
        if (!unique.has(key)) unique.set(key, target);
      }
      const previous = new Map(remote.value.map((resource) => [resource.key, resource]));
      remote.value = [...unique]
        .sort((a, b) => (a[1].name || a[1].host).localeCompare(b[1].name || b[1].host))
        .map(([key, target]) => {
          const old = previous.get(key);
          return {
            ...old,
            key,
            connectionId: target.id,
            name: target.name || target.host,
            username: target.username,
            host: target.host,
            port: target.port,
            checkedAt: old?.checkedAt ?? 0,
          };
        });
      const update = (key: string, value: SshResourceStatusDto) => {
        remote.value = remote.value.map((resource) => (resource.key === key ? value : resource));
      };
      for (const [key, target] of unique) {
        if (remoteAbort.signal.aborted) break;
        try {
          const result = await systemOverviewApi.ssh(target.id, remoteAbort.signal);
          if (remoteAbort.signal.aborted) break;
          update(key, result);
        } catch (cause) {
          if (remoteAbort.signal.aborted) break;
          const current = remote.value.find((resource) => resource.key === key);
          if (current)
            update(key, {
              ...current,
              status: undefined,
              error: apiErrorMessage(cause, ''),
              checkedAt: Date.now(),
            });
        }
        await waitForNextHost();
      }
    } catch (cause) {
      remoteError.value = apiErrorMessage(cause, '');
    } finally {
      remoteLoading.value = false;
    }
  };

  return {
    local,
    remote,
    loading,
    localLoading,
    remoteLoading,
    localError,
    remoteError,
    loadLocal,
    loadRemote,
  };
};
