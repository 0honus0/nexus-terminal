<script setup lang="ts">
	import { Package, RotateCw, Search } from '@lucide/vue';
	import { computed, nextTick, onScopeDispose, ref, shallowRef, watch, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { LogApi } from '../../log/browser/log-api.js';
	import type { z } from 'zod';
	import type {
		MarketplaceRetainedDataListSchema,
		MarketplaceUninstallPlanSchema,
		MarketplaceRuntimeImpactSchema,
	} from '../marketplace-http-types.js';
	import type { MarketplaceDesktopApi } from './marketplace-desktop-api.js';
	import { CodedError } from '../../utils/error.js';
	import type { MarketplaceInstallAttempt, MarketplaceOperation, MarketplacePlugin } from '../marketplace-types.js';
	import type { PluginReadiness, PluginRuntimeInfo } from '../../plugin/plugin-state-types.js';
	import { resolvePluginIcon } from '../../plugin/plugin-api.browser.js';
	import type { MarketplaceInstallPlan, MarketplaceRepositorySource } from '../marketplace-install-types.js';
	import type { MarketplaceCatalogPlugin, MarketplaceRepository } from '../marketplace-catalog-types.js';
	import {
		UiBadge,
		UiButton,
		UiDialog,
		UiEmptyState,
		UiInput,
		UiList,
		UiListItem,
		UiSection,
		UiToolbar,
		UiSwitch,
	} from '../../ui/browser/ui-components-api.js';

	import MarketplaceActionDialog from './MarketplaceActionDialog.vue';
	import MarketplaceDiscover from './MarketplaceDiscover.vue';
	import MarketplaceInstalledCard from './MarketplaceInstalledCard.vue';
	import MarketplaceInstallDialog from './MarketplaceInstallDialog.vue';
	import MarketplacePluginDialog from './MarketplacePluginDialog.vue';
	import MarketplaceRepositories from './MarketplaceRepositories.vue';
	import {
		isMarketplaceUpdate,
		marketplaceDescription,
		marketplaceInstalledStatus,
		marketplaceInstalledName,
		marketplaceLabel,
		marketplacePackageName,
		marketplacePluginRuntime,
		marketplaceStatusTones,
		sortMarketplacePlugins,
	} from './marketplace-presentation.js';

	const {
		installed,
		loading,
		api,
		minimized,
		log,
		applications,
		pluginRuntime,
		builtins,
		openConfigurationApplication,
	} = defineProps<{
		installed?: readonly MarketplacePlugin[];
		loading: boolean;
		api: MarketplaceDesktopApi;
		minimized: boolean;
		applications: readonly {
			key: string;
			id: string;
			pluginId: string;
			label: string;
			icon?: Component;
			visible: boolean;
			readiness: PluginReadiness;
		}[];
		pluginRuntime?: ReadonlyMap<string, PluginRuntimeInfo>;
		builtins: readonly {
			key: string;
			label: string;
			description: string;
			icon?: Component;
			color?: string;
			visible: boolean;
			version: string;
		}[];
		log: Pick<LogApi, 'report'>;
		openConfigurationApplication(key: string): AbortSignal | undefined;
	}>();
	const emit = defineEmits<{
		refresh: [];
		showApplication: [key: string, visible: boolean];
		openApplication: [key: string];
	}>();
	const { t, n, locale } = useI18n({ useScope: 'global' });
	const root = ref<HTMLElement>();
	const catalog = shallowRef<readonly MarketplaceCatalogPlugin[]>();
	const repositories = shallowRef<readonly MarketplaceRepository[]>([]);
	const selectedId = ref<string>();
	const detailOpen = ref(false);
	const planOpen = ref(false);
	const plan = shallowRef<MarketplaceInstallPlan>();
	const installTarget = shallowRef<MarketplaceRepositorySource>();
	const installOperation = shallowRef<MarketplaceOperation>();
	const planning = ref(false);
	const submittingIds = ref(new Set<string>());
	const dismissing = ref<string>();
	const attempts = shallowRef<readonly MarketplaceInstallAttempt[]>([]);
	let managementRead: AbortController | undefined;
	const managedId = ref<string>();
	const managedOpen = ref(false);
	let managedFocusId: string | undefined;
	const managed = computed(() => installed?.find(({ pluginId }) => pluginId === managedId.value));
	const managedStatus = computed(() => (managed.value ? installedStatus(managed.value) : 'unavailable'));
	const managedEntries = computed(() => applications.filter(({ pluginId }) => pluginId === managedId.value));
	const managedName = computed(() =>
		managed.value ? marketplaceInstalledName(managed.value, locale.value, managedEntries.value[0]?.label) : '',
	);
	const managedBuiltinKey = ref<string>();
	const managedBuiltin = computed(() => builtins.find(({ key }) => key === managedBuiltinKey.value));
	const builtinOpen = ref(false);
	const builtinResults = computed(() => {
		const filter = query.value.trim().toLowerCase();
		return builtins.filter(({ label, key }) =>
			`${label} ${key} ${t('marketplace.builtin')}`.toLowerCase().includes(filter),
		);
	});
	const uninstallPlan = shallowRef<z.infer<typeof MarketplaceUninstallPlanSchema>>();
	const confirmingUninstall = ref(false);
	const uninstallLoading = ref(false);
	const uninstallTrigger = ref<InstanceType<typeof UiButton>>();
	const uninstallBody = ref<HTMLElement>();
	const currentUninstallPlan = computed(() =>
		uninstallPlan.value?.pluginId === managed.value?.pluginId &&
		uninstallPlan.value?.version === managed.value?.version
			? uninstallPlan.value
			: undefined,
	);
	const runtimeChange = shallowRef<
		{ action: 'set-enabled'; pluginId: string; enabled: false } | { action: 'reload'; pluginId: string }
	>();
	const runtimeChangeOpen = ref(false);
	const runtimeImpact = shallowRef<z.infer<typeof MarketplaceRuntimeImpactSchema>>();
	const runtimeImpactLoading = ref(false);
	let runtimeImpactRequest: AbortController | undefined;
	watch(
		runtimeChangeOpen,
		(open) => {
			if (!open) runtimeImpactRequest?.abort();
		},
		{ flush: 'sync' },
	);
	let runtimeChangeTrigger: HTMLElement | undefined;
	const runtimeReload = computed(() => runtimeChange.value?.action === 'reload');
	const runtimeImpactMatches = computed(
		() =>
			runtimeImpact.value?.pluginId === managed.value?.pluginId &&
			runtimeImpact.value?.version === managed.value?.version &&
			!!runtimeImpact.value,
	);
	const runtimeDependents = computed(() =>
		(runtimeImpact.value?.dependents ?? []).map((id) => {
			const item = installed?.find(({ pluginId }) => pluginId === id);
			const application = applications.find(({ pluginId }) => pluginId === id);
			return { id, name: item ? marketplaceInstalledName(item, locale.value, application?.label) : id };
		}),
	);
	const runtimeChangeAllowed = computed(
		() =>
			!!runtimeChange.value &&
			managedOpen.value &&
			managed.value?.pluginId === runtimeChange.value.pluginId &&
			managed.value.enabled &&
			runtimeImpactMatches.value &&
			!runtimeImpactLoading.value &&
			!activeIds.value.has(runtimeChange.value.pluginId),
	);

	const clearOnUninstall = ref(false);
	const clearTarget = shallowRef<z.infer<typeof MarketplaceRetainedDataListSchema>['items'][number]>();
	const clearPackage = computed(() => {
		const target = clearTarget.value;
		const versions = catalog.value?.find(({ id }) => id === target?.pluginId)?.versions;
		return (versions?.find(({ package: item }) => item.version === target?.version) ?? versions?.[0])?.package;
	});
	const clearOpen = ref(false);
	const retained = shallowRef<z.infer<typeof MarketplaceRetainedDataListSchema>['items']>([]);
	const operations = api.operations;
	watch(operations, (items) => {
		const current = items.find(({ id }) => id === installOperation.value?.id);
		if (current) installOperation.value = current;
	});
	const activeIds = computed(() => {
		const ids = new Set(submittingIds.value);
		for (const { change, state } of operations.value)
			if (state === 'queued' || state === 'running') ids.add(change.pluginId);
		return ids;
	});
	let planRequest: AbortController | undefined;
	let configuration: AbortController | undefined;
	let uninstallRequest: AbortController | undefined;
	const selected = computed(() => catalog.value?.find(({ id }) => id === selectedId.value));
	const selectedInstalled = computed(() => installed?.find(({ pluginId }) => pluginId === selectedId.value));
	const updates = computed(() => {
		const versions = new Map(catalog.value?.map(({ id, versions }) => [id, versions]));
		const targets = new Map<string, MarketplaceRepositorySource>();
		for (const item of installed ?? []) {
			const next = versions.get(item.pluginId)?.find((candidate) => isMarketplaceUpdate(item, candidate));
			if (next)
				targets.set(item.pluginId, {
					kind: 'repository',
					repositoryId: next.repositoryId,
					pluginId: item.pluginId,
					version: next.package.version,
				});
		}
		return targets;
	});
	const managing = ref(false);
	const query = ref('');
	const refreshing = ref(false);
	const catalogFailed = ref(false);
	const scope = new AbortController();
	let catalogRead: AbortController | undefined;
	const catalogDescriptions = computed(() => {
		const map = new Map<string, string>();
		for (const plugin of catalog.value ?? []) {
			const pack = plugin.versions[0]?.package;
			const desc = pack ? marketplaceDescription(pack, locale.value) : undefined;
			if (desc) map.set(plugin.id, desc);
		}
		return map;
	});
	const results = computed(() => {
		const filter = query.value.trim().toLowerCase();
		return installed?.flatMap((item) => {
			const entries = applications.filter(({ pluginId }) => pluginId === item.pluginId);
			const name = marketplaceInstalledName(item, locale.value, entries[0]?.label);
			const kind = t('marketplace.kind.' + (item.kind ?? 'unknown'));
			return `${name} ${item.pluginId} ${kind}`.toLowerCase().includes(filter)
				? [
						{
							item,
							name,
							entries,
							status: installedStatus(item),
							update: updates.value.get(item.pluginId),
						},
					]
				: [];
		});
	});

	function installedStatus(item: MarketplacePlugin) {
		return marketplaceInstalledStatus({
			...item,
			runtime: marketplacePluginRuntime(item, pluginRuntime?.get(item.pluginId)),
		});
	}

	const installedGroups = computed(() =>
		(['application', 'extension', null] as const).map((kind) => ({
			kind,
			items: results.value?.filter(({ item }) => item.kind === kind) ?? [],
		})),
	);
	watch(
		() => minimized,
		(hidden) => {
			if (hidden) {
				detailOpen.value = false;
				managedOpen.value = false;
				builtinOpen.value = false;
				dismissInstallation();
				runtimeChangeOpen.value = false;
				clearOpen.value = false;
			}
		},
	);
	onScopeDispose(() => scope.abort());
	void discover(true);

	watch(operations, (next, previous) => {
		if (
			managing.value &&
			next.some(
				(item) =>
					(item.state === 'failed' || item.state === 'succeeded') &&
					!previous.some((old) => old.id === item.id && old.state === item.state),
			)
		)
			void readManagement();
	});

	async function readManagement(): Promise<void> {
		managementRead?.abort();
		const request = new AbortController();
		managementRead = request;
		const signal = AbortSignal.any([scope.signal, request.signal]);
		const [data, pending] = await Promise.allSettled([api.readRetained(signal), api.readAttempts(signal)]);
		if (signal.aborted) return;
		if (data.status === 'fulfilled') retained.value = data.value;
		if (pending.status === 'fulfilled') attempts.value = pending.value;
		if (data.status === 'rejected' || pending.status === 'rejected')
			log.report({ source: 'marketplace', code: 'MARKETPLACE_MANAGEMENT_READ_FAILED', level: 'warn' });
	}

	async function dismissAttempt(pluginId: string): Promise<void> {
		if (dismissing.value) return;
		dismissing.value = pluginId;
		try {
			await api.dismissAttempt(pluginId);
		} catch (cause) {
			reportFailure(cause);
		} finally {
			if (!scope.signal.aborted) {
				dismissing.value = undefined;
				void readManagement();
			}
		}
	}

	async function discover(refreshOfficial = false): Promise<void> {
		// 仓库变更可能在读取期间提交，此时旧快照不能覆盖新目录。
		catalogRead?.abort();
		const request = new AbortController();
		catalogRead = request;
		const signal = AbortSignal.any([scope.signal, request.signal]);
		refreshing.value = true;
		catalogFailed.value = false;
		try {
			const [items, sources] = await Promise.allSettled([api.readCatalog(signal), api.readRepositories(signal)]);
			signal.throwIfAborted();
			if (sources.status === 'fulfilled') repositories.value = sources.value;
			if (items.status === 'rejected') throw items.reason;
			catalog.value = sortMarketplacePlugins(items.value);

			const official = refreshOfficial && repositories.value.find(({ official }) => official);
			if (!official) return;

			await api.refreshRepository(official.id, signal);
			const updated = await api.readCatalog(signal);
			signal.throwIfAborted();
			catalog.value = sortMarketplacePlugins(updated);
		} catch {
			if (!signal.aborted) {
				catalogFailed.value = !catalog.value?.length;
				log.report({ source: 'marketplace', code: 'MARKETPLACE_CATALOG_READ_FAILED', level: 'warn' });
			}
		} finally {
			if (catalogRead === request) {
				catalogRead = undefined;
				refreshing.value = false;
			}
		}
	}

	function inspect(pluginId: string): void {
		selectedId.value = pluginId;
		detailOpen.value = true;
	}

	function manage(pluginId: string): void {
		detailOpen.value = false;
		managing.value = true;
		query.value = pluginId;
		emit('refresh');
		inspectInstalled(pluginId);
		managedFocusId = pluginId;
		void readManagement();
		void api.readOperations().catch(() => undefined);
	}

	function inspectInstalled(pluginId: string): void {
		managedFocusId = undefined;
		managedId.value = pluginId;
		managedOpen.value = true;
	}

	function restoreManagedFocus(event: Event): void {
		if (!managedFocusId || managedOpen.value) return;
		const id = managedFocusId;
		managedFocusId = undefined;
		if (minimized || !managing.value || scope.signal.aborted) return;
		const button = root.value?.querySelector<HTMLButtonElement>(
			`[data-marketplace-plugin="${CSS.escape(id)}"] .ui-card__main`,
		);
		if (!button?.isConnected || button.disabled) return;
		event.preventDefault();
		button.focus();
	}

	async function preview(source: MarketplaceRepositorySource): Promise<void> {
		dismissInstallation();
		const request = new AbortController();
		planRequest = request;
		const signal = AbortSignal.any([request.signal, scope.signal]);
		installTarget.value = source;
		detailOpen.value = false;
		managedOpen.value = false;
		planOpen.value = true;
		planning.value = true;
		try {
			const result = await api.previewInstall(source, signal);
			signal.throwIfAborted();
			if (minimized || !planOpen.value) return;
			plan.value = result;
		} catch {
			if (!signal.aborted)
				log.report({
					source: 'marketplace',
					code: 'MARKETPLACE_INSTALL_PLAN_FAILED',
					level: 'error',
					userVisible: true,
				});
		} finally {
			if (planRequest === request) {
				planRequest = undefined;
				if (!scope.signal.aborted) planning.value = false;
			}
		}
	}

	function openConfiguration(key: string): void {
		if (configuration || !planOpen.value || scope.signal.aborted) return;
		const closed = openConfigurationApplication(key);
		if (!closed || closed.aborted) return;
		const request = new AbortController();
		configuration = request;
		planOpen.value = false;
		closed.addEventListener(
			'abort',
			() => {
				configuration = undefined;
				planOpen.value = true;
				emit('refresh');
			},
			{ once: true, signal: AbortSignal.any([request.signal, scope.signal]) },
		);
	}

	function dismissInstallation(): void {
		planRequest?.abort();
		configuration?.abort();
		configuration = undefined;
		planOpen.value = false;
		installOperation.value = undefined;
		installTarget.value = undefined;
		plan.value = undefined;
	}

	function finishInstallation(): void {
		const fromDiscover = !managing.value;
		dismissInstallation();
		managing.value = true;
		query.value = '';
		if (fromDiscover) root.value?.closest('.application-window__body')?.scrollTo(0, 0);
		void readManagement();
	}

	function reportFailure(cause: unknown): void {
		if (!scope.signal.aborted)
			log.report({
				source: 'marketplace',
				code: cause instanceof CodedError ? cause.code : 'MARKETPLACE_REQUEST_FAILED',
				level: 'error',
				userVisible: true,
			});
	}

	async function submit(command: Parameters<MarketplaceDesktopApi['submit']>[0]): Promise<void> {
		const pluginId =
			command.action === 'install'
				? command.plan.target.pluginId
				: command.action === 'uninstall'
					? command.plan.pluginId
					: command.pluginId;
		if (activeIds.value.has(pluginId)) return;

		submittingIds.value.add(pluginId);
		try {
			const operation = await api.submit(command);
			if (scope.signal.aborted || command.action === 'set-enabled' || command.action === 'reload') return;

			// 等待受理时用户可能已切换目标，只关闭仍属于本次操作的界面。
			if (command.action === 'install') {
				if (plan.value === command.plan) installOperation.value = operation;
				return;
			}
			if (command.action === 'uninstall' && uninstallPlan.value === command.plan) managedOpen.value = false;
			if (command.action === 'clear-data' && clearTarget.value?.pluginId === pluginId) clearOpen.value = false;

			managing.value = true;
			query.value = '';
			void readManagement();
		} catch (cause) {
			reportFailure(cause);
		} finally {
			submittingIds.value.delete(pluginId);
		}
	}

	function prepareRuntimeChange(item: MarketplacePlugin, action: 'disable' | 'reload'): void {
		if (!item.enabled || activeIds.value.has(item.pluginId) || runtimeChangeOpen.value) return;
		runtimeChangeTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		runtimeChange.value =
			action === 'reload'
				? { action: 'reload', pluginId: item.pluginId }
				: { action: 'set-enabled', pluginId: item.pluginId, enabled: false };
		runtimeChangeOpen.value = true;
		void readRuntimeImpact();
	}

	async function readRuntimeImpact(): Promise<void> {
		const command = runtimeChange.value;
		if (!command || !runtimeChangeOpen.value) return;
		runtimeImpactRequest?.abort();
		const request = new AbortController();
		runtimeImpactRequest = request;
		const signal = AbortSignal.any([request.signal, scope.signal]);
		runtimeImpact.value = undefined;
		runtimeImpactLoading.value = true;
		try {
			const impact = await api.previewRuntimeImpact(command.pluginId, signal);
			if (signal.aborted || !runtimeChangeOpen.value || runtimeChange.value !== command) return;
			if (impact.pluginId !== command.pluginId || impact.version !== managed.value?.version)
				throw new CodedError('MARKETPLACE_INSTALL_PLAN_CHANGED');
			runtimeImpact.value = impact;
		} catch (cause) {
			if (!signal.aborted) reportFailure(cause);
		} finally {
			if (runtimeImpactRequest === request) runtimeImpactLoading.value = false;
		}
	}

	function restoreRuntimeChangeFocus(event: Event): void {
		const trigger = runtimeChangeTrigger;
		runtimeChangeTrigger = undefined;
		if (
			!managedOpen.value ||
			minimized ||
			scope.signal.aborted ||
			!trigger?.isConnected ||
			trigger.matches(':disabled')
		)
			return;
		event.preventDefault();
		trigger.focus();
	}

	function confirmRuntimeChange(): void {
		const command = runtimeChange.value;
		if (!command || !runtimeChangeAllowed.value || !runtimeImpact.value) return;
		const impactRevision = runtimeImpact.value.revision;
		runtimeChangeOpen.value = false;
		void submit({ ...command, impactRevision });
	}

	async function prepareUninstall(item: MarketplacePlugin): Promise<void> {
		if (uninstallLoading.value || activeIds.value.has(item.pluginId)) return;
		if (!confirmingUninstall.value) {
			confirmingUninstall.value = true;
			clearOnUninstall.value = false;
			void nextTick(() => uninstallBody.value?.focus());
		}
		const request = new AbortController();
		uninstallRequest = request;
		const signal = AbortSignal.any([request.signal, scope.signal]);
		uninstallLoading.value = true;
		uninstallPlan.value = undefined;
		try {
			const result = await api.previewUninstall(item.pluginId, signal);
			if (signal.aborted || !managedOpen.value || !confirmingUninstall.value) return;
			uninstallPlan.value = result;
		} catch (cause) {
			if (!signal.aborted) reportFailure(cause);
		} finally {
			if (uninstallRequest === request) {
				uninstallRequest = undefined;
				uninstallLoading.value = false;
			}
		}
	}

	function resetUninstall(): void {
		uninstallRequest?.abort();
		uninstallRequest = undefined;
		uninstallLoading.value = false;
		uninstallPlan.value = undefined;
		confirmingUninstall.value = false;
	}

	function cancelUninstall(event?: KeyboardEvent): void {
		if (!confirmingUninstall.value) return;
		event?.preventDefault();
		resetUninstall();
		void nextTick(() => uninstallTrigger.value?.$el.focus());
	}

	watch(managedOpen, (open) => {
		if (!open) {
			resetUninstall();
			runtimeChangeOpen.value = false;
		}
	});

	function refreshManagement(): void {
		emit('refresh');
		void readManagement();
		void api.readOperations().catch(() => undefined);
	}

	function refresh(): void {
		void discover(true);
		if (managing.value) refreshManagement();
	}

	function setManaging(next: boolean): void {
		if (managing.value === next) return;
		managing.value = next;
		query.value = '';
		if (managing.value) refreshManagement();
		root.value?.closest('.application-window__body')?.scrollTo(0, 0);
	}
</script>

<template>
	<div ref="root" class="marketplace-app">
		<UiToolbar class="marketplace-toolbar">
			<UiInput
				v-model="query"
				type="search"
				:placeholder="t('marketplaceTile.search')"
				:aria-label="t('marketplaceTile.search')"
			>
				<template #leading><Search :size="17" /></template>
			</UiInput>
			<template #actions>
				<div class="marketplace-actions">
					<div class="marketplace-nav" role="group" :aria-label="t('market')">
						<button
							type="button"
							class="marketplace-nav__item"
							:aria-pressed="!managing"
							@click="setManaging(false)"
						>
							{{ t('marketplace.discover') }}
						</button>
						<button
							type="button"
							class="marketplace-nav__item"
							:aria-label="t('marketplaceTile.manage')"
							:aria-pressed="managing"
							@click="setManaging(true)"
						>
							<span>{{ t('marketplace.installed') }}</span>
							<span class="marketplace-nav__count">{{ n(installed?.length ?? 0) }}</span>
						</button>
					</div>
					<UiButton
						appearance="ghost"
						icon-only
						:aria-label="t('desktop.refresh')"
						:loading="refreshing || (managing && loading)"
						@click="refresh()"
						><RotateCw :size="17"
					/></UiButton>
				</div>
			</template>
		</UiToolbar>
		<div class="marketplace-content">
			<MarketplaceDiscover
				v-if="!managing"
				:plugins="catalog ?? []"
				:installed="installed ?? []"
				:updates="updates"
				:query="query"
				:refreshing="refreshing"
				:failed="catalogFailed"
				@inspect="inspect"
			/>
			<template v-else>
				<div>
					<UiEmptyState
						v-if="results?.length === 0 && !builtinResults.length"
						:icon="Package"
						:title="t(query.trim() ? 'marketplace.noMatchingPlugins' : 'marketplaceTile.empty')"
					/>
					<template v-for="group in installedGroups" :key="group.kind ?? 'unknown'">
						<section
							v-if="group.items.length"
							class="marketplace-installed-group"
							:data-kind="group.kind ?? 'unknown'"
						>
							<header class="marketplace-installed-group__heading">
								<h3>
									{{ t('marketplace.installedGroup.' + (group.kind ?? 'unknown')) }}
									<span>{{ n(group.items.length) }}</span>
								</h3>
							</header>
							<ul class="marketplace-installed-cards">
								<MarketplaceInstalledCard
									v-for="{ item, name, entries, status, update } in group.items"
									:key="item.pluginId"
									:data-marketplace-plugin="item.pluginId"
									:name="name"
									:description="catalogDescriptions.get(item.pluginId)"
									:icon="resolvePluginIcon(item.icon) ?? entries[0]?.icon"
									:kind="item.kind"
									:version="item.version"
									:status="status"
									:update-version="update?.version"
									:update-disabled="planning || activeIds.has(item.pluginId)"
									:openable="item.kind === 'application' && item.enabled && entries.length === 1"
									@manage="inspectInstalled(item.pluginId)"
									@open="entries[0] && emit('openApplication', entries[0].key)"
									@update="update && preview(update)"
								/>
							</ul>
						</section>
					</template>
					<section v-if="builtinResults.length" class="marketplace-installed-group">
						<header class="marketplace-installed-group__heading">
							<h3>
								{{ t('marketplace.builtin') }} <span>{{ n(builtinResults.length) }}</span>
							</h3>
						</header>
						<ul class="marketplace-installed-cards">
							<MarketplaceInstalledCard
								v-for="item in builtinResults"
								:key="item.key"
								:name="item.label"
								:description="item.description"
								:icon="item.icon"
								:accent="item.color"
								:version="item.version"
								kind="application"
								status="available"
								openable
								@manage="
									managedBuiltinKey = item.key;
									builtinOpen = true;
								"
								@open="emit('openApplication', item.key)"
							/>
						</ul>
					</section>
				</div>
				<div class="marketplace-management-section">
					<MarketplaceRepositories
						:api="api"
						:repositories="repositories"
						:minimized="minimized"
						:log="log"
						@changed="discover"
					/>
				</div>
				<UiSection
					v-if="attempts.length"
					class="marketplace-management-section"
					:title="t('marketplace.installAttempts')"
				>
					<UiList>
						<UiListItem
							v-for="{ target, state } in attempts"
							:key="target.pluginId"
							:title="target.pluginId"
							:description="target.version + ' · ' + t('marketplace.attemptState.' + state)"
						>
							<template #actions>
								<UiButton
									:disabled="state === 'installing' || planning || activeIds.has(target.pluginId)"
									@click="preview(target)"
								>
									{{ t('marketplace.retryInstallation') }}
								</UiButton>
								<UiButton
									:disabled="state === 'installing' || !!dismissing"
									:loading="dismissing === target.pluginId"
									@click="dismissAttempt(target.pluginId)"
									>{{ t('marketplace.dismissAttempt') }}</UiButton
								>
							</template>
						</UiListItem>
					</UiList>
				</UiSection>
				<UiSection
					v-if="retained.length"
					class="marketplace-management-section"
					:title="t('marketplace.retainedData')"
				>
					<UiList>
						<UiListItem
							v-for="item in retained"
							:key="item.pluginId"
							:title="item.pluginId"
							:description="item.version"
						>
							<template #actions>
								<UiButton
									tone="danger"
									:disabled="activeIds.has(item.pluginId)"
									@click="
										clearTarget = item;
										clearOpen = true;
									"
								>
									{{ t('marketplace.clearData') }}
								</UiButton>
							</template>
						</UiListItem>
					</UiList>
				</UiSection>
			</template>
		</div>
		<MarketplacePluginDialog
			v-model:open="detailOpen"
			:plugin="selected"
			:repositories="repositories"
			:installed="selectedInstalled"
			:update="selectedId ? updates.get(selectedId) : undefined"
			:installing="planning || (!!selectedId && activeIds.has(selectedId))"
			@manage="manage"
			@install="preview"
		/>
		<UiDialog
			v-model:open="builtinOpen"
			:title="managedBuiltin?.label ?? ''"
			size="md"
			:close-label="t('closeApplication')"
		>
			<div v-if="managedBuiltin" class="marketplace-managed-summary">
				<div class="marketplace-managed-meta">
					<span class="marketplace-managed-version">{{
						t('marketplace.installedVersion', { version: managedBuiltin.version })
					}}</span>
					<UiBadge tone="success" dot>{{ t('marketplace.status.available') }}</UiBadge>
				</div>
				<p>{{ managedBuiltin.description }}</p>
			</div>
			<UiList v-if="managedBuiltin">
				<UiListItem :title="t('marketplace.showOnHome')">
					<template #actions>
						<UiSwitch
							:model-value="managedBuiltin.visible"
							:aria-label="t('marketplace.showOnHome')"
							@update:model-value="
								(visible) => managedBuiltin && emit('showApplication', managedBuiltin.key, visible)
							"
						/>
					</template>
				</UiListItem>
			</UiList>
			<template v-if="managedBuiltin" #footer>
				<UiButton
					tone="primary"
					@click="
						builtinOpen = false;
						emit('openApplication', managedBuiltin.key);
					"
				>
					{{ t('marketplace.openApplication') }}
				</UiButton>
			</template>
		</UiDialog>
		<UiDialog
			v-model:open="managedOpen"
			:class="{ 'marketplace-uninstall-dialog': confirmingUninstall }"
			@close-auto-focus="restoreManagedFocus"
			@escape-key-down="cancelUninstall"
			:title="t(confirmingUninstall ? 'marketplace.uninstall' : 'marketplace.manageInstalled')"
			size="md"
			:close-label="t('closeApplication')"
			:close-disabled="confirmingUninstall && !!managed && submittingIds.has(managed.pluginId)"
		>
			<template v-if="managed">
				<div v-if="!confirmingUninstall" class="marketplace-managed-summary">
					<div class="marketplace-managed-heading">
						<h3>{{ managedName }}</h3>
						<UiBadge :tone="marketplaceStatusTones[managedStatus]" dot>{{
							t('marketplace.status.' + managedStatus)
						}}</UiBadge>
					</div>
					<div class="marketplace-managed-meta marketplace-managed-package" data-ui-selection="text">
						<span>{{ managed.pluginId }}</span>
						<span class="marketplace-managed-version">{{ managed.version }}</span>
					</div>
					<p v-if="catalogDescriptions.has(managed.pluginId)" data-ui-selection="text">
						{{ catalogDescriptions.get(managed.pluginId) }}
					</p>
				</div>
				<div v-if="confirmingUninstall" ref="uninstallBody" class="marketplace-uninstall" tabindex="-1">
					<div class="marketplace-uninstall-target">
						<div class="marketplace-uninstall-target__heading">
							<span class="marketplace-uninstall-target__icon" aria-hidden="true">
								<component
									:is="resolvePluginIcon(managed.icon) ?? managedEntries[0]?.icon ?? Package"
									:size="20"
								/>
							</span>
							<h3 data-ui-selection="text">{{ managedName }}</h3>
						</div>
						<dl class="marketplace-uninstall-target__details">
							<div>
								<dt>{{ t('marketplace.packageName') }}</dt>
								<dd data-ui-selection="text">{{ managed.pluginId }}</dd>
							</div>
							<div>
								<dt>{{ t('marketplace.packageVersion') }}</dt>
								<dd class="marketplace-uninstall-target__version" data-ui-selection="text">
									{{ managed.version }}
								</dd>
							</div>
						</dl>
					</div>
					<p v-if="uninstallLoading" role="status">{{ t('marketplace.loadingImpact') }}</p>
					<template v-else-if="currentUninstallPlan">
						<UiSection
							v-if="currentUninstallPlan.dependents.length"
							class="marketplace-uninstall-dependents"
							:title="t('marketplace.affected')"
							:description="t('marketplace.uninstallDependents')"
						>
							<UiList>
								<UiListItem v-for="id in currentUninstallPlan.dependents" :key="id" :title="id" />
							</UiList>
						</UiSection>
						<p v-if="currentUninstallPlan.required">{{ t('notices.MARKETPLACE_PLUGIN_REQUIRED') }}</p>
						<UiList v-else class="marketplace-uninstall-data">
							<UiListItem
								:title="t('marketplace.clearOnUninstall')"
								:description="t('marketplace.uninstallDataHint')"
							>
								<template #actions>
									<UiSwitch
										v-model="clearOnUninstall"
										:aria-label="t('marketplace.clearOnUninstall')"
										:disabled="activeIds.has(managed.pluginId)"
									/>
								</template>
							</UiListItem>
						</UiList>
					</template>
					<p v-else role="status">
						{{
							t(
								uninstallPlan
									? 'notices.MARKETPLACE_INSTALL_PLAN_CHANGED'
									: 'notices.MARKETPLACE_REQUEST_FAILED',
							)
						}}
					</p>
				</div>
				<UiList v-else>
					<UiListItem :title="t('marketplace.enablePlugin')">
						<template #actions>
							<UiSwitch
								:model-value="managed.enabled"
								:aria-label="t('marketplace.enablePlugin')"
								:disabled="activeIds.has(managed.pluginId)"
								@update:model-value="
									(enabled) =>
										managed &&
										(enabled
											? submit({
													action: 'set-enabled',
													pluginId: managed.pluginId,
													enabled: true,
												})
											: prepareRuntimeChange(managed, 'disable'))
								"
							/>
						</template>
					</UiListItem>
					<template v-if="managed.enabled && managedEntries.length">
						<UiListItem
							v-for="entry in managedEntries"
							:key="entry.key"
							:title="t('marketplace.showOnHome')"
							:description="managedEntries.length > 1 ? entry.label : undefined"
						>
							<template #actions>
								<UiSwitch
									:model-value="entry.visible"
									:aria-label="
										managedEntries.length > 1
											? t('marketplace.showOnHomeNamed', { name: entry.label })
											: t('marketplace.showOnHome')
									"
									@update:model-value="(value) => emit('showApplication', entry.key, value)"
								/>
							</template>
						</UiListItem>
					</template>
					<UiListItem v-else-if="managed.kind === 'application'" :title="t('marketplace.showOnHome')">
						<template #actions>
							<UiSwitch :model-value="false" disabled :aria-label="t('marketplace.showOnHome')" />
						</template>
					</UiListItem>
				</UiList>
			</template>
			<template v-if="managed" #footer>
				<template v-if="confirmingUninstall">
					<UiButton
						appearance="ghost"
						:disabled="submittingIds.has(managed.pluginId)"
						@click="cancelUninstall()"
					>
						{{ t('marketplace.cancel') }}
					</UiButton>
					<UiButton v-if="!currentUninstallPlan && !uninstallLoading" @click="prepareUninstall(managed)">{{
						t('marketplace.retryInstallation')
					}}</UiButton>
					<UiButton
						v-else-if="!currentUninstallPlan?.required"
						tone="danger"
						:loading="submittingIds.has(managed.pluginId)"
						:disabled="!currentUninstallPlan || activeIds.has(managed.pluginId)"
						@click="
							currentUninstallPlan &&
							submit({
								action: 'uninstall',
								plan: currentUninstallPlan,
								data: clearOnUninstall ? 'clear' : 'keep',
							})
						"
						>{{ t('marketplace.uninstall') }}</UiButton
					>
				</template>
				<template v-else>
					<UiButton
						v-if="managed.enabled"
						:disabled="activeIds.has(managed.pluginId)"
						@click="prepareRuntimeChange(managed, 'reload')"
					>
						{{ t('marketplace.reload') }}
					</UiButton>
					<UiButton
						ref="uninstallTrigger"
						tone="danger"
						:disabled="activeIds.has(managed.pluginId)"
						@click="prepareUninstall(managed)"
					>
						{{ t('marketplace.uninstall') }}
					</UiButton>
				</template>
			</template>
		</UiDialog>
		<MarketplaceActionDialog
			v-if="runtimeChange"
			v-model:open="runtimeChangeOpen"
			:title="t(runtimeReload ? 'marketplace.reloadConfirmTitle' : 'marketplace.disableConfirmTitle')"
			:name="managedName || marketplaceLabel(runtimeChange.pluginId)"
			:plugin-id="runtimeChange.pluginId"
			:version="managed?.version"
			:icon="resolvePluginIcon(managed?.icon) ?? managedEntries[0]?.icon"
			:notice="t('marketplace.runtimeChangeWarning')"
			:tone="runtimeReload ? 'warning' : 'danger'"
			@close-auto-focus="restoreRuntimeChangeFocus"
		>
			<section class="marketplace-runtime-impact" :aria-label="t('marketplace.affected')">
				<h3>{{ t('marketplace.affected') }}</h3>
				<p v-if="runtimeImpactLoading" role="status">{{ t('marketplace.loadingImpact') }}</p>
				<template v-else-if="runtimeImpactMatches">
					<UiList v-if="runtimeDependents.length">
						<UiListItem
							v-for="{ id, name } in runtimeDependents"
							:key="id"
							:title="name"
							:description="name === id ? undefined : id"
						/>
					</UiList>
					<p v-else>{{ t('marketplace.noDependents') }}</p>
				</template>
				<p v-else role="status">
					{{
						t(
							runtimeImpact
								? 'notices.MARKETPLACE_INSTALL_PLAN_CHANGED'
								: 'notices.MARKETPLACE_REQUEST_FAILED',
						)
					}}
				</p>
			</section>
			<template #footer>
				<UiButton appearance="ghost" @click="runtimeChangeOpen = false">{{ t('marketplace.cancel') }}</UiButton>
				<UiButton v-if="!runtimeImpactLoading && !runtimeImpactMatches" @click="readRuntimeImpact">
					{{ t('marketplace.retryInstallation') }}
				</UiButton>
				<UiButton
					appearance="solid"
					:tone="runtimeReload ? 'primary' : 'danger'"
					:disabled="!runtimeChangeAllowed"
					@click="confirmRuntimeChange"
				>
					{{ t(runtimeReload ? 'marketplace.reload' : 'marketplace.disable') }}
				</UiButton>
			</template>
		</MarketplaceActionDialog>
		<MarketplaceActionDialog
			v-if="clearTarget"
			v-model:open="clearOpen"
			:title="t('marketplace.clearData')"
			:name="clearPackage ? marketplacePackageName(clearPackage, locale) : marketplaceLabel(clearTarget.pluginId)"
			:plugin-id="clearTarget.pluginId"
			:version="clearTarget.version"
			:icon="resolvePluginIcon(clearPackage?.nexus.icon)"
			:notice="t('marketplace.clearConfirm')"
			:close-disabled="submittingIds.has(clearTarget.pluginId)"
			tone="danger"
		>
			<template #footer>
				<UiButton
					appearance="ghost"
					:disabled="submittingIds.has(clearTarget.pluginId)"
					@click="clearOpen = false"
				>
					{{ t('marketplace.cancel') }}
				</UiButton>
				<UiButton
					appearance="solid"
					tone="danger"
					:loading="submittingIds.has(clearTarget.pluginId)"
					:disabled="activeIds.has(clearTarget.pluginId)"
					@click="submit({ action: 'clear-data', pluginId: clearTarget.pluginId })"
				>
					{{ t('marketplace.clearData') }}
				</UiButton>
			</template>
		</MarketplaceActionDialog>
		<MarketplaceInstallDialog
			v-if="installTarget"
			:open="planOpen"
			:target="installTarget"
			:target-package="
				catalog
					?.find(({ id }) => id === installTarget?.pluginId)
					?.versions.find(
						({ package: item, repositoryId }) =>
							item.version === installTarget?.version && repositoryId === installTarget?.repositoryId,
					)?.package
			"
			:plan="plan"
			:planning="planning"
			:operation="installOperation"
			:submitting="submittingIds.has(installTarget.pluginId)"
			:busy="activeIds.has(installTarget.pluginId)"
			:installed="installed"
			:loading-installed="loading"
			:plugin-runtime="pluginRuntime"
			:applications="applications"
			@update:open="!$event && dismissInstallation()"
			@confirm="plan && submit({ action: 'install', plan })"
			@retry="preview(installTarget)"
			@configure="openConfiguration"
			@finish="finishInstallation"
		/>
	</div>
</template>
<style scoped>
	.marketplace-app {
		--marketplace-card-radius: 12px;
		display: flex;
		flex-direction: column;
		min-height: 100%;
		container-type: inline-size;
	}
	.marketplace-toolbar {
		flex-wrap: nowrap;
		--ui-toolbar-content-basis: 0px;
		position: sticky;
		top: 0;
		z-index: 5;
		align-items: center;
		gap: 10px;
		padding: 16px 28px;
		background: color-mix(in srgb, var(--ui-surface) 92%, transparent);
		backdrop-filter: blur(16px);
	}
	.marketplace-toolbar :deep(.ui-toolbar__content) {
		flex: 1 1 0;
		min-width: 0;
	}
	.marketplace-toolbar :deep(.ui-toolbar__content > [data-ui='input']) {
		width: 100%;
	}
	.marketplace-toolbar :deep(.ui-toolbar__actions) {
		flex: none;
		margin-inline-start: 0;
	}
	.marketplace-nav {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 3px;
		flex: none;
		border-radius: 11px;
		background: color-mix(in srgb, var(--ui-text) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--ui-border) 60%, transparent);
	}
	.marketplace-nav__item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--ui-muted);
		font: inherit;
		font-size: 13px;
		font-weight: 520;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--ui-motion-duration, 140ms) ease,
			color var(--ui-motion-duration, 140ms) ease,
			box-shadow var(--ui-motion-duration, 140ms) ease;
	}
	.marketplace-nav__item:hover:not([aria-pressed='true']) {
		color: var(--ui-text);
	}
	.marketplace-nav__item[aria-pressed='true'] {
		background: var(--ui-surface);
		color: var(--ui-primary);
		font-weight: 600;
		box-shadow: 0 1px 4px color-mix(in srgb, #241b35 10%, transparent);
	}
	.marketplace-nav__count {
		padding: 1px 6px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--ui-text) 6%, transparent);
		color: var(--ui-muted);
		font-size: 11px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
		line-height: 15px;
	}
	.marketplace-nav__item[aria-pressed='true'] .marketplace-nav__count {
		background: color-mix(in srgb, var(--ui-primary) 13%, transparent);
		color: var(--ui-primary);
	}
	.marketplace-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.marketplace-actions > :deep(button) {
		flex: none;
		--ui-button-background: var(--ui-surface);
		box-shadow: 0 3px 12px color-mix(in srgb, var(--ui-text) 5%, transparent);
	}
	.marketplace-content {
		display: flex;
		flex: 1;
		flex-direction: column;
		padding: 0 28px 34px;
	}
	@container (max-width: 560px) {
		.marketplace-toolbar {
			flex-wrap: wrap;
			padding: 14px 16px;
			gap: 8px;
		}
		.marketplace-toolbar :deep(.ui-toolbar__content) {
			flex-basis: 100%;
		}
		.marketplace-toolbar :deep(.ui-toolbar__actions) {
			margin-inline-start: auto;
		}
		.marketplace-content {
			padding: 0 16px 28px;
		}
	}
	.marketplace-managed-summary {
		display: grid;
		gap: 8px;
		margin-bottom: 18px;
	}
	.marketplace-managed-summary h3,
	.marketplace-managed-summary p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.marketplace-managed-summary h3 {
		font-size: 16px;
		font-weight: 600;
	}
	.marketplace-managed-summary p {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.6;
	}
	.marketplace-managed-heading,
	.marketplace-managed-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
	}
	.marketplace-managed-heading {
		align-items: center;
	}
	.marketplace-managed-meta {
		align-items: baseline;
	}
	.marketplace-managed-package,
	.marketplace-managed-version {
		color: var(--ui-muted);
		font-size: 12px;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.marketplace-management-section {
		margin-top: 28px;
	}
	:global(.marketplace-uninstall-dialog) {
		--ui-dialog-width: 460px;
		--ui-dialog-radius: 16px;
		--ui-dialog-padding: 20px;
	}
	:global(.marketplace-uninstall-dialog .ui-dialog__footer) {
		padding-block: 12px 16px;
		border-block-start: 1px solid var(--ui-border);
	}
	.marketplace-uninstall {
		display: grid;
		gap: 12px;
	}
	.marketplace-uninstall-target {
		container-type: inline-size;
		min-width: 0;
		border: 1px solid var(--ui-border);
		border-radius: 10px;
	}
	.marketplace-uninstall-target__heading {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 9px 9px 0 0;
		background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-surface));
	}
	.marketplace-uninstall-target__heading h3 {
		min-width: 0;
		margin: 0;
		font-size: 16px;
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.marketplace-uninstall-target__icon {
		display: grid;
		flex: none;
		inline-size: 34px;
		block-size: 34px;
		place-items: center;
		border-radius: 7px;
		background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
		color: var(--ui-primary);
	}
	.marketplace-uninstall-target__details {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 34%);
		margin: 0;
		border-block-start: 1px solid var(--ui-border);
	}
	.marketplace-uninstall-target__details > div {
		display: grid;
		align-content: start;
		gap: 4px;
		min-width: 0;
		padding: 9px 12px 10px;
	}
	.marketplace-uninstall-target__details > div + div {
		border-inline-start: 1px solid var(--ui-border);
	}
	.marketplace-uninstall-target__details dt {
		color: var(--ui-muted);
		font-size: 11px;
	}
	.marketplace-uninstall-target__details dd {
		margin: 0;
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	.marketplace-uninstall-target__version {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	@container (max-width: 300px) {
		.marketplace-uninstall-target__details {
			grid-template-columns: minmax(0, 1fr);
		}
		.marketplace-uninstall-target__details > div {
			grid-template-columns: 60px minmax(0, 1fr);
			align-items: baseline;
			gap: 8px;
		}
		.marketplace-uninstall-target__details > div + div {
			border-inline-start: 0;
			border-block-start: 1px solid var(--ui-border);
		}
	}
	.marketplace-uninstall p {
		margin: 0;
		color: var(--ui-muted);
		font-size: 13px;
	}
	.marketplace-uninstall :deep(.ui-list-item__description) {
		white-space: normal;
	}
	.marketplace-uninstall-dependents {
		--ui-layout-gap: 8px;
		--ui-section-title-size: 13px;
	}
	.marketplace-uninstall-data {
		--ui-list-radius: 10px;
		--ui-list-item-padding: 10px 12px;
	}
	.marketplace-runtime-impact {
		display: grid;
		gap: 6px;
	}
	.marketplace-runtime-impact h3,
	.marketplace-runtime-impact p {
		margin: 0;
		font-size: 12px;
	}
	.marketplace-runtime-impact p {
		color: var(--ui-muted);
	}
	.marketplace-runtime-impact :deep(.ui-list-item) {
		--ui-list-item-padding: 7px 10px;
	}
	.marketplace-runtime-impact :deep(.ui-list-item__description) {
		overflow-wrap: anywhere;
		white-space: normal;
	}
	.marketplace-installed-group + .marketplace-installed-group {
		margin-top: 22px;
	}
	.marketplace-installed-group__heading {
		margin-bottom: 10px;
		padding-inline: 2px;
	}
	.marketplace-installed-group__heading > h3 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		color: var(--ui-text);
		font-size: 14.5px;
		font-weight: 600;
	}
	.marketplace-installed-group__heading > h3 > span {
		font-size: 10.5px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
		color: var(--ui-muted);
		background: color-mix(in srgb, var(--ui-text) 6%, transparent);
		border-radius: 6px;
		padding: 2px 6px;
	}
	.marketplace-installed-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 252px), 1fr));
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
