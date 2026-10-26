<script setup lang="ts">
	import { computed, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiInlineNotice, UiSearchInput } from '@/foundation/ui';
	import { createNativeThreadApi } from '../api/native-thread-api';
	import { useNativeThreads } from '../composables/use-native-threads';
	import type { NativeThread } from '../model/native-thread-types';

	const props = defineProps<{
		appId: string;
		liveThread?: NativeThread | null;
		active: boolean;
		resumeRevision?: number;
		disabled?: boolean;
		autoLoad?: boolean;
		apiBase?: '/api/v1/agent' | '/__next/api/v1/agent';
	}>();
	const emit = defineEmits<{ select: [value: NativeThread | null]; working: [value: boolean] }>();
	const { locale, t } = useI18n();
	const editor = useNativeThreads(
		props.appId,
		createNativeThreadApi(props.apiBase),
		() => props.active,
		(value) => emit('select', value),
	);
	const { items, nextCursor, title, selected, loaded, pending, pendingDelete, inspected, deleteInspected, busy } =
		editor;
	const query = ref('');
	const scroller = ref<HTMLElement | null>(null);
	const confirmingDeleteId = ref<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;
	const canCreate = computed(
		() =>
			!props.disabled &&
			!busy.value &&
			pending.value === null &&
			pendingDelete.value === null &&
			!editor.refreshRequired.value,
	);
	const canDelete = computed(
		() =>
			!props.disabled &&
			!busy.value &&
			pending.value === null &&
			pendingDelete.value === null &&
			!editor.refreshRequired.value,
	);
	const visibleItems = computed(() => {
		const needle = query.value.trim().toLowerCase();
		return items.value
			.filter((item) => !needle || `${item.title} ${item.id}`.toLowerCase().includes(needle))
			.slice()
			.sort((left, right) => right.updatedAt - left.updatedAt);
	});
	const timeFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }));
	const dateFormatter = computed(() => new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric' }));

	function formatUpdatedAt(updatedAt: number): string {
		const date = new Date(updatedAt);
		return date.toDateString() === new Date().toDateString()
			? timeFormatter.value.format(date)
			: dateFormatter.value.format(date);
	}

	function clearDeleteConfirmation(): void {
		if (confirmTimer !== null) clearTimeout(confirmTimer);
		confirmTimer = null;
		confirmingDeleteId.value = null;
	}

	function chooseThread(item: NativeThread): void {
		clearDeleteConfirmation();
		editor.choose(item);
	}

	function requestDelete(item: NativeThread): void {
		if (!canDelete.value) return;
		if (confirmingDeleteId.value !== item.id) {
			clearDeleteConfirmation();
			confirmingDeleteId.value = item.id;
			confirmTimer = setTimeout(clearDeleteConfirmation, 3500);
			return;
		}
		clearDeleteConfirmation();
		void editor.remove(item);
	}

	async function createThread(): Promise<void> {
		if (!canCreate.value) {
			return;
		}
		editor.newThread();
		title.value = t('agent.operations.untitledThread');
		await editor.submit(false, true);
		if (pending.value === null && selected.value !== null) {
			await editor.refresh();
		}
	}

	async function retryPending(): Promise<void> {
		await editor.submit(true);
		if (pending.value === null && selected.value !== null) {
			await editor.refresh();
		}
	}

	function handleScroll(): void {
		const element = scroller.value;
		if (
			!element ||
			!props.active ||
			props.disabled ||
			!loaded.value ||
			pending.value !== null ||
			pendingDelete.value !== null ||
			nextCursor.value === null ||
			busy.value ||
			editor.refreshRequired.value ||
			(!query.value.trim() && element.scrollHeight - element.scrollTop - element.clientHeight > 96)
		) {
			return;
		}
		void editor.loadMore();
	}

	// Search must inspect later pages even when the current filtered list cannot scroll.
	watch([query, nextCursor, busy, () => props.active, () => props.disabled], handleScroll, { flush: 'post' });

	watch(
		() => props.liveThread,
		(value) => {
			if (value) editor.acceptThread(value);
		},
		{ immediate: true },
	);
	watch(busy, (value) => emit('working', value), { flush: 'sync' });
	watch([busy, pending, pendingDelete], clearDeleteConfirmation);
	let pendingRefresh = false;
	let lastResumeRevision: number | undefined;

	function refreshWhenIdle(): void {
		if (!pendingRefresh || !props.active || !props.autoLoad || busy.value) return;
		pendingRefresh = false;
		lastResumeRevision = props.resumeRevision;
		void editor.refresh();
	}

	watch(busy, refreshWhenIdle);
	watch(
		() => [props.active, props.resumeRevision] as const,
		([active, revision]) => {
			if (
				active &&
				props.autoLoad &&
				(!loaded.value || editor.refreshRequired.value || revision !== lastResumeRevision)
			) {
				pendingRefresh = true;
				refreshWhenIdle();
			}
		},
		{ immediate: true },
	);
	onBeforeUnmount(clearDeleteConfirmation);
</script>

<template>
	<section class="flex h-full min-h-0 min-w-0 flex-col select-none">
		<div class="flex h-10 shrink-0 items-center justify-between border-b border-border/45 px-3">
			<div class="flex min-w-0 items-center gap-2">
				<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"></span>
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="text-xs font-semibold leading-none text-foreground">{{
						t('agent.operations.threads')
					}}</span>
					<span v-if="items.length" class="text-[11px] font-medium leading-none text-text-secondary/60">
						{{ nextCursor ? `${items.length}+` : items.length }}
					</span>
				</div>
			</div>
			<div class="flex items-center gap-0.5">
				<UiButton
					v-if="editor.refreshRequired.value"
					density="compact"
					appearance="ghost"
					tone="warning"
					icon-only
					:title="t('common.retry')"
					:aria-label="t('common.retry')"
					:disabled="disabled || busy || !!pending"
					@click="editor.refresh"
				>
					<i class="fa-solid fa-rotate text-[9px]" aria-hidden="true"></i>
				</UiButton>
				<UiButton
					density="compact"
					appearance="ghost"
					tone="primary"
					icon-only
					:title="t('agent.operations.newThread')"
					:aria-label="t('agent.operations.newThread')"
					:disabled="!canCreate"
					@click="createThread"
				>
					<i class="fa-solid fa-plus text-[9px]" aria-hidden="true"></i>
				</UiButton>
			</div>
		</div>

		<div class="shrink-0 border-b border-border/40 px-2.5 py-2">
			<UiSearchInput
				v-model="query"
				density="compact"
				class="w-full"
				:placeholder="t('agent.operations.searchThreads')"
				:aria-label="t('agent.operations.searchThreads')"
				:clear-label="t('agent.operations.clearSearch')"
			/>
		</div>

		<div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5" @scroll.passive="handleScroll">
			<div
				v-for="item in visibleItems"
				:key="item.id"
				class="group relative mb-0.5 flex min-h-12 w-full items-stretch rounded-lg transition-colors"
				:class="
					selected?.id === item.id
						? 'bg-primary/[0.055] font-medium text-foreground'
						: 'text-text-secondary hover:bg-card/45 hover:text-foreground'
				"
			>
				<span
					v-if="selected?.id === item.id"
					class="absolute bottom-2 left-0.5 top-2 w-0.5 rounded-full bg-primary"
				></span>
				<button
					type="button"
					class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
					:disabled="disabled || busy || !!pending || !!pendingDelete || editor.refreshRequired.value"
					:aria-current="selected?.id === item.id ? 'true' : undefined"
					@click="chooseThread(item)"
				>
					<span class="relative mt-px flex h-4 w-3 shrink-0 items-center justify-center" aria-hidden="true">
						<span
							class="relative z-10 h-1.5 w-1.5 rounded-full transition-colors"
							:class="
								selected?.id === item.id
									? 'bg-primary'
									: 'bg-text-secondary/25 group-hover:bg-text-secondary/45'
							"
						></span>
					</span>
					<div class="min-w-0 flex-1">
						<span
							class="block truncate text-[11px] leading-[1.35] tracking-[-0.012em] text-foreground/90"
							:title="item.title || t('agent.operations.untitledThread')"
						>
							{{ item.title || t('agent.operations.untitledThread') }}
						</span>
						<div class="mt-0.5 flex justify-end text-[9px] text-text-secondary/75">
							<span class="shrink-0 tabular-nums">{{ formatUpdatedAt(item.updatedAt) }}</span>
						</div>
					</div>
				</button>
				<UiButton
					density="compact"
					:appearance="confirmingDeleteId === item.id ? 'soft' : 'ghost'"
					tone="danger"
					icon-only
					class="my-1 mr-1 shrink-0"
					:title="
						confirmingDeleteId === item.id
							? t('agent.operations.confirmDeleteThread')
							: t('agent.operations.deleteThread')
					"
					:aria-label="
						confirmingDeleteId === item.id
							? t('agent.operations.confirmDeleteThread')
							: t('agent.operations.deleteThread')
					"
					:disabled="!canDelete"
					@click="requestDelete(item)"
				>
					<i class="fa-regular fa-trash-can" aria-hidden="true"></i>
				</UiButton>
			</div>

			<UiEmptyState
				v-if="visibleItems.length === 0"
				class="py-4"
				compact
				:bordered="false"
				icon="fa-regular fa-comment-dots"
				:title="t('agent.operations.noThreadsFound')"
			/>
		</div>

		<div v-if="(pending || pendingDelete) && !busy" class="shrink-0 border-t border-border/45 p-2.5">
			<UiInlineNotice v-if="pending" tone="warning" compact>
				<p class="leading-4">{{ t('agent.nativeThreads.unknown') }}</p>
				<details class="mt-1 text-[10px] text-text-secondary">
					<summary class="cursor-pointer select-none">{{ t('agent.nativeRun.technicalDetails') }}</summary>
					<code class="mt-1 block break-all">{{ pending.operationId }}</code>
				</details>
				<div class="mt-2 flex flex-wrap gap-1.5">
					<UiButton density="compact" appearance="soft" :disabled="disabled || busy" @click="editor.refresh">
						{{ t('agent.nativeRun.inspect') }}
					</UiButton>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="disabled || busy || !inspected || editor.refreshRequired.value"
						@click="retryPending"
					>
						{{ t('agent.nativeThreads.retry') }}
					</UiButton>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="disabled || busy || !inspected"
						@click="editor.abandon"
					>
						{{ t('agent.nativeThreads.abandon') }}
					</UiButton>
				</div>
			</UiInlineNotice>
			<UiInlineNotice v-else-if="pendingDelete" tone="warning" compact>
				<p class="leading-4">
					{{ t('agent.nativeThreads.deleteUnknown') }}
				</p>
				<details class="mt-1 text-[10px] text-text-secondary">
					<summary class="cursor-pointer select-none">{{ t('agent.nativeRun.technicalDetails') }}</summary>
					<code class="mt-1 block break-all">{{ pendingDelete.thread.id }}</code>
				</details>
				<div class="mt-2 flex flex-wrap gap-1.5">
					<UiButton density="compact" appearance="soft" :disabled="disabled || busy" @click="editor.refresh">
						{{ t('agent.nativeRun.inspect') }}
					</UiButton>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="disabled || busy || !deleteInspected || editor.refreshRequired.value"
						@click="editor.retryDelete"
					>
						{{ t('agent.nativeThreads.retry') }}
					</UiButton>
					<UiButton
						density="compact"
						appearance="soft"
						:disabled="disabled || busy || !deleteInspected"
						@click="editor.abandonDelete"
					>
						{{ t('agent.nativeThreads.abandon') }}
					</UiButton>
				</div>
			</UiInlineNotice>
		</div>
	</section>
</template>
