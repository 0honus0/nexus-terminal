import { computed, ref } from 'vue';
import { apiErrorMessage, apiErrorStatus } from '@/client/http';
import { sshSuspendApi } from '../api/sshSuspendApi';
import type { SuspendedSession } from '../model/sshSuspend';

const BASE_POLL_MS = 3_000;
const MAX_POLL_MS = 60_000;
const ERROR_POLL_MS = 10_000;

const sessions = ref<SuspendedSession[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let loaded = false;
let loadPromise: Promise<{ ok: boolean; status?: number }> | null = null;
let pollTimer: number | undefined;
let pollIntervalMs = BASE_POLL_MS;
let pollConsumers = 0;

export interface SuspendedAutoTerminationEvent {
  suspendedSessionId: string;
  reason: string;
}

export interface SuspendedAutoTerminationNotice extends SuspendedAutoTerminationEvent {
  name?: string;
}

const handledAutoTerminations = new Set<string>();
const handledAutoTerminationOrder: string[] = [];

export function applySuspendedAutoTermination(
  event: SuspendedAutoTerminationEvent,
): SuspendedAutoTerminationNotice | null {
  const id = event.suspendedSessionId.trim();
  if (!id || handledAutoTerminations.has(id)) return null;
  handledAutoTerminations.add(id);
  handledAutoTerminationOrder.push(id);
  while (handledAutoTerminationOrder.length > 128) {
    const oldest = handledAutoTerminationOrder.shift();
    if (oldest) handledAutoTerminations.delete(oldest);
  }
  const session = sessions.value.find((item) => item.id === id);
  if (session) {
    session.status = 'disconnected';
    session.disconnectedAt = new Date().toISOString();
  }
  return {
    suspendedSessionId: id,
    reason: event.reason,
    ...(session ? { name: session.customName ?? session.connectionName } : {}),
  };
}

const load = async (options: { silent?: boolean; force?: boolean } = {}): Promise<{ ok: boolean; status?: number }> => {
  if (loaded && !options.force && !options.silent) return { ok: true };
  if (loadPromise) {
    const pending = loadPromise;
    if (!options.force) return pending;
    await pending;
    if (loadPromise) return loadPromise;
  }

  loadPromise = (async () => {
    if (!options.silent) {
      loading.value = true;
      error.value = null;
    }
    try {
      sessions.value = await sshSuspendApi.list();
      loaded = true;
      if (!options.silent) error.value = null;
      return { ok: true };
    } catch (cause) {
      if (!options.silent) error.value = apiErrorMessage(cause, 'Failed to load suspended SSH sessions.');
      return { ok: false, status: apiErrorStatus(cause) };
    } finally {
      if (!options.silent) loading.value = false;
      loadPromise = null;
    }
  })();

  return loadPromise;
};

export const refreshSuspendedSessionsCatalog = (): Promise<{ ok: boolean; status?: number }> =>
  load({ silent: true, force: true });

export const findSuspendedSessionByOriginalWorkspace = (workspaceId: string): SuspendedSession | undefined =>
  sessions.value.find((session) => session.status === 'active' && session.originalWorkspaceId === workspaceId);

const schedulePoll = (): void => {
  if (pollConsumers <= 0 || pollTimer !== undefined) return;
  pollTimer = window.setTimeout(async () => {
    pollTimer = undefined;
    if (pollConsumers <= 0) return;
    const result = await load({ silent: true, force: true });
    pollIntervalMs =
      result.status === 429
        ? Math.min(pollIntervalMs * 2, MAX_POLL_MS)
        : result.ok
          ? BASE_POLL_MS
          : Math.min(Math.max(pollIntervalMs, ERROR_POLL_MS), MAX_POLL_MS);
    schedulePoll();
  }, pollIntervalMs);
};

const startPolling = (): void => {
  pollConsumers += 1;
  schedulePoll();
};

const stopPolling = (): void => {
  pollConsumers = Math.max(0, pollConsumers - 1);
  if (pollConsumers > 0) return;
  if (pollTimer !== undefined) window.clearTimeout(pollTimer);
  pollTimer = undefined;
  pollIntervalMs = BASE_POLL_MS;
};

export function useSuspendedSessions() {
  const search = ref('');
  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    if (!term) return sessions.value;
    return sessions.value.filter((session) =>
      `${session.customName ?? ''} ${session.connectionName}`.toLowerCase().includes(term),
    );
  });

  async function rename(session: SuspendedSession, name: string): Promise<string> {
    const authoritativeName = await sshSuspendApi.rename(session.id, name);
    session.customName = authoritativeName.trim() || undefined;
    return authoritativeName;
  }

  async function remove(session: SuspendedSession): Promise<void> {
    if (session.status === 'active') await sshSuspendApi.terminate(session.id);
    else await sshSuspendApi.removeDisconnected(session.id);
    sessions.value = sessions.value.filter((item) => item.id !== session.id);
  }

  return {
    sessions,
    search,
    loading,
    error,
    filtered,
    load,
    startPolling,
    stopPolling,
    rename,
    remove,
    exportLog: sshSuspendApi.exportLog,
  };
}
