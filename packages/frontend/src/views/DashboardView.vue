<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ja, zhCN } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { useI18n } from 'vue-i18n';
import { useConnectionsStore, type ConnectionInfo } from '../stores/connections.store';
import { useAuditLogStore } from '../stores/audit.store';
import { useSessionStore } from '../stores/session.store';
import { useTagsStore } from '../stores/tags.store';
import type { TagInfo } from '../stores/tags.store';
import type { SortField, SortOrder } from '../stores/settings.store';
import { useSettingsStore } from '../stores/settings.store';
import apiClient from '../utils/apiClient';
import type { ServerStatus } from '../types/server.types';

const { t, locale } = useI18n();
const connectionsStore = useConnectionsStore();
const auditLogStore = useAuditLogStore();
const sessionStore = useSessionStore();
const tagsStore = useTagsStore();
const settingsStore = useSettingsStore();

const { connections, isLoading: isLoadingConnections } = storeToRefs(connectionsStore);
const { logs: auditLogs, isLoading: isLoadingLogs } = storeToRefs(auditLogStore);
const { tags, isLoading: isLoadingTags } = storeToRefs(tagsStore);
const { sessions } = storeToRefs(sessionStore);
const {
  dashboardShowLocalResourcesBoolean,
  dashboardShowRemoteResourcesBoolean,
  statusMonitorIntervalSecondsNumber,
} = storeToRefs(settingsStore);

const LS_SORT_BY_KEY = 'dashboard_connections_sort_by';
const LS_SORT_ORDER_KEY = 'dashboard_connections_sort_order';
const LS_FILTER_TAG_KEY = 'dashboard_connections_filter_tag';
const maxRecentLogs = 5;

const sortOptions: { value: SortField; labelKey: string }[] = [
  { value: 'last_connected_at', labelKey: 'dashboard.sortOptions.lastConnected' },
  { value: 'name', labelKey: 'dashboard.sortOptions.name' },
  { value: 'type', labelKey: 'dashboard.sortOptions.type' },
  { value: 'updated_at', labelKey: 'dashboard.sortOptions.updated' },
  { value: 'created_at', labelKey: 'dashboard.sortOptions.created' },
];

const getInitialSelectedTagId = (): number | null => {
  const storedValue = localStorage.getItem(LS_FILTER_TAG_KEY);
  return storedValue && storedValue !== 'null' ? Number.parseInt(storedValue, 10) : null;
};

const localSortBy = ref<SortField>((localStorage.getItem(LS_SORT_BY_KEY) as SortField) || 'last_connected_at');
const localSortOrder = ref<SortOrder>((localStorage.getItem(LS_SORT_ORDER_KEY) as SortOrder) || 'desc');
const selectedTagId = ref<number | null>(getInitialSelectedTagId());
const searchQuery = ref('');
const localSystemStatus = ref<(ServerStatus & { uptimeSeconds?: number }) | null>(null);
const localSystemError = ref('');
let localSystemTimer: ReturnType<typeof setInterval> | null = null;
const activatedRemoteStatusSessions = new Set<string>();

const filteredAndSortedConnections = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  const factor = localSortOrder.value === 'desc' ? -1 : 1;
  const filterTagId = selectedTagId.value;

  const filtered = connections.value.filter((connection) => {
    if (filterTagId !== null && !connection.tag_ids?.includes(filterTagId)) return false;
    if (!query) return true;
    return [connection.name, connection.username, connection.host, String(connection.port)]
      .some((value) => value?.toLowerCase().includes(query));
  });

  return filtered.sort((a, b) => {
    switch (localSortBy.value) {
      case 'name':
        return (a.name || '').localeCompare(b.name || '') * factor;
      case 'type':
        return (a.type || '').localeCompare(b.type || '') * factor;
      case 'created_at':
        return ((a.created_at ?? 0) - (b.created_at ?? 0)) * factor;
      case 'updated_at':
        return ((a.updated_at ?? 0) - (b.updated_at ?? 0)) * factor;
      case 'last_connected_at': {
        const aTime = a.last_connected_at ?? (localSortOrder.value === 'desc' ? -Infinity : Infinity);
        const bTime = b.last_connected_at ?? (localSortOrder.value === 'desc' ? -Infinity : Infinity);
        return (aTime - bTime) * factor;
      }
      default:
        return 0;
    }
  });
});

