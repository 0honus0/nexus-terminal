<script setup lang="ts">
	import { computed, ref, useAttrs } from 'vue';
	import type { UiDensity } from './uiTypes';

	defineOptions({ inheritAttrs: false });

	const attrs = useAttrs();
	const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
	const inputAttrs = computed(() => {
		const { class: _class, style: _style, ...rest } = attrs;
		return rest;
	});
	const inputRef = ref<HTMLInputElement | null>(null);
	const model = defineModel<string | number | null>({ default: '' });
	const props = withDefaults(
		defineProps<{
			type?: string;
			density?: UiDensity;
			invalid?: boolean;
			disabled?: boolean;
			trailingInteractive?: boolean;
			incrementLabel?: string;
			decrementLabel?: string;
		}>(),
		{
			type: 'text',
			density: 'default',
			invalid: false,
			disabled: false,
			trailingInteractive: false,
			incrementLabel: 'Increase value',
			decrementLabel: 'Decrease value',
		},
	);
	const isNumber = computed(() => props.type === 'number');

	const focus = (options?: FocusOptions): void => {
		inputRef.value?.focus(options);
	};

	const blur = (): void => {
		inputRef.value?.blur();
	};

	const select = (): void => {
		inputRef.value?.select();
	};

	const step = (direction: 1 | -1): void => {
		const input = inputRef.value;
		if (!input || props.disabled || input.readOnly) return;
		try {
			if (direction === 1) input.stepUp();
			else input.stepDown();
			const value = input.valueAsNumber;
			if (Number.isFinite(value)) model.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
		} catch {
			// type=number with step=any has no discrete next value; keep manual input.
		}
	};

	defineExpose({ focus, blur, select });
</script>

<template>
	<div
		v-bind="rootAttrs"
		data-ui="input"
		data-ui-gen="2"
		:data-density="props.density"
		:data-invalid="props.invalid || undefined"
		:data-disabled="props.disabled || undefined"
		:data-number="isNumber || undefined"
		class="ui-control ui-input"
		:class="{ 'ui-input--invalid': props.invalid, 'ui-input--disabled': props.disabled }"
	>
		<span v-if="$slots.leading" class="ui-input__adornment" aria-hidden="true">
			<slot name="leading" />
		</span>
		<input
			ref="inputRef"
			v-model="model"
			v-bind="inputAttrs"
			data-no-highlight=""
			:type="props.type"
			:disabled="props.disabled"
			:aria-invalid="props.invalid || undefined"
			class="ui-input__control"
		/>
		<span v-if="isNumber" class="ui-input__number-stepper">
			<button
				type="button"
				class="ui-input__number-button"
				:disabled="props.disabled"
				:aria-label="props.incrementLabel"
				@mousedown.prevent
				@click="step(1)"
			>
				<svg viewBox="0 0 8 5" aria-hidden="true">
					<path d="M1 4L4 1L7 4" />
				</svg>
			</button>
			<button
				type="button"
				class="ui-input__number-button"
				:disabled="props.disabled"
				:aria-label="props.decrementLabel"
				@mousedown.prevent
				@click="step(-1)"
			>
				<svg viewBox="0 0 8 5" aria-hidden="true">
					<path d="M1 1L4 4L7 1" />
				</svg>
			</button>
		</span>
		<span
			v-if="$slots.trailing"
			class="ui-input__adornment"
			:aria-hidden="props.trailingInteractive ? undefined : 'true'"
		>
			<slot name="trailing" />
		</span>
	</div>
</template>
