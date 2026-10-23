<script setup lang="ts">
	import { ref, useAttrs } from 'vue';
	import UiInput from './UiInput.vue';
	import type { UiDensity } from './uiTypes';

	defineOptions({ inheritAttrs: false });

	const attrs = useAttrs();
	const model = defineModel<string>({ default: '' });
	const input = ref<InstanceType<typeof UiInput> | null>(null);
	const props = withDefaults(
		defineProps<{
			placeholder?: string;
			ariaLabel?: string;
			clearLabel?: string;
			density?: UiDensity;
			disabled?: boolean;
			clearable?: boolean;
		}>(),
		{
			placeholder: '',
			ariaLabel: '',
			clearLabel: 'Clear search',
			density: 'comfortable',
			disabled: false,
			clearable: true,
		},
	);

	const clear = (): void => {
		model.value = '';
	};

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
		v-model="model"
		type="search"
		:aria-label="props.ariaLabel || props.placeholder"
		:density="props.density"
		:disabled="props.disabled"
		:placeholder="props.placeholder"
		:trailing-interactive="props.clearable && model.length > 0"
		class="ui-search-input"
	>
		<template #leading>
			<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
		</template>
		<template v-if="props.clearable && model.length > 0" #trailing>
			<button
				type="button"
				class="ui-search-input__clear"
				:aria-label="props.clearLabel"
				:title="props.clearLabel"
				@mousedown.prevent
				@click="clear"
			>
				<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>
			</button>
		</template>
	</UiInput>
</template>

<style scoped>
	.ui-search-input__clear {
		display: grid;
		width: 18px;
		height: 18px;
		place-items: center;
		border: 0;
		border-radius: 999px;
		padding: 0;
		background: transparent;
		color: var(--ui-text-muted);
		cursor: pointer;
		font-size: 11px;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.ui-search-input__clear:hover,
	.ui-search-input__clear:focus-visible {
		background: var(--ui-fill-soft-hover);
		color: var(--ui-text);
	}

	.ui-search-input__clear:focus-visible {
		outline: 1px solid var(--ui-focus-color);
		outline-offset: 1px;
	}
</style>