const recentAuditLogs = computed(() => auditLogs.value.slice(0, maxRecentLogs));
const usedConnectionCount = computed(() => connections.value.filter((connection) => Boolean(connection.last_connected_at)).length);
const latestConnection = computed(() => {
  return [...connections.value]
    .filter((connection) => Boolean(connection.last_connected_at))
    .sort((a, b) => (b.last_connected_at ?? 0) - (a.last_connected_at ?? 0))[0] ?? null;
});
const remoteResourceSessions = computed(() => {
  return [...sessions.value.entries()]
    .filter(([, session]) => connections.value.some((connection) => (
      String(connection.id) === String(session.connectionId) && connection.type === 'SSH'
    )))
    .map(([sessionId, session]) => ({
      sessionId,
      name: session.connectionName,
      status: session.statusMonitorManager.serverStatus.value,
      error: session.statusMonitorManager.statusError.value,
    }));
});
const resourcePercent = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value!)));
};
const resourceRingStyle = (
  value: number | undefined,
  color: 'primary' | 'success' | 'warning' = 'primary',
): Record<string, string> => {
  const percent = resourcePercent(value);
  const colorValue = color === 'success'
    ? 'var(--color-success)'
    : color === 'warning'
      ? 'var(--color-warning)'
      : 'var(--link-active-color)';
  return {
    background: `conic-gradient(${colorValue} 0 ${percent}%, var(--border-color) ${percent}% 100%)`,
  };
};
const formatMemory = (value: number | undefined): string => {
  if (!Number.isFinite(value)) return '—';
  if (value! >= 1024) return `${(value! / 1024).toFixed(value! >= 10240 ? 0 : 1)} GB`;
  return `${Math.round(value!)} MB`;
};

const dateFnsLocales: Record<string, Locale> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'ja-JP': ja,
  en: enUS,
  zh: zhCN,
  ja,
};

const formatRelativeTime = (timestampInSeconds: number | null | undefined): string => {
  if (!timestampInSeconds) return t('connections.status.never');
  try {
    const currentLocale = locale.value;
    const selectedLocale = dateFnsLocales[currentLocale]
      ?? dateFnsLocales[currentLocale.split('-')[0]]
      ?? enUS;
    return formatDistanceToNow(new Date(timestampInSeconds * 1000), {
      addSuffix: true,
      locale: selectedLocale,
    });
  } catch {
    return String(timestampInSeconds);
  }
};

const getTagNames = (tagIds: number[] | undefined): string[] => {
  if (!tagIds?.length) return [];
  const allTags = tags.value as TagInfo[];
  return tagIds
    .map((id) => allTags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => Boolean(name));
};

const getActionTranslation = (actionType: string): string => {
  const key = `auditLog.actions.${actionType}`;
  const translated = t(key);
  return translated === key ? actionType : translated;
};

const isFailedAction = (actionType: string): boolean => {
  const normalized = actionType.toLowerCase();
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('denied');
};

const auditSummary = (details: unknown): string => {
  if (!details || typeof details !== 'object') return '';
  const record = details as Record<string, unknown>;
  if (typeof record.raw === 'string') return record.raw.slice(0, 120);

  const connectionName = typeof record.connectionName === 'string'
    ? record.connectionName
    : typeof record.connection_name === 'string'
      ? record.connection_name
      : '';
  const username = typeof record.username === 'string' ? record.username : '';
  const host = typeof record.host === 'string'
    ? record.host
    : typeof record.ip === 'string'
      ? record.ip
      : '';
  const subject = typeof record.command === 'string'
    ? record.command
    : typeof record.path === 'string'
      ? record.path
      : typeof record.filename === 'string'
        ? record.filename
        : '';

  return [connectionName, username && host ? `${username}@${host}` : username || host, subject]
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');
};

const connectTo = (connection: ConnectionInfo) => {
  sessionStore.handleConnectRequest(connection);
};

const toggleSortOrder = () => {
  localSortOrder.value = localSortOrder.value === 'asc' ? 'desc' : 'asc';
};

const isAscending = computed(() => localSortOrder.value === 'asc');

const fetchLocalSystemStatus = async () => {
  if (!dashboardShowLocalResourcesBoolean.value) return;
  try {
    const response = await apiClient.get<ServerStatus & { uptimeSeconds?: number }>('/system/status');
    localSystemStatus.value = response.data;
    localSystemError.value = '';
  } catch (error: any) {
    localSystemError.value = error?.response?.data?.message || error?.message || t('dashboard.resources.unavailable');
  }
};

