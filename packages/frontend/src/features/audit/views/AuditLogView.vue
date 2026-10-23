<script setup lang="ts">
	import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
	import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
	import {
		UiBadge,
		UiButton,
		UiEmptyState,
		UiInfoHint,
		UiInlineNotice,
		UiLoadingState,
		UiSearchInput,
		UiSelect,
		UiSpinner,
	} from '@/foundation/ui';
	import { OPERATION_EVENTS } from '@nexus-terminal/shared/operations/values';
	import type { AuditQuery } from '../model/audit-types';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { notificationFailureKey } from '@/features/notifications/public';
	import { useAuditStore } from '../store/audit.store';
	import AuditDeliveryRow from './AuditDeliveryRow.vue';
	import AuditLogRow from './AuditLogRow.vue';

	type AuditView = 'logs' | 'deliveries';
	type TimeRange = 'all' | '24h' | '7d' | '30d';

	const TIME_RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
		'24h': 24 * 60 * 60 * 1000,
		'7d': 7 * 24 * 60 * 60 * 1000,
		'30d': 30 * 24 * 60 * 60 * 1000,
	};

	const { t, te } = useI18n();
	const store = useAuditStore();
	const { logs, loading, error, hasMore, deliveries, deliveriesLoading, deliveriesError, deliveriesHasMore } =
		storeToRefs(store);
	const activeView = ref<AuditView>('logs');
	const searchDraft = ref('');
	const actionTypeDraft = ref('');
	const timeRangeDraft = ref<TimeRange>('all');

	const actionLabel = (action: string) =>
		te(`auditLog.actions.${action}`) ? t(`auditLog.actions.${action}`) : t('auditLog.unknownAction');

	const options = computed(() => [
		{ value: '', label: t('auditLog.allActions') },
		...OPERATION_EVENTS.map((value) => ({ value, label: actionLabel(value) })),
	]);
	const timeRangeOptions = computed(() => [
		{ value: 'all', label: t('auditLog.filters.allTime') },
		{ value: '24h', label: t('auditLog.filters.last24Hours') },
		{ value: '7d', label: t('auditLog.filters.last7Days') },
		{ value: '30d', label: t('auditLog.filters.last30Days') },
	]);

	const view = useAuthenticatedViewScope();

	const unknownDeliveryCount = computed(
		() => deliveries.value.filter((delivery) => delivery.status === 'unknown').length,
	);
	const deliveryErrorMessage = computed(() =>
		deliveriesError.value ? t(notificationFailureKey(deliveriesError.value)) : '',
	);
	const hasFilters = computed(
		() => searchDraft.value.trim() !== '' || actionTypeDraft.value !== '' || timeRangeDraft.value !== 'all',
	);
	const loadedLabel = computed(() =>
		activeView.value === 'logs'
			? t('auditLog.loadedOnly', { loaded: logs.value.length })
			: t('auditLog.deliveries.loadedOnly', { loaded: deliveries.value.length }),
	);

	const currentQuery = (): AuditQuery => {
		const duration = timeRangeDraft.value === 'all' ? null : TIME_RANGE_MS[timeRangeDraft.value];
		const now = Date.now();
		return {
			q: searchDraft.value.trim(),
			event: OPERATION_EVENTS.find((event) => event === actionTypeDraft.value) ?? null,
			from: duration === null ? null : now - duration,
			to: duration === null ? null : now,
			limit: 40,
		};
	};

	const load = () => store.load(currentQuery(), view.capture());

	const loadMore = () => store.loadMore(view.capture());

	const loadDeliveries = (append = false) =>
		append ? store.loadMoreDeliveries(view.capture()) : store.loadDeliveries(view.capture());

	const selectView = (next: AuditView) => {
		if (activeView.value === next) return;
		activeView.value = next;
		if (next === 'deliveries') void loadDeliveries();
	};

	const applyFilters = () => {
		void load();
	};

	const resetFilters = () => {
		if (!hasFilters.value) return;
		searchDraft.value = '';
		actionTypeDraft.value = '';
		timeRangeDraft.value = 'all';
	};

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	watch([searchDraft, actionTypeDraft, timeRangeDraft], (next, previous) => {
		clearTimeout(searchTimer);
		const signal = view.capture();
		const filterChanged = !previous || next[1] !== previous[1] || next[2] !== previous[2];
		if (filterChanged) {
			applyFilters();
			return;
		}
		searchTimer = setTimeout(() => {
			if (view.isCurrent(signal)) applyFilters();
		}, 300);
	});
	onBeforeUnmount(() => {
		clearTimeout(searchTimer);
	});

	const onScroll = (event: Event) => {
		const element = event.target as HTMLElement;
		if (element.scrollHeight - element.scrollTop - element.clientHeight < 320 && !error.value) {
			void loadMore();
		}
	};

	const onDeliveryScroll = (event: Event) => {
		const element = event.target as HTMLElement;
		if (element.scrollHeight - element.scrollTop - element.clientHeight < 320 && !deliveriesError.value) {
			void loadDeliveries(true);
		}
	};

	onMounted(() => void load());
	let initialActivation = true;
	onActivated(() => {
		if (initialActivation) {
			initialActivation = false;
			return;
		}
		if (activeView.value === 'logs') void load();
		else void loadDeliveries();
	});
