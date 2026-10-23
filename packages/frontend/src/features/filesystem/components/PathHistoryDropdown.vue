<script setup lang="ts">
	import { nextTick, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiContextMenu, UiContextMenuItem, UiEmptyState, UiLoadingState } from '@/foundation/ui';
	import type { PathHistoryItem } from '../model/catalog-types';

	const props = defineProps<{
		visible: boolean;
		loading: boolean;
		items: PathHistoryItem[];
		selectedIndex: number;
	}>();

	const emit = defineEmits<{
		select: [path: string];
		copy: [path: string];
		remove: [id: number];
	}>();

	const { t } = useI18n();
	const itemRefs = ref<HTMLElement[]>([]);
	const context = ref<{ item: PathHistoryItem; x: number; y: number } | null>(null);

	const openContext = (event: MouseEvent, item: PathHistoryItem) => {
		context.value = { item, x: event.clientX, y: event.clientY };
	};

	const copyContextPath = () => {
		if (!context.value) return;
		const path = context.value.item.path;
		emit('copy', path);
		context.value = null;
	};

	const removeContextPath = () => {
		if (!context.value) return;
		const id = context.value.item.id;
		context.value = null;
		emit('remove', id);
	};

	watch(
		() => [props.visible, props.selectedIndex] as const,
		async ([visible, selectedIndex]) => {
			if (!visible) {
				context.value = null;
				return;
			}
			if (selectedIndex < 0) return;
			await nextTick();
			itemRefs.value[selectedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		},
	);
</script>

<template>
	<div
		v-if="visible"
		class="path-history-dropdown absolute right-0 top-full z-40 mt-1 overflow-y-auto text-sm"
		@mousedown.prevent
	>
		<UiLoadingState
			v-if="loading && !items.length"
			class="path-history-state"
			dense
			:bordered="false"
			:title="t('pathHistory.loading')"
		/>
		<UiEmptyState
			v-else-if="!items.length"
			class="path-history-state"
			dense
			:bordered="false"
			icon="fas fa-history"
			:title="t('pathHistory.empty')"
		/>
		<ul v-else class="path-history-list">
			<li
				v-for="(item, index) in items"
				:key="item.id"
				:ref="(element) => element && (itemRefs[index] = element as HTMLElement)"
				class="path-history-item"
				:class="{ 'is-selected': index === selectedIndex }"
				:title="item.path"
				@click="emit('select', item.path)"
				@contextmenu.prevent.stop="openContext($event, item)"
			>
				<span class="path-history-path">{{ item.path }}</span>
			</li>
		</ul>

		<UiContextMenu
			v-if="context"
			:visible="true"
			:x="context.x"
			:y="context.y"
			:width="190"
			@close="context = null"
		>
			<UiContextMenuItem @mousedown.prevent.stop @click="copyContextPath">
				<i class="fas fa-copy" aria-hidden="true"></i>
				<span>{{ t('pathHistory.copy') }}</span>
			</UiContextMenuItem>
			<UiContextMenuItem tone="danger" @mousedown.prevent.stop @click="removeContextPath">
				<i class="fas fa-trash-alt" aria-hidden="true"></i>
				<span>{{ t('pathHistory.delete') }}</span>
			</UiContextMenuItem>
		</UiContextMenu>
	</div>
</template>

<style scoped>
	.path-history-dropdown {
		width: min(34rem, calc(100cqw - 0.5rem));
		max-width: min(34rem, calc(100cqw - 0.5rem), 100%);
		max-height: max(92px, min(18rem, calc(100cqh - 3rem)));
		min-width: 0;
		padding: 4px;
		border: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
		border-radius: 10px;
		background: color-mix(in srgb, var(--card-bg-color, var(--app-bg-color)) 94%, transparent);
		box-shadow: 0 10px 28px rgb(0 0 0 / 24%);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--text-color) 22%, transparent) transparent;
	}

	.path-history-state {
		padding: 12px 8px;
		font-size: 11px;
	}

	.path-history-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.path-history-item {
		display: flex;
		min-width: 0;
		align-items: center;
		padding: 6px 8px;
		border-radius: 7px;
		color: var(--text-color);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}

	.path-history-item:hover,
	.path-history-item:focus-visible {
		outline: 0;
		background: color-mix(in srgb, var(--primary-color) 9%, transparent);
	}

	.path-history-item.is-selected {
		background: color-mix(in srgb, var(--primary-color) 14%, transparent);
		color: var(--primary-color);
	}

	.path-history-path {
		display: -webkit-box;
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow-wrap: anywhere;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 10px;
		line-height: 1.4;
	}
</style>
