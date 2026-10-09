<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller';
	import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
	import { UiButton, UiSelect, UiSpinner } from '@/foundation/ui';
	import UiListToolbar from '@/foundation/ui/UiListToolbar.vue';
	import { auditActionTypes, type AuditLogQueryDto } from '../model/audit';
	import { useAuditStore } from '../store/audit.store';
	import AuditLogRow from './AuditLogRow.vue';

	const { t, te } = useI18n();
	const store = useAuditStore();
	const { logs, total, loading, error, hasMore } = storeToRefs(store);
	const searchDraft = ref('');
	const actionTypeDraft = ref('');
	const appliedFilters = ref<Pick<AuditLogQueryDto, 'search' | 'actionType'>>({});

	const actionLabel = (action: string) =>
		te(`auditLog.actions.${action}`) ? t(`auditLog.actions.${action}`) : t('auditLog.unknownAction');

	const options = computed(() => [
		{ value: '', label: t('auditLog.allActions') },
		...auditActionTypes.map((value) => ({ value, label: actionLabel(value) })),
	]);

	const load = () => store.load({ ...appliedFilters.value, limit: 40 });

	const applyFilters = () => {
		appliedFilters.value = {
			...(searchDraft.value.trim() ? { search: searchDraft.value.trim() } : {}),
			...(actionTypeDraft.value ? { actionType: actionTypeDraft.value } : {}),
		};
		void load();
	};

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	watch(searchDraft, () => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(applyFilters, 300);
	});
	watch(actionTypeDraft, () => {
		clearTimeout(searchTimer);
		applyFilters();
	});
	onBeforeUnmount(() => {
		clearTimeout(searchTimer);
	});

	const onScroll = (event: Event) => {
		const element = event.target as HTMLElement;
		if (element.scrollHeight - element.scrollTop - element.clientHeight < 320 && !error.value)
			void store.loadMore();
	};

	onMounted(() => void load());
</script>

<template>
	<div class="audit-page bg-background p-4 text-foreground">
		<section class="audit-shell mx-auto max-w-7xl">
			<header class="audit-heading">
				<div class="flex min-w-0 items-center gap-3">
					<span class="audit-mark" aria-hidden="true"><i class="fa-solid fa-shield-halved"></i></span>
					<div class="min-w-0">
						<h1 class="text-xl font-semibold">{{ t('auditLog.title') }}</h1>
						<p class="mt-1 text-xs text-text-secondary">{{ t('auditLog.subtitle') }}</p>
					</div>
				</div>
				<UiButton appearance="soft" :disabled="loading" @click="load"
					><i class="fa-solid fa-rotate-right" aria-hidden="true"></i
					><span>{{ t('auditLog.refresh') }}</span></UiButton
				>
			</header>
			<UiListToolbar
				v-model="searchDraft"
				:search-label="t('common.search')"
				:placeholder="t('auditLog.searchPlaceholder')"
			>
				<UiSelect
					v-model="actionTypeDraft"
					:options="options"
					:aria-label="t('auditLog.table.actionType')"
					fit-longest-option
					text-align="center"
				/>
			</UiListToolbar>
			<div class="audit-list-heading">
				<span>{{ t('auditLog.activity') }}</span
				><span class="text-xs font-normal text-text-secondary" role="status">{{
					t('auditLog.loadedInfo', { loaded: logs.length, total })
				}}</span>
			</div>
			<div
				v-if="error"
				role="alert"
				class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-error"
			>
				<span>{{ error === 'audit-load-error' ? t('auditLog.loadFailed') : error }}</span
				><UiButton appearance="soft" @click="logs.length ? store.loadMore() : load()">{{
					t('auditLog.retry')
				}}</UiButton>
			</div>
			<div v-if="logs.length" class="audit-column-heading" aria-hidden="true">
				<span>{{ t('auditLog.table.timestamp') }}</span>
				<span>{{ t('auditLog.table.actionType') }}</span>
				<span>{{ t('auditLog.table.details') }}</span>
			</div>
			<DynamicScroller
				v-if="logs.length"
				class="audit-scroller"
				:items="logs"
				:min-item-size="140"
				:buffer="280"
				key-field="id"
				:aria-label="t('auditLog.title')"
				tabindex="0"
				@scroll.passive="onScroll"
			>
				<template #default="{ item, active }">
					<DynamicScrollerItem
						:item="item"
						:active="active"
						:size-dependencies="[item.details]"
						:emit-resize="true"
					>
						<div class="audit-row-spacing"><AuditLogRow :log="item" /></div>
					</DynamicScrollerItem>
				</template>
			</DynamicScroller>
			<div v-else class="audit-empty">
				<UiSpinner v-if="loading" /><template v-else-if="!error"
					><i class="fa-regular fa-folder-open text-2xl" aria-hidden="true"></i>
					<p class="mt-3 font-medium">{{ t('auditLog.noLogs') }}</p>
					<p class="mt-1 text-xs text-text-secondary">{{ t('auditLog.emptyHint') }}</p></template
				>
			</div>
			<footer v-if="logs.length" class="audit-footer">
				<UiSpinner v-if="loading" /><span>{{
					loading ? t('auditLog.loadingMore') : hasMore ? t('auditLog.scrollMore') : t('auditLog.endOfList')
				}}</span
				><UiButton
					v-if="hasMore && !loading && !error"
					density="compact"
					appearance="ghost"
					@click="store.loadMore()"
					>{{ t('auditLog.loadMore') }}</UiButton
				>
			</footer>
		</section>
	</div>
</template>

<style scoped>
	.audit-shell {
		border: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
		border-radius: 16px;
		overflow: hidden;
		background: color-mix(in srgb, var(--card-bg-color) 82%, var(--app-bg-color));
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 8%),
			0 5px 14px -12px color-mix(in srgb, var(--text-color) 32%, transparent);
	}
	.audit-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 20px;
	}
	.audit-mark {
		display: grid;
		place-items: center;
		flex: none;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}
	.audit-list-heading {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		border-block: 1px solid var(--ui-hairline);
		font-size: 12px;
		font-weight: 600;
	}
	.audit-scroller {
		height: min(640px, 65dvh);
		min-height: 224px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.audit-row-spacing {
		padding: 4px 8px;
	}
	.audit-column-heading {
		display: grid;
		grid-template-columns: 220px 220px minmax(0, 1fr);
		gap: 20px;
		padding: 12px 29px;
		border-bottom: 1px solid var(--border-color);
		background: var(--ui-fill-inset);
		color: var(--ui-text-muted);
		font-size: 12px;
	}
	.audit-empty {
		min-height: 260px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}
	.audit-footer {
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px;
		border-top: 1px solid var(--ui-hairline);
		font-size: 11px;
		color: var(--ui-text-muted);
	}
	@media (max-width: 640px) {
		.audit-heading {
			padding: 14px 12px;
			align-items: flex-start;
		}
		.audit-list-heading {
			padding-inline: 12px;
		}
	}
	.audit-column-heading > :nth-child(-n + 2) {
		text-align: center;
	}
	@media (max-width: 800px) {
		.audit-column-heading {
			display: none;
		}
	}
</style>