</script>

<template>
	<main class="audit-page ui-catalog-page">
		<div class="audit-shell">
			<h1 class="ui-catalog-title audit-title">{{ t('auditLog.title') }}</h1>

			<div class="audit-header-actions">
				<div class="audit-tabs" role="tablist" :aria-label="t('auditLog.title')">
					<button
						id="audit-tab-logs"
						type="button"
						role="tab"
						class="audit-tab"
						:class="{ 'audit-tab--active': activeView === 'logs' }"
						:aria-selected="activeView === 'logs'"
						aria-controls="audit-panel-logs"
						@click="selectView('logs')"
					>
						<i class="fa-solid fa-list-ul" aria-hidden="true"></i>
						<span>{{ t('auditLog.tabs.logs') }}</span>
					</button>
					<button
						id="audit-tab-deliveries"
						type="button"
						role="tab"
						class="audit-tab"
						:class="{ 'audit-tab--active': activeView === 'deliveries' }"
						:aria-selected="activeView === 'deliveries'"
						aria-controls="audit-panel-deliveries"
						@click="selectView('deliveries')"
					>
						<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
						<span>{{ t('auditLog.tabs.deliveries') }}</span>
						<UiBadge v-if="unknownDeliveryCount" tone="danger" density="compact">{{
							unknownDeliveryCount
						}}</UiBadge>
					</button>
				</div>
			</div>

			<section class="audit-panel" aria-labelledby="audit-panel-title">
				<header class="audit-panel__head">
					<div class="audit-panel__title">
						<span class="audit-panel__mark" aria-hidden="true">
							<i :class="activeView === 'logs' ? 'fa-solid fa-list-ul' : 'fa-solid fa-paper-plane'"></i>
						</span>
						<h2 id="audit-panel-title">
							{{ activeView === 'logs' ? t('auditLog.activity') : t('auditLog.deliveries.title') }}
						</h2>
						<UiInfoHint
							v-if="activeView === 'deliveries'"
							:text="t('auditLog.deliveries.hint')"
							:label="t('auditLog.deliveries.title')"
						/>
					</div>
					<span class="audit-loaded" role="status">{{ loadedLabel }}</span>
				</header>

				<template v-if="activeView === 'logs'">
					<div id="audit-panel-logs" role="tabpanel" aria-labelledby="audit-tab-logs">
						<div class="audit-filters">
							<UiSearchInput
								v-model="searchDraft"
								class="audit-filters__search"
								density="comfortable"
								:aria-label="t('common.search')"
								:placeholder="t('auditLog.searchPlaceholder')"
								:clear-label="t('common.clear')"
							/>
							<div class="audit-filters__tail">
								<div class="audit-filters__selects">
									<UiSelect
										v-model="actionTypeDraft"
										class="audit-filters__event"
										:options="options"
										density="comfortable"
										:aria-label="t('auditLog.table.actionType')"
										text-align="center"
									/>
									<UiSelect
										v-model="timeRangeDraft"
										class="audit-filters__time"
										:options="timeRangeOptions"
										density="comfortable"
										:aria-label="t('auditLog.filters.timeRange')"
										text-align="center"
									/>
								</div>
								<UiButton
									v-if="hasFilters"
									type="button"
									appearance="ghost"
									icon-only
									density="comfortable"
									:aria-label="t('auditLog.filters.clear')"
									:title="t('auditLog.filters.clear')"
									@click="resetFilters"
								>
									<i class="fa-solid fa-filter-circle-xmark" aria-hidden="true"></i>
								</UiButton>
							</div>
						</div>

						<UiInlineNotice v-if="error" class="audit-alert" tone="danger" compact>
							{{ t('auditLog.loadFailed') }}
							<template #actions>
								<UiButton
									appearance="soft"
									density="compact"
									@click="logs.length ? loadMore() : load()"
									>{{ t('auditLog.retry') }}</UiButton
								>
							</template>
						</UiInlineNotice>

						<DynamicScroller
							v-if="logs.length"
							class="audit-scroller"
							:items="logs"
							:min-item-size="92"
							:buffer="360"
							key-field="id"
							:aria-label="t('auditLog.title')"
							tabindex="0"
							@scroll.passive="onScroll"
						>
							<template #default="{ item, active }">
								<DynamicScrollerItem :item="item" :active="active" :emit-resize="true">
									<AuditLogRow :log="item" />
								</DynamicScrollerItem>
							</template>
						</DynamicScroller>
						<UiLoadingState
							v-else-if="loading && !error"
							class="audit-empty"
							:bordered="false"
							:title="t('common.loading')"
						/>
						<UiEmptyState
							v-else-if="!error"
							class="audit-empty"
							:bordered="false"
							icon="fa-solid fa-clock-rotate-left"
							:title="t('auditLog.noLogs')"
							:description="t('auditLog.emptyHint')"
						>
							<template v-if="hasFilters" #action>
								<UiButton appearance="soft" density="compact" @click="resetFilters">{{
									t('auditLog.filters.clear')
								}}</UiButton>
							</template>
						</UiEmptyState>
						<footer v-if="logs.length" class="audit-footer">
							<span class="audit-footer__state" role="status">
								<UiSpinner v-if="loading" />
								{{
									loading
										? t('auditLog.loadingMore')
										: hasMore
											? t('auditLog.scrollMore')
											: t('auditLog.endOfList')
								}}
							</span>
							<UiButton
								v-if="hasMore && !loading && !error"
								density="compact"
								appearance="ghost"
								@click="loadMore()"
								>{{ t('auditLog.loadMore') }}</UiButton
							>
						</footer>
					</div>
				</template>

				<template v-else>
					<div id="audit-panel-deliveries" role="tabpanel" aria-labelledby="audit-tab-deliveries">
						<UiInlineNotice v-if="deliveriesError" class="audit-alert" tone="danger" compact>
							{{ deliveryErrorMessage }}
							<template #actions>
								<UiButton appearance="soft" density="compact" @click="loadDeliveries()">{{
									t('auditLog.retry')
								}}</UiButton>
							</template>
						</UiInlineNotice>

						<UiInlineNotice
							v-if="unknownDeliveryCount"
							class="audit-unknown-note"
							tone="warning"
							icon="fa-solid fa-circle-question"
							compact
						>
							{{ t('auditLog.deliveries.unknownCount', { count: unknownDeliveryCount }) }}
						</UiInlineNotice>

						<div
							v-if="deliveries.length"
							class="audit-scroller audit-delivery-scroller"
							tabindex="0"
							:aria-label="t('auditLog.deliveries.title')"
							@scroll.passive="onDeliveryScroll"
						>
							<AuditDeliveryRow v-for="delivery in deliveries" :key="delivery.id" :delivery="delivery" />
						</div>
						<UiLoadingState
							v-else-if="deliveriesLoading && !deliveriesError"
							class="audit-empty"
							:bordered="false"
							:title="t('common.loading')"
						/>
						<UiEmptyState
							v-else-if="!deliveriesError"
							class="audit-empty"
							:bordered="false"
							icon="fa-regular fa-paper-plane"
							:title="t('auditLog.deliveries.empty')"
						/>
						<footer v-if="deliveries.length" class="audit-footer">
							<span class="audit-footer__state" role="status">
								<UiSpinner v-if="deliveriesLoading" />
								{{
									deliveriesLoading
										? t('auditLog.loadingMore')
										: deliveriesHasMore
											? t('auditLog.scrollMore')
											: t('auditLog.endOfList')
								}}
							</span>
							<UiButton
								v-if="deliveriesHasMore && !deliveriesLoading && !deliveriesError"
								density="compact"
								appearance="ghost"
								@click="loadDeliveries(true)"
								>{{ t('auditLog.loadMore') }}</UiButton
							>
						</footer>
					</div>
				</template>
			</section>
		</div>
	</main>
