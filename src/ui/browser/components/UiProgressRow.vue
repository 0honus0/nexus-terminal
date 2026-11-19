<script setup lang="ts">
	import { computed } from 'vue';
	import { Circle, CircleCheck, CircleX, LoaderCircle } from '@lucide/vue';
	import type { UiProgressRowProps } from '../ui-component-types.js';
	import UiProgress from './UiProgress.vue';
	const props = withDefaults(defineProps<UiProgressRowProps>(), {
		density: 'default',
		showProgress: true,
		statusDisplay: 'percent',
	});
	const icons = { pending: Circle, running: LoaderCircle, succeeded: CircleCheck, failed: CircleX };
	const percent = computed(() =>
		props.state === 'succeeded'
			? 100
			: props.value === undefined
				? undefined
				: Math.min(100, Math.max(0, props.value)),
	);
</script>

<template>
	<div class="ui-progress-row" data-ui="progress-row" :data-state="state" :data-density="density">
		<div class="ui-progress-row__heading">
			<component
				:is="icons[state]"
				:size="density === 'compact' ? 15 : 18"
				class="ui-progress-row__icon"
				aria-hidden="true"
			/>
			<span class="ui-progress-row__label" :title="label">{{ label }}</span>
			<span class="ui-progress-row__status" :aria-label="statusLabel"
				><template v-if="statusDisplay === 'percent' && percent !== undefined">{{ percent }}%</template
				><template v-else>{{ statusLabel }}</template></span
			>
		</div>
		<UiProgress v-if="showProgress" :label="label" :value="percent" />
		<slot />
	</div>
</template>

<style scoped>
	.ui-progress-row {
		--ui-progress-color: var(--ui-primary);
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.ui-progress-row__heading {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) var(--ui-progress-status-width, 5rem);
		gap: 10px;
		align-items: center;
		min-height: 32px;
		font-size: 13px;
	}
	.ui-progress-row[data-density='compact'] {
		--ui-progress-height: 3px;
		gap: 4px;
	}
	.ui-progress-row[data-density='compact'] .ui-progress-row__heading {
		grid-template-columns: 15px minmax(0, 1fr) var(--ui-progress-status-width, 4rem);
		gap: 8px;
		min-height: 24px;
		font-size: 12px;
	}
	.ui-progress-row__label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ui-progress-row__status {
		text-align: end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ui-progress-row__icon {
		color: var(--ui-muted);
	}
	.ui-progress-row[data-state='succeeded'] {
		--ui-progress-color: var(--ui-success);
	}
	.ui-progress-row[data-state='failed'] {
		--ui-progress-color: var(--ui-danger);
	}
	:is([data-state='succeeded'], [data-state='failed']) > .ui-progress-row__heading > .ui-progress-row__status {
		color: var(--ui-progress-color);
	}
	[data-state='running'] > .ui-progress-row__heading > .ui-progress-row__icon {
		color: var(--ui-primary);
		animation: ui-progress-spin 1s linear infinite;
	}
	[data-state='succeeded'] > .ui-progress-row__heading > .ui-progress-row__icon {
		color: var(--ui-success);
	}
	[data-state='failed'] > .ui-progress-row__heading > .ui-progress-row__icon {
		color: var(--ui-danger);
	}
	@keyframes ui-progress-spin {
		to {
			transform: rotate(360deg);
		}
	}
	:global(html[data-ui-motion='reduced']) .ui-progress-row__icon {
		animation: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.ui-progress-row__icon {
			animation: none !important;
		}
	}
</style>
