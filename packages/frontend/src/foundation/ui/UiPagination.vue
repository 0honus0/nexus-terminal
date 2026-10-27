<script setup lang="ts">
	import UiButton from './UiButton.vue';
	import type { UiDensity } from './uiTypes';

	const props = withDefaults(
		defineProps<{
			page: number;
			pageCount: number;
			previousLabel: string;
			nextLabel: string;
			label?: string;
			density?: UiDensity;
		}>(),
		{
			label: 'Pagination',
			density: 'compact',
		},
	);

	const emit = defineEmits<{ previous: []; next: [] }>();
</script>

<template>
	<div data-ui="pagination" data-ui-gen="2" class="ui-pagination" role="group" :aria-label="props.label">
		<UiButton
			appearance="ghost"
			density="compact"
			icon-only
			class="ui-pagination__button"
			:disabled="props.page <= 1"
			:aria-label="props.previousLabel"
			:title="props.previousLabel"
			@click="emit('previous')"
		>
			<i class="fas fa-chevron-left" aria-hidden="true"></i>
		</UiButton>
		<span class="ui-pagination__status" aria-live="polite">
			<slot :page="props.page" :page-count="props.pageCount">{{ props.page }} / {{ props.pageCount }}</slot>
		</span>
		<UiButton
			appearance="ghost"
			density="compact"
			icon-only
			class="ui-pagination__button"
			:disabled="props.page >= props.pageCount"
			:aria-label="props.nextLabel"
			:title="props.nextLabel"
			@click="emit('next')"
		>
			<i class="fas fa-chevron-right" aria-hidden="true"></i>
		</UiButton>
	</div>
</template>

<style scoped>
	.ui-pagination {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 4px;
	}

	.ui-pagination__button {
		flex: none;
	}

	.ui-pagination__status {
		display: inline-flex;
		min-width: 4.5rem;
		align-items: center;
		justify-content: center;
		gap: 0.3em;
		color: var(--ui-text-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
		white-space: nowrap;
	}

	.ui-pagination__status :slotted(strong) {
		color: var(--ui-text);
		font-weight: 620;
	}

	@media (max-width: 640px) {
		.ui-pagination :deep(.ui-button) {
			width: 44px;
			height: 44px;
			min-height: 44px;
		}
	}
</style>
