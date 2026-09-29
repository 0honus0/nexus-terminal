import { computed, ref, type ComputedRef, type Ref } from 'vue';
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
    if (remoteLoading.value) return;
    remoteLoading.value = true;
    remoteError.value = null;
    try {
      const unique = new Map<string, SshResourceTarget>();
      for (const target of await targets()) {
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
      await Promise.all(
        [...unique].map(async ([key, target]) => {
          try {
            update(key, await systemOverviewApi.ssh(target.id));
          } catch (cause) {
            const current = remote.value.find((resource) => resource.key === key);
            if (current)
              update(key, {
                ...current,
                status: undefined,
                error: apiErrorMessage(cause, ''),
                checkedAt: Date.now(),
              });
          }
        }),
      );
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
