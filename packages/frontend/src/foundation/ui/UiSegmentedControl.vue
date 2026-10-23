<script setup lang="ts" generic="T extends string | number">
	import { nextTick, ref } from 'vue';
	import type { UiDensity } from './uiTypes';

	interface SegmentedOption {
		value: T;
		label: string;
		disabled?: boolean;
	}

	const model = defineModel<T>({ required: true });
	const props = withDefaults(
		defineProps<{
			options: SegmentedOption[];
			label: string;
			density?: UiDensity;
			disabled?: boolean;
		}>(),
		{
			density: 'default',
			disabled: false,
		},
	);

	const optionRefs = ref<HTMLButtonElement[]>([]);

	const setOptionRef = (element: unknown, index: number): void => {
		if (element instanceof HTMLButtonElement) optionRefs.value[index] = element;
	};

	const select = (option: SegmentedOption): void => {
		if (props.disabled || option.disabled || option.value === model.value) return;
		model.value = option.value;
	};

	const move = (index: number, direction: -1 | 1): void => {
		const enabledIndexes = props.options
			.map((option, optionIndex) => ({ option, optionIndex }))
			.filter((entry) => !entry.option.disabled)
			.map((entry) => entry.optionIndex);
		if (!enabledIndexes.length) return;
		const current = enabledIndexes.indexOf(index);
		const nextIndex = enabledIndexes[(current + direction + enabledIndexes.length) % enabledIndexes.length];
		if (nextIndex === undefined) return;
		const next = props.options[nextIndex];
		if (!next) return;
		model.value = next.value;
		void nextTick(() => optionRefs.value[nextIndex]?.focus());
	};

	const handleKeydown = (event: KeyboardEvent, index: number): void => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		move(index, event.key === 'ArrowRight' ? 1 : -1);
	};
</script>

<template>
	<div
		data-ui="segmented-control"
		data-ui-gen="2"
		:data-density="props.density"
		:data-disabled="props.disabled || undefined"
		class="ui-segmented"
		role="radiogroup"
		:aria-label="props.label"
		:aria-disabled="props.disabled || undefined"
	>
		<button
			v-for="(option, index) in props.options"
			:key="option.value"
			:ref="(element) => setOptionRef(element, index)"
			type="button"
			role="radio"
			class="ui-focusable ui-segmented__option"
			:data-active="option.value === model || undefined"
			:aria-checked="option.value === model"
			:disabled="props.disabled || option.disabled"
			:tabindex="option.value === model ? 0 : -1"
			@click="select(option)"
			@keydown="handleKeydown($event, index)"
		>
			{{ option.label }}
		</button>
	</div>
</template>

<style scoped>
	.ui-segmented {
		display: grid;
		grid-auto-columns: minmax(0, 1fr);
		grid-auto-flow: column;
		gap: 3px;
		min-width: 0;
		padding: 3px;
		border: 1px solid color-mix(in srgb, var(--border-color) 56%, transparent);
		border-radius: var(--ui-control-radius);
		background: color-mix(in srgb, var(--header-bg-color) 56%, var(--app-bg-color));
		box-shadow: inset 0 1px 2px color-mix(in srgb, var(--text-color) 5%, transparent);
	}

	.ui-segmented__option {
		min-width: 0;
		min-height: calc(var(--ui-control-height) - 8px);
		border: 0;
		border-radius: calc(var(--ui-control-radius) - 2px);
		padding: 0 9px;
		background: transparent;
		color: var(--text-color-secondary);
		font-size: 12px;
		font-weight: 560;
		line-height: 1.25;
		overflow-wrap: anywhere;
		cursor: pointer;
		transition:
			background-color 140ms ease,
			color 140ms ease,
			box-shadow 140ms ease;
	}

	.ui-segmented__option:hover:not(:disabled) {
		background: color-mix(in srgb, var(--card-bg-color) 76%, var(--app-bg-color));
		color: var(--text-color);
	}

	.ui-segmented__option[data-active] {
		background: color-mix(in srgb, var(--link-active-color) 13%, var(--card-bg-color));
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--link-active-color) 22%, transparent);
		color: var(--link-active-color);
	}

	.ui-segmented__option:disabled {
		cursor: not-allowed;
		opacity: 0.52;
	}

	.ui-segmented[data-density='compact'] .ui-segmented__option {
		min-height: calc(var(--ui-control-height) - 10px);
		padding-inline: 7px;
		font-size: 11px;
	}
</style>
