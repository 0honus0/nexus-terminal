<script setup lang="ts">
	import gt from 'semver/functions/gt.js';
	import prerelease from 'semver/functions/prerelease.js';
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
	import type { MarketplaceInstallAttempt, MarketplacePlugin } from '../marketplace-types.js';
	import type { MarketplaceInstallPlan, MarketplaceRepositorySource } from '../marketplace-install-types.js';
	import type { MarketplaceCatalogPlugin, MarketplaceRepository } from '../marketplace-catalog-types.js';
	import {
		UiBadge,
		UiButton,
		UiCard,
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
	import MarketplacePluginDialog from './MarketplacePluginDialog.vue';
	import MarketplaceRepositories from './MarketplaceRepositories.vue';
	import { sortMarketplacePlugins } from './marketplace-presentation.js';

	const { installed, loading, api, minimized, log, applications, builtins } = defineProps<{
		installed?: readonly MarketplacePlugin[];
		loading: boolean;
		api: MarketplaceDesktopApi;
		minimized: boolean;
		applications: readonly { key: string; pluginId: string; label: string; visible: boolean }[];
		builtins: readonly { key: string; label: string; icon?: Component; visible: boolean }[];
		log: Pick<LogApi, 'report'>;
	}>();
	const emit = defineEmits<{
		refresh: [];
		showApplication: [key: string, visible: boolean];
		openApplication: [key: string];
	}>();
	const { t } = useI18n({ useScope: 'global' });
	const root = ref<HTMLElement>();
	const catalog = shallowRef<readonly MarketplaceCatalogPlugin[]>();
	const repositories = shallowRef<readonly MarketplaceRepository[]>([]);
	const selectedId = ref<string>();
	const detailOpen = ref(false);
	const planOpen = ref(false);
	const plan = shallowRef<MarketplaceInstallPlan>();
	const planning = ref(false);
	const submitting = ref(false);
	const dismissing = ref<string>();
	const attempts = shallowRef<readonly MarketplaceInstallAttempt[]>([]);
	let managementRead: AbortController | undefined;
	const managedId = ref<string>();
	const managedOpen = ref(false);
	const managed = computed(() => installed?.find(({ pluginId }) => pluginId === managedId.value));
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
	const operations = computed(() => [...api.operations.value].reverse());
	const activeIds = computed(
		() =>
			new Set(
				operations.value
					.filter(({ state }) => state === 'queued' || state === 'running')
					.map(({ change }) => change.pluginId),
			),
	);
	let planRequest: AbortController | undefined;
	const selected = computed(() => catalog.value?.find(({ id }) => id === selectedId.value));
	const managing = ref(false);
	const query = ref('');
	const refreshing = ref(false);
	const scope = new AbortController();
	let catalogRead: AbortController | undefined;
	const results = computed(() => {
		const filter = query.value.trim().toLowerCase();
		return installed?.filter(({ pluginId }) => pluginId.toLowerCase().includes(filter));
	});
	watch(
		() => minimized,
		(hidden) => {
			if (hidden) {
				detailOpen.value = false;
				managedOpen.value = false;
				builtinOpen.value = false;
				planOpen.value = false;
				planRequest?.abort();
				uninstallOpen.value = false;
				clearOpen.value = false;
			}
		},
	);
	watch(detailOpen, (visible) => {
		if (!visible) {
			planRequest?.abort();
			planOpen.value = false;
		}
	});
	onScopeDispose(() => scope.abort());
	void discover();

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

	async function discover(): Promise<void> {
		// 仓库变更可能在读取期间提交，此时旧快照不能覆盖新目录。
		catalogRead?.abort();
		const request = new AbortController();
		catalogRead = request;
		const signal = AbortSignal.any([scope.signal, request.signal]);
		refreshing.value = true;
		try {
			const [items, sources] = await Promise.allSettled([api.readCatalog(signal), api.readRepositories(signal)]);
			signal.throwIfAborted();
			if (sources.status === 'fulfilled') repositories.value = sources.value;
			if (items.status === 'rejected') throw items.reason;
			catalog.value = sortMarketplacePlugins(items.value);
		} catch {
			if (!signal.aborted)
				log.report({ source: 'marketplace', code: 'MARKETPLACE_CATALOG_READ_FAILED', level: 'warn' });
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

	const updateTarget = computed<MarketplaceRepositorySource | undefined>(() => {
		const current = managed.value;
		if (!current || current.source.kind !== 'repository') return;
		const { repositoryId } = current.source;
		const next = catalog.value
			?.find(({ id }) => id === current.pluginId)
			?.versions.find(
				(item) =>
					item.repositoryId === repositoryId &&
					gt(item.package.version, current.version) &&
					(prerelease(current.version) || !prerelease(item.package.version)),
			);
		return next ? { ...current.source, version: next.package.version } : undefined;
	});

	async function preview(source: MarketplaceRepositorySource): Promise<void> {
		planRequest?.abort();
		const request = new AbortController();
		planRequest = request;
		const signal = AbortSignal.any([request.signal, scope.signal]);
		planning.value = true;
		try {
			const result = await api.previewInstall(source, signal);
			signal.throwIfAborted();
			if (minimized || (!detailOpen.value && !managedOpen.value && !managing.value)) return;
			plan.value = result;
			planOpen.value = true;
		} catch {
			if (!signal.aborted)
				log.report({
					source: 'marketplace',
					code: 'MARKETPLACE_INSTALL_PLAN_FAILED',
					level: 'error',
					userVisible: true,
				});
		} finally {
			if (!scope.signal.aborted && planRequest === request) planning.value = false;
		}
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
		if (submitting.value) return;
		submitting.value = true;
		try {
			await api.submit(command);
			if (scope.signal.aborted) return;
			planOpen.value = false;
			detailOpen.value = false;
			uninstallOpen.value = false;
			clearOpen.value = false;
			if (command.action !== 'set-enabled' && command.action !== 'reload') managedOpen.value = false;

			managing.value = true;
			query.value = '';
			void readManagement();
		} catch (cause) {
			reportFailure(cause);
		} finally {
			if (!scope.signal.aborted) submitting.value = false;
		}
	}

	async function prepareUninstall(item: MarketplacePlugin): Promise<void> {
		if (planning.value) return;
		const request = new AbortController();
		planRequest?.abort();
		planRequest = request;
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
			if (!scope.signal.aborted && planRequest === request) planning.value = false;
		}
	}

	watch(managedOpen, (open) => {
		if (!open) {
			planRequest?.abort();
			planOpen.value = false;
			uninstallOpen.value = false;
		}
	});

	function refresh(): void {
		void discover();
		if (managing.value) {
			emit('refresh');
			void readManagement();
			void api.readOperations().catch(() => undefined);
		}
	}

	function toggle(): void {
		managing.value = !managing.value;
		query.value = '';
		if (managing.value) refresh();
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
						:loading="managing ? loading : refreshing"
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
				:query="query"
				:loaded="!!catalog"
				@inspect="inspect"
			/>
			<template v-else>
				<UiSection :title="t('desktop.installed')">
					<UiEmptyState
						v-if="results?.length === 0 && !builtinResults.length"
						:icon="Package"
						:title="t(query ? 'logViewer.noMatches' : 'marketplaceTile.empty')"
					/>
					<div v-else class="marketplace-cards">
						<UiCard
							v-for="item in builtinResults"
							:key="item.key"
							:title="item.label"
							:icon="item.icon"
							:description="t('marketplace.builtin')"
							:action-label="t('marketplace.manageBuiltin', { name: item.label })"
							@select="
								managedBuiltinKey = item.key;
								builtinOpen = true;
							"
						>
							<template #badge>
								<UiBadge tone="success" role="status" dot>{{ t('marketplace.available') }}</UiBadge>
							</template>
							<template #actions>
								<UiButton
									density="compact"
									:aria-label="t('marketplace.openNamedApplication', { name: item.label })"
									@click="emit('openApplication', item.key)"
								>
									{{ t('marketplace.open') }}
								</UiButton>
							</template>
						</UiCard>
						<UiCard
							v-for="item in results"
							:key="item.pluginId"
							:title="item.pluginId"
							@select="inspectInstalled(item.pluginId)"
						>
							<template #aside>
								<UiBadge :tone="item.issue ? 'danger' : item.enabled ? 'success' : 'neutral'">
									{{
										t(
											item.issue
												? 'desktop.issue'
												: item.enabled
													? 'desktop.enabled'
													: 'desktop.disabled',
										)
									}}
								</UiBadge>
							</template>
							<template #footer>{{ item.version }}</template>
						</UiCard>
					</div>
				</UiSection>
				<MarketplaceRepositories
					:api="api"
					:repositories="repositories"
					:query="query"
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
				<UiSection
					v-if="operations.length"
					class="marketplace-management-section"
					:title="t('marketplace.operations')"
				>
					<UiList>
						<UiListItem
							v-for="operation in operations"
							:key="operation.id"
							:title="operation.change.pluginId"
							:description="t('marketplace.operation.' + operation.change.action)"
						>
							<template #actions>
								<UiBadge
									:tone="
										operation.state === 'failed'
											? 'danger'
											: operation.state === 'succeeded'
												? 'success'
												: 'neutral'
									"
								>
									{{ t('marketplace.operationState.' + operation.state) }}
								</UiBadge>
							</template>
							<template v-if="operation.error" #description>
								{{ t('marketplace.operation.' + operation.change.action) }}
								· {{ t('notices.' + operation.error) }}
								<span v-if="operation.committed"> · {{ t('marketplace.partialCommit') }}</span>
							</template>
							<template v-else-if="operation.step && operation.state === 'running'" #description>
								{{ t('marketplace.phase.' + operation.step.phase) }} · {{ operation.step.pluginId }}
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
			:installed="!!installed?.some(({ pluginId }) => pluginId === selectedId)"
			:installing="planning"
			@manage="manage"
			@install="preview"
		/>
		<UiDialog
			v-model:open="builtinOpen"
			:title="managedBuiltin?.label ?? ''"
			size="sm"
			:close-label="t('closeApplication')"
		>
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
			:close-label="t('closeApplication')"
		>
			<template v-if="managed">
				<h3>{{ managed.pluginId }}</h3>
				<p>{{ managed.version }}</p>
				<UiList>
					<UiListItem :title="t('marketplace.enablePlugin')">
						<template #actions>
							<UiSwitch
								:model-value="managed.enabled"
								:aria-label="t('marketplace.enablePlugin')"
								:disabled="submitting || activeIds.has(managed.pluginId)"
								@update:model-value="
									(enabled) =>
										managed &&
										submit({ action: 'set-enabled', pluginId: managed.pluginId, enabled })
								"
							/>
						</template>
					</UiListItem>
				</UiList>
				<UiList
					v-if="applications.some((entry) => entry.pluginId === managedId)"
					class="marketplace-management-section"
				>
					<UiListItem
						v-for="entry in applications.filter((item) => item.pluginId === managedId)"
						:key="entry.key"
						:title="entry.label"
						:description="t('marketplace.showOnHome')"
					>
						<template #actions>
							<UiSwitch
								:model-value="entry.visible"
								:aria-label="t('marketplace.showOnHome') + ' · ' + entry.label"
								@update:model-value="(value) => emit('showApplication', entry.key, value)"
							/>
						</template>
					</UiListItem>
				</UiList>
			</template>
			<template v-if="managed" #footer>
				<UiButton
					tone="danger"
					:disabled="planning || activeIds.has(managed.pluginId)"
					@click="prepareUninstall(managed)"
				>
					{{ t('marketplace.uninstall') }}
				</UiButton>
				<UiButton
					v-if="updateTarget"
					tone="primary"
					:loading="planning"
					:disabled="activeIds.has(managed.pluginId)"
					@click="preview(updateTarget)"
				>
					{{ t('marketplace.updateVersion', { version: updateTarget.version }) }}
				</UiButton>
				<UiButton
					v-if="managed.enabled"
					:disabled="submitting || activeIds.has(managed.pluginId)"
					@click="submit({ action: 'reload', pluginId: managed.pluginId })"
				>
					{{ t('marketplace.reload') }}
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
			<template v-if="uninstallPlan && !uninstallPlan.required" #footer>
				<UiButton
					tone="danger"
					:loading="submitting"
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
				<UiButton
					tone="danger"
					:loading="submitting"
					@click="submit({ action: 'clear-data', pluginId: clearTarget.pluginId })"
				>
					{{ t('marketplace.clearData') }}
				</UiButton>
			</template>
		</UiDialog>
		<UiDialog v-model:open="planOpen" :title="t('marketplace.previewInstall')" :close-label="t('closeApplication')">
			<template v-if="plan">
				<UiSection v-if="plan.blockers.length" :title="t('marketplace.blockers')">
					<UiList>
						<UiListItem
							v-for="(issue, index) in plan.blockers"
							:key="index"
							:title="issue.pluginId"
							:description="t('marketplace.blocker.' + issue.code)"
						/>
					</UiList>
				</UiSection>
				<UiSection v-if="plan.affected?.length" :title="t('marketplace.affected')">
					<UiList>
						<UiListItem v-for="id in plan.affected" :key="id" :title="id" />
					</UiList>
				</UiSection>
				<UiList v-if="plan.steps.length">
					<UiListItem
						v-for="step in plan.steps"
						:key="step.package.name"
						:title="step.package.name"
						:description="
							step.repository
								? step.package.version + ' · ' + step.repository.label
								: step.package.version
						"
					>
						<template #actions
							><UiBadge tone="neutral">{{
								t('marketplace.planAction.' + step.action)
							}}</UiBadge></template
						>
					</UiListItem>
				</UiList>
			</template>
			<template v-if="plan && plan.steps.length && !plan.blockers.length" #footer>
				<UiButton
					tone="primary"
					:loading="submitting"
					:disabled="activeIds.has(plan.target.pluginId)"
					@click="submit({ action: 'install', plan })"
				>
					{{
						t(
							plan.steps.some((step) => step.action === 'update')
								? 'marketplace.confirmUpdate'
								: 'marketplace.confirmInstall',
						)
					}}
				</UiButton>
			</template>
		</UiDialog>
	</div>
</template>
<style scoped>
	.marketplace-app {
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
	.marketplace-management-section {
		margin-top: 28px;
	}
	.marketplace-uninstall-data {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.marketplace-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
		gap: 14px;
	}
</style>
