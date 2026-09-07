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
import type { StatusChannel } from '../ports/status-channel';
import type { ServerStatusSample, StatusHistory, StatusHistoryPoint } from '../model/status';

export interface StatusMonitorSessionController {
  current: Readonly<Ref<ServerStatusSample | null>>;
  error: Readonly<Ref<string | null>>;
  history: Readonly<Ref<StatusHistory>>;
  available: ComputedRef<boolean>;
  activate(): void;
  deactivate(): void;
  setIntervalSeconds(seconds: number): void;
  workspaceConnected(): Promise<void>;
  workspaceDisconnected(): void;
  dispose(): void;
}

const emptyHistory = (): StatusHistory => ({ cpu: [], memory: [], swap: [], disk: [], networkRx: [], networkTx: [] });
const finiteValue = (value: number | undefined): number => (Number.isFinite(value) ? Number(value) : 0);

export function createStatusMonitorSession(channel: StatusChannel, maxSamples = 1800): StatusMonitorSessionController {
  const current = ref<ServerStatusSample | null>(null);
  const error = ref<string | null>(null);
  const history = ref<StatusHistory>(emptyHistory());
  let sequence = 0;
  let consumerCount = 0;
  let workspaceAvailable = false;
  let sampling = false;
  let disposed = false;
  let intervalSeconds: number | null = null;
  let operation = Promise.resolve();

  const push = (list: StatusHistoryPoint[], time: number, value: number | undefined, sampleSequence: number): void => {
    list.push({ time, value: finiteValue(value), sequence: sampleSequence });
    if (list.length > maxSamples) list.splice(0, list.length - maxSamples);
  };

  const stopEvents = channel.subscribe(
    (sample) => {
      if (disposed) return;
      current.value = sample;
      error.value = null;
      sequence += 1;
      const time = Number.isFinite(sample.timestamp) ? sample.timestamp : Date.now();
      push(history.value.cpu, time, sample.cpuPercent, sequence);
      push(history.value.memory, time, sample.memPercent, sequence);
      push(history.value.swap, time, sample.swapPercent, sequence);
      push(history.value.disk, time, sample.diskPercent, sequence);
      push(history.value.networkRx, time, sample.netRxRate, sequence);
      push(history.value.networkTx, time, sample.netTxRate, sequence);
    },
    (message) => {
      if (!disposed) error.value = message;
    },
  );

  const desiredSampling = (): boolean => !disposed && workspaceAvailable && consumerCount > 0;
  const messageFrom = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = operation.then(task, task).catch((cause) => {
      sampling = false;
      if (!disposed) error.value = messageFrom(cause);
    });
    operation = next;
    return next;
  };

  const syncSampling = (): Promise<void> =>
    enqueue(async () => {
      const desired = desiredSampling();
      if (desired === sampling) return;
      if (!desired) {
        if (sampling && workspaceAvailable) await channel.stop();
        sampling = false;
        return;
      }

      await channel.start();
      if (!desiredSampling()) {
        sampling = false;
        if (workspaceAvailable) await channel.stop();
        return;
      }
      sampling = true;
    });

  const activate = (): void => {
    if (disposed) return;
    consumerCount += 1;
    if (consumerCount === 1) void syncSampling();
  };

  const deactivate = (): void => {
    if (consumerCount === 0) return;
    consumerCount -= 1;
    if (consumerCount === 0) void syncSampling();
  };

  const setIntervalSeconds = (seconds: number): void => {
    const next = Math.max(1, Math.round(Number(seconds) || 1));
    if (intervalSeconds === next) return;
    const hadInterval = intervalSeconds !== null;
    intervalSeconds = next;
    if (!hadInterval || !desiredSampling()) return;
    void enqueue(async () => {
      if (sampling && workspaceAvailable) {
        await channel.stop();
        sampling = false;
      }
      if (!desiredSampling()) return;
      await channel.start();
      sampling = desiredSampling();
    });
  };

  const workspaceConnected = async (): Promise<void> => {
    if (disposed) return;
    workspaceAvailable = true;
    await syncSampling();
  };

  const workspaceDisconnected = (): void => {
    workspaceAvailable = false;
    sampling = false;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    consumerCount = 0;
    const shouldStop = workspaceAvailable && sampling;
    workspaceAvailable = false;
    sampling = false;
    stopEvents();
    if (shouldStop) void Promise.resolve(channel.stop()).catch(() => undefined);
  };

  return {
    current: shallowReadonly(current),
    error: shallowReadonly(error),
    history: shallowReadonly(history),
    available: computed(() => Boolean(current.value)),
    activate,
    deactivate,
    setIntervalSeconds,
    workspaceConnected,
    workspaceDisconnected,
    dispose,
  };
}

export function useStatusMonitor(controller: StatusMonitorSessionController, intervalSeconds?: () => number) {
  let active = false;
  const activate = (): void => {
    if (active) return;
    active = true;
    controller.activate();
  };
  const deactivate = (): void => {
    if (!active) return;
    active = false;
    controller.deactivate();
  };

  if (intervalSeconds) watch(intervalSeconds, (value) => controller.setIntervalSeconds(value), { immediate: true });
  onMounted(activate);
  onActivated(activate);
  onDeactivated(deactivate);
  onBeforeUnmount(deactivate);
  return controller;
}
