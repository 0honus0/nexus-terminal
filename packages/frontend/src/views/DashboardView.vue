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
const protocolBreakdown = computed(() => {
  const total = Math.max(connections.value.length, 1);
  const counts = connections.value.reduce<Record<'SSH' | 'RDP' | 'VNC', number>>((result, connection) => {
    result[connection.type] += 1;
    return result;
  }, { SSH: 0, RDP: 0, VNC: 0 });

  return (['SSH', 'RDP', 'VNC'] as const)
    .map((type) => ({
      type,
      count: counts[type],
      percentage: Math.round((counts[type] / total) * 100),
    }))
    .filter((item) => item.count > 0);
});
const tagOverview = computed(() => {
  const allTags = tags.value as TagInfo[];
  return allTags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: connections.value.filter((connection) => connection.tag_ids?.includes(tag.id)).length,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 5);
});
const remoteResourceSessions = computed(() => {
  return [...sessions.value.entries()].map(([sessionId, session]) => ({
    sessionId,
    name: session.connectionName,
    status: session.statusMonitorManager.serverStatus.value,
    error: session.statusMonitorManager.statusError.value,
  }));
});
const systemResourcesVisible = computed(() => (
  dashboardShowLocalResourcesBoolean.value || dashboardShowRemoteResourcesBoolean.value
));
const protocolSummary = computed(() => {
  const counts = connections.value.reduce<Record<string, number>>((result, connection) => {
    result[connection.type] = (result[connection.type] ?? 0) + 1;
    return result;
  }, {});
  return ['SSH', 'RDP', 'VNC']
    .filter((type) => counts[type])
    .map((type) => `${type} ${counts[type]}`)
    .join(' · ');
});
const protocolBarClass = (type: ConnectionInfo['type']): string => {
  if (type === 'RDP') return 'bg-success';
  if (type === 'VNC') return 'bg-warning';
  return 'bg-primary';
};
const tagUsageWidth = (count: number): string => {
  if (!connections.value.length) return '0%';
  return `${Math.max(8, Math.round((count / connections.value.length) * 100))}%`;
};
const resourcePercent = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value!)));
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
    ? new Set(sessions.value.keys())
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
  () => [dashboardShowRemoteResourcesBoolean.value, [...sessions.value.keys()].join('|')],
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
  <main
    data-testid="dashboard-view"
    class="min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8 lg:py-7"
  >
    <div class="mx-auto w-full max-w-[1680px]">
      <section
        data-testid="dashboard-overview"
        class="relative mb-5 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-sm"
      >
        <div class="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-primary/10 blur-3xl"></div>
        <div class="pointer-events-none absolute bottom-0 left-1/3 h-28 w-72 rounded-full bg-link/5 blur-3xl"></div>

        <div class="relative grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
          <div class="flex min-w-0 flex-col justify-between gap-6">
            <div>
              <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                NEXUS · {{ t('dashboard.workspaceLabel', '远程工作台') }}
              </div>
              <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{{ t('nav.dashboard') }}</h1>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                {{ t('dashboard.subtitle', '快速查看并进入你的远程连接') }}
              </p>
            </div>

            <div
              v-if="latestConnection"
              class="flex min-w-0 flex-col gap-3 rounded-xl border border-border/80 bg-background/45 p-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="min-w-0">
                <div class="text-[11px] font-medium uppercase tracking-[0.12em] text-text-alt">
                  {{ t('dashboard.latestConnection', '最近连接') }}
                </div>
                <div class="mt-1 flex min-w-0 items-center gap-2">
                  <strong class="truncate text-base font-semibold">{{ latestConnection.name || latestConnection.host }}</strong>
                  <span class="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-text-alt">{{ latestConnection.type }}</span>
                </div>
                <div class="mt-1 truncate font-mono text-xs text-text-secondary">
                  {{ latestConnection.username }}@{{ latestConnection.host }}:{{ latestConnection.port }}
                </div>
                <div class="mt-1 text-xs text-text-alt">{{ formatRelativeTime(latestConnection.last_connected_at) }}</div>
              </div>
              <button
                type="button"
                class="h-9 shrink-0 rounded-md bg-button px-4 text-sm font-medium text-button-text shadow-sm transition hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary/60"
                @click="connectTo(latestConnection)"
              >
                {{ t('dashboard.reconnect', '重新连接') }}
              </button>
            </div>

            <div class="grid grid-cols-3 overflow-hidden rounded-xl border border-border/80 bg-background/35 backdrop-blur-sm">
              <div class="border-r border-border/70 px-4 py-3 sm:px-5">
                <div class="text-[10px] font-medium uppercase tracking-[0.12em] text-text-alt">{{ t('dashboard.totalConnections', '连接总数') }}</div>
                <strong data-testid="dashboard-total-connections" class="mt-1 block text-2xl font-semibold tabular-nums sm:text-3xl">{{ connections.length }}</strong>
              </div>
              <div class="border-r border-border/70 px-4 py-3 sm:px-5">
                <div class="text-[10px] font-medium uppercase tracking-[0.12em] text-text-alt">{{ t('dashboard.usedConnections', '已有连接记录') }}</div>
                <div class="mt-1 flex items-baseline gap-1.5">
                  <strong data-testid="dashboard-used-connections" class="text-2xl font-semibold tabular-nums sm:text-3xl">{{ usedConnectionCount }}</strong>
                  <span class="text-xs text-text-alt">/ {{ connections.length }}</span>
                </div>
              </div>
              <div class="px-4 py-3 sm:px-5">
                <div class="text-[10px] font-medium uppercase tracking-[0.12em] text-text-alt">{{ t('dashboard.tagCount', '标签数量') }}</div>
                <strong data-testid="dashboard-tag-count" class="mt-1 block text-2xl font-semibold tabular-nums sm:text-3xl">{{ tags.length }}</strong>
              </div>
            </div>
          </div>

          <div class="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div class="rounded-xl border border-border/80 bg-background/45 p-4 backdrop-blur-sm">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-sm font-semibold">{{ t('dashboard.protocolDistribution', '连接类型') }}</h2>
                <span class="text-xs text-text-alt">{{ protocolSummary || '—' }}</span>
              </div>
              <div v-if="protocolBreakdown.length" class="mt-4 space-y-3">
                <div v-for="item in protocolBreakdown" :key="item.type">
                  <div class="mb-1.5 flex items-center justify-between gap-3 text-xs">
                    <span class="font-medium">{{ item.type }}</span>
                    <span class="tabular-nums text-text-alt">{{ item.count }} · {{ item.percentage }}%</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div class="h-full rounded-full" :class="protocolBarClass(item.type)" :style="{ width: `${item.percentage}%` }"></div>
                  </div>
                </div>
              </div>
              <div v-else class="mt-4 text-xs text-text-alt">{{ t('dashboard.noConnections', '没有连接记录') }}</div>
            </div>

            <div class="rounded-xl border border-border/80 bg-background/45 p-4 backdrop-blur-sm">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-sm font-semibold">{{ t('dashboard.tagOverview', '标签概览') }}</h2>
                <span class="text-xs text-text-alt">{{ tags.length }}</span>
              </div>
              <div v-if="tagOverview.length" class="mt-4 space-y-3">
                <div v-for="tag in tagOverview" :key="tag.id" class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div class="min-w-0">
                    <div class="mb-1.5 truncate text-xs font-medium" :title="tag.name">{{ tag.name }}</div>
                    <div class="h-1 overflow-hidden rounded-full bg-muted">
                      <div class="h-full rounded-full bg-primary/70" :style="{ width: tagUsageWidth(tag.count) }"></div>
                    </div>
                  </div>
                  <span class="text-xs tabular-nums text-text-alt">{{ tag.count }}</span>
                </div>
              </div>
              <div v-else class="mt-4 text-xs text-text-alt">{{ t('dashboard.noTags', '暂无标签') }}</div>
            </div>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section
          data-testid="dashboard-connections"
          class="min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
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

          <div class="max-h-[540px] overflow-y-auto px-4 sm:px-5">
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

        <aside class="space-y-5 self-start">
          <section
            v-if="systemResourcesVisible"
            data-testid="dashboard-system-resources"
            class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
              <div>
                <h2 class="text-base font-semibold">{{ t('dashboard.resources.title', '系统资源') }}</h2>
                <p class="mt-0.5 text-xs text-text-secondary">{{ t('dashboard.resources.hint', 'Nexus 本机与活动 SSH 主机') }}</p>
              </div>
              <span class="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                {{ t('dashboard.resources.live', '实时') }}
              </span>
            </header>

            <div class="space-y-4 p-4 sm:p-5">
              <div v-if="dashboardShowLocalResourcesBoolean" data-testid="dashboard-local-resources" class="rounded-xl border border-border/80 bg-header/25 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold">{{ t('dashboard.resources.local', 'Nexus 本机') }}</div>
                    <div v-if="localSystemStatus?.osName" class="mt-0.5 truncate text-[11px] text-text-alt" :title="localSystemStatus.osName">
                      {{ localSystemStatus.osName }}
                    </div>
                  </div>
                  <span class="text-[10px] uppercase tracking-[0.12em] text-text-alt">LOCAL</span>
                </div>

                <div v-if="localSystemStatus" class="mt-4 space-y-3">
                  <div>
                    <div class="mb-1.5 flex items-center justify-between text-xs">
                      <span>{{ t('dashboard.resources.cpu', 'CPU') }}</span>
                      <span class="tabular-nums text-text-secondary">{{ resourcePercent(localSystemStatus.cpuPercent) }}%</span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div class="h-full rounded-full bg-primary" :style="{ width: `${resourcePercent(localSystemStatus.cpuPercent)}%` }"></div>
                    </div>
                  </div>
                  <div>
                    <div class="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span>{{ t('dashboard.resources.memory', '内存') }}</span>
                      <span class="truncate tabular-nums text-text-secondary">
                        {{ formatMemory(localSystemStatus.memUsed) }} / {{ formatMemory(localSystemStatus.memTotal) }} · {{ resourcePercent(localSystemStatus.memPercent) }}%
                      </span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div class="h-full rounded-full bg-success" :style="{ width: `${resourcePercent(localSystemStatus.memPercent)}%` }"></div>
                    </div>
                  </div>
                  <div v-if="localSystemStatus.diskPercent !== undefined">
                    <div class="mb-1.5 flex items-center justify-between text-xs">
                      <span>{{ t('dashboard.resources.disk', '根磁盘') }}</span>
                      <span class="tabular-nums text-text-secondary">{{ resourcePercent(localSystemStatus.diskPercent) }}%</span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div class="h-full rounded-full bg-warning" :style="{ width: `${resourcePercent(localSystemStatus.diskPercent)}%` }"></div>
                    </div>
                  </div>
                </div>
                <div v-else-if="localSystemError" class="mt-3 text-xs text-error">{{ localSystemError }}</div>
                <div v-else class="mt-3 text-xs text-text-alt">{{ t('common.loading') }}</div>
              </div>

              <div v-if="dashboardShowRemoteResourcesBoolean" data-testid="dashboard-remote-resources">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <div class="text-xs font-semibold uppercase tracking-[0.12em] text-text-alt">
                    {{ t('dashboard.resources.remote', '远程主机') }}
                  </div>
                  <span class="text-xs tabular-nums text-text-alt">{{ remoteResourceSessions.length }}</span>
                </div>

                <div v-if="remoteResourceSessions.length" class="space-y-2">
                  <div
                    v-for="remote in remoteResourceSessions.slice(0, 3)"
                    :key="remote.sessionId"
                    class="rounded-xl border border-border/80 px-3 py-3"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <span class="min-w-0 truncate text-xs font-semibold" :title="remote.name">{{ remote.name }}</span>
                      <span v-if="remote.status" class="text-[10px] text-success">{{ t('dashboard.resources.connected', '已连接') }}</span>
                      <span v-else class="text-[10px] text-text-alt">{{ t('dashboard.resources.waiting', '等待数据') }}</span>
                    </div>
                    <div v-if="remote.status" class="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                      <div class="rounded-md bg-header/40 px-2 py-1.5"><span class="text-text-alt">CPU</span><strong class="ml-1 tabular-nums">{{ resourcePercent(remote.status.cpuPercent) }}%</strong></div>
                      <div class="rounded-md bg-header/40 px-2 py-1.5"><span class="text-text-alt">MEM</span><strong class="ml-1 tabular-nums">{{ resourcePercent(remote.status.memPercent) }}%</strong></div>
                      <div class="rounded-md bg-header/40 px-2 py-1.5"><span class="text-text-alt">DISK</span><strong class="ml-1 tabular-nums">{{ resourcePercent(remote.status.diskPercent) }}%</strong></div>
                    </div>
                    <div v-else-if="remote.error" class="mt-2 truncate text-[10px] text-error" :title="remote.error">{{ remote.error }}</div>
                  </div>
                  <div v-if="remoteResourceSessions.length > 3" class="pt-1 text-right text-[11px] text-text-alt">
                    {{ t('dashboard.resources.moreHosts', { count: remoteResourceSessions.length - 3 }) }}
                  </div>
                </div>
                <div v-else class="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-text-alt">
                  {{ t('dashboard.resources.noRemoteSessions', '当前没有活动 SSH 会话') }}
                </div>
              </div>
            </div>
          </section>

          <section
            data-testid="dashboard-recent-activity"
            class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
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
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
