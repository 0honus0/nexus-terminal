<script setup lang="ts">
	import { isNetworkFailure } from '@/client/http/network-failure';
	import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import { storeToRefs } from 'pinia';
	import { useI18n } from 'vue-i18n';
	import {
		UiButton,
		UiContextMenu,
		UiContextMenuItem,
		UiEmptyState,
		UiLoadingState,
		UiSearchInput,
	} from '@/foundation/ui';
	import {
		booleanStorageCodec,
		numberStorageCodec,
		readStoredValue,
		writeClipboardText,
		writeStoredValue,
	} from '@/foundation/browser';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { useFeedback, preferenceFailureMessage } from '@/shared/feedback/public';
	import { focusRegistry } from '@/shared/focus/public';
	import { useWheelScale } from '@/foundation/interaction';
	import { useCommandHistoryStore } from '../store/commandHistory.store';
	import type { CommandHistoryItem, ExecuteHistoryIntent } from '../model/command-history-types';

	const compactStorage = {
		namespace: 'command-history.compact',
		version: 1,
		codec: booleanStorageCodec,
	} as const;
	const rowScaleStorage = {
		namespace: 'command-history.row-scale',
		version: 1,
		codec: numberStorageCodec((value) => value >= 0.5 && value <= 2.5),
	} as const;

	const props = withDefaults(
		defineProps<{
			collapsibleSearch?: boolean;
			compact?: boolean;
			rowScale?: number;
		}>(),
		{ collapsibleSearch: false, compact: false, rowScale: 1 },
	);

	const emit = defineEmits<{
		execute: [intent: ExecuteHistoryIntent];
		rowScale: [scale: number];
		compactMode: [compact: boolean];
	}>();

	const { t } = useI18n();
	const feedback = useFeedback();
	const store = useCommandHistoryStore();
	const { search, loading, error, filtered, selectedIndex } = storeToRefs(store);

	const searchInput = ref<{ focus?: (options?: FocusOptions) => void } | null>(null);
	const root = ref<HTMLElement | null>(null);
	const list = ref<HTMLElement | null>(null);
	const scaleArea = ref<HTMLElement | null>(null);
	const context = ref<{ entry: CommandHistoryItem; x: number; y: number } | null>(null);
	const searchExpanded = ref(!props.collapsibleSearch || Boolean(search.value));
	let unregisterFocus: (() => void) | undefined;
	const view = useAuthenticatedViewScope({
		onRevoke: () => {
			context.value = null;
		},
	});

	const readCompactMode = (): boolean => (props.compact ? true : (readStoredValue(compactStorage) ?? false));

	const isCompact = ref(readCompactMode());
	watch(
		() => props.compact,
		(val) => {
			if (typeof val === 'boolean') {
				isCompact.value = val;
			}
		},
	);

	const toggleCompact = () => {
		isCompact.value = !isCompact.value;
		writeStoredValue(compactStorage, isCompact.value);
		emit('compactMode', isCompact.value);
	};

	const readRowScale = (): number => {
		if (Number.isFinite(props.rowScale) && props.rowScale !== 1) {
			return props.rowScale!;
		}
		return readStoredValue(rowScaleStorage) ?? 1;
	};

	const localScale = ref(readRowScale());
	useWheelScale({
		target: () => scaleArea.value,

		value: () => props.rowScale,

		scale: localScale,

		onChange: (scale) => {
			writeStoredValue(rowScaleStorage, scale);
			emit('rowScale', scale);
		},

		min: 0.5,
		max: 2.5,
		step: 0.12,
		precision: 2,
		thresholdPx: 64,
		maxStepsPerEvent: 3,
	});
	const rowStyle = computed(() => ({ '--history-row-scale': localScale.value }));

	watch(
		() => props.collapsibleSearch,
		(enabled) => {
			searchExpanded.value = !enabled || Boolean(search.value);
		},
	);

	const openSearch = async (): Promise<boolean> => {
		searchExpanded.value = true;
		await nextTick();
		searchInput.value?.focus?.();
		return true;
	};

	watch(error, (cause) => {
		if (!cause || isNetworkFailure(cause)) return;
		feedback.notifyError(preferenceFailureMessage(cause, t), 0, {
			key: 'command-history',
			label: t('common.refresh'),

			disabled: () => loading.value,

			onClick: () => {
				void store.load(true).catch(() => undefined);
			},
		});
	});

	onMounted(() => {
		void store.load().catch(() => undefined);
		unregisterFocus = focusRegistry.register('commandHistorySearch', openSearch, () =>
			Boolean(root.value?.getClientRects().length),
		);
	});
	onBeforeUnmount(() => unregisterFocus?.());

	const clear = async () => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		if (!(await feedback.confirm({ message: t('commandHistory.confirmClear'), destructive: true, signal }))) {
			return;
		}
		try {
			if (!view.isCurrent(signal)) {
				return;
			}
			await store.clear(signal);
		} catch (cause) {
			if (isNetworkFailure(cause) || cause === error.value) return;
			if (!view.isCurrent(signal)) {
				return;
			}
			feedback.notifyError(t('commandHistory.clearFailed', { error: preferenceFailureMessage(cause, t) }));
		}
	};

	const remove = async (id: number) => {
		const signal = view.capture();
		if (!view.isCurrent(signal)) {
			return;
		}
		context.value = null;
		try {
			await store.remove(id, signal);
		} catch (cause) {
			if (isNetworkFailure(cause) || cause === error.value) return;
			if (!view.isCurrent(signal)) {
				return;
			}
			feedback.notifyError(t('commandHistory.deleteFailed', { error: preferenceFailureMessage(cause, t) }));
		}
	};

	const copy = async (command: string) => {
		context.value = null;
		try {
			await writeClipboardText(command);
			feedback.notifySuccess(t('commandHistory.copied'));
		} catch {
			feedback.notifyError(t('commandHistory.copyFailed'));
		}
	};

	const execute = (entry: CommandHistoryItem, allSessions = false) => {
		context.value = null;
		emit('execute', { command: entry.command, allSessions: allSessions || undefined });
	};

	const openContext = (event: MouseEvent, entry: CommandHistoryItem) => {
		const idx = filtered.value.findIndex((e) => e.id === entry.id);
		if (idx !== -1) {
			selectedIndex.value = idx;
		}
		context.value = { entry, x: event.clientX, y: event.clientY };
	};

	const revealSelected = () => {
		const entry = filtered.value[selectedIndex.value];
		if (!entry) {
			return;
		}
		root.value?.querySelector<HTMLElement>(`[data-history-id="${entry.id}"]`)?.scrollIntoView({ block: 'nearest' });
	};

	const handleSearchKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			if (search.value) {
				event.preventDefault();
				search.value = '';
				store.resetSelection();
				return;
			}
			if (props.collapsibleSearch) {
				event.preventDefault();
				searchExpanded.value = false;
				store.resetSelection();
				return;
			}
		}
		if (!filtered.value.length) {
			return;
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			store.selectNext();
			revealSelected();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			store.selectPrevious();
			revealSelected();
			return;
		}
		if (event.key === 'Enter') {
			const entry = filtered.value[selectedIndex.value] ?? filtered.value[0];
			if (!entry) {
				return;
			}
			event.preventDefault();
			execute(entry);
		}
	};

	const handleSearchBlur = () => {
		window.setTimeout(() => {
			if (document.activeElement !== searchInput.value && !list.value?.contains(document.activeElement)) {
				store.resetSelection();
				if (props.collapsibleSearch && !search.value) {
					searchExpanded.value = false;
				}
			}
		}, 0);
	};

	const formatTime = (ts: number): string => {
		if (!ts) {
			return '';
		}
		const date = new Date(ts > 1e11 ? ts : ts * 1000);
		const now = new Date();
		const isToday =
			date.getFullYear() === now.getFullYear() &&
			date.getMonth() === now.getMonth() &&
			date.getDate() === now.getDate();
		if (isToday) {
			return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
		}
		return `${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
	};

	const formatFullDate = (ts: number): string => {
		if (!ts) {
			return '';
		}
		const date = new Date(ts > 1e11 ? ts : ts * 1000);
		return date.toLocaleString();
	};
</script>

<template>
	<section ref="root" class="command-history-root flex min-h-0 flex-1 flex-col overflow-hidden">
		<div class="command-history-controls flex shrink-0 items-center gap-2">
			<UiButton
				v-if="collapsibleSearch && !searchExpanded"
				appearance="ghost"
				density="compact"
				icon-only
				class="history-control"
				:title="t('commandHistory.expandSearch')"
				:aria-label="t('commandHistory.expandSearch')"
				@click="openSearch"
			>
				<i class="fas fa-search" aria-hidden="true"></i>
			</UiButton>
			<UiSearchInput
				v-if="searchExpanded"
				ref="searchInput"
				v-model="search"
				data-focus-id="commandHistorySearch"
				class="command-history-search min-w-0 flex-1 text-sm text-foreground"
				density="compact"
				:placeholder="t('commandHistory.searchPlaceholder')"
				:aria-label="t('commandHistory.searchPlaceholder')"
				:clear-label="t('common.clear')"
				@keydown="handleSearchKeydown"
				@blur="handleSearchBlur"
			/>
			<UiButton
				appearance="ghost"
				density="compact"
				icon-only
				class="history-control"
				:class="{ 'history-control--active': isCompact }"
				:title="t('commandHistory.compactMode')"
				:aria-label="t('commandHistory.compactMode')"
				@click="toggleCompact"
			>
				<i :class="['fas', isCompact ? 'fa-compress-alt' : 'fa-expand-alt']" aria-hidden="true"></i>
			</UiButton>
			<UiButton
				appearance="ghost"
				tone="danger"
				density="compact"
				icon-only
				class="history-control history-control--danger"
				:title="t('commandHistory.clear')"
				:aria-label="t('commandHistory.clear')"
				@click="clear"
			>
				<i class="fas fa-trash-alt" aria-hidden="true"></i>
			</UiButton>
		</div>

		<div
			ref="scaleArea"
			class="command-history-list-area min-h-0 flex-1 overflow-y-auto"
			:style="rowStyle"
			:data-row-scale="localScale.toFixed(2)"
		>
			<UiLoadingState
				v-if="loading && !filtered.length"
				class="command-history-empty"
				compact
				:bordered="false"
				:title="t('commandHistory.loading')"
			/>
			<UiEmptyState
				v-else-if="!filtered.length"
				class="command-history-empty"
				dense
				:icon="search ? 'fas fa-search' : 'fas fa-clock-rotate-left'"
				:title="search ? t('commandHistory.noMatches') : t('commandHistory.empty')"
				:bordered="false"
			/>
			<div v-else class="command-history-list">
				<ul ref="list" class="m-0 list-none">
					<li
						v-for="(entry, index) in filtered"
						:key="entry.id"
						:data-history-id="entry.id"
						class="command-history-row group flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-primary/10 active:bg-primary/15"
						:class="[
							isCompact ? 'command-history-row--compact' : '',
							selectedIndex === index ? 'bg-primary/20 font-medium' : '',
						]"
						:title="entry.command"
						@click="execute(entry)"
						@contextmenu.prevent="openContext($event, entry)"
					>
						<div class="flex items-center gap-2 min-w-0 flex-1">
							<i
								class="fas fa-terminal text-[10px] text-text-secondary/50 group-hover:text-primary transition-colors shrink-0"
								aria-hidden="true"
							></i>
							<button
								type="button"
								class="command-history-command min-w-0 flex-1 truncate text-left font-mono text-xs text-foreground group-hover:text-foreground cursor-pointer transition-colors"
								@click.stop="execute(entry)"
							>
								{{ entry.command }}
							</button>
						</div>
						<span
							v-if="entry.timestamp"
							class="command-history-timestamp shrink-0 ml-auto pl-2 text-[11px] font-mono text-text-secondary/50 transition-colors group-hover:text-text-secondary/80 select-none text-right"
							:title="formatFullDate(entry.timestamp)"
						>
							{{ formatTime(entry.timestamp) }}
						</span>
					</li>
				</ul>
			</div>
		</div>

		<UiContextMenu
			v-if="context"
			:visible="true"
			:x="context.x"
			:y="context.y"
			:width="200"
			@close="context = null"
		>
			<UiContextMenuItem @click="execute(context.entry)">
				<i class="fas fa-play" aria-hidden="true"></i>
				<span>{{ t('commandHistory.execute') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem @click="copy(context.entry.command)">
				<i class="fas fa-copy" aria-hidden="true"></i>
				<span>{{ t('commandHistory.copy') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem tone="danger" @click="remove(context.entry.id)">
				<i class="fas fa-trash-alt" aria-hidden="true"></i>
				<span>{{ t('commandHistory.delete') }}</span>
			</UiContextMenuItem>
			<div class="my-1 border-t border-border" role="separator"></div>
			<UiContextMenuItem @click="execute(context.entry, true)">
				<i class="fas fa-paper-plane" aria-hidden="true"></i>
				<span>{{ t('commandHistory.actions.sendToAllSessions') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>
	</section>
</template>

<style scoped>
	.command-history-root {
		container-type: size;
		container-name: command-history-pane;
		min-width: 0;
		background: color-mix(in srgb, var(--app-bg-color) 94%, transparent);
	}
	.command-history-controls {
		justify-content: flex-start;
		gap: clamp(0.2rem, 1.25cqi, 0.4rem);
		padding: 0.35rem 0.45rem 0.25rem;
		background: linear-gradient(180deg, color-mix(in srgb, var(--header-bg-color) 30%, transparent), transparent);
	}
	.command-history-controls,
	.command-history-list-area,
	.command-history-row {
		min-width: 0;
	}
	.command-history-row {
		min-height: calc(var(--history-row-scale) * 1.875rem);
		padding: calc(var(--history-row-scale) * 0.35rem) calc(var(--history-row-scale) * 0.6rem);
		border-radius: 0.35rem;
	}
	.command-history-row--compact {
		min-height: calc(var(--history-row-scale) * 1.5rem);
		padding-block: calc(var(--history-row-scale) * 0.15rem);
	}
	.command-history-command {
		min-width: 0;
	}
	.command-history-list-area {
		padding: 0.15rem 0.4rem 0.4rem 0.5rem;
		scrollbar-gutter: stable;
	}
	.command-history-list {
		padding: 0.05rem 0.1rem;
	}
	.command-history-search {
		--ui-control-radius: 0.45rem;
	}
	.command-history-empty {
		min-height: 100%;
		margin: auto;
		justify-content: center;
		background: transparent;
	}
	.command-history-empty :deep(.ui-empty-state__icon) {
		width: 26px;
		height: 26px;
		border: 0;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 11px;
	}
	.command-history-empty :deep(.ui-empty-state__title) {
		font-size: 11px;
		font-weight: 500;
		color: var(--text-color-secondary);
	}
	@container command-history-pane (min-width: 420px) {
		.command-history-list {
			padding-inline: 0.3rem;
		}
	}
	@container command-history-pane (max-width: 340px) {
		.command-history-controls {
			gap: 0.2rem;
			padding: 0.3rem 0.35rem 0.22rem;
		}
		.command-history-search {
			--ui-control-font-size: 0.75rem;
		}
		.command-history-list-area {
			padding: 0.1rem 0.3rem 0.35rem 0.4rem;
		}
		.command-history-row {
			padding-inline: 0.45rem;
		}
	}
	@container command-history-pane (max-width: 150px) {
		.command-history-controls {
			flex-wrap: wrap;
		}
		.command-history-search {
			flex: 1 1 100%;
			width: 100%;
			order: 2;
		}
		.history-control {
			order: 1;
		}
		.command-history-row {
			flex-wrap: nowrap;
			align-items: center;
			height: 1.6rem;
		}
		.command-history-row > :first-child {
			gap: 0.25rem;
		}
		.command-history-row i {
			display: none;
		}
	}
	@container command-history-pane (max-height: 180px) {
		.command-history-controls {
			padding-block: 0.2rem;
		}
		.command-history-list-area {
			padding-top: 0.05rem;
		}
		.command-history-row,
		.command-history-row--compact {
			min-height: 1.45rem;
			padding-block: 0.08rem;
		}
	}
	@container command-history-pane (max-height: 120px) {
		.command-history-controls {
			border-bottom-color: transparent;
		}
		.command-history-timestamp {
			display: none;
		}
	}
	.history-control {
		display: flex;
		width: clamp(1.65rem, 8.5cqi, 1.875rem);
		height: clamp(1.65rem, 8.5cqi, 1.875rem);
		flex: 0 0 clamp(1.65rem, 8.5cqi, 1.875rem);
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: 0.4rem;
		background: transparent;
		color: var(--text-color-secondary);
		transition:
			background-color 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
		cursor: pointer;
	}
	.history-control i {
		font-size: clamp(0.72rem, 3.5cqi, 0.825rem);
	}
	.history-control:hover {
		background: color-mix(in srgb, var(--text-color) 7%, transparent);
		color: var(--text-color);
	}
	.history-control--danger:hover {
		background: color-mix(in srgb, var(--status-error-color) 12%, transparent);
		color: var(--status-error-color);
	}
	.history-control--active {
		background: color-mix(in srgb, var(--primary-color) 14%, transparent);
		color: var(--primary-color);
	}
</style>
