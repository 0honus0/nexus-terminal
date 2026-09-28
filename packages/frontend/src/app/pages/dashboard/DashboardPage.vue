<script setup lang="ts">
  import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { UiButton, UiInput, UiSelect, UiSpinner } from '@/foundation/ui';
  import DashboardHostCard from './DashboardHostCard.vue';
  import {
    numberStorageCodec,
    readStoredValue,
    removeStoredValue,
    stringStorageCodec,
    writeStoredValue,
  } from '@/foundation/browser';
  import { useConnections, type ConnectionDto } from '@/features/connections/public';
  import { useConnectionTags } from '@/features/tags/public';
  import { auditApi, type AuditLogEntryDto } from '@/features/audit/public';
  import { useSystemOverview } from '@/features/system-overview/public';
  import { usePreferences } from '@/features/preferences/public';
  import { remoteDesktopLauncher } from '@/features/remote-desktop/public';
  import { useSuspendedSessions } from '@/features/ssh-suspend/public';

  const { t, locale } = useI18n();
  const router = useRouter();
  const connections = useConnections();
  const tags = useConnectionTags();
  const resources = useSystemOverview();
  const preferences = usePreferences();
  const suspended = useSuspendedSessions();
  const activity = ref<AuditLogEntryDto[]>([]);
  const search = ref('');
  type DashboardSort = 'lastConnected' | 'name' | 'type' | 'updated' | 'created';
  type DashboardSortOrder = 'asc' | 'desc';
  const validSorts = new Set<DashboardSort>(['lastConnected', 'name', 'type', 'updated', 'created']);
  const dashboardTagStorage = {
    namespace: 'dashboard.tag',
    version: 1,
    codec: numberStorageCodec((value) => Number.isInteger(value) && value > 0),
    legacyKeys: ['nexus.dashboard.tagId'],
  } as const;
  const dashboardSortStorage = {
    namespace: 'dashboard.sort',
    version: 1,
    codec: stringStorageCodec((value) => validSorts.has(value as DashboardSort)),
    legacyKeys: ['nexus.dashboard.sortField'],
  } as const;
  const dashboardSortOrderStorage = {
    namespace: 'dashboard.sort-order',
    version: 1,
    codec: stringStorageCodec((value) => value === 'asc' || value === 'desc'),
    legacyKeys: ['nexus.dashboard.sortOrder'],
  } as const;
  const tagId = ref<number | ''>(readStoredValue(dashboardTagStorage) ?? '');
  const sort = ref<DashboardSort>(
    (readStoredValue(dashboardSortStorage) as DashboardSort | undefined) ?? 'lastConnected',
  );
  const sortOrder = ref<DashboardSortOrder>(
    (readStoredValue(dashboardSortOrderStorage) as DashboardSortOrder | undefined) ?? 'desc',
  );
  const loading = ref(true);
  const tagFilterOptions = computed(() => [
    { value: '', label: t('dashboard.filterTags.all') },
    ...(loading.value ? [{ value: '__loading__', label: t('common.loading'), disabled: true }] : []),
    ...tags.tags.value.map((tag) => ({ value: tag.id, label: tag.name })),
  ]);
  const sortOptions = computed(() =>
    (['lastConnected', 'name', 'type', 'updated', 'created'] as const).map((value) => ({
      value,
      label: t(`dashboard.sortOptions.${value}`),
    })),
  );

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
  const latestConnection = computed(() => {
    let latest: ConnectionDto | null = null;
    let latestTimestamp = -1;
    for (const item of connections.connections.value) {
      if (!item.lastConnectedAt || item.lastConnectedAt <= latestTimestamp) continue;
      latestTimestamp = item.lastConnectedAt;
      latest = item;
    }
    return latest;
  });
  const activeSuspendedSessions = computed(() =>
    suspended.sessions.value
      .filter((session) => session.status === 'active')
      .sort((a, b) => Date.parse(b.suspendedAt) - Date.parse(a.suspendedAt)),
  );
  const suspendedSessionsTitle = computed(() =>
    activeSuspendedSessions.value
      .slice(0, 3)
      .map((session) => session.customName || session.connectionName)
      .join(' · '),
  );
  const connect = (item: ConnectionDto) => {
    if (item.type === 'RDP' || item.type === 'VNC') {
      remoteDesktopLauncher.open({ id: item.id, name: item.name || item.host, type: item.type });
      return;
    }
    return router.push({ name: 'Workspace', query: { connectionId: String(item.id) } });
  };
  const openSuspendedSessions = () => router.push({ name: 'Workspace', query: { openSuspended: '1' } });

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
  const tagNameById = computed(() => new Map(tags.tags.value.map((tag) => [tag.id, tag.name] as const)));
  const tagNames = (item: ConnectionDto): string[] =>
    item.tagIds.map((id) => tagNameById.value.get(id)).filter((name): name is string => Boolean(name));
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

  let dashboardActive = false;
  let hasActivatedOnce = false;
  let localRefreshTimer: number | undefined;
  let remoteRefreshTimer: number | undefined;
  let remoteInitialTimer: number | undefined;
  const refreshLocal = () => {
    if (!document.hidden) void resources.loadLocal();
  };
  const refreshRemote = () => {
    if (!document.hidden) void resources.loadRemote();
  };
  const scheduleLocalRefresh = () => {
    window.clearInterval(localRefreshTimer);
    localRefreshTimer = undefined;
    if (!preferences.values.value.dashboardShowLocalResources) return;
    const seconds = Math.max(1, preferences.values.value.statusMonitorIntervalSeconds);
    localRefreshTimer = window.setInterval(refreshLocal, seconds * 1000);
  };
  const scheduleRemoteRefresh = () => {
    window.clearInterval(remoteRefreshTimer);
    remoteRefreshTimer = undefined;
    if (!preferences.values.value.dashboardShowRemoteResources) return;
    const seconds = Math.max(1, preferences.values.value.remoteHostRefreshIntervalSeconds);
    remoteRefreshTimer = window.setInterval(refreshRemote, seconds * 1000);
  };
  const syncLocalRefresh = () => {
    if (!dashboardActive) {
      window.clearInterval(localRefreshTimer);
      localRefreshTimer = undefined;
      return;
    }
    scheduleLocalRefresh();
    if (preferences.values.value.dashboardShowLocalResources) refreshLocal();
  };
  const syncRemoteRefresh = () => {
    if (!dashboardActive) {
      window.clearInterval(remoteRefreshTimer);
      remoteRefreshTimer = undefined;
      window.clearTimeout(remoteInitialTimer);
      remoteInitialTimer = undefined;
      return;
    }
    scheduleRemoteRefresh();
    window.clearTimeout(remoteInitialTimer);
    remoteInitialTimer = undefined;
    if (!preferences.values.value.dashboardShowRemoteResources) return;
    remoteInitialTimer = window.setTimeout(() => {
      remoteInitialTimer = undefined;
      refreshRemote();
    }, 800);
  };

  watch(tagId, (value) => {
    if (value === '') removeStoredValue(dashboardTagStorage);
    else writeStoredValue(dashboardTagStorage, value);
  });
  watch(sort, (value) => writeStoredValue(dashboardSortStorage, value));
  watch(sortOrder, (value) => writeStoredValue(dashboardSortOrderStorage, value));
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

  const handleVisibilityChange = () => {
    if (document.hidden) return;
    if (preferences.values.value.dashboardShowLocalResources) refreshLocal();
    if (preferences.values.value.dashboardShowRemoteResources) refreshRemote();
  };

  const refreshDashboardData = async (initial = false) => {
    if (initial) loading.value = !connections.loaded.value || !tags.loaded.value;
    const [, , audit] = await Promise.allSettled([
      initial ? connections.load() : connections.revalidate(),
      initial ? tags.load() : tags.revalidate(),
      auditApi.list({ limit: MAX_RECENT_LOGS, offset: 0 }),
      preferences.load(),
      suspended.load({ silent: true, force: true }),
    ]);
    if (audit.status === 'fulfilled') activity.value = audit.value.logs.slice(0, MAX_RECENT_LOGS);
    if (initial) loading.value = false;
  };

  const activateDashboard = () => {
    dashboardActive = true;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    suspended.startPolling();
    syncLocalRefresh();
    syncRemoteRefresh();
    if (hasActivatedOnce) void refreshDashboardData(false);
    else hasActivatedOnce = true;
  };
  const deactivateDashboard = () => {
    dashboardActive = false;
    window.clearInterval(localRefreshTimer);
    localRefreshTimer = undefined;
    window.clearInterval(remoteRefreshTimer);
    remoteRefreshTimer = undefined;
    window.clearTimeout(remoteInitialTimer);
    remoteInitialTimer = undefined;
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    suspended.stopPolling();
  };

  onMounted(() => void refreshDashboardData(true));
  onActivated(activateDashboard);
  onDeactivated(deactivateDashboard);
  onBeforeUnmount(deactivateDashboard);
  const percent = (value?: number) => {
    if (!Number.isFinite(value)) return '—';
    return `${Math.min(100, Math.max(0, Math.round(value!)))}%`;
  };
  const formatMemory = (value?: number) => {
    if (!Number.isFinite(value)) return '—';
    if (value! >= 1024) return `${(value! / 1024).toFixed(value! >= 10240 ? 0 : 1)} GB`;
    return `${Math.round(value!)} MB`;
  };
  const formatDisk = (value?: number) => {
    if (!Number.isFinite(value)) return '—';
    const gibibytes = value! / 1024 / 1024;
    if (gibibytes >= 1024) return `${(gibibytes / 1024).toFixed(gibibytes >= 10240 ? 0 : 1)} TB`;
    return `${gibibytes.toFixed(gibibytes >= 100 ? 0 : 1)} GB`;
  };
