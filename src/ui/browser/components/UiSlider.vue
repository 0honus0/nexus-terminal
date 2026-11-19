<script setup lang="ts">
	import type { UiSliderProps } from '../ui-component-types.js';
	import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'reka-ui';
	defineOptions({ inheritAttrs: false });
	withDefaults(defineProps<UiSliderProps>(), { min: 0, max: 100, step: 1 });
	const emit = defineEmits<{
		'update:modelValue': [value: number];
		commit: [value: number];
		cancel: [];
	}>();
</script>
<template>
	<SliderRoot
		class="ui-slider"
		data-ui="slider"
		:model-value="[modelValue]"
		:min="min"
		:max="max"
		:step="step"
		:disabled="disabled"
		:name="name"
		@update:model-value="(value) => value?.[0] !== undefined && emit('update:modelValue', value[0])"
		@value-commit="(value) => value[0] !== undefined && emit('commit', value[0])"
		@pointercancel="emit('cancel')"
	>
		<SliderTrack class="ui-slider__track"><SliderRange class="ui-slider__range" /></SliderTrack>
		<SliderThumb v-bind="$attrs" class="ui-slider__thumb" />
	</SliderRoot>
</template>
<style scoped>
	.ui-slider {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 40px;
		touch-action: none;
		user-select: none;
	}
	.ui-slider__track {
		position: relative;
		flex: 1;
		height: 5px;
		border-radius: 999px;
		background: var(--ui-border);
	}
	.ui-slider__range {
		position: absolute;
		height: 100%;
		border-radius: inherit;
		background: var(--ui-primary);
	}
	.ui-slider__thumb {
		display: block;
		width: 18px;
		height: 18px;
		border: 2px solid var(--ui-primary);
		border-radius: 50%;
		background: var(--ui-surface);
		cursor: grab;
	}
	.ui-slider__thumb:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: 4px;
	}
	.ui-slider__thumb:active {
		cursor: grabbing;
	}
	.ui-slider[data-disabled] {
		opacity: 0.5;
	}
	.ui-slider[data-disabled] .ui-slider__thumb {
		cursor: default;
	}
</style>