const stopLocalSystemPolling = () => {
  if (localSystemTimer) clearInterval(localSystemTimer);
  localSystemTimer = null;
};

const syncLocalSystemPolling = () => {
  stopLocalSystemPolling();
  if (!dashboardShowLocalResourcesBoolean.value) {
    localSystemStatus.value = null;
    localSystemError.value = '';
    return;
  }
  void fetchLocalSystemStatus();
  localSystemTimer = setInterval(
    () => void fetchLocalSystemStatus(),
    Math.max(1, statusMonitorIntervalSecondsNumber.value) * 1000,
  );
};

const syncRemoteStatusSubscriptions = () => {
  const desiredSessionIds = dashboardShowRemoteResourcesBoolean.value
    ? new Set(
      [...sessions.value.entries()]
        .filter(([, session]) => connections.value.some((connection) => (
          String(connection.id) === String(session.connectionId) && connection.type === 'SSH'
        )))
        .map(([sessionId]) => sessionId),
    )
    : new Set<string>();

  for (const sessionId of [...activatedRemoteStatusSessions]) {
    if (desiredSessionIds.has(sessionId)) continue;
    sessions.value.get(sessionId)?.statusMonitorManager.deactivate();
    activatedRemoteStatusSessions.delete(sessionId);
  }

  for (const sessionId of desiredSessionIds) {
    if (activatedRemoteStatusSessions.has(sessionId)) continue;
    const session = sessions.value.get(sessionId);
    if (!session) continue;
    session.statusMonitorManager.activate();
    activatedRemoteStatusSessions.add(sessionId);
  }
};

watch(localSortBy, (value) => localStorage.setItem(LS_SORT_BY_KEY, value));
watch(localSortOrder, (value) => localStorage.setItem(LS_SORT_ORDER_KEY, value));
watch(selectedTagId, (value) => localStorage.setItem(LS_FILTER_TAG_KEY, value === null ? 'null' : String(value)));
watch(
  [dashboardShowLocalResourcesBoolean, statusMonitorIntervalSecondsNumber],
  syncLocalSystemPolling,
  { immediate: true },
);
watch(
  () => [
    dashboardShowRemoteResourcesBoolean.value,
    [...sessions.value.keys()].join('|'),
    connections.value.map((connection) => `${connection.id}:${connection.type}`).join('|'),
  ],
  syncRemoteStatusSubscriptions,
  { immediate: true },
);

onMounted(async () => {
  await Promise.allSettled([
    connectionsStore.fetchConnections(),
    auditLogStore.fetchLogs({ page: 1, limit: maxRecentLogs, sortOrder: 'desc', isDashboardRequest: true }),
    tagsStore.fetchTags(),
  ]);
});

onBeforeUnmount(() => {
  stopLocalSystemPolling();
  for (const sessionId of activatedRemoteStatusSessions) {
    sessions.value.get(sessionId)?.statusMonitorManager.deactivate();
  }
  activatedRemoteStatusSessions.clear();
});
</script>

