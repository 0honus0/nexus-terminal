<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { BaseBadge, BaseButton, BaseInput, BasePanel, BaseSelect, BaseSpinner } from '@/foundation/ui';
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
  <main data-testid="dashboard-view" class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
    <header>
      <h1 class="text-2xl font-semibold">{{ t('nav.dashboard') }}</h1>
      <p class="text-sm text-text-secondary">{{ t('dashboard.subtitle') }}</p>
      <div
        v-if="latestConnection"
        class="mt-3 flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-header/20 p-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <p class="text-xs text-text-secondary">{{ t('dashboard.latestConnection') }}</p>
          <div class="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <strong class="truncate">{{ latestConnection.name || latestConnection.host }}</strong>
            <BaseBadge>{{ latestConnection.type }}</BaseBadge>
            <span class="truncate font-mono text-xs text-text-secondary">
              {{ latestConnection.username }}@{{ latestConnection.host }}:{{ latestConnection.port }}
            </span>
            <span class="text-xs text-text-secondary">{{ formatRelativeTime(latestConnection.lastConnectedAt) }}</span>
          </div>
        </div>
        <BaseButton class="w-full shrink-0 sm:w-auto" size="sm" variant="primary" @click="connect(latestConnection)">
          {{ t('dashboard.reconnect') }}
        </BaseButton>
      </div>
    </header>
    <BaseSpinner v-if="loading" />
    <template v-else>
      <section data-testid="dashboard-overview" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BasePanel
          ><p class="text-sm text-text-secondary">{{ t('dashboard.totalConnections') }}</p>
          <strong class="text-2xl">{{ connections.connections.value.length }}</strong></BasePanel
        >
        <BasePanel
          ><p class="text-sm text-text-secondary">{{ t('dashboard.usedConnections') }}</p>
          <strong class="text-2xl">{{ usedCount }}</strong></BasePanel
        >
        <BasePanel
          ><p class="text-sm text-text-secondary">{{ t('dashboard.tagCount') }}</p>
          <strong class="text-2xl">{{ tags.tags.value.length }}</strong></BasePanel
        >
        <BasePanel
          ><p class="text-sm text-text-secondary">{{ t('dashboard.protocolDistribution') }}</p>
          <div class="mt-2 flex gap-2">
            <BaseBadge v-for="(count, type) in protocolCounts" :key="type">{{ type }} {{ count }}</BaseBadge>
          </div></BasePanel
        >
      </section>

      <section data-testid="dashboard-workspace" class="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <BasePanel data-testid="dashboard-connections" padding="lg">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">{{ t('dashboard.connectionList') }}</h2>
              <p class="text-sm text-text-secondary">{{ t('dashboard.quickConnectHint') }}</p>
            </div>
            <RouterLink to="/connections" data-testid="dashboard-connections-link" class="text-sm text-link">{{
              t('dashboard.viewAllConnections')
            }}</RouterLink>
          </div>
          <div
            class="mb-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 md:grid-cols-[1fr_180px_180px_auto] md:gap-3"
          >
            <BaseInput
              v-model="search"
              data-testid="dashboard-connection-search"
              class="col-span-3 md:col-span-1"
              :placeholder="t('dashboard.searchConnectionsPlaceholder')"
            /><BaseSelect v-model="tagId" data-testid="dashboard-tag-filter"
              ><option value="">{{ t('dashboard.filterTags.all') }}</option>
              <option v-for="tag in tags.tags.value" :key="tag.id" :value="tag.id">{{ tag.name }}</option></BaseSelect
            ><BaseSelect v-model="sort" data-testid="dashboard-sort-by"
              ><option value="lastConnected">{{ t('dashboard.sortOptions.lastConnected') }}</option>
              <option value="name">{{ t('dashboard.sortOptions.name') }}</option>
              <option value="type">{{ t('dashboard.sortOptions.type') }}</option>
              <option value="updated">{{ t('dashboard.sortOptions.updated') }}</option>
              <option value="created">{{ t('dashboard.sortOptions.created') }}</option></BaseSelect
            >
            <BaseButton
              data-testid="dashboard-sort-order"
              size="sm"
              :title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
              @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
            >
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </BaseButton>
          </div>
          <ul data-testid="dashboard-connection-list" class="divide-y divide-border">
            <li
              v-for="item in filtered"
              :key="item.id"
              :data-testid="`dashboard-connection-row-${item.id}`"
              class="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium">{{ item.name || item.host }}</span
                  ><BaseBadge>{{ item.type }}</BaseBadge>
                </div>
                <p class="truncate text-sm text-text-secondary">{{ item.username }}@{{ item.host }}:{{ item.port }}</p>
                <div class="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                  <span class="text-xs text-text-secondary">
                    {{ t('dashboard.lastConnected') }} {{ formatRelativeTime(item.lastConnectedAt) }}
                  </span>
                  <span
                    v-for="tagName in tagNames(item)"
                    :key="tagName"
                    class="max-w-40 truncate rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    :title="tagName"
                  >
                    {{ tagName }}
                  </span>
                </div>
              </div>
              <BaseButton
                :data-testid="`dashboard-connect-${item.id}`"
                class="w-full sm:w-auto"
                size="sm"
                variant="primary"
                @click="connect(item)"
                >{{ t('dashboard.quickConnect') }}</BaseButton
              >
            </li>
            <li v-if="!filtered.length" class="py-8 text-center text-sm text-text-secondary">
              {{ search ? t('dashboard.noConnectionsMatchSearch') : t('dashboard.noConnections') }}
            </li>
          </ul>
        </BasePanel>
        <BasePanel data-testid="dashboard-recent-activity" padding="lg"
          ><div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold">{{ t('dashboard.recentActivity') }}</h2>
            <RouterLink to="/audit-logs" data-testid="dashboard-audit-link" class="text-sm text-link">{{
              t('dashboard.viewFullAuditLog')
            }}</RouterLink>
          </div>
          <ul class="space-y-3">
            <li v-for="log in activity" :key="log.id" class="border-b border-border pb-3 last:border-0">
              <div class="flex min-w-0 items-start justify-between gap-2">
                <p
                  class="min-w-0 truncate text-sm font-medium"
                  :class="isFailedAction(log.actionType) ? 'text-error' : 'text-foreground'"
                  :title="actionLabel(log.actionType)"
                >
                  {{ actionLabel(log.actionType) }}
                </p>
                <time class="shrink-0 text-xs text-text-secondary">{{ formatRelativeTime(log.timestamp) }}</time>
              </div>
              <p
                v-if="auditSummary(log.details)"
                class="mt-1 truncate text-xs text-text-secondary"
                :title="auditSummary(log.details)"
              >
                {{ auditSummary(log.details) }}
              </p>
            </li>
            <li v-if="!activity.length" class="text-sm text-text-secondary">{{ t('dashboard.noRecentActivity') }}</li>
          </ul></BasePanel
        >
      </section>

      <BasePanel
        v-if="
          preferences.values.value.dashboardShowLocalResources || preferences.values.value.dashboardShowRemoteResources
        "
        data-testid="dashboard-system-resources"
        padding="lg"
      >
        <div class="mb-4">
          <h2 class="text-lg font-semibold">{{ t('dashboard.resources.title') }}</h2>
          <p class="text-sm text-text-secondary">{{ t('dashboard.resources.hint') }}</p>
        </div>
        <div data-testid="dashboard-ssh-resource-list" class="grid min-h-36 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <article
            v-if="preferences.values.value.dashboardShowLocalResources && resources.local.value"
            data-testid="dashboard-local-resources"
            class="min-w-0 rounded border border-border p-4"
          >
            <div class="flex items-center justify-between gap-2">
              <h3 class="truncate font-medium">{{ t('dashboard.resources.local') }}</h3>
              <span class="text-xs text-text-secondary">{{ t('dashboard.resources.live') }}</span>
            </div>
            <p class="mt-2 break-words text-sm">
              CPU {{ percent(resources.local.value.cpuPercent) }} · {{ t('dashboard.resources.memory') }}
              {{ percent(resources.local.value.memPercent) }} · {{ t('dashboard.resources.disk') }}
              {{ percent(resources.local.value.diskPercent) }}
            </p>
          </article>
          <article
            v-else-if="preferences.values.value.dashboardShowLocalResources && resources.localLoading.value"
            data-testid="dashboard-local-resources"
            class="grid min-h-32 place-items-center rounded border border-border p-4"
          >
            <BaseSpinner />
          </article>
          <article
            v-else-if="preferences.values.value.dashboardShowLocalResources && resources.localError.value"
            data-testid="dashboard-local-resources"
            class="rounded border border-border p-4 text-sm text-error"
          >
            {{ resources.localError.value || t('dashboard.resources.unavailable') }}
          </article>

          <article
            v-for="host in preferences.values.value.dashboardShowRemoteResources ? resources.remote.value : []"
            :key="host.key"
            :data-testid="`dashboard-remote-resource-${host.key}`"
            class="min-w-0 rounded border border-border p-4"
          >
            <h3 class="truncate font-medium" :title="host.name">{{ host.name }}</h3>
            <p class="truncate text-xs text-text-secondary" :title="`${host.username}@${host.host}:${host.port}`">
              {{ host.username }}@{{ host.host }}:{{ host.port }}
            </p>
            <p v-if="host.status" class="mt-2 break-words text-sm">
              CPU {{ percent(host.status.cpuPercent) }} · {{ t('dashboard.resources.memory') }}
              {{ percent(host.status.memPercent) }} ({{ formatMemory(host.status.memUsed) }} /
              {{ formatMemory(host.status.memTotal) }}) · {{ t('dashboard.resources.disk') }}
              {{ percent(host.status.diskPercent) }}
            </p>
            <p v-else class="mt-2 break-words text-sm text-error">
              {{ host.error || t('dashboard.resources.unavailable') }}
            </p>
          </article>

          <div
            v-if="
              preferences.values.value.dashboardShowRemoteResources &&
              resources.remoteLoading.value &&
              resources.remote.value.length === 0
            "
            data-testid="dashboard-remote-resources-loading"
            class="col-span-full grid min-h-36 place-items-center rounded border border-border/70 p-4"
          >
            <BaseSpinner />
          </div>
          <p
            v-else-if="
              preferences.values.value.dashboardShowRemoteResources &&
              resources.remoteError.value &&
              resources.remote.value.length === 0
            "
            class="col-span-full grid min-h-36 place-items-center rounded border border-border/70 p-4 text-center text-sm text-error"
          >
            {{ resources.remoteError.value || t('dashboard.resources.unavailable') }}
          </p>
          <p
            v-else-if="
              preferences.values.value.dashboardShowRemoteResources &&
              !resources.remoteLoading.value &&
              resources.remote.value.length === 0
            "
            class="col-span-full grid min-h-36 place-items-center rounded border border-border/70 p-4 text-center text-sm text-text-secondary"
          >
            {{ t('dashboard.resources.noRemoteSessions') }}
          </p>
        </div></BasePanel
      >
    </template>
  </main>
</template>
