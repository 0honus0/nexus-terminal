<script setup lang="ts">
	import UiListToolbar from '@/foundation/ui/UiListToolbar.vue';
	import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiEmptyState,
		UiLoadingState,
		UiInlineNotice,
		UiSelect,
		UiSpinner,
		UiScrollArea,
	} from '@/foundation/ui';
	import DashboardResourceGauge from './DashboardResourceGauge.vue';
	import {
		jsonStorageCodec,
		numberStorageCodec,
		readStoredValue,
		removeStoredValue,
		stringStorageCodec,
		writeStoredValue,
	} from '@/foundation/browser';
	import { useConnections, type ConnectionSummary } from '@/features/connections/public';
	import { useConnectionTags } from '@/features/tags/public';
	import { useSystemOverview } from '@/features/system-overview/public';
	import { usePreferences, useMonitoringConfiguration } from '@/features/preferences/public';
	import { remoteDesktopLauncher } from '@/features/remote-desktop/public';
	import { useSuspendedSessions } from '@/features/ssh-suspend/public';
	import { preloadWorkspaceTerminalSurface } from '@/runtimes/workspace/public';

	const { t, locale } = useI18n();
	const router = useRouter();
	const connections = useConnections();
	const tags = useConnectionTags();
	const resources = useSystemOverview();
	const preferences = usePreferences();
	const monitoring = useMonitoringConfiguration();
	const effectiveMonitoring = computed(() =>
		monitoring.needsRefresh.value ? null : (monitoring.snapshot.value?.effectiveMonitoring ?? null),
	);
	const suspended = useSuspendedSessions();
	const search = ref('');
	type DashboardSort = 'lastConnected' | 'name' | 'type' | 'updated' | 'created';
	type DashboardSortOrder = 'asc' | 'desc';
	type DashboardConnectionType = 'SSH' | 'RDP' | 'VNC';
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
	const dashboardSectionStorage = {
		namespace: 'dashboard.section-expansion',
		version: 1,
		codec: jsonStorageCodec<Partial<Record<DashboardConnectionType, boolean>>>((value) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
			const result: Partial<Record<DashboardConnectionType, boolean>> = {};
			for (const [key, expanded] of Object.entries(value)) {
				if (typeof expanded !== 'boolean') return undefined;
				if (key !== 'SSH' && key !== 'RDP' && key !== 'VNC') return undefined;
				result[key] = expanded;
			}
			return result;
		}),
	} as const;
	const tagId = ref<number | ''>(readStoredValue(dashboardTagStorage) ?? '');
	const sort = ref<DashboardSort>(
		(readStoredValue(dashboardSortStorage) as DashboardSort | undefined) ?? 'lastConnected',
	);
	const sortOrder = ref<DashboardSortOrder>(
		(readStoredValue(dashboardSortOrderStorage) as DashboardSortOrder | undefined) ?? 'desc',
	);
	const storedSectionExpansion = readStoredValue(dashboardSectionStorage) ?? {};
	const expandedSections = ref<Record<DashboardConnectionType, boolean>>({
		SSH: storedSectionExpansion.SSH !== false,
		RDP: storedSectionExpansion.RDP !== false,
		VNC: storedSectionExpansion.VNC !== false,
	});
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
			return (
				!term || `${item.name ?? ''} ${item.host} ${item.username} ${item.port}`.toLowerCase().includes(term)
			);
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
	const remoteResourceIndex = computed(() => {
		const byConnectionId = new Map<number, (typeof resources.remote.value)[number]>();
		const byEndpoint = new Map<string, (typeof resources.remote.value)[number]>();
		for (const resource of resources.remote.value) {
			byConnectionId.set(resource.connectionId, resource);
			const endpoint = `${resource.host.trim().toLowerCase()}:${resource.port}`;
			if (!byEndpoint.has(endpoint)) byEndpoint.set(endpoint, resource);
		}
		return { byConnectionId, byEndpoint };
	});
	const filteredEntries = computed(() =>
		filtered.value.map((connection) => {
			const resource =
				preferences.values.value.dashboardShowRemoteResources && connection.type === 'SSH'
					? (remoteResourceIndex.value.byConnectionId.get(connection.id) ??
						remoteResourceIndex.value.byEndpoint.get(
							`${connection.host.trim().toLowerCase()}:${connection.port}`,
						))
					: undefined;
			return { connection, resource };
		}),
	);
	const connectionGroups = computed(() =>
		(['SSH', 'RDP', 'VNC'] as const satisfies readonly DashboardConnectionType[])
			.map((type) => ({
				type,
				entries: filteredEntries.value.filter((entry) => entry.connection.type === type),
			}))
			.filter((group) => group.entries.length > 0),
	);

	const isSectionExpanded = (type: DashboardConnectionType): boolean => expandedSections.value[type];

	const toggleSection = (type: DashboardConnectionType) => {
		const next = { ...expandedSections.value, [type]: !expandedSections.value[type] };
		expandedSections.value = next;
		writeStoredValue(dashboardSectionStorage, next);
	};

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

	const connect = (item: ConnectionSummary) => {
		if (item.type === 'RDP' || item.type === 'VNC') {
			remoteDesktopLauncher.open({ id: item.id, name: item.name || item.host, type: item.type });
			return;
		}
		preloadWorkspaceTerminalSurface();
		return router.push({ name: 'Workspace', query: { connectionId: String(item.id) } });
	};

	const openSuspendedSessions = () => router.push({ name: 'Workspace', query: { openSuspended: '1' } });

	const relativeTimeFormatter = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }));
	const refreshTimeFormatter = computed(
		() =>
			new Intl.DateTimeFormat(locale.value, {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				hour12: false,
			}),
	);

	const formatRelativeTime = (timestamp: number | null | undefined): string => {
		if (!timestamp) return t('connections.status.never');
		try {
			const seconds = (timestamp - Date.now()) / 1000;
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
			return relativeTimeFormatter.value.format(Math.round(seconds / scale), unit);
		} catch {
			return String(timestamp);
		}
	};

	const formatRefreshTime = (timestamp: number | null | undefined): string => {
		if (!timestamp || !Number.isFinite(timestamp)) return '—';
		try {
			return refreshTimeFormatter.value.format(timestamp);
		} catch {
			return new Date(timestamp).toLocaleTimeString();
		}
	};

	const tagNameById = computed(() => new Map(tags.tags.value.map((tag) => [tag.id, tag.name] as const)));

	const tagNames = (item: ConnectionSummary): string[] =>
		item.tagIds.map((id) => tagNameById.value.get(id)).filter((name): name is string => Boolean(name));

	let dashboardActive = false;
	let hasActivatedOnce = false;
	let localRefreshTimer: number | undefined;
	let remoteRefreshTimer: number | undefined;
	let remoteInitialTimer: number | undefined;
	let dashboardRequest: AbortController | null = null;
	let localRefreshRequest: object | null = null;
	let remoteRefreshRequest: object | null = null;
	let lastLocalLoadedAt = 0;
	let lastRemoteLoadedAt = 0;

	const isDashboardVisible = () =>
		dashboardActive && router.currentRoute.value.name === 'Dashboard' && !document.hidden;

	const refreshLocal = async () => {
		if (
			!isDashboardVisible() ||
			!preferences.values.value.dashboardShowLocalResources ||
			!effectiveMonitoring.value ||
			localRefreshRequest
		)
			return;
		const interval = effectiveMonitoring.value.statusIntervalSeconds * 1000;
		if (lastLocalLoadedAt && Date.now() - lastLocalLoadedAt < interval) return;
		const request = {};
		localRefreshRequest = request;
		try {
			await resources.loadLocal();
			if (
				localRefreshRequest === request &&
				isDashboardVisible() &&
				resources.local.value &&
				!resources.localError.value
			)
				lastLocalLoadedAt = Date.now();
		} finally {
			if (localRefreshRequest === request) localRefreshRequest = null;
		}
	};

	const refreshRemote = async () => {
		if (
			!isDashboardVisible() ||
			!preferences.values.value.dashboardShowRemoteResources ||
			!effectiveMonitoring.value ||
			remoteRefreshRequest
		)
			return;
		const interval = effectiveMonitoring.value.hostIntervalSeconds * 1000;
		if (lastRemoteLoadedAt && Date.now() - lastRemoteLoadedAt < interval) return;
		const request = {};
		remoteRefreshRequest = request;
		try {
			await resources.loadRemote(() =>
				connections.load().then((items) => items.filter((item) => item.type === 'SSH')),
			);
			if (remoteRefreshRequest === request && isDashboardVisible()) {
				// A completed batch can contain host failures; only healthy samples may defer a return refresh.
				const succeeded =
					resources.remote.value.length > 0 &&
					!resources.remoteError.value &&
					resources.remote.value.every((resource) => resource.state === 'ready' && !resource.refreshError);
				lastRemoteLoadedAt = succeeded ? Date.now() : 0;
			}
		} finally {
			if (remoteRefreshRequest === request) remoteRefreshRequest = null;
		}
	};

	const scheduleLocalRefresh = () => {
		window.clearInterval(localRefreshTimer);
		localRefreshTimer = undefined;
		if (
			!isDashboardVisible() ||
			!preferences.values.value.dashboardShowLocalResources ||
			!effectiveMonitoring.value
		)
			return;
		const seconds = effectiveMonitoring.value.statusIntervalSeconds;
		localRefreshTimer = window.setInterval(refreshLocal, seconds * 1000);
	};

	const scheduleRemoteRefresh = () => {
		window.clearInterval(remoteRefreshTimer);
		remoteRefreshTimer = undefined;
		if (
			!isDashboardVisible() ||
			!preferences.values.value.dashboardShowRemoteResources ||
			!effectiveMonitoring.value
		)
			return;
		const seconds = effectiveMonitoring.value.hostIntervalSeconds;
		remoteRefreshTimer = window.setInterval(refreshRemote, seconds * 1000);
	};

	const syncLocalRefresh = () => {
		if (!isDashboardVisible()) {
			window.clearInterval(localRefreshTimer);
			localRefreshTimer = undefined;
			return;
		}
		scheduleLocalRefresh();
		if (preferences.values.value.dashboardShowLocalResources) void refreshLocal();
	};

	const syncRemoteRefresh = () => {
		if (!isDashboardVisible()) {
			window.clearInterval(remoteRefreshTimer);
			remoteRefreshTimer = undefined;
			window.clearTimeout(remoteInitialTimer);
			remoteInitialTimer = undefined;
			return;
		}
		scheduleRemoteRefresh();
		window.clearTimeout(remoteInitialTimer);
		remoteInitialTimer = undefined;
		if (!preferences.values.value.dashboardShowRemoteResources || !effectiveMonitoring.value) return;
		remoteInitialTimer = window.setTimeout(() => {
			remoteInitialTimer = undefined;
			void refreshRemote();
		}, 800);
	};

	watch(tagId, (value) => {
		if (value === '') removeStoredValue(dashboardTagStorage);
		else writeStoredValue(dashboardTagStorage, value);
	});
	watch(sort, (value) => writeStoredValue(dashboardSortStorage, value));
	watch(sortOrder, (value) => writeStoredValue(dashboardSortOrderStorage, value));
	watch(
		() => [preferences.values.value.dashboardShowLocalResources, effectiveMonitoring.value?.statusIntervalSeconds],
		syncLocalRefresh,
	);
	watch(
		() => [preferences.values.value.dashboardShowRemoteResources, effectiveMonitoring.value?.hostIntervalSeconds],
		syncRemoteRefresh,
	);

	const handleVisibilityChange = () => {
		if (!dashboardActive) return;
		if (document.hidden) {
			localRefreshRequest = null;
			remoteRefreshRequest = null;
			resources.deactivate();
			monitoring.deactivate();
		} else {
			resources.activate();
			monitoring.activate();
		}
		syncLocalRefresh();
		syncRemoteRefresh();
	};

	const refreshDashboardData = async (initial = false) => {
		dashboardRequest?.abort();
		const request = new AbortController();
		dashboardRequest = request;
		if (initial) loading.value = !connections.loaded.value || !tags.loaded.value;
		await Promise.allSettled([
			initial ? connections.load() : connections.revalidate(),
			initial ? tags.load() : tags.revalidate(),
			preferences.load(),
		]);
		if (dashboardRequest !== request) return;
		loading.value = false;
		dashboardRequest = null;
	};

	const activateDashboard = () => {
		if (dashboardActive || router.currentRoute.value.name !== 'Dashboard') return;
		dashboardActive = true;
		if (!document.hidden) {
			resources.activate();
		}
		monitoring.activate();
		document.addEventListener('visibilitychange', handleVisibilityChange);
		syncLocalRefresh();
		syncRemoteRefresh();
		void refreshDashboardData(!hasActivatedOnce);
		hasActivatedOnce = true;
	};

	const deactivateDashboard = () => {
		dashboardActive = false;
		dashboardRequest?.abort();
		dashboardRequest = null;
		loading.value = false;
		resources.deactivate();
		localRefreshRequest = null;
		remoteRefreshRequest = null;
		monitoring.deactivate();
		window.clearInterval(localRefreshTimer);
		localRefreshTimer = undefined;
		window.clearInterval(remoteRefreshTimer);
		remoteRefreshTimer = undefined;
		window.clearTimeout(remoteInitialTimer);
		remoteInitialTimer = undefined;
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	};

	watch(
		() => router.currentRoute.value.name,
		(name) => {
			if (name !== 'Dashboard') deactivateDashboard();
			else if (hasActivatedOnce) activateDashboard();
		},
		{ flush: 'sync' },
	);

	onActivated(activateDashboard);
	onDeactivated(deactivateDashboard);
	onBeforeUnmount(deactivateDashboard);

	const percent = (value?: number) => {
		if (value === undefined || !Number.isFinite(value)) return '—';
		return `${Math.min(100, Math.max(0, Math.round(value)))}%`;
	};

	const percentageWidth = (value?: number) =>
		value === undefined || !Number.isFinite(value) ? '0%' : percent(value);

	const formatMemory = (value?: number) => {
		if (value === undefined || !Number.isFinite(value)) return '—';
		if (value >= 1024) return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} GB`;
		return `${Math.round(value)} MB`;
	};

	const formatDisk = (value?: number) => {
		if (value === undefined || !Number.isFinite(value)) return '—';
		const gibibytes = value / 1024 / 1024;
		if (gibibytes >= 1024) return `${(gibibytes / 1024).toFixed(gibibytes >= 10240 ? 0 : 1)} TB`;
		return `${gibibytes.toFixed(gibibytes >= 100 ? 0 : 1)} GB`;
	};

	const resourceMetric = (
		resource: (typeof resources.remote.value)[number] | undefined,
		metric: 'cpuPercent' | 'memPercent' | 'memUsed' | 'memTotal' | 'diskPercent' | 'diskUsed' | 'diskTotal',
	): number | undefined => (resource?.state === 'ready' ? resource.status[metric] : undefined);

	const resourceErrorKey = (resource: (typeof resources.remote.value)[number] | undefined): string =>
		resource?.state === 'failed' ? `systemOverview.errors.${resource.error}` : 'dashboard.resources.unavailable';

	const resourceStatusKey = (resource: (typeof resources.remote.value)[number] | undefined): string => {
		if (resource?.state === 'ready') {
			return resource.refreshError ? 'dashboard.resources.refreshFailed' : 'dashboard.resources.live';
		}
		if (resource?.state === 'failed') return 'dashboard.resources.unavailable';
		if (resource?.state === 'waiting') return 'dashboard.resources.waiting';
		return 'dashboard.configured';
	};

	const resourceStatusTone = (resource: (typeof resources.remote.value)[number] | undefined): string => {
		if (resource?.state === 'ready') return resource.refreshError ? 'bg-warning' : 'bg-success';
		if (resource?.state === 'failed') return 'bg-error';
		return 'bg-text-secondary/50';
	};

	const localResourceStatusKey = computed(() => {
		if (!resources.localError.value) return 'dashboard.resources.live';
		return resources.local.value ? 'dashboard.resources.refreshFailed' : 'dashboard.resources.unavailable';
	});

	const localResourceStatusTone = computed(() => {
		if (!resources.localError.value) return 'bg-success';
		return resources.local.value ? 'bg-warning' : 'bg-error';
	});
</script>

<template>
	<main class="dashboard-page min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-9 lg:py-6">
		<div class="dashboard-layout mx-auto flex w-full max-w-[1680px] flex-col gap-5">
			<UiInlineNotice
				v-if="monitoring.needsRefresh.value && monitoring.feedback.value"
				tone="danger"
				compact
				data-monitoring-dashboard-error
			>
				{{ t(`settings.monitoring.feedback.${monitoring.feedback.value}`) }}
				<template #actions>
					<UiButton density="compact" :disabled="monitoring.loading.value" @click="monitoring.refresh">{{
						t('settings.monitoring.refresh')
					}}</UiButton>
				</template>
			</UiInlineNotice>
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
						<div v-if="activeSuspendedSessions.length" class="mt-3 hidden lg:flex">
							<UiButton
								density="compact"
								appearance="soft"
								tone="neutral"
								:title="suspendedSessionsTitle || t('dashboard.suspendedSessions')"
								@click="openSuspendedSessions"
							>
								<template #leading
									><i class="fas fa-pause-circle text-[10px]" aria-hidden="true"></i
								></template>
								<span>{{ t('dashboard.suspendedSessions') }}</span>
								<UiBadge class="tabular-nums" tone="primary" appearance="ghost" density="compact">{{
									activeSuspendedSessions.length
								}}</UiBadge>
							</UiButton>
						</div>
					</div>

					<div class="dashboard-overview-metrics min-w-0 w-full lg:w-[520px]">
						<div class="dashboard-overview-metrics-layout">
							<div class="dashboard-overview-counts flex items-end justify-between gap-7 px-1">
								<div>
									<strong class="block text-2xl font-semibold leading-none tabular-nums">{{
										connections.connections.value.length
									}}</strong>
									<div class="mt-1.5 text-[11px] text-text-secondary">
										{{ t('dashboard.totalConnections') }}
									</div>
								</div>
								<div>
									<strong class="block text-2xl font-semibold leading-none tabular-nums">{{
										tags.tags.value.length
									}}</strong>
									<div class="mt-1.5 text-[11px] text-text-secondary">
										{{ t('dashboard.tagCount') }}
									</div>
								</div>
							</div>

							<div
								v-if="preferences.values.value.dashboardShowLocalResources"
								class="dashboard-overview-local min-w-0 border-t border-border pt-3"
							>
								<div class="flex items-center justify-between gap-3">
									<div
										class="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary"
									>
										{{ t('dashboard.resources.local') }}
									</div>
									<div class="dashboard-overview-local__status">
										<span class="flex items-center gap-1.5 text-[11px] text-text-secondary"
											><span
												class="h-1.5 w-1.5 rounded-full"
												:class="localResourceStatusTone"
												aria-hidden="true"
											></span
											>{{ t(localResourceStatusKey) }}</span
										>
										<span v-if="resources.local.value" class="dashboard-overview-local__updated">
											{{
												t('dashboard.resources.updatedAt', {
													time: formatRefreshTime(resources.local.value.checkedAt),
												})
											}}
										</span>
									</div>
								</div>
								<div v-if="resources.local.value" class="mt-2 grid grid-cols-3 gap-4">
									<div>
										<div class="flex items-baseline justify-between gap-2">
											<span class="text-[11px] font-medium text-text-secondary">{{
												t('dashboard.resources.cpu')
											}}</span>
											<strong class="text-base font-semibold tabular-nums">{{
												percent(resources.local.value.cpuPercent)
											}}</strong>
										</div>
										<div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80">
											<div
												class="h-full rounded-full bg-primary"
												:style="{ width: percentageWidth(resources.local.value.cpuPercent) }"
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
												:style="{ width: percentageWidth(resources.local.value.memPercent) }"
											></div>
										</div>
									</div>
									<div>
										<div class="flex items-baseline justify-between gap-2">
											<span class="text-[11px] font-medium text-text-secondary">{{
												t('dashboard.resources.disk')
											}}</span>
											<strong class="text-base font-semibold tabular-nums">{{
												percent(resources.local.value.diskPercent)
											}}</strong>
										</div>
										<div class="mt-1.5 h-0.5 overflow-hidden rounded-full bg-border/80">
											<div
												class="h-full rounded-full bg-warning"
												:style="{ width: percentageWidth(resources.local.value.diskPercent) }"
											></div>
										</div>
									</div>
								</div>
								<div v-else-if="resources.localError.value" class="py-2 text-[11px] text-error">
									{{ t(`systemOverview.errors.${resources.localError.value}`) }}
								</div>
								<div
									v-else
									class="grid min-h-10 place-items-center py-2 text-[11px] text-text-secondary"
								>
									<UiSpinner v-if="resources.localLoading.value" density="compact" /><span v-else>{{
										t('dashboard.resources.unavailable')
									}}</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section
				class="dashboard-surface dashboard-status-surface flex min-w-0 flex-col overflow-hidden"
				aria-labelledby="dashboard-connections-title"
			>
				<h2 id="dashboard-connections-title" class="sr-only">{{ t('dashboard.connectionList') }}</h2>

				<UiScrollArea class="dashboard-scroll-area" :back-to-top-label="t('dashboard.backToTop')">
					<div class="dashboard-status-content">
						<UiListToolbar
							v-model="search"
							:search-label="t('dashboard.searchConnectionsPlaceholder')"
							class="dashboard-toolbar dashboard-status-toolbar"
						>
							<div class="min-w-0 sm:min-w-32">
								<UiSelect
									v-model="tagId"
									:options="tagFilterOptions"
									class="dashboard-filter-select-gen2 text-xs sm:text-sm"
									style="--ui-control-height: 2.375rem"
									text-align="center"
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
									:class="[
										'fas',
										sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a',
										'text-xs',
									]"
									aria-hidden="true"
								></i>
							</UiButton>
							<span class="dashboard-result-count shrink-0 text-xs text-text-secondary">
								{{ filteredEntries.length }} / {{ connections.connections.value.length }}
							</span>
							<RouterLink
								to="/connections"
								:aria-label="t('dashboard.viewAllConnections')"
								:title="t('dashboard.viewAllConnections')"
								class="dashboard-manage-link hidden shrink-0 sm:inline-flex"
							>
								<span class="hidden sm:inline">{{ t('dashboard.viewAllConnections') }}</span>
								<i class="fas fa-arrow-right text-xs" aria-hidden="true"></i>
							</RouterLink>
						</UiListToolbar>

						<div class="dashboard-status-grid-wrap">
							<UiLoadingState
								v-if="loading && filteredEntries.length === 0"
								class="py-12"
								compact
								:bordered="false"
								:title="t('common.loading')"
							/>
							<div v-else-if="filteredEntries.length" class="dashboard-connection-sections">
								<section
									v-for="group in connectionGroups"
									:key="group.type"
									class="dashboard-connection-section"
									:class="`dashboard-connection-section--${group.type.toLowerCase()}`"
									:aria-labelledby="`dashboard-connection-section-${group.type}`"
								>
									<header class="dashboard-connection-section__header">
										<h3 :id="`dashboard-connection-section-${group.type}`">
											<button
												type="button"
												class="dashboard-connection-section__toggle"
												:aria-expanded="isSectionExpanded(group.type)"
												:aria-controls="`dashboard-connection-list-${group.type}`"
												:aria-label="group.type"
												:title="
													t(
														isSectionExpanded(group.type)
															? 'common.collapse'
															: 'common.expand',
													)
												"
												@click="toggleSection(group.type)"
											>
												<i
													class="fas fa-chevron-down dashboard-connection-section__chevron"
													:class="{
														'dashboard-connection-section__chevron--collapsed':
															!isSectionExpanded(group.type),
													}"
													aria-hidden="true"
												></i>
												<span>{{ group.type }}</span>
												<span class="dashboard-connection-section__count" aria-hidden="true">{{
													group.entries.length
												}}</span>
											</button>
										</h3>
									</header>
									<ul
										v-show="isSectionExpanded(group.type)"
										:id="`dashboard-connection-list-${group.type}`"
										class="dashboard-connection-grid"
									>
										<li
											v-for="entry in group.entries"
											:key="entry.connection.id"
											class="dashboard-connection-item"
											:data-last-connected-at="entry.connection.lastConnectedAt ?? 0"
											:data-connection-type="entry.connection.type"
										>
											<button
												type="button"
												class="dashboard-connection-card dashboard-host-card group"
												:data-resource-state="entry.resource?.state ?? 'none'"
												:aria-label="`${t('connections.actions.connect')} ${entry.connection.name || entry.connection.host}`"
												@click="connect(entry.connection)"
											>
												<div class="dashboard-connection-card__header">
													<div class="dashboard-connection-card__identity">
														<span
															class="dashboard-connection-card__icon"
															:class="
																entry.connection.type === 'SSH'
																	? 'dashboard-connection-card__icon--ssh'
																	: 'dashboard-connection-card__icon--desktop'
															"
															aria-hidden="true"
														>
															<i
																:class="
																	entry.connection.type === 'SSH'
																		? 'fas fa-server'
																		: 'fas fa-display'
																"
															></i>
														</span>
														<span class="min-w-0">
															<span class="flex min-w-0 items-center gap-2">
																<strong
																	class="truncate text-[15px] font-semibold tracking-tight text-foreground"
																	:title="
																		entry.connection.name || entry.connection.host
																	"
																>
																	{{ entry.connection.name || entry.connection.host }}
																</strong>
																<UiBadge
																	class="dashboard-connection-card__protocol"
																	appearance="ghost"
																	density="compact"
																	>{{ entry.connection.type }}</UiBadge
																>
																<UiBadge
																	v-for="tagName in tagNames(entry.connection)"
																	:key="tagName"
																	class="dashboard-connection-card__tag max-w-24 min-w-0"
																	tone="primary"
																	appearance="ghost"
																	density="compact"
																	:title="tagName"
																>
																	{{ tagName }}
																</UiBadge>
															</span>
															<code
																class="mt-1 block truncate text-[11px] text-text-secondary"
																:title="`${entry.connection.username}@${entry.connection.host}:${entry.connection.port}`"
															>
																{{ entry.connection.username }}@{{
																	entry.connection.host
																}}:{{ entry.connection.port }}
															</code>
														</span>
													</div>
													<div class="dashboard-connection-card__aside">
														<span class="dashboard-connection-card__state">
															<span
																class="h-1.5 w-1.5 shrink-0 rounded-full"
																:class="resourceStatusTone(entry.resource)"
																aria-hidden="true"
															></span>
															{{ t(resourceStatusKey(entry.resource)) }}
														</span>
														<div class="dashboard-connection-card__times">
															<span
																class="dashboard-connection-card__last-connected"
																:title="`${t('dashboard.lastConnected')} ${formatRelativeTime(entry.connection.lastConnectedAt)}`"
															>
																{{
																	formatRelativeTime(entry.connection.lastConnectedAt)
																}}
															</span>
															<template
																v-if="
																	entry.connection.type === 'SSH' &&
																	entry.resource?.state === 'ready'
																"
															>
																<span
																	class="dashboard-connection-card__time-divider"
																	aria-hidden="true"
																></span>
																<span
																	class="dashboard-connection-card__updated-at"
																	:title="
																		t('dashboard.resources.updatedAt', {
																			time: formatRefreshTime(
																				entry.resource.checkedAt,
																			),
																		})
																	"
																>
																	{{ formatRefreshTime(entry.resource.checkedAt) }}
																</span>
															</template>
														</div>
													</div>
												</div>

												<div
													v-if="
														entry.connection.type === 'SSH' &&
														entry.resource?.state === 'ready'
													"
													class="dashboard-resource-strip"
												>
													<div class="dashboard-resource-gauges">
														<DashboardResourceGauge
															:gradient-id="`dashboard-gauge-${entry.connection.id}-cpu`"
															:label="t('dashboard.resources.cpu')"
															:value="resourceMetric(entry.resource, 'cpuPercent')"
															:detail="t('dashboard.resources.usage')"
															tone="cpu"
														/>
														<DashboardResourceGauge
															:gradient-id="`dashboard-gauge-${entry.connection.id}-memory`"
															:label="t('dashboard.resources.memory')"
															:value="resourceMetric(entry.resource, 'memPercent')"
															:detail="`${formatMemory(resourceMetric(entry.resource, 'memUsed'))} / ${formatMemory(resourceMetric(entry.resource, 'memTotal'))}`"
															tone="memory"
														/>
														<DashboardResourceGauge
															:gradient-id="`dashboard-gauge-${entry.connection.id}-disk`"
															:label="t('dashboard.resources.disk')"
															:value="resourceMetric(entry.resource, 'diskPercent')"
															:detail="`${formatDisk(resourceMetric(entry.resource, 'diskUsed'))} / ${formatDisk(resourceMetric(entry.resource, 'diskTotal'))}`"
															tone="disk"
														/>
													</div>
												</div>
												<div
													v-else-if="
														entry.connection.type === 'SSH' &&
														entry.resource?.state === 'failed'
													"
													class="dashboard-resource-message dashboard-resource-message--error"
													:title="t(resourceErrorKey(entry.resource))"
												>
													<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
													<span>{{ t(resourceErrorKey(entry.resource)) }}</span>
												</div>
												<div
													v-else-if="
														entry.connection.type === 'SSH' &&
														entry.resource?.state === 'waiting'
													"
													class="dashboard-resource-message"
												>
													<UiSpinner density="compact" />
													<span>{{ t('dashboard.resources.waiting') }}</span>
												</div>
												<div
													v-else-if="
														entry.connection.type === 'SSH' &&
														!preferences.values.value.dashboardShowRemoteResources
													"
													class="dashboard-resource-message"
												>
													<i class="fas fa-chart-simple" aria-hidden="true"></i>
													<span>{{ t('dashboard.configured') }}</span>
												</div>
												<div
													v-else-if="entry.connection.type === 'SSH'"
													class="dashboard-resource-message"
												>
													<i class="fas fa-chart-simple" aria-hidden="true"></i>
													<span>{{ t('dashboard.resources.waiting') }}</span>
												</div>
											</button>
										</li>
									</ul>
								</section>
							</div>
							<UiEmptyState
								v-else
								class="py-12"
								compact
								:bordered="false"
								icon="fa-solid fa-server"
								:title="
									search
										? t('dashboard.noConnectionsMatchSearch')
										: tagId !== ''
											? t('dashboard.noConnectionsWithTag')
											: t('dashboard.noConnections')
								"
							/>
						</div>
					</div>
				</UiScrollArea>
			</section>
		</div>
	</main>
</template>

<style scoped>
	.dashboard-surface.dashboard-status-surface {
		min-width: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
	}

	.dashboard-status-content {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 2px 6px 8px;
	}

	.dashboard-scroll-area :deep(.ui-scroll-area__back) {
		right: 24px;
	}

	.dashboard-scroll-area :deep(.ui-scroll-area__viewport) {
		height: auto;
		overflow-y: visible;
		scrollbar-gutter: auto;
	}

	.dashboard-toolbar.dashboard-status-toolbar {
		position: sticky;
		top: 0;
		z-index: 4;
		margin: 0;
		padding: 4px 0;
		border: 0;
		background: color-mix(in srgb, var(--app-bg-color) 94%, transparent);
		box-shadow: none;
		backdrop-filter: blur(10px);
	}

	.dashboard-result-count {
		font-variant-numeric: tabular-nums;
	}

	.dashboard-manage-link {
		display: inline-flex;
		height: 2.375rem;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding-inline: 10px;
		border-radius: 10px;
		color: var(--link-active-color);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.dashboard-manage-link:hover {
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: var(--link-hover-color);
		text-decoration: none;
	}

	.dashboard-manage-link:focus-visible {
		outline: 2px solid var(--link-active-color);
		outline-offset: 2px;
	}

	.dashboard-status-grid-wrap {
		min-width: 0;
	}

	.dashboard-connection-sections {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.dashboard-connection-section {
		--dashboard-card-height: 188px;
		--dashboard-resource-height: 100px;
		min-width: 0;
	}

	.dashboard-connection-section--rdp,
	.dashboard-connection-section--vnc {
		--dashboard-card-height: 76px;
	}

	.dashboard-connection-section__header {
		display: flex;
		align-items: center;
		margin: 0 2px 9px;
	}

	.dashboard-connection-section__header h3 {
		margin: 0;
	}

	.dashboard-connection-section__toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-left: -4px;
		padding: 4px 7px 4px 4px;
		border-radius: 8px;
		color: var(--text-color-secondary);
		font-size: 10px;
		font-weight: 750;
		letter-spacing: 0.14em;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.dashboard-connection-section__toggle:hover {
		color: var(--text-color);
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
	}

	.dashboard-connection-section__toggle:focus-visible {
		outline: 2px solid var(--link-active-color);
		outline-offset: 2px;
	}

	.dashboard-connection-section__chevron {
		width: 10px;
		font-size: 9px;
		transition: transform 160ms ease;
	}

	.dashboard-connection-section__chevron--collapsed {
		transform: rotate(-90deg);
	}

	.dashboard-connection-section__count {
		display: inline-grid;
		min-width: 18px;
		height: 18px;
		place-items: center;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}

	.dashboard-connection-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
		align-items: stretch;
		gap: 12px;
	}

	.dashboard-connection-item {
		display: flex;
		width: 100%;
		min-width: 0;
	}

	.dashboard-connection-card {
		display: flex;
		width: 100%;
		height: var(--dashboard-card-height);
		flex-direction: column;
		padding: 16px 18px 14px;
		color: inherit;
		text-align: left;
		cursor: pointer;
		appearance: none;
		border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
		border-radius: 18px;
		background: color-mix(in srgb, var(--card-bg-color) 92%, var(--app-bg-color));
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 9%, transparent),
			0 14px 34px -30px color-mix(in srgb, var(--text-color) 58%, transparent);
		transition:
			border-color 150ms ease,
			background-color 150ms ease,
			box-shadow 150ms ease,
			transform 150ms ease;
	}

	.dashboard-connection-card:hover {
		border-color: color-mix(in srgb, var(--link-active-color) 42%, var(--border-color));
		background: color-mix(in srgb, var(--card-bg-color) 97%, var(--app-bg-color));
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
			0 18px 38px -28px color-mix(in srgb, var(--link-active-color) 34%, transparent);
		transform: translateY(-1px);
	}

	.dashboard-connection-card:focus-visible {
		outline: 2px solid var(--link-active-color);
		outline-offset: 2px;
	}

	.dashboard-connection-card__header {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
	}

	.dashboard-connection-card__identity {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 10px;
	}

	.dashboard-connection-card__icon {
		display: grid;
		width: 36px;
		height: 36px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 12px;
		font-size: 13px;
	}

	.dashboard-connection-card__icon--ssh {
		color: var(--link-active-color);
		background: color-mix(in srgb, var(--link-active-color) 12%, transparent);
	}

	.dashboard-connection-card__icon--desktop {
		color: var(--status-warning-text-color);
		background: color-mix(in srgb, var(--color-warning) 16%, transparent);
	}

	.dashboard-connection-card__protocol {
		flex: 0 0 auto;
	}

	.dashboard-connection-card__tag {
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dashboard-connection-card__aside {
		display: grid;
		flex: 0 0 auto;
		justify-items: end;
		gap: 3px;
	}

	.dashboard-connection-card__state {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text-color-secondary);
		font-size: 10px;
		font-weight: 600;
		white-space: nowrap;
	}

	.dashboard-connection-card__times {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text-color-secondary);
		font-size: 8.5px;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		white-space: nowrap;
	}

	.dashboard-connection-card__last-connected {
		font-variant-numeric: normal;
	}

	.dashboard-connection-card__time-divider {
		width: 1px;
		height: 8px;
		background: color-mix(in srgb, var(--border-color) 78%, transparent);
	}

	.dashboard-connection-card__updated-at {
		font-variant-numeric: tabular-nums;
	}

	.dashboard-overview-local__updated {
		color: var(--text-color-secondary);
		font-size: 9px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.dashboard-overview-local__status {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		white-space: nowrap;
	}

	.dashboard-resource-strip {
		display: flex;
		min-width: 0;
		height: var(--dashboard-resource-height);
		flex: 1;
		align-items: center;
		margin-top: 10px;
	}

	.dashboard-resource-gauges {
		display: flex;
		min-width: 0;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: clamp(12px, 3vw, 22px);
	}

	.dashboard-resource-message {
		display: flex;
		height: var(--dashboard-resource-height);
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-top: 10px;
		color: var(--text-color-secondary);
		font-size: 11px;
		text-align: center;
	}

	.dashboard-resource-message {
		border-radius: 12px;
		background: color-mix(in srgb, var(--input-bg-color) 54%, transparent);
	}

	.dashboard-resource-message--error {
		padding-inline: 12px;
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 7%, transparent);
	}

	.dashboard-resource-message--error span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.dashboard-connection-card {
			transition: none;
		}
	}

	.dashboard-overview-metrics {
		container-type: inline-size;
	}
	.dashboard-overview-metrics-layout {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	@container (min-width: 520px) {
		.dashboard-overview-metrics-layout {
			flex-direction: row;
			align-items: center;
			justify-content: flex-end;
			gap: 1.25rem;
		}
		.dashboard-overview-counts {
			flex-shrink: 0;
			justify-content: flex-start;
		}
		.dashboard-overview-local {
			flex: 1;
			min-width: 300px;
			border-top: 0;
			border-left: 1px solid var(--border-color);
			padding-top: 0;
			padding-left: 1.25rem;
		}
	}

	.dashboard-surface {
		border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
		border-radius: 16px;
		background: color-mix(in srgb, var(--card-bg-color) 96%, var(--app-bg-color));
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 8%, transparent),
			0 10px 24px -24px color-mix(in srgb, var(--text-color) 38%, transparent);
	}

	@media (min-width: 1100px) {
		.dashboard-page {
			height: calc(100dvh - var(--app-header-height));
			min-height: 0;
			overflow: hidden;
		}

		.dashboard-layout {
			display: grid;
			height: 100%;
			min-height: 0;
			grid-template-rows: auto minmax(0, 1fr);
		}

		.dashboard-workspace {
			min-height: 0;
			overflow: hidden;
		}

		.dashboard-surface {
			height: 100%;
			min-height: 0;
		}

		.dashboard-scroll-area {
			min-height: 0;
			flex: 1;
		}

		.dashboard-scroll-area :deep(.ui-scroll-area__viewport) {
			height: 100%;
			overflow-y: auto;
			scrollbar-gutter: stable;
		}
	}

	.dashboard-toolbar,
	.dashboard-muted-card {
		border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
		background: color-mix(in srgb, var(--input-bg-color) 84%, var(--card-bg-color));
		box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
	}

	.dashboard-connection-search {
		background: var(--ui-fill-inset);
	}

	.dashboard-connection-search:hover {
		background: var(--ui-fill-inset-hover);
	}

	@media (max-width: 639px) {
		.dashboard-connection-card__aside {
			align-self: stretch;
			align-content: space-between;
		}

		.dashboard-manage-link {
			display: none;
		}

		.dashboard-status-toolbar :deep(.ui-list-toolbar__filters) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 2.5rem auto;
			align-items: center;
		}

		.dashboard-status-toolbar :deep(.ui-list-toolbar__filters > div),
		.dashboard-status-toolbar :deep(.ui-select) {
			width: 100%;
		}

		.dashboard-result-count {
			justify-self: end;
		}

		.dashboard-connection-search {
			--ui-control-radius: 8px;
		}

		.dashboard-filter-select-gen2[data-ui-gen='2'] {
			--ui-control-padding-inline: 12px;
			--ui-control-gap: 8px;
			--ui-control-font-size: 12px;
			--ui-control-radius: 8px;
		}
	}
</style>