</template>

<style scoped>
	.audit-shell {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: 16px;
		row-gap: 14px;
		width: 100%;
		max-width: 1680px;
		margin: 0 auto;
	}

	.audit-title {
		grid-column: 1;
		grid-row: 1;
	}

	.audit-header-actions {
		grid-column: 2;
		grid-row: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}

	.audit-tabs {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--ui-hairline);
		border-radius: 11px;
		background: color-mix(in srgb, var(--text-color) 3%, transparent);
	}

	.audit-tab {
		display: inline-flex;
		min-width: 0;
		height: 31px;
		align-items: center;
		justify-content: center;
		gap: 7px;
		padding: 0 11px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text-color-secondary);
		font-size: 11px;
		font-weight: 620;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.audit-tab i {
		font-size: 9px;
	}

	.audit-tab:hover {
		color: var(--text-color);
	}

	.audit-tab--active {
		background: color-mix(in srgb, var(--card-bg-color) 82%, var(--app-bg-color));
		color: var(--text-color);
		box-shadow: 0 1px 5px -4px color-mix(in srgb, var(--text-color) 36%, transparent);
	}

	.audit-panel {
		grid-column: 1 / -1;
		min-width: 0;
	}

	.audit-panel__head {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 2px 2px 12px;
	}

	.audit-panel__title {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 9px;
	}

	.audit-panel__mark {
		display: grid;
		width: 28px;
		height: 28px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: var(--link-active-color);
		font-size: 10px;
	}

	.audit-panel__title h2 {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 7px;
		margin: 0;
		font-size: 13px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.audit-loaded {
		flex: 0 0 auto;
		color: var(--ui-text-muted);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.audit-filters {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		padding: 0 2px 12px;
	}

	.audit-filters > * {
		min-width: 0;
	}

	.audit-filters__tail {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.audit-filters__selects {
		display: grid;
		grid-template-columns: minmax(170px, 218px) 138px;
		gap: 0;
	}

	.audit-filters__selects > * {
		width: 100%;
	}

	.audit-filters__selects > *:first-child :deep(.ui-select__trigger) {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
	}

	.audit-filters__selects > * + * :deep(.ui-select__trigger) {
		border-left-width: 0;
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
	}

	.audit-filters__time {
		width: 100%;
	}

	.audit-alert,
	.audit-unknown-note {
		margin-bottom: 10px;
	}

	.audit-scroller {
		height: min(660px, calc(100dvh - 238px));
		min-height: 240px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		padding: 0 8px 2px 0;
	}

	.audit-delivery-scroller {
		height: min(660px, calc(100dvh - 205px));
	}

	.audit-empty {
		min-height: 320px;
		padding-inline: 20px;
	}

	.audit-footer {
		display: flex;
		min-height: 42px;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
		padding: 9px 2px 0;
		color: var(--ui-text-muted);
		font-size: 10px;
	}

	.audit-footer__state {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 7px;
	}

	@media (max-width: 900px) {
		.audit-filters {
			grid-template-columns: minmax(0, 1fr);
		}

		.audit-filters__search {
			grid-column: 1;
		}

		.audit-filters__tail {
			grid-column: 1;
			justify-content: flex-end;
		}
	}

	@media (max-width: 760px) {
		.audit-shell {
			grid-template-columns: minmax(0, 1fr);
		}

		.audit-header-actions {
			grid-column: 1;
			grid-row: 2;
			justify-content: space-between;
		}

		.audit-panel {
			grid-row: 3;
		}

		.audit-tabs {
			flex: 1;
		}

		.audit-tab {
			flex: 1;
		}

		.audit-panel__head {
			align-items: flex-start;
			flex-wrap: wrap;
			gap: 7px;
		}

		.audit-loaded {
			margin-left: 37px;
		}

		.audit-filters__time {
			width: 100%;
		}

		.audit-filters__tail {
			justify-content: stretch;
		}

		.audit-filters__selects {
			min-width: 0;
			flex: 1;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.audit-scroller,
		.audit-delivery-scroller {
			height: min(620px, calc(100dvh - 240px));
		}
	}

	@media (max-width: 430px) {
		.audit-tab {
			padding-inline: 8px;
		}

		.audit-tab i {
			display: none;
		}

		.audit-loaded {
			margin-left: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.audit-tab {
			transition: none;
		}
	}
</style>