<template>
  <main data-testid="dashboard-view" class="min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8 lg:py-7">
    <div class="mx-auto w-full max-w-[1680px] space-y-5">
      <section data-testid="dashboard-overview" class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div class="grid gap-6 bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div class="min-w-0">
            <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              NEXUS · {{ t('dashboard.workspaceLabel', '远程工作台') }}
            </div>
            <h1 class="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{{ t('nav.dashboard') }}</h1>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
              {{ t('dashboard.subtitle', '快速查看并进入你的远程连接') }}
            </p>

            <div v-if="latestConnection" class="mt-5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
              <span class="text-xs text-text-alt">{{ t('dashboard.latestConnection', '最近连接') }}</span>
              <strong class="max-w-64 truncate text-sm font-semibold" :title="latestConnection.name || latestConnection.host">
                {{ latestConnection.name || latestConnection.host }}
              </strong>
              <span class="hidden truncate font-mono text-xs text-text-secondary sm:inline">
                {{ latestConnection.username }}@{{ latestConnection.host }}:{{ latestConnection.port }}
              </span>
              <span class="text-xs text-text-alt">{{ formatRelativeTime(latestConnection.last_connected_at) }}</span>
              <button
                type="button"
                class="h-8 rounded-md border border-primary/35 bg-primary/10 px-3 text-xs font-medium text-primary transition hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/50"
                @click="connectTo(latestConnection)"
              >
                {{ t('dashboard.reconnect', '重新连接') }}
              </button>
            </div>
          </div>

          <div class="min-w-0 space-y-3 lg:min-w-[430px]">
            <div class="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-background/50">
              <div class="border-r border-border px-4 py-4">
                <div class="text-[10px] font-medium uppercase tracking-[0.1em] text-text-alt">{{ t('dashboard.totalConnections', '连接总数') }}</div>
                <strong data-testid="dashboard-total-connections" class="mt-2 block text-2xl font-semibold tabular-nums">{{ connections.length }}</strong>
              </div>
              <div class="border-r border-border px-4 py-4">
                <div class="text-[10px] font-medium uppercase tracking-[0.1em] text-text-alt">{{ t('dashboard.usedConnections', '已有连接记录') }}</div>
                <div class="mt-2 flex items-baseline gap-1">
                  <strong data-testid="dashboard-used-connections" class="text-2xl font-semibold tabular-nums">{{ usedConnectionCount }}</strong>
                  <span class="text-[11px] text-text-alt">/ {{ connections.length }}</span>
                </div>
              </div>
              <div class="px-4 py-4">
                <div class="text-[10px] font-medium uppercase tracking-[0.1em] text-text-alt">{{ t('dashboard.tagCount', '标签数量') }}</div>
                <strong data-testid="dashboard-tag-count" class="mt-2 block text-2xl font-semibold tabular-nums">{{ tags.length }}</strong>
              </div>
            </div>

            <div
              v-if="dashboardShowLocalResourcesBoolean"
              data-testid="dashboard-local-resources"
              class="rounded-xl border border-primary/20 bg-background/45 px-4 py-3.5"
            >
              <div class="mb-3 flex min-w-0 items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs font-semibold">{{ t('dashboard.resources.local', 'Nexus 本机') }}</div>
                  <div v-if="localSystemStatus?.osName" class="mt-0.5 truncate text-[10px] text-text-alt" :title="localSystemStatus.osName">{{ localSystemStatus.osName }}</div>
                </div>
                <span class="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">{{ t('dashboard.resources.live', '实时') }}</span>
              </div>

              <div v-if="localSystemStatus" class="grid grid-cols-3 gap-4">
                <div class="text-center">
                  <div data-testid="dashboard-local-cpu-ring" class="mx-auto h-16 w-16 rounded-full p-[5px]" :style="resourceRingStyle(localSystemStatus.cpuPercent)">
                    <div class="flex h-full w-full items-center justify-center rounded-full bg-card">
                      <strong class="text-sm tabular-nums">{{ resourcePercent(localSystemStatus.cpuPercent) }}%</strong>
                    </div>
                  </div>
                  <div class="mt-1.5 text-[10px] font-medium text-text-alt">CPU</div>
                </div>
                <div class="text-center" :title="`${formatMemory(localSystemStatus.memUsed)} / ${formatMemory(localSystemStatus.memTotal)}`">
                  <div data-testid="dashboard-local-memory-ring" class="mx-auto h-16 w-16 rounded-full p-[5px]" :style="resourceRingStyle(localSystemStatus.memPercent, 'success')">
                    <div class="flex h-full w-full items-center justify-center rounded-full bg-card">
                      <strong class="text-sm tabular-nums">{{ resourcePercent(localSystemStatus.memPercent) }}%</strong>
                    </div>
                  </div>
                  <div class="mt-1.5 text-[10px] font-medium text-text-alt">{{ t('dashboard.resources.memory', '内存') }}</div>
                </div>
                <div class="text-center">
                  <div data-testid="dashboard-local-disk-ring" class="mx-auto h-16 w-16 rounded-full p-[5px]" :style="resourceRingStyle(localSystemStatus.diskPercent, 'warning')">
                    <div class="flex h-full w-full items-center justify-center rounded-full bg-card">
                      <strong class="text-sm tabular-nums">{{ localSystemStatus.diskPercent === undefined ? '—' : `${resourcePercent(localSystemStatus.diskPercent)}%` }}</strong>
                    </div>
                  </div>
                  <div class="mt-1.5 text-[10px] font-medium text-text-alt">{{ t('dashboard.resources.disk', '根磁盘') }}</div>
                </div>
              </div>
              <div v-else-if="localSystemError" class="py-3 text-xs text-error">{{ localSystemError }}</div>
              <div v-else class="py-3 text-xs text-text-alt">{{ t('common.loading') }}</div>
            </div>
          </div>
        </div>

      </section>

      <div
        :class="dashboardShowRemoteResourcesBoolean
          ? 'grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)] xl:items-start'
          : 'grid grid-cols-1 gap-5'"
      >
      <section
        v-if="dashboardShowRemoteResourcesBoolean"
        data-testid="dashboard-system-resources"
        class="order-2 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      >
        <header class="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 class="text-base font-semibold">{{ t('dashboard.resources.sshTitle', 'SSH 资源') }}</h2>
            <p class="mt-0.5 text-xs text-text-secondary">{{ t('dashboard.resources.sshHint', '活动 SSH 会话的实时资源') }}</p>
          </div>
          <div class="flex items-center gap-2 text-[11px]">
            <span class="rounded-full border border-border bg-header/40 px-2.5 py-1 text-text-secondary">
              {{ remoteResourceSessions.length }} {{ t('dashboard.resources.remote', '远程主机') }}
            </span>
            <span class="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 font-medium text-success">
              {{ t('dashboard.resources.live', '实时') }}
            </span>
          </div>
        </header>

        <div class="space-y-3 p-4 sm:p-5">

          <article
            v-for="remote in dashboardShowRemoteResourcesBoolean ? remoteResourceSessions : []"
            :key="remote.sessionId"
            :data-testid="`dashboard-remote-resource-${remote.sessionId}`"
            class="rounded-xl border border-border bg-header/20 p-4"
          >
            <div class="flex min-w-0 items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="truncate text-sm font-semibold" :title="remote.name">{{ remote.name }}</h3>
                <p class="mt-1 text-[11px] text-text-alt">{{ t('dashboard.resources.remoteSession', '活动 SSH 会话') }}</p>
              </div>
              <span class="rounded border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-secondary">SSH</span>
            </div>

            <div v-if="remote.status" class="mt-4 grid grid-cols-3 gap-3">
              <div class="text-center">
                <div :data-testid="`dashboard-resource-ring-${remote.sessionId}-cpu`" class="mx-auto h-16 w-16 rounded-full p-[5px]" :style="resourceRingStyle(remote.status.cpuPercent)">
                  <div class="flex h-full w-full items-center justify-center rounded-full bg-card">
                    <strong class="text-sm tabular-nums">{{ resourcePercent(remote.status.cpuPercent) }}%</strong>
                  </div>
                </div>
                <div class="mt-1.5 text-[10px] font-medium text-text-alt">CPU</div>
              </div>
              <div class="text-center" :title="`${formatMemory(remote.status.memUsed)} / ${formatMemory(remote.status.memTotal)}`">
                <div :data-testid="`dashboard-resource-ring-${remote.sessionId}-memory`" class="mx-auto h-16 w-16 rounded-full p-[5px]" :style="resourceRingStyle(remote.status.memPercent, 'success')">
                  <div class="flex h-full w-full items-center justify-center rounded-full bg-card">
                    <strong class="text-sm tabular-nums">{{ resourcePercent(remote.status.memPercent) }}%</strong>
                  </div>
                </div>
                <div class="mt-1.5 text-[10px] font-medium text-text-alt">{{ t('dashboard.resources.memory', '内存') }}</div>
              </div>
              <div class="text-center">
                <div :data-testid="`dashboard-resource-ring-${remote.sessionId}-disk`" class="mx-auto h-16 w-16 rounded-full p-[5px]" :style="resourceRingStyle(remote.status.diskPercent, 'warning')">
                  <div class="flex h-full w-full items-center justify-center rounded-full bg-card">
                    <strong class="text-sm tabular-nums">{{ remote.status.diskPercent === undefined ? '—' : `${resourcePercent(remote.status.diskPercent)}%` }}</strong>
                  </div>
                </div>
                <div class="mt-1.5 text-[10px] font-medium text-text-alt">{{ t('dashboard.resources.disk', '根磁盘') }}</div>
              </div>
            </div>
            <div v-else-if="remote.error" class="mt-4 truncate text-xs text-error" :title="remote.error">{{ remote.error }}</div>
            <div v-else class="mt-4 text-xs text-text-alt">{{ t('dashboard.resources.waiting', '等待数据') }}</div>
          </article>

          <div
            v-if="dashboardShowRemoteResourcesBoolean && remoteResourceSessions.length === 0"
            data-testid="dashboard-remote-resources"
            class="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-text-alt"
          >
            {{ t('dashboard.resources.noRemoteSessions', '当前没有活动 SSH 会话') }}
          </div>
          <div v-else-if="dashboardShowRemoteResourcesBoolean" data-testid="dashboard-remote-resources" class="sr-only">
            {{ remoteResourceSessions.length }}
          </div>
        </div>
      </section>

        <section
          data-testid="dashboard-connections"
          class="order-1 min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        >
          <div class="border-b border-border px-4 py-4 sm:px-5">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                  <i class="fas fa-bolt text-sm"></i>
                </span>
                <div class="min-w-0">
                  <h2 class="text-base font-semibold">{{ t('dashboard.quickConnect', '快速连接') }}</h2>
                  <p class="truncate text-xs text-text-secondary">
                    {{ t('dashboard.quickConnectHint', '查找连接并直接进入终端') }}
                  </p>
                </div>
              </div>
              <span class="shrink-0 text-xs text-text-alt">
                {{ filteredAndSortedConnections.length }} / {{ connections.length }}
              </span>
            </div>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_auto_auto_auto]">
              <label class="relative min-w-0">
                <span class="sr-only">{{ t('dashboard.searchConnectionsPlaceholder', '搜索连接...') }}</span>
                <i class="fas fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-alt" aria-hidden="true"></i>
                <input
                  v-model="searchQuery"
                  data-testid="dashboard-connection-search"
                  type="search"
                  :placeholder="t('dashboard.searchConnectionsPlaceholder', '搜索连接...')"
                  class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-1 focus:ring-primary/40"
                />
              </label>
              <select
                v-model="selectedTagId"
                data-testid="dashboard-tag-filter"
                :disabled="isLoadingTags"
                class="h-9 min-w-32 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-1 focus:ring-primary/40"
                :aria-label="t('dashboard.filterByTag', '按标签筛选')"
              >
                <option :value="null">{{ t('dashboard.filterTags.all', '所有标签') }}</option>
                <option v-if="isLoadingTags" disabled>{{ t('common.loading') }}</option>
                <option v-for="tag in (tags as TagInfo[])" :key="tag.id" :value="tag.id">
                  {{ tag.name }}
                </option>
              </select>
              <select
                v-model="localSortBy"
                data-testid="dashboard-sort-by"
                class="h-9 min-w-32 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-1 focus:ring-primary/40"
                :aria-label="t('dashboard.sortBy', '排序方式')"
              >
                <option v-for="option in sortOptions" :key="option.value" :value="option.value">
                  {{ t(option.labelKey, option.value.replace('_', ' ')) }}
                </option>
              </select>
              <button
                data-testid="dashboard-sort-order"
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-text-secondary transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                :aria-label="isAscending ? t('common.sortAscending') : t('common.sortDescending')"
                :title="isAscending ? t('common.sortAscending') : t('common.sortDescending')"
                @click="toggleSortOrder"
              >
                <i :class="['fas', isAscending ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a', 'text-xs']" aria-hidden="true"></i>
              </button>
            </div>
          </div>

          <div class="max-h-[640px] overflow-y-auto px-4 sm:px-5">
            <div
              v-if="isLoadingConnections && filteredAndSortedConnections.length === 0"
              class="py-14 text-center text-sm text-text-secondary"
            >
              {{ t('common.loading') }}
            </div>

            <ul v-else-if="filteredAndSortedConnections.length > 0" class="divide-y divide-border/70">
              <li
                v-for="conn in filteredAndSortedConnections"
                :key="conn.id"
                :data-testid="`dashboard-connection-row-${conn.id}`"
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4 sm:gap-5"
              >
                <div class="min-w-0">
                  <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="truncate text-sm font-semibold" :title="conn.name || conn.host">
                      {{ conn.name || conn.host || t('connections.unnamedFallback', '未命名连接') }}
                    </span>
                    <span class="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-text-alt">
                      {{ conn.type }}
                    </span>
                  </div>
                  <div class="mt-1 truncate font-mono text-xs text-text-secondary" :title="`${conn.username}@${conn.host}:${conn.port}`">
                    {{ conn.username }}@{{ conn.host }}:{{ conn.port }}
                  </div>
                  <div class="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                    <span class="text-xs text-text-alt">
                      {{ t('dashboard.lastConnected', '上次连接:') }} {{ formatRelativeTime(conn.last_connected_at) }}
                    </span>
                    <span
                      v-for="tagName in getTagNames(conn.tag_ids)"
                      :key="tagName"
                      class="max-w-40 truncate rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                      :title="tagName"
                    >
                      {{ tagName }}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  :data-testid="`dashboard-connect-${conn.id}`"
                  class="h-9 shrink-0 rounded-md bg-button px-4 text-sm font-medium text-button-text shadow-sm transition hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary/60"
                  @click="connectTo(conn)"
                >
                  {{ t('connections.actions.connect') }}
                </button>
              </li>
            </ul>

            <div v-else class="py-14 text-center text-sm text-text-secondary">
              <template v-if="searchQuery">
                {{ t('dashboard.noConnectionsMatchSearch', '没有连接匹配搜索条件') }}
              </template>
              <template v-else-if="selectedTagId !== null">
                {{ t('dashboard.noConnectionsWithTag', '该标签下没有连接记录') }}
              </template>
              <template v-else>
                {{ t('dashboard.noConnections', '没有连接记录') }}
              </template>
            </div>
          </div>

          <footer class="flex items-center justify-end border-t border-border bg-header/25 px-4 py-3 sm:px-5">
            <RouterLink
              data-testid="dashboard-connections-link"
              :to="{ name: 'Connections' }"
              class="shrink-0 text-sm font-medium text-link hover:text-link-hover hover:no-underline"
            >
              {{ t('dashboard.viewAllConnections', '查看所有连接') }} →
            </RouterLink>
          </footer>
        </section>

      </div>

        <aside data-testid="dashboard-recent-activity" class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                <i class="fas fa-clock-rotate-left text-sm"></i>
              </span>
              <div>
                <h2 class="text-base font-semibold">{{ t('dashboard.recentActivity', '最近活动') }}</h2>
                <p class="text-xs text-text-secondary">{{ t('dashboard.recentActivityHint', '最近的审计事件') }}</p>
              </div>
            </div>
            <span class="text-xs tabular-nums text-text-alt">{{ recentAuditLogs.length }}</span>
          </header>

          <div class="px-4 sm:px-5">
            <div v-if="isLoadingLogs && recentAuditLogs.length === 0" class="py-12 text-center text-sm text-text-secondary">
              {{ t('common.loading') }}
            </div>
            <ol v-else-if="recentAuditLogs.length > 0" class="divide-y divide-border/70">
              <li v-for="log in recentAuditLogs" :key="log.id" class="relative py-4 pl-4">
                <span
                  class="absolute left-0 top-[1.35rem] h-2 w-2 rounded-full"
                  :class="isFailedAction(log.action_type) ? 'bg-error' : 'bg-primary'"
                  aria-hidden="true"
                ></span>
                <div class="flex items-start justify-between gap-3">
                  <span
                    class="min-w-0 text-sm font-medium leading-5"
                    :class="isFailedAction(log.action_type) ? 'text-error' : 'text-foreground'"
                  >
                    {{ getActionTranslation(log.action_type) }}
                  </span>
                  <time class="shrink-0 pt-0.5 text-[11px] text-text-alt">
                    {{ formatRelativeTime(log.timestamp) }}
                  </time>
                </div>
                <p v-if="auditSummary(log.details)" class="mt-1 truncate text-xs text-text-secondary" :title="auditSummary(log.details)">
                  {{ auditSummary(log.details) }}
                </p>
              </li>
            </ol>
            <div v-else class="py-12 text-center text-sm text-text-secondary">
              {{ t('dashboard.noRecentActivity', '没有最近活动记录') }}
            </div>
          </div>

          <footer class="border-t border-border bg-header/25 px-4 py-3 text-right sm:px-5">
            <RouterLink
              data-testid="dashboard-audit-link"
              :to="{ name: 'AuditLogs' }"
              class="text-sm font-medium text-link hover:text-link-hover hover:no-underline"
            >
              {{ t('dashboard.viewFullAuditLog', '查看完整审计日志') }} →
            </RouterLink>
          </footer>
        </aside>
    </div>
  </main>
</template>
