<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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

const { t, locale } = useI18n();
const connectionsStore = useConnectionsStore();
const auditLogStore = useAuditLogStore();
const sessionStore = useSessionStore();
const tagsStore = useTagsStore();

const { connections, isLoading: isLoadingConnections } = storeToRefs(connectionsStore);
const { logs: auditLogs, isLoading: isLoadingLogs } = storeToRefs(auditLogStore);
const { tags, isLoading: isLoadingTags } = storeToRefs(tagsStore);

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

watch(localSortBy, (value) => localStorage.setItem(LS_SORT_BY_KEY, value));
watch(localSortOrder, (value) => localStorage.setItem(LS_SORT_ORDER_KEY, value));
watch(selectedTagId, (value) => localStorage.setItem(LS_FILTER_TAG_KEY, value === null ? 'null' : String(value)));

onMounted(async () => {
  await Promise.allSettled([
    connectionsStore.fetchConnections(),
    auditLogStore.fetchLogs({ page: 1, limit: maxRecentLogs, sortOrder: 'desc', isDashboardRequest: true }),
    tagsStore.fetchTags(),
  ]);
});
</script>

<template>
  <main
    data-testid="dashboard-view"
    class="min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8 lg:py-7"
  >
    <div class="mx-auto w-full max-w-[1680px]">
      <header class="mb-5 flex flex-col gap-1 sm:mb-6">
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('nav.dashboard') }}</h1>
        <p class="text-sm text-text-secondary">
          {{ t('dashboard.subtitle', '快速查看并进入你的远程连接') }}
        </p>
      </header>

      <section
        data-testid="dashboard-overview"
        class="mb-5 grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:grid-cols-3"
      >
        <div class="border-b border-border px-5 py-4 sm:border-b-0 sm:border-r">
          <div class="text-xs font-medium uppercase tracking-[0.12em] text-text-alt">
            {{ t('dashboard.totalConnections', '连接总数') }}
          </div>
          <div class="mt-2 flex items-end gap-3">
            <strong data-testid="dashboard-total-connections" class="text-3xl font-semibold tabular-nums">
              {{ connections.length }}
            </strong>
            <span v-if="protocolSummary" class="mb-1 truncate text-xs text-text-secondary">{{ protocolSummary }}</span>
          </div>
        </div>
        <div class="border-b border-border px-5 py-4 sm:border-b-0 sm:border-r">
          <div class="text-xs font-medium uppercase tracking-[0.12em] text-text-alt">
            {{ t('dashboard.usedConnections', '已有连接记录') }}
          </div>
          <div class="mt-2 flex items-end gap-2">
            <strong data-testid="dashboard-used-connections" class="text-3xl font-semibold tabular-nums">
              {{ usedConnectionCount }}
            </strong>
            <span class="mb-1 text-xs text-text-secondary">/ {{ connections.length }}</span>
          </div>
        </div>
        <div class="px-5 py-4">
          <div class="text-xs font-medium uppercase tracking-[0.12em] text-text-alt">
            {{ t('dashboard.tagCount', '标签数量') }}
          </div>
          <strong data-testid="dashboard-tag-count" class="mt-2 block text-3xl font-semibold tabular-nums">
            {{ tags.length }}
          </strong>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          data-testid="dashboard-connections"
          class="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm"
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

          <div class="px-4 sm:px-5">
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

          <footer class="flex items-center justify-between gap-3 border-t border-border bg-header/25 px-4 py-3 sm:px-5">
            <span class="text-xs text-text-alt">
              {{ t('dashboard.manageHint', '连接的新增、编辑和批量管理请前往连接管理') }}
            </span>
            <RouterLink
              data-testid="dashboard-connections-link"
              :to="{ name: 'Connections' }"
              class="shrink-0 text-sm font-medium text-link hover:text-link-hover hover:no-underline"
            >
              {{ t('dashboard.viewAllConnections', '查看所有连接') }} →
            </RouterLink>
          </footer>
        </section>

        <aside
          data-testid="dashboard-recent-activity"
          class="self-start overflow-hidden rounded-xl border border-border bg-card shadow-sm"
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
        </aside>
      </div>
    </div>
  </main>
</template>
