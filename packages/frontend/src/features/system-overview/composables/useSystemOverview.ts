import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { apiErrorMessage } from '@/client/http';
import { systemOverviewApi } from '../api/systemOverviewApi';
import type { ResourceStatusDto, SshResourceStatusDto } from '../model/systemOverview';

export interface SystemOverviewLoadOptions {
  local?: boolean;
  remote?: boolean;
}

export interface SystemOverviewController {
  local: Ref<ResourceStatusDto | null>;
  remote: Ref<SshResourceStatusDto[]>;
  loading: ComputedRef<boolean>;
  localLoading: Ref<boolean>;
  remoteLoading: Ref<boolean>;
  localError: Ref<string | null>;
  remoteError: Ref<string | null>;
  load(options?: SystemOverviewLoadOptions): Promise<void>;
  loadLocal(): Promise<void>;
  loadRemote(): Promise<void>;
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

  const loadRemote = async (): Promise<void> => {
    if (remoteLoading.value) return;
    remoteLoading.value = true;
    remoteError.value = null;
    try {
      remote.value = await systemOverviewApi.ssh();
    } catch (cause) {
      remoteError.value = apiErrorMessage(cause, '');
    } finally {
      remoteLoading.value = false;
    }
  };

  const load = async ({ local: includeLocal = true, remote: includeRemote = true }: SystemOverviewLoadOptions = {}) => {
    const jobs: Promise<void>[] = [];
    if (includeLocal) jobs.push(loadLocal());
    else {
      local.value = null;
      localError.value = null;
    }
    if (includeRemote) jobs.push(loadRemote());
    else {
      remote.value = [];
      remoteError.value = null;
    }
    await Promise.all(jobs);
  };

  return {
    local,
    remote,
    loading,
    localLoading,
    remoteLoading,
    localError,
    remoteError,
    load,
    loadLocal,
    loadRemote,
  };
};
