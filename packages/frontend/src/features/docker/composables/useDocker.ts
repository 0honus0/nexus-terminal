import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowReadonly,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import type { DockerChannel } from '../ports/docker-channel';
import type { DockerCommand, DockerContainer } from '../model/docker';

export interface DockerSessionController {
  available: Readonly<Ref<boolean>>;
  containers: Readonly<Ref<DockerContainer[]>>;
  loading: Readonly<Ref<boolean>>;
  error: Readonly<Ref<string | null>>;
  expandedContainerIds: ComputedRef<ReadonlySet<string>>;
  activate(): void;
  deactivate(): void;
  setIntervalSeconds(seconds: number): void;
  setDefaultExpand(expanded: boolean): void;
  workspaceConnected(): void;
  workspaceDisconnected(): void;
  refresh(force?: boolean): Promise<void>;
  command(containerId: string, action: DockerCommand): Promise<void>;
  toggleExpand(containerId: string): void;
  dispose(): void;
}

export function createDockerSession(channel: DockerChannel): DockerSessionController {
  const available = ref(false);
  const containers = ref<DockerContainer[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const expanded = ref(new Set<string>());

  let workspaceAvailable = false;
  let consumerCount = 0;
  let intervalSeconds = 5;
  let defaultExpand = false;
  let initialLoadDone = false;
  let disposed = false;
  let generation = 0;
  let timer: number | undefined;
  let refreshPromise: Promise<void> | null = null;

  const desiredPolling = () => !disposed && workspaceAvailable && consumerCount > 0;
  const stopTimer = () => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
  };
  const startTimer = () => {
    stopTimer();
    if (!desiredPolling()) return;
    timer = window.setInterval(() => void refresh(), Math.max(1, intervalSeconds) * 1000);
  };
  const pruneExpansion = (nextContainers: DockerContainer[]) => {
    const current = new Set(nextContainers.map((container) => container.id));
    expanded.value = new Set([...expanded.value].filter((id) => current.has(id)));
  };
  const applyStatus = (nextContainers: DockerContainer[], nextAvailable: boolean) => {
    available.value = nextAvailable;
    containers.value = nextAvailable ? nextContainers : [];
    pruneExpansion(containers.value);
    if (nextAvailable && !initialLoadDone) {
      initialLoadDone = true;
      if (defaultExpand) expanded.value = new Set(containers.value.map((container) => container.id));
    }
    error.value = null;
  };
  const resetForDisconnect = () => {
    generation += 1;
    stopTimer();
    refreshPromise = null;
    loading.value = false;
    available.value = false;
    containers.value = [];
    error.value = null;
    expanded.value = new Set();
    initialLoadDone = false;
  };

  const performRefresh = async (requestGeneration: number) => {
    loading.value = true;
    try {
      const status = await channel.getStatus();
      if (disposed || requestGeneration !== generation || !workspaceAvailable) return;
      applyStatus(status.containers, status.available);
    } catch (cause) {
      if (disposed || requestGeneration !== generation || !workspaceAvailable) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (!disposed && requestGeneration === generation) loading.value = false;
    }
  };

  const refresh = async (force = false): Promise<void> => {
    if (!desiredPolling()) return;
    if (refreshPromise) {
      if (!force) return refreshPromise;
      await refreshPromise;
      if (!desiredPolling()) return;
    }
    const requestGeneration = generation;
    const request = performRefresh(requestGeneration);
    const tracked = request.finally(() => {
      if (refreshPromise === tracked) refreshPromise = null;
    });
    refreshPromise = tracked;
    await tracked;
  };

  const startPolling = () => {
    if (!desiredPolling()) return;
    void refresh();
    startTimer();
  };

  const activate = () => {
    if (disposed) return;
    consumerCount += 1;
    if (consumerCount === 1) startPolling();
  };
  const deactivate = () => {
    if (consumerCount === 0) return;
    consumerCount -= 1;
    if (consumerCount !== 0) return;
    generation += 1;
    stopTimer();
    refreshPromise = null;
    loading.value = false;
  };
  const setIntervalSeconds = (seconds: number) => {
    const next = Math.min(86_400, Math.max(1, Math.round(Number(seconds) || 5)));
    if (next === intervalSeconds) return;
    intervalSeconds = next;
    if (desiredPolling()) startTimer();
  };
  const setDefaultExpand = (next: boolean) => {
    defaultExpand = Boolean(next);
  };
  const workspaceConnected = () => {
    if (disposed) return;
    workspaceAvailable = true;
    generation += 1;
    if (consumerCount > 0) startPolling();
  };
  const workspaceDisconnected = () => {
    workspaceAvailable = false;
    resetForDisconnect();
  };
  const command = async (containerId: string, action: DockerCommand) => {
    await channel.command(containerId, action);
    await refresh(true);
  };
  const toggleExpand = (containerId: string) => {
    const next = new Set(expanded.value);
    if (next.has(containerId)) next.delete(containerId);
    else next.add(containerId);
    expanded.value = next;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    consumerCount = 0;
    workspaceAvailable = false;
    resetForDisconnect();
  };

  return {
    available: shallowReadonly(available),
    containers: shallowReadonly(containers),
    loading: shallowReadonly(loading),
    error: shallowReadonly(error),
    expandedContainerIds: computed<ReadonlySet<string>>(() => expanded.value),
    activate,
    deactivate,
    setIntervalSeconds,
    setDefaultExpand,
    workspaceConnected,
    workspaceDisconnected,
    refresh,
    command,
    toggleExpand,
    dispose,
  };
}

export function useDocker(
  controller: DockerSessionController,
  intervalSeconds?: () => number,
  defaultExpand?: () => boolean,
): DockerSessionController {
  let active = false;
  const activate = () => {
    if (active) return;
    active = true;
    controller.activate();
  };
  const deactivate = () => {
    if (!active) return;
    active = false;
    controller.deactivate();
  };

  if (intervalSeconds) watch(intervalSeconds, (value) => controller.setIntervalSeconds(value), { immediate: true });
  if (defaultExpand) watch(defaultExpand, (value) => controller.setDefaultExpand(value), { immediate: true });
  onMounted(activate);
  onActivated(activate);
  onDeactivated(deactivate);
  onBeforeUnmount(deactivate);
  return controller;
}
