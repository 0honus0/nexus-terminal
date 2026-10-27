<script setup lang="ts">
	import UiSpinner from './UiSpinner.vue';
	import type { UiDensity } from './uiTypes';

	withDefaults(
		defineProps<{
			label?: string;
			density?: UiDensity;
		}>(),
		{
			label: '',
			density: 'compact',
		},
	);
</script>

<template>
	<span data-ui="inline-loading" data-ui-gen="2" class="ui-loading-inline" role="status" aria-live="polite">
		<UiSpinner :density="density" />
		<span v-if="label || $slots.default" class="ui-loading-inline__label">
			<slot>{{ label }}</slot>
		</span>
	</span>
</template>
