<script setup lang="ts">
	import { computed, ref, useAttrs } from 'vue';
	import UiInput from './UiInput.vue';
	import type { UiDensity } from './uiTypes';

	defineOptions({ inheritAttrs: false });

	const attrs = useAttrs();
	const model = defineModel<string | number | null>({ default: '' });
	const input = ref<InstanceType<typeof UiInput> | null>(null);

	const numericModel = computed({
		get: () => model.value,

		set: (value: string | number | null) => {
			if (value === '' || value === null) {
				model.value = null;
				return;
			}
			const parsed = typeof value === 'number' ? value : Number(value);
			model.value = Number.isFinite(parsed) ? parsed : value;
		},
	});

	const props = withDefaults(
		defineProps<{
			icon?: string;
			unit?: string;
			density?: UiDensity;
			invalid?: boolean;
			disabled?: boolean;
			incrementLabel?: string;
			decrementLabel?: string;
		}>(),
		{
			icon: undefined,
			unit: undefined,
			density: 'default',
			invalid: false,
			disabled: false,
			incrementLabel: 'Increase value',
			decrementLabel: 'Decrease value',
		},
	);

	const focus = (options?: FocusOptions): void => {
		input.value?.focus(options);
	};

	const blur = (): void => {
		input.value?.blur();
	};

	const select = (): void => {
		input.value?.select();
	};

	defineExpose({ focus, blur, select });
</script>

<template>
	<UiInput
		ref="input"
		v-bind="attrs"
		v-model="numericModel"
		type="number"
		:density="props.density"
		:invalid="props.invalid"
		:disabled="props.disabled"
		:increment-label="props.incrementLabel"
		:decrement-label="props.decrementLabel"
		class="ui-number-input"
	>
		<template v-if="props.icon" #leading>
			<i :class="props.icon" aria-hidden="true"></i>
		</template>
		<template v-if="props.unit" #trailing>
			<span class="ui-number-input__unit">{{ props.unit }}</span>
		</template>
	</UiInput>
</template>

<style scoped>
	.ui-number-input {
		width: 100%;
	}

	.ui-number-input__unit {
		color: var(--ui-text-muted);
		font-size: 10px;
		font-weight: 620;
		line-height: 1;
		letter-spacing: 0.01em;
	}
</style>
