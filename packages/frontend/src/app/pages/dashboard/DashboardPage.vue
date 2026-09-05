<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
  import { useConnections, type Connection } from '@/features/connections/public';
  import { useConnectionTags } from '@/features/tags/public';
  import { auditApi, type AuditLogEntry } from '@/features/audit/public';
  import { useSystemOverview } from '@/features/system-overview/public';
  import { usePreferences } from '@/features/preferences/public';

  const { t, locale } = useI18n();
  const router = useRouter();
  const connections = useConnections();
  const tags = useConnectionTags();
  const resources = useSystemOverview();
  const preferences = usePreferences();
  const activity = ref<AuditLogEntry[]>([]);
  const search = ref('');
  const DASHBOARD_TAG_KEY = 'nexus.dashboard.tagId';
  const DASHBOARD_SORT_KEY = 'nexus.dashboard.sortField';
  const DASHBOARD_SORT_ORDER_KEY = 'nexus.dashboard.sortOrder';
  type DashboardSort = 'lastConnected' | 'name' | 'type' | 'updated' | 'created';
  type DashboardSortOrder = 'asc' | 'desc';
  const validSorts = new Set<DashboardSort>(['lastConnected', 'name', 'type', 'updated', 'created']);
  const storedTag = localStorage.getItem(DASHBOARD_TAG_KEY);
  const storedSort = localStorage.getItem(DASHBOARD_SORT_KEY) as DashboardSort | null;
  const storedOrder = localStorage.getItem(DASHBOARD_SORT_ORDER_KEY) as DashboardSortOrder | null;
  const parsedTag = storedTag && storedTag !== 'all' ? Number.parseInt(storedTag, 10) : Number.NaN;
  const tagId = ref<number | ''>(Number.isFinite(parsedTag) ? parsedTag : '');
  const sort = ref<DashboardSort>(storedSort && validSorts.has(storedSort) ? storedSort : 'lastConnected');
  const sortOrder = ref<DashboardSortOrder>(storedOrder === 'asc' ? 'asc' : 'desc');
  const loading = ref(true);

  const filtered = computed(() => {
    const term = search.value.trim().toLowerCase();
    const values = connections.connections.value.filter((item) => {
      if (tagId.value !== '' && !item.tagIds.includes(tagId.value)) return false;
      return !term || `${item.name ?? ''} ${item.host} ${item.username} ${item.port}`.toLowerCase().includes(term);
    });
    const direction = sortOrder.value === 'asc' ? 1 : -1;
    return [...values].sort((a, b) => {
      if (sort.value === 'name') return (a.name ?? a.host).localeCompare(b.name ?? b.host) * direction;
      if (sort.value === 'type') return a.type.localeCompare(b.type) * direction;
      if (sort.value === 'updated') return (a.updatedAt - b.updatedAt) * direction;
      if (sort.value === 'created') return (a.createdAt - b.createdAt) * direction;
      const aTime = a.lastConnectedAt ?? (sortOrder.value === 'asc' ? Number.POSITIVE_INFINITY : -1);
      const bTime = b.lastConnectedAt ?? (sortOrder.value === 'asc' ? Number.POSITIVE_INFINITY : -1);
      return (aTime - bTime) * direction;
    });
  });
  const MAX_RECENT_LOGS = 5;
  const usedCount = computed(() => connections.connections.value.filter((item) => item.lastConnectedAt).length);
  const protocolCounts = computed(() =>
    Object.fromEntries(
      ['SSH', 'RDP', 'VNC'].map((type) => [
        type,
        connections.connections.value.filter((item) => item.type === type).length,
      ]),
    ),
  );
  const latestConnection = computed(
    () =>
      [...connections.connections.value]
        .filter((item) => item.lastConnectedAt !== null)
        .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))[0] ?? null,
  );
  const connect = (item: Connection) => router.push({ name: 'Workspace', query: { connectionId: String(item.id) } });

  const formatRelativeTime = (timestamp: number | null | undefined): string => {
    if (!timestamp) return t('connections.status.never');
    try {
      const seconds = timestamp - Date.now() / 1000;
      const absoluteSeconds = Math.abs(seconds);
      const [scale, unit]: [number, Intl.RelativeTimeFormatUnit] =
        absoluteSeconds < 60
          ? [1, 'second']
          : absoluteSeconds < 3600
            ? [60, 'minute']
            : absoluteSeconds < 86400
              ? [3600, 'hour']
              : absoluteSeconds < 604800
                ? [86400, 'day']
                : absoluteSeconds < 2629800
                  ? [604800, 'week']
                  : absoluteSeconds < 31557600
                    ? [2629800, 'month']
                    : [31557600, 'year'];
      return new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }).format(Math.round(seconds / scale), unit);
    } catch {
      return String(timestamp);
    }
  };
  const tagNames = (item: Connection): string[] =>
    item.tagIds
      .map((id) => tags.tags.value.find((tag) => tag.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  const actionLabel = (actionType: string): string => t(`auditLog.actions.${actionType}`, actionType);
  const isFailedAction = (actionType: string): boolean => {
    const normalized = actionType.toLowerCase();
    return normalized.includes('fail') || normalized.includes('error') || normalized.includes('denied');
  };
  const auditSummary = (details: unknown): string => {
    if (!details || typeof details !== 'object') return '';
    const record = details as Record<string, unknown>;
    if (typeof record.raw === 'string') return record.raw.slice(0, 120);
    const connectionName =
      typeof record.connectionName === 'string'
        ? record.connectionName
        : typeof record.connection_name === 'string'
          ? record.connection_name
          : '';
    const username = typeof record.username === 'string' ? record.username : '';
    const host = typeof record.host === 'string' ? record.host : typeof record.ip === 'string' ? record.ip : '';
    const subject =
      typeof record.command === 'string'
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

  let localRefreshTimer: number | undefined;
  let remoteRefreshTimer: number | undefined;
  const scheduleLocalRefresh = () => {
    window.clearInterval(localRefreshTimer);
    localRefreshTimer = undefined;
    if (!preferences.values.value.dashboardShowLocalResources) return;
    const seconds = Math.max(1, preferences.values.value.statusMonitorIntervalSeconds);
    localRefreshTimer = window.setInterval(() => void resources.loadLocal(), seconds * 1000);
  };
  const scheduleRemoteRefresh = () => {
    window.clearInterval(remoteRefreshTimer);
    remoteRefreshTimer = undefined;
    if (!preferences.values.value.dashboardShowRemoteResources) return;
    const seconds = Math.max(1, preferences.values.value.remoteHostRefreshIntervalSeconds);
    remoteRefreshTimer = window.setInterval(() => void resources.loadRemote(), seconds * 1000);
  };
  const syncLocalRefresh = () => {
    scheduleLocalRefresh();
    if (preferences.values.value.dashboardShowLocalResources) void resources.loadLocal();
  };
  const syncRemoteRefresh = () => {
    scheduleRemoteRefresh();
    if (preferences.values.value.dashboardShowRemoteResources) void resources.loadRemote();
  };

  watch(tagId, (value) => localStorage.setItem(DASHBOARD_TAG_KEY, value === '' ? 'all' : String(value)));
  watch(sort, (value) => localStorage.setItem(DASHBOARD_SORT_KEY, value));
  watch(sortOrder, (value) => localStorage.setItem(DASHBOARD_SORT_ORDER_KEY, value));
  watch(
    () => [preferences.values.value.dashboardShowLocalResources, preferences.values.value.statusMonitorIntervalSeconds],
    syncLocalRefresh,
  );
  watch(
    () => [
      preferences.values.value.dashboardShowRemoteResources,
      preferences.values.value.remoteHostRefreshIntervalSeconds,
    ],
    syncRemoteRefresh,
  );

  onMounted(async () => {
    loading.value = true;
    const [, , audit] = await Promise.allSettled([
      connections.load(),
      tags.load(),
      auditApi.list({ limit: MAX_RECENT_LOGS, offset: 0 }),
      preferences.load(),
    ]);
    if (audit?.status === 'fulfilled') activity.value = audit.value.logs.slice(0, MAX_RECENT_LOGS);
    loading.value = false;
    syncLocalRefresh();
    syncRemoteRefresh();
  });
  onBeforeUnmount(() => {
    window.clearInterval(localRefreshTimer);
    window.clearInterval(remoteRefreshTimer);
  });
  const percent = (value?: number) => {
    if (!Number.isFinite(value)) return '—';
    return `${Math.min(100, Math.max(0, Math.round(value!)))}%`;
  };
  const formatMemory = (value?: number) => {
    if (!Number.isFinite(value)) return '—';
    if (value! >= 1024) return `${(value! / 1024).toFixed(value! >= 10240 ? 0 : 1)} GB`;
    return `${Math.round(value!)} MB`;
  };
</script>

<template>
  <main data-testid="dashboard-view" class="min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8 lg:py-7">
    <div class="mx-auto w-full max-w-[1680px] space-y-5">
      <section data-testid="dashboard-overview" class="border-b border-border/70 pb-4">
        <div class="grid gap-4 px-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-3">
              <span class="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{{
                t('projectName').split(' ')[0]
              }}</span>
              <span class="h-4 w-px bg-border" aria-hidden="true"></span>
              <h1 class="truncate text-lg font-semibold tracking-tight">{{ t('nav.dashboard') }}</h1>
            </div>
            <div v-if="latestConnection" class="mt-2.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span class="text-text-secondary">{{ t('dashboard.latestConnection') }}</span>
              <strong
                class="max-w-48 truncate text-foreground"
                :title="latestConnection.name || latestConnection.host"
                >{{ latestConnection.name || latestConnection.host }}</strong
              >
              <span class="hidden max-w-64 truncate font-mono text-text-secondary md:inline"
                >{{ latestConnection.username }}@{{ latestConnection.host }}:{{ latestConnection.port }}</span
              >
              <span class="text-text-secondary">{{ formatRelativeTime(latestConnection.lastConnectedAt) }}</span>
              <button
                type="button"
                class="h-7 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-medium text-primary transition hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/50"
                @click="connect(latestConnection)"
              >
                {{ t('dashboard.reconnect') }}
              </button>
            </div>
          </div>

          <div
            class="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start sm:gap-x-5 lg:justify-end"
          >
            <div
              data-testid="dashboard-overview-stats"
              class="flex items-end justify-between gap-7 px-1 sm:justify-start"
            >
              <div>
                <strong class="block text-xl font-semibold leading-none tabular-nums">{{
                  connections.connections.value.length
                }}</strong>
                <div class="mt-1.5 text-[10px] text-text-secondary">{{ t('dashboard.totalConnections') }}</div>
              </div>
              <div>
                <strong class="block text-xl font-semibold leading-none tabular-nums">{{
                  tags.tags.value.length
                }}</strong>
                <div class="mt-1.5 text-[10px] text-text-secondary">{{ t('dashboard.tagCount') }}</div>
              </div>
            </div>

            <div
              v-if="preferences.values.value.dashboardShowLocalResources"
              data-testid="dashboard-local-resources"
              class="min-w-0 border-t border-border pt-3 sm:min-w-[300px] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                  {{ t('dashboard.resources.local') }}
                </div>
                <span class="flex items-center gap-1.5 text-[9px] text-text-secondary"
                  ><span class="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true"></span
                  >{{ t('dashboard.resources.live') }}</span
                >
              </div>
              <div v-if="resources.local.value" class="mt-2 grid grid-cols-3 gap-4">
                <div>
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[9px] font-medium text-text-secondary">{{ t('dashboard.resources.cpu') }}</span
                    ><strong class="text-sm font-semibold tabular-nums">{{
                      percent(resources.local.value.cpuPercent)
                    }}</strong>
                  </div>
                  <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80">
                    <div
                      class="h-full rounded-full bg-primary"
                      :style="{ width: percent(resources.local.value.cpuPercent) }"
                    ></div>
                  </div>
                </div>
                <div
                  :title="`${formatMemory(resources.local.value.memUsed)} / ${formatMemory(resources.local.value.memTotal)}`"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[9px] font-medium text-text-secondary">{{ t('dashboard.resources.memory') }}</span
                    ><strong class="text-sm font-semibold tabular-nums">{{
                      percent(resources.local.value.memPercent)
                    }}</strong>
                  </div>
                  <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80">
                    <div
                      class="h-full rounded-full bg-success"
                      :style="{ width: percent(resources.local.value.memPercent) }"
                    ></div>
                  </div>
                </div>
                <div>
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[9px] font-medium text-text-secondary">{{ t('dashboard.resources.disk') }}</span
                    ><strong class="text-sm font-semibold tabular-nums">{{
                      percent(resources.local.value.diskPercent)
                    }}</strong>
                  </div>
                  <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80">
                    <div
                      class="h-full rounded-full bg-warning"
                      :style="{ width: percent(resources.local.value.diskPercent) }"
                    ></div>
                  </div>
                </div>
              </div>
              <div v-else-if="resources.localError.value" class="py-2 text-[11px] text-error">
                {{ resources.localError.value }}
              </div>
              <div v-else class="grid min-h-10 place-items-center py-2 text-[11px] text-text-secondary">
                <BaseSpinner v-if="resources.localLoading.value" size="sm" /><span v-else>{{
                  t('dashboard.resources.unavailable')
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        data-testid="dashboard-workspace"
        :class="
          preferences.values.value.dashboardShowRemoteResources
            ? 'grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)] xl:items-start xl:gap-0'
            : 'grid grid-cols-1'
        "
      >
        <section data-testid="dashboard-connections" class="order-1 min-w-0 xl:pr-7">
          <header class="pb-4">
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2.5">
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                  aria-hidden="true"
                  ><i class="fas fa-bolt text-sm"></i
                ></span>
                <div class="min-w-0">
                  <h2 class="text-base font-semibold">{{ t('dashboard.quickConnect') }}</h2>
                  <p class="truncate text-xs text-text-secondary">{{ t('dashboard.quickConnectHint') }}</p>
                </div>
              </div>
              <span class="shrink-0 text-xs text-text-secondary"
                >{{ filtered.length }} / {{ connections.connections.value.length }}</span
              >
            </div>
          </header>

          <div
            data-testid="dashboard-connection-list"
            class="h-[clamp(300px,42vh,440px)] overflow-y-auto overscroll-contain rounded-xl border border-border/80 bg-header/10 shadow-inner xl:h-[clamp(360px,50vh,520px)]"
            style="scrollbar-gutter: stable"
          >
            <div
              class="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b border-border/70 bg-background/95 p-2 backdrop-blur sm:grid-cols-[minmax(180px,1fr)_auto_auto_auto]"
            >
              <label class="relative col-span-3 min-w-0 sm:col-span-1"
                ><span class="sr-only">{{ t('dashboard.searchConnectionsPlaceholder') }}</span
                ><i
                  class="fas fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary"
                  aria-hidden="true"
                ></i
                ><input
                  v-model="search"
                  data-testid="dashboard-connection-search"
                  type="search"
                  :placeholder="t('dashboard.searchConnectionsPlaceholder')"
                  class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/70 focus:ring-1 focus:ring-primary/40"
              /></label>
              <select
                v-model="tagId"
                data-testid="dashboard-tag-filter"
                class="h-9 min-w-0 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition focus:border-primary/70 focus:ring-1 focus:ring-primary/40 sm:min-w-32 sm:px-3 sm:text-sm"
                :aria-label="t('dashboard.filterByTag')"
              >
                <option value="">{{ t('dashboard.filterTags.all') }}</option>
                <option v-for="tag in tags.tags.value" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
              </select>
              <select
                v-model="sort"
                data-testid="dashboard-sort-by"
                class="h-9 min-w-0 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition focus:border-primary/70 focus:ring-1 focus:ring-primary/40 sm:min-w-32 sm:px-3 sm:text-sm"
                :aria-label="t('dashboard.sortBy')"
              >
                <option value="lastConnected">{{ t('dashboard.sortOptions.lastConnected') }}</option>
                <option value="name">{{ t('dashboard.sortOptions.name') }}</option>
                <option value="type">{{ t('dashboard.sortOptions.type') }}</option>
                <option value="updated">{{ t('dashboard.sortOptions.updated') }}</option>
                <option value="created">{{ t('dashboard.sortOptions.created') }}</option>
              </select>
              <button
                data-testid="dashboard-sort-order"
                type="button"
                class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-text-secondary transition hover:bg-header hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                :aria-label="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
                :title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
                @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
              >
                <i
                  :class="['fas', sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a', 'text-xs']"
                  aria-hidden="true"
                ></i>
              </button>
            </div>

            <div class="p-1.5">
              <ul v-if="filtered.length" class="space-y-2">
                <li
                  v-for="item in filtered"
                  :key="item.id"
                  :data-testid="`dashboard-connection-row-${item.id}`"
                  class="grid grid-cols-1 items-center gap-3 rounded-lg bg-header/20 px-3 py-3.5 transition-colors hover:bg-header/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-5"
                >
                  <div class="min-w-0">
                    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span class="truncate text-sm font-semibold" :title="item.name || item.host">{{
                        item.name || item.host
                      }}</span
                      ><span
                        class="rounded border border-border bg-header/50 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-text-secondary"
                        >{{ item.type }}</span
                      >
                    </div>
                    <div
                      class="mt-1 truncate font-mono text-xs text-text-secondary"
                      :title="`${item.username}@${item.host}:${item.port}`"
                    >
                      {{ item.username }}@{{ item.host }}:{{ item.port }}
                    </div>
                    <div class="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                      <span class="text-xs text-text-secondary"
                        >{{ t('dashboard.lastConnected') }} {{ formatRelativeTime(item.lastConnectedAt) }}</span
                      ><span
                        v-for="tagName in tagNames(item)"
                        :key="tagName"
                        class="max-w-40 truncate rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                        :title="tagName"
                        >{{ tagName }}</span
                      >
                    </div>
                  </div>
                  <button
                    type="button"
                    :data-testid="`dashboard-connect-${item.id}`"
                    class="h-9 w-full shrink-0 rounded-md bg-button px-4 text-sm font-medium text-button-text shadow-sm transition hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary/60 sm:w-auto"
                    @click="connect(item)"
                  >
                    {{ t('connections.actions.connect') }}
                  </button>
                </li>
              </ul>
              <div v-else class="py-14 text-center text-sm text-text-secondary">
                {{ search ? t('dashboard.noConnectionsMatchSearch') : t('dashboard.noConnections') }}
              </div>
            </div>
          </div>
          <div class="pt-3 text-right">
            <RouterLink
              data-testid="dashboard-connections-link"
              to="/connections"
              class="text-sm font-medium text-link hover:text-link-hover hover:no-underline"
              >{{ t('dashboard.viewAllConnections') }} →</RouterLink
            >
          </div>
        </section>

        <section
          v-if="preferences.values.value.dashboardShowRemoteResources"
          data-testid="dashboard-system-resources"
          class="order-2 min-w-0 xl:border-l xl:border-border/70 xl:pl-7"
        >
          <header class="flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-2.5">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                aria-hidden="true"
                ><i class="fas fa-server text-sm"></i
              ></span>
              <div class="min-w-0">
                <h2 class="text-base font-semibold">{{ t('dashboard.resources.sshTitle') }}</h2>
                <p class="mt-0.5 truncate text-xs text-text-secondary">{{ t('dashboard.resources.sshHint') }}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[11px]">
              <span class="rounded-full border border-border bg-header/40 px-2.5 py-1 text-text-secondary"
                >{{ resources.remote.value.length }} {{ t('dashboard.resources.remote') }}</span
              >
            </div>
          </header>
          <div
            data-testid="dashboard-ssh-resource-list"
            class="h-[clamp(300px,42vh,440px)] space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-border/80 bg-header/10 p-1.5 shadow-inner xl:h-[clamp(360px,50vh,520px)]"
            style="scrollbar-gutter: stable"
          >
            <div
              v-if="resources.remoteLoading.value && resources.remote.value.length === 0"
              data-testid="dashboard-remote-resources-loading"
              class="grid h-full min-h-0 place-items-center"
            >
              <BaseSpinner />
            </div>
            <article
              v-for="remote in resources.remote.value"
              :key="remote.key"
              :data-testid="`dashboard-remote-resource-${remote.key}`"
              class="group relative overflow-hidden rounded-lg bg-header/20 px-3 py-3.5 transition-colors hover:bg-header/30"
            >
              <span
                class="absolute inset-y-3 left-0 w-0.5 rounded-full"
                :class="remote.status ? 'bg-success/70' : remote.error ? 'bg-error/70' : 'bg-border'"
                aria-hidden="true"
              ></span>
              <div class="flex min-w-0 items-start justify-between gap-3 pl-1">
                <div class="min-w-0">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="h-1.5 w-1.5 shrink-0 rounded-full"
                      :class="remote.status ? 'bg-success' : remote.error ? 'bg-error' : 'bg-border'"
                      aria-hidden="true"
                    ></span>
                    <h3 class="truncate text-sm font-semibold" :title="remote.name">{{ remote.name }}</h3>
                  </div>
                  <p
                    class="mt-1 truncate pl-3.5 font-mono text-xs text-text-secondary"
                    :title="`${remote.username}@${remote.host}:${remote.port}`"
                  >
                    {{ remote.username }}@{{ remote.host }}:{{ remote.port }}
                  </p>
                </div>
                <span
                  class="rounded bg-header/60 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-text-secondary"
                  >SSH</span
                >
              </div>
              <div v-if="remote.status" class="mt-3 grid grid-cols-3 gap-2 sm:gap-4">
                <div>
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[10px] font-medium text-text-secondary">{{ t('dashboard.resources.cpu') }}</span
                    ><strong class="text-base font-semibold tabular-nums">{{
                      percent(remote.status.cpuPercent)
                    }}</strong>
                  </div>
                  <div class="mt-2 h-0.5 overflow-hidden rounded-full bg-border/80">
                    <div
                      class="h-full rounded-full bg-primary"
                      :style="{ width: percent(remote.status.cpuPercent) }"
                    ></div>
                  </div>
                </div>
                <div :title="`${formatMemory(remote.status.memUsed)} / ${formatMemory(remote.status.memTotal)}`">
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[10px] font-medium text-text-secondary">{{
                      t('dashboard.resources.memory')
                    }}</span
                    ><strong class="text-base font-semibold tabular-nums">{{
                      percent(remote.status.memPercent)
                    }}</strong>
                  </div>
                  <div class="mt-2 h-0.5 overflow-hidden rounded-full bg-border/80">
                    <div
                      class="h-full rounded-full bg-success"
                      :style="{ width: percent(remote.status.memPercent) }"
                    ></div>
                  </div>
                  <div class="mt-1 truncate text-[9px] tabular-nums text-text-secondary">
                    {{ formatMemory(remote.status.memUsed) }} / {{ formatMemory(remote.status.memTotal) }}
                  </div>
                </div>
                <div>
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[10px] font-medium text-text-secondary">{{ t('dashboard.resources.disk') }}</span
                    ><strong class="text-base font-semibold tabular-nums">{{
                      percent(remote.status.diskPercent)
                    }}</strong>
                  </div>
                  <div class="mt-2 h-0.5 overflow-hidden rounded-full bg-border/80">
                    <div
                      class="h-full rounded-full bg-warning"
                      :style="{ width: percent(remote.status.diskPercent) }"
                    ></div>
                  </div>
                </div>
              </div>
              <div v-else-if="remote.error" class="mt-4 truncate text-xs text-error" :title="remote.error">
                {{ remote.error }}
              </div>
              <div v-else class="mt-4 text-xs text-text-secondary">{{ t('dashboard.resources.waiting') }}</div>
            </article>
            <div
              v-if="!resources.remoteLoading.value && resources.remote.value.length === 0"
              data-testid="dashboard-remote-resources"
              class="flex h-full min-h-0 items-center justify-center px-4 text-center text-xs text-text-secondary"
            >
              {{ resources.remoteError.value || t('dashboard.resources.noRemoteSessions') }}
            </div>
          </div>
        </section>
      </div>

      <aside data-testid="dashboard-recent-activity" class="border-t border-border/70 pt-5">
        <header class="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-2.5">
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              aria-hidden="true"
              ><i class="fas fa-clock-rotate-left text-sm"></i
            ></span>
            <div class="min-w-0">
              <h2 class="text-base font-semibold">{{ t('dashboard.recentActivity') }}</h2>
              <p class="mt-0.5 truncate text-xs text-text-secondary">{{ t('dashboard.recentActivityHint') }}</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs tabular-nums text-text-secondary">{{ activity.length }}</span
            ><RouterLink
              data-testid="dashboard-audit-link"
              to="/audit-logs"
              class="text-sm font-medium text-link hover:text-link-hover hover:no-underline"
              >{{ t('dashboard.viewFullAuditLog') }} →</RouterLink
            >
          </div>
        </header>
        <ol v-if="activity.length" class="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <li
            v-for="log in activity"
            :key="log.id"
            class="relative min-w-0 rounded-xl border border-border/70 bg-header/15 px-3 py-3 pl-5 transition-colors hover:bg-header/25"
          >
            <span
              class="absolute left-2.5 top-4 h-1.5 w-1.5 rounded-full"
              :class="isFailedAction(log.actionType) ? 'bg-error' : 'bg-primary'"
              aria-hidden="true"
            ></span>
            <div class="flex min-w-0 items-start justify-between gap-2">
              <span
                class="min-w-0 truncate text-sm font-medium leading-5"
                :class="isFailedAction(log.actionType) ? 'text-error' : 'text-foreground'"
                :title="actionLabel(log.actionType)"
                >{{ actionLabel(log.actionType) }}</span
              ><time class="shrink-0 pt-0.5 text-[10px] text-text-secondary">{{
                formatRelativeTime(log.timestamp)
              }}</time>
            </div>
            <p
              v-if="auditSummary(log.details)"
              class="mt-1.5 truncate text-xs text-text-secondary"
              :title="auditSummary(log.details)"
            >
              {{ auditSummary(log.details) }}
            </p>
          </li>
        </ol>
        <div
          v-else
          class="rounded-xl border border-border/70 bg-header/10 py-10 text-center text-sm text-text-secondary"
        >
          {{ t('dashboard.noRecentActivity') }}
        </div>
      </aside>
    </div>
  </main>
</template>
