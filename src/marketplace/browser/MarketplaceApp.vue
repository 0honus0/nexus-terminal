<script setup lang="ts">
	import { Package, RotateCw, Search, SlidersHorizontal } from '@lucide/vue';
	import { computed, onScopeDispose, ref, shallowRef, watch, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { LogApi } from '../../log/browser/log-api.js';
	import type { z } from 'zod';
	import type {
		MarketplaceRetainedDataListSchema,
		MarketplaceUninstallPlanSchema,
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

	import MarketplaceDiscover from './MarketplaceDiscover.vue';
	import MarketplaceInstalledCard from './MarketplaceInstalledCard.vue';
	import MarketplaceInstallDialog from './MarketplaceInstallDialog.vue';
	import MarketplacePluginDialog from './MarketplacePluginDialog.vue';
	import MarketplaceRepositories from './MarketplaceRepositories.vue';
	import {
		isMarketplaceUpdate,
		marketplaceInstalledStatus,
		marketplaceInstalledName,
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
	const { t, locale } = useI18n({ useScope: 'global' });
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
	const managed = computed(() => installed?.find(({ pluginId }) => pluginId === managedId.value));
	const managedStatus = computed(() => (managed.value ? installedStatus(managed.value) : 'unavailable'));
	const managedEntries = computed(() => applications.filter(({ pluginId }) => pluginId === managedId.value));
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
	const uninstallOpen = ref(false);
	const clearOnUninstall = ref(false);
	const clearTarget = shallowRef<z.infer<typeof MarketplaceRetainedDataListSchema>['items'][number]>();
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
	const results = computed(() => {
		const filter = query.value.trim().toLowerCase();
		return installed?.flatMap((item) => {
			const entries = applications.filter(({ pluginId }) => pluginId === item.pluginId);
			const name = marketplaceInstalledName(item, locale.value, entries[0]?.label);
			const kind = t('marketplace.kind.' + (item.kind ?? 'unknown'));
			return `${name} ${item.pluginId} ${kind}`.toLowerCase().includes(filter)
				? [{ item, name, entries, status: installedStatus(item), update: updates.value.get(item.pluginId) }]
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
				uninstallOpen.value = false;
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
		void readManagement();
		void api.readOperations().catch(() => undefined);
	}

	function inspectInstalled(pluginId: string): void {
		managedId.value = pluginId;
		managedOpen.value = true;
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
		dismissInstallation();
		managing.value = true;
		query.value = '';
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
			if (command.action === 'uninstall' && uninstallPlan.value === command.plan) uninstallOpen.value = false;
			if (command.action === 'clear-data' && clearTarget.value?.pluginId === pluginId) clearOpen.value = false;
			if (managedId.value === pluginId) managedOpen.value = false;

			managing.value = true;
			query.value = '';
			void readManagement();
		} catch (cause) {
			reportFailure(cause);
		} finally {
			submittingIds.value.delete(pluginId);
		}
	}

	async function prepareUninstall(item: MarketplacePlugin): Promise<void> {
		if (planning.value) return;
		const request = new AbortController();
		uninstallRequest?.abort();
		uninstallRequest = request;
		const signal = AbortSignal.any([request.signal, scope.signal]);
		planning.value = true;
		try {
			const result = await api.previewUninstall(item.pluginId, signal);
			if (signal.aborted || !managedOpen.value || managedId.value !== item.pluginId) return;
			uninstallPlan.value = result;
			clearOnUninstall.value = false;
			uninstallOpen.value = true;
		} catch (cause) {
			if (!signal.aborted) reportFailure(cause);
		} finally {
			if (!scope.signal.aborted && uninstallRequest === request) planning.value = false;
		}
	}

	watch(managedOpen, (open) => {
		if (!open) {
			uninstallRequest?.abort();
			uninstallOpen.value = false;
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

	function toggle(): void {
		managing.value = !managing.value;
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
					<UiButton
						appearance="ghost"
						icon-only
						:aria-label="t('desktop.refresh')"
						:loading="refreshing || (managing && loading)"
						@click="refresh()"
						><RotateCw :size="17"
					/></UiButton>
					<UiButton
						class="marketplace-manage-entry"
						icon-only
						:tone="managing ? 'primary' : 'neutral'"
						:aria-label="t('marketplaceTile.manage')"
						:aria-pressed="managing"
						@click="toggle"
						><SlidersHorizontal :size="18"
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
				<UiSection :title="t('desktop.installed')">
					<UiEmptyState
						v-if="results?.length === 0 && !builtinResults.length"
						:icon="Package"
						:title="t(query.trim() ? 'marketplace.noMatchingPlugins' : 'marketplaceTile.empty')"
					/>
					<template v-for="group in installedGroups" :key="group.kind ?? 'unknown'">
						<section
							v-if="group.items.length || (group.kind === 'application' && builtinResults.length)"
							class="marketplace-installed-group"
						>
							<h3>{{ t('marketplace.installedGroup.' + (group.kind ?? 'unknown')) }}</h3>
							<div class="marketplace-cards">
								<template v-if="group.kind === 'application'">
									<MarketplaceInstalledCard
										v-for="item in builtinResults"
										:key="item.key"
										:name="item.label"
										:icon="item.icon"
										:version="item.version"
										kind="application"
										status="available"
										builtin
										openable
										@manage="
											managedBuiltinKey = item.key;
											builtinOpen = true;
										"
										@open="emit('openApplication', item.key)"
									/>
								</template>
								<MarketplaceInstalledCard
									v-for="{ item, name, entries, status, update } in group.items"
									:key="item.pluginId"
									:name="name"
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
							</div>
						</section>
					</template>
				</UiSection>
				<MarketplaceRepositories
					:api="api"
					:repositories="repositories"
					:minimized="minimized"
					:log="log"
					@changed="discover"
				/>
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
			:title="t('marketplace.manageInstalled')"
			size="md"
			:close-label="t('closeApplication')"
		>
			<template v-if="managed">
				<div class="marketplace-managed-summary">
					<div class="marketplace-managed-heading">
						<h3>{{ marketplaceInstalledName(managed, locale, managedEntries[0]?.label) }}</h3>
						<UiBadge :tone="marketplaceStatusTones[managedStatus]" dot>{{
							t('marketplace.status.' + managedStatus)
						}}</UiBadge>
					</div>
					<div class="marketplace-managed-meta marketplace-managed-package" data-ui-selection="text">
						<span>{{ managed.pluginId }}</span>
						<span class="marketplace-managed-version">{{ managed.version }}</span>
					</div>
				</div>
				<UiList>
					<UiListItem :title="t('marketplace.enablePlugin')">
						<template #actions>
							<UiSwitch
								:model-value="managed.enabled"
								:aria-label="t('marketplace.enablePlugin')"
								:disabled="activeIds.has(managed.pluginId)"
								@update:model-value="
									(enabled) =>
										managed &&
										submit({ action: 'set-enabled', pluginId: managed.pluginId, enabled })
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
				<UiButton
					v-if="managed.enabled"
					:disabled="activeIds.has(managed.pluginId)"
					@click="submit({ action: 'reload', pluginId: managed.pluginId })"
				>
					{{ t('marketplace.reload') }}
				</UiButton>
				<UiButton
					tone="danger"
					:disabled="planning || activeIds.has(managed.pluginId)"
					@click="prepareUninstall(managed)"
				>
					{{ t('marketplace.uninstall') }}
				</UiButton>
			</template>
		</UiDialog>
		<UiDialog v-model:open="uninstallOpen" :title="t('marketplace.uninstall')" :close-label="t('closeApplication')">
			<template v-if="uninstallPlan">
				<p>{{ uninstallPlan.pluginId }} · {{ uninstallPlan.version }}</p>
				<template v-if="uninstallPlan.dependents.length">
					<p>{{ t('marketplace.uninstallDependents') }}</p>
					<UiList>
						<UiListItem v-for="id in uninstallPlan.dependents" :key="id" :title="id" />
					</UiList>
				</template>
				<p v-if="uninstallPlan.required">{{ t('notices.MARKETPLACE_PLUGIN_REQUIRED') }}</p>
				<label v-else class="marketplace-uninstall-data">
					<span>{{ t('marketplace.clearOnUninstall') }}</span>
					<UiSwitch v-model="clearOnUninstall" :aria-label="t('marketplace.clearOnUninstall')" />
				</label>
			</template>
			<template v-if="uninstallPlan" #footer>
				<UiButton :disabled="submittingIds.has(uninstallPlan.pluginId)" @click="uninstallOpen = false">
					{{ t('marketplace.cancel') }}
				</UiButton>
				<UiButton
					v-if="!uninstallPlan.required"
					tone="danger"
					:loading="submittingIds.has(uninstallPlan.pluginId)"
					:disabled="activeIds.has(uninstallPlan.pluginId)"
					@click="
						submit({ action: 'uninstall', plan: uninstallPlan, data: clearOnUninstall ? 'clear' : 'keep' })
					"
				>
					{{ t('marketplace.uninstall') }}
				</UiButton>
			</template>
		</UiDialog>
		<UiDialog v-model:open="clearOpen" :title="t('marketplace.clearData')" :close-label="t('closeApplication')">
			<p v-if="clearTarget">{{ t('marketplace.clearConfirm', { name: clearTarget.pluginId }) }}</p>
			<template v-if="clearTarget" #footer>
				<UiButton :disabled="submittingIds.has(clearTarget.pluginId)" @click="clearOpen = false">
					{{ t('marketplace.cancel') }}
				</UiButton>
				<UiButton
					tone="danger"
					:loading="submittingIds.has(clearTarget.pluginId)"
					:disabled="activeIds.has(clearTarget.pluginId)"
					@click="submit({ action: 'clear-data', pluginId: clearTarget.pluginId })"
				>
					{{ t('marketplace.clearData') }}
				</UiButton>
			</template>
		</UiDialog>
		<MarketplaceInstallDialog
			v-if="installTarget"
			:open="planOpen"
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
		z-index: 2;
		align-items: center;
		gap: 12px;
		padding: 22px 28px;
		background: color-mix(in srgb, var(--ui-surface) 92%, transparent);
		backdrop-filter: blur(16px);
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
	.marketplace-manage-entry {
		--ui-button-radius: 12px;
		--ui-button-background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-surface));
		--ui-button-text: var(--ui-primary);
		--ui-button-border: color-mix(in srgb, var(--ui-primary) 15%, var(--ui-border));
	}
	.marketplace-content {
		display: flex;
		flex: 1;
		flex-direction: column;
		padding: 0 28px 34px;
	}
	@container (max-width: 699px) {
		.marketplace-toolbar {
			padding: 18px 16px;
			gap: 8px;
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
	.marketplace-uninstall-data {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.marketplace-installed-group + .marketplace-installed-group {
		margin-top: 22px;
	}
	.marketplace-installed-group > h3 {
		margin: 0 0 10px;
		color: var(--ui-text);
		font-size: 14px;
		font-weight: 600;
	}
	.marketplace-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
		gap: 14px;
	}
</style>