</script>

<template>
  <main class="min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-9 lg:py-6">
    <div class="mx-auto w-full max-w-[1680px] space-y-5">
      <section class="border-b border-border/70 pb-4">
        <div class="grid gap-4 px-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-3">
              <span class="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">{{
                t('projectName').split(' ')[0]
              }}</span>
              <span class="h-4 w-px bg-border" aria-hidden="true"></span>
              <h1 class="truncate text-xl font-semibold tracking-tight">{{ t('nav.dashboard') }}</h1>
            </div>
            <div v-if="latestConnection" class="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
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
              <UiButton
                density="compact"
                appearance="soft"
                tone="neutral"
                class="px-2.5"
                @click="connect(latestConnection)"
              >
                <span class="inline-flex items-center gap-1 text-[11px] font-medium">
                  <i class="fa-solid fa-rotate-right text-[9px]" aria-hidden="true"></i>
                  <span>{{ t('dashboard.reconnect') }}</span>
                </span>
              </UiButton>
              <UiButton
                v-if="activeSuspendedSessions.length"
                density="compact"
                appearance="soft"
                tone="neutral"
                class="hidden lg:inline-flex"
                :title="suspendedSessionsTitle || t('dashboard.suspendedSessions')"
                @click="openSuspendedSessions"
              >
                <template #leading><i class="fas fa-pause-circle text-[10px]" aria-hidden="true"></i></template>
                <span>{{ t('dashboard.suspendedSessions') }}</span>
                <span class="rounded-full bg-primary/15 px-1.5 tabular-nums">{{ activeSuspendedSessions.length }}</span>
              </UiButton>
            </div>
            <div v-else-if="activeSuspendedSessions.length" class="mt-3 hidden lg:flex">
              <UiButton
                density="compact"
                appearance="soft"
                tone="neutral"
                :title="suspendedSessionsTitle || t('dashboard.suspendedSessions')"
                @click="openSuspendedSessions"
              >
                <template #leading><i class="fas fa-pause-circle text-[10px]" aria-hidden="true"></i></template>
                <span>{{ t('dashboard.suspendedSessions') }}</span>
                <span class="rounded-full bg-primary/15 px-1.5 tabular-nums">{{ activeSuspendedSessions.length }}</span>
              </UiButton>
            </div>
          </div>

          <div
            class="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start sm:gap-x-5 lg:justify-end"
          >
            <div class="flex items-end justify-between gap-7 px-1 sm:justify-start">
              <div>
                <strong class="block text-2xl font-semibold leading-none tabular-nums">{{
                  connections.connections.value.length
                }}</strong>
                <div class="mt-1.5 text-[11px] text-text-secondary">{{ t('dashboard.totalConnections') }}</div>
              </div>
              <div>
                <strong class="block text-2xl font-semibold leading-none tabular-nums">{{
                  tags.tags.value.length
                }}</strong>
                <div class="mt-1.5 text-[11px] text-text-secondary">{{ t('dashboard.tagCount') }}</div>
              </div>
            </div>

            <div
              v-if="preferences.values.value.dashboardShowLocalResources"
              class="min-w-0 border-t border-border pt-3 sm:min-w-[300px] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
                  {{ t('dashboard.resources.local') }}
                </div>
                <span class="flex items-center gap-1.5 text-[11px] text-text-secondary"
                  ><span class="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true"></span
                  >{{ t('dashboard.resources.live') }}</span
                >
              </div>
              <div v-if="resources.local.value" class="mt-2 grid grid-cols-3 gap-4">
                <div>
                  <div class="flex items-baseline justify-between gap-2">
                    <span class="text-[11px] font-medium text-text-secondary">{{ t('dashboard.resources.cpu') }}</span>
                    <strong class="text-base font-semibold tabular-nums">{{
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
                    <span class="text-[11px] font-medium text-text-secondary">{{
                      t('dashboard.resources.memory')
                    }}</span>
                    <strong class="text-base font-semibold tabular-nums">{{
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
                    <span class="text-[11px] font-medium text-text-secondary">{{ t('dashboard.resources.disk') }}</span>
                    <strong class="text-base font-semibold tabular-nums">{{
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
                <UiSpinner v-if="resources.localLoading.value" density="compact" /><span v-else>{{
                  t('dashboard.resources.unavailable')
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div
        :class="
          preferences.values.value.dashboardShowRemoteResources
            ? 'grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)] xl:items-start xl:gap-0'
            : 'grid grid-cols-1'
        "
      >
        <section class="order-1 min-w-0 xl:pr-7">
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
            class="ui-glass-inset h-[clamp(300px,42vh,440px)] overflow-y-auto overscroll-auto rounded-xl xl:h-[clamp(360px,50vh,520px)]"
            style="scrollbar-gutter: stable both-edges"
          >
            <div
              class="ui-glass-nav sticky top-2 z-10 m-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 rounded-xl p-2.5 sm:grid-cols-[minmax(180px,1fr)_auto_auto_auto]"
            >
              <label class="col-span-3 min-w-0 sm:col-span-1"
                ><span class="sr-only">{{ t('dashboard.searchConnectionsPlaceholder') }}</span>
                <UiInput
                  v-model="search"
                  type="search"
                  density="comfortable"
                  :placeholder="t('dashboard.searchConnectionsPlaceholder')"
                  class="w-full"
                  style="--ui-control-radius: 12px"
                >
                  <template #leading><i class="fas fa-search text-xs" aria-hidden="true"></i></template>
                </UiInput>
              </label>
              <div class="min-w-0 sm:min-w-32">
                <UiSelect
                  v-model="tagId"
                  :options="tagFilterOptions"
                  class="dashboard-filter-select-gen2 text-xs sm:text-sm"
                  style="--ui-control-height: 2.375rem"
                  text-align="center"
                  match-trigger-width
                  :aria-label="t('dashboard.filterByTag')"
                />
              </div>
              <div class="min-w-0 sm:min-w-32">
                <UiSelect
                  v-model="sort"
                  :options="sortOptions"
                  class="dashboard-filter-select-gen2 text-xs sm:text-sm"
                  style="--ui-control-height: 2.375rem"
                  text-align="center"
                  match-trigger-width
                  :aria-label="t('dashboard.sortBy')"
                />
              </div>
              <UiButton
                appearance="soft"
                tone="neutral"
                icon-only
                class="!h-10 !w-10 shrink-0 text-xs"
                :aria-label="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
                :title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
                @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
              >
                <i
                  :class="['fas', sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a', 'text-xs']"
                  aria-hidden="true"
                ></i>
              </UiButton>
            </div>

            <div class="p-1.5">
              <div v-if="loading && filtered.length === 0" class="py-14 text-center text-sm text-text-secondary">
                {{ t('common.loading') }}
              </div>
              <ul v-else-if="filtered.length" class="space-y-2">
                <DashboardHostCard
                  v-for="item in filtered"
                  :key="item.id"
                  as="li"
                  title-tag="span"
                  :name="item.name || item.host"
                  :address="`${item.username}@${item.host}:${item.port}`"
                  :type="item.type"
                >
                  <template #metadata>
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
                  </template>
                  <template #action>
                    <UiButton
                      type="button"
                      appearance="soft"
                      tone="neutral"
                      class="w-full shrink-0 px-3.5 sm:w-auto"
                      @click="connect(item)"
                    >
                      <span class="inline-flex items-center gap-1.5 text-xs font-semibold">
                        <i class="fa-solid fa-arrow-right-to-bracket text-[10px]" aria-hidden="true"></i>
                        <span>{{ t('connections.actions.connect') }}</span>
                      </span>
                    </UiButton>
                  </template>
                </DashboardHostCard>
              </ul>
              <div v-else class="py-14 text-center text-sm text-text-secondary">
                <template v-if="search">{{ t('dashboard.noConnectionsMatchSearch') }}</template>
                <template v-else-if="tagId !== ''">{{ t('dashboard.noConnectionsWithTag') }}</template>
                <template v-else>{{ t('dashboard.noConnections') }}</template>
              </div>
            </div>
          </div>
          <div class="pt-3 text-right">
            <RouterLink to="/connections" class="text-sm font-medium text-link hover:text-link-hover hover:no-underline"
              >{{ t('dashboard.viewAllConnections') }} →</RouterLink
            >
          </div>
        </section>

        <section
          v-if="preferences.values.value.dashboardShowRemoteResources"
          class="order-2 min-w-0 xl:border-l xl:border-border/70 xl:pl-7"
        >
          <header class="flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-center gap-2.5">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <i class="fa-solid fa-server text-sm" aria-hidden="true"></i>
              </span>
              <div class="min-w-0">
                <h2 class="text-base font-semibold">{{ t('dashboard.resources.sshTitle') }}</h2>
                <p class="mt-0.5 truncate text-xs text-text-secondary">{{ t('dashboard.resources.sshHint') }}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[11px]">
              <span class="rounded-full border border-border bg-header/40 px-2.5 py-1 text-text-secondary"
                >{{ resources.remote.value.length }} {{ t('dashboard.resources.remote') }}</span
              >
              <span class="rounded-full border border-success/25 bg-success/10 px-2.5 py-1 font-medium text-success">{{
                t('dashboard.resources.snapshot', {
                  seconds: preferences.values.value.remoteHostRefreshIntervalSeconds,
                })
              }}</span>
            </div>
          </header>
          <div
            class="ui-glass-inset h-[clamp(300px,42vh,440px)] space-y-2 overflow-y-auto overscroll-auto rounded-xl p-1 sm:p-1.5 xl:h-[clamp(360px,50vh,520px)]"
            style="scrollbar-gutter: stable"
          >
            <div
              v-if="resources.remoteLoading.value && resources.remote.value.length === 0"
              class="grid h-full min-h-0 place-items-center"
            >
              <UiSpinner />
            </div>
            <DashboardHostCard
              v-for="remote in resources.remote.value"
              :key="remote.key"
              as="article"
              title-tag="h3"
              :name="remote.name"
              :address="`${remote.username}@${remote.host}:${remote.port}`"
              type="SSH"
              :status-dot-class="remote.status ? 'bg-success' : remote.error ? 'bg-error' : 'bg-border'"
              :accent-class="remote.status ? 'bg-success/70' : remote.error ? 'bg-error/70' : 'bg-border'"
            >
              <div v-if="remote.status" class="mt-3 grid grid-cols-3 gap-1.5 sm:mt-3.5 sm:gap-4">
                <div>
                  <div class="flex items-baseline justify-between gap-1 sm:gap-2">
                    <span class="text-[11px] font-medium text-text-secondary">{{ t('dashboard.resources.cpu') }}</span>
                    <strong class="text-base font-semibold tabular-nums sm:text-lg">{{
                      percent(remote.status.cpuPercent)
                    }}</strong>
                  </div>
                  <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80 sm:mt-2">
                    <div
                      class="h-full rounded-full bg-primary"
                      :style="{ width: percent(remote.status.cpuPercent) }"
                    ></div>
                  </div>
                </div>
                <div :title="`${formatMemory(remote.status.memUsed)} / ${formatMemory(remote.status.memTotal)}`">
                  <div class="flex items-baseline justify-between gap-1 sm:gap-2">
                    <span class="text-[11px] font-medium text-text-secondary">{{
                      t('dashboard.resources.memory')
                    }}</span>
                    <strong class="text-base font-semibold tabular-nums sm:text-lg">{{
                      percent(remote.status.memPercent)
                    }}</strong>
                  </div>
                  <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80 sm:mt-2">
                    <div
                      class="h-full rounded-full bg-success"
                      :style="{ width: percent(remote.status.memPercent) }"
                    ></div>
                  </div>
                  <div
                    class="mt-1 flex flex-wrap items-baseline gap-x-1 text-[10px] tabular-nums tracking-tight text-text-secondary sm:text-[11px]"
                  >
                    <span class="max-w-full truncate">{{ formatMemory(remote.status.memUsed) }}</span>
                    <span class="max-w-full truncate text-text-secondary/75"
                      >/ {{ formatMemory(remote.status.memTotal) }}</span
                    >
                  </div>
                </div>
                <div :title="`${formatDisk(remote.status.diskUsed)} / ${formatDisk(remote.status.diskTotal)}`">
                  <div class="flex items-baseline justify-between gap-1 sm:gap-2">
                    <span class="text-[11px] font-medium text-text-secondary">{{ t('dashboard.resources.disk') }}</span>
                    <strong class="text-base font-semibold tabular-nums sm:text-lg">{{
                      percent(remote.status.diskPercent)
                    }}</strong>
                  </div>
                  <div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80 sm:mt-2">
                    <div
                      class="h-full rounded-full bg-warning"
                      :style="{ width: percent(remote.status.diskPercent) }"
                    ></div>
                  </div>
                  <div
                    class="mt-1 flex flex-wrap items-baseline gap-x-1 text-[10px] tabular-nums tracking-tight text-text-secondary sm:text-[11px]"
                  >
                    <span class="max-w-full truncate">{{ formatDisk(remote.status.diskUsed) }}</span>
                    <span class="max-w-full truncate text-text-secondary/75"
                      >/ {{ formatDisk(remote.status.diskTotal) }}</span
                    >
                  </div>
                </div>
              </div>
              <div v-else-if="remote.error" class="mt-3 truncate text-xs text-error" :title="remote.error">
                {{ remote.error }}
              </div>
              <div v-else class="mt-3 text-xs text-text-secondary">{{ t('dashboard.resources.waiting') }}</div>
            </DashboardHostCard>
            <div
              v-if="!resources.remoteLoading.value && resources.remote.value.length === 0"
              class="flex h-full min-h-0 items-center justify-center px-4 text-center text-xs text-text-secondary"
            >
              {{ resources.remoteError.value || t('dashboard.resources.noRemoteSessions') }}
            </div>
          </div>
        </section>
      </div>

      <aside class="border-t border-border/70 pt-5">
        <header class="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
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
            ><RouterLink to="/audit-logs" class="text-sm font-medium text-link hover:text-link-hover hover:no-underline"
              >{{ t('dashboard.viewFullAuditLog') }} →</RouterLink
            >
          </div>
        </header>
        <div
          v-if="loading && activity.length === 0"
          class="ui-glass-inset rounded-xl py-10 text-center text-sm text-text-secondary"
        >
          {{ t('common.loading') }}
        </div>
        <ol v-else-if="activity.length" class="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <li v-for="log in activity" :key="log.id" class="ui-glass-item min-w-0 rounded-xl px-4 py-3.5">
            <div class="flex min-w-0 items-start justify-between gap-2">
              <div class="flex min-w-0 items-center gap-2">
                <span
                  class="activity-dot h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="isFailedAction(log.actionType) ? 'bg-error' : 'bg-primary'"
                  aria-hidden="true"
                ></span>
                <span
                  class="activity-title min-w-0 truncate text-sm font-medium leading-5"
                  :class="isFailedAction(log.actionType) ? 'text-error' : 'text-foreground'"
                  :title="actionLabel(log.actionType)"
                  >{{ actionLabel(log.actionType) }}</span
                >
              </div>
              <time class="shrink-0 pt-0.5 text-[11px] text-text-secondary">{{
                formatRelativeTime(log.timestamp)
              }}</time>
            </div>
            <p
              v-if="auditSummary(log.details)"
              class="mt-1.5 truncate pl-3.5 text-xs text-text-secondary"
              :title="auditSummary(log.details)"
            >
              {{ auditSummary(log.details) }}
            </p>
          </li>
        </ol>
        <div v-else class="ui-glass-inset rounded-xl py-10 text-center text-sm text-text-secondary">
          {{ t('dashboard.noRecentActivity') }}
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
  @media (max-width: 639px) {
    .dashboard-filter-select-gen2[data-ui-gen='2'] {
      --ui-control-padding-inline: 12px;
      --ui-control-gap: 8px;
      --ui-control-font-size: 12px;
      --ui-control-radius: 8px;
    }
  }
</style>
