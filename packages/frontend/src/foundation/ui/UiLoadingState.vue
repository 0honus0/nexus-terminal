<script setup lang="ts">
	import { computed } from 'vue';
	import UiSpinner from './UiSpinner.vue';

	const props = withDefaults(
		defineProps<{
			title?: string;
			description?: string;
			dense?: boolean;
			compact?: boolean;
			bordered?: boolean;
			lines?: number;
		}>(),
		{
			title: '',
			description: '',
			dense: false,
			compact: false,
			bordered: true,
			lines: 3,
		},
	);
	const lineCount = computed(() => {
		const requested = Math.max(1, Math.min(4, Math.round(props.lines)));
		return props.dense ? Math.min(2, requested) : requested;
	});
</script>

<template>
	<div
		data-ui="loading-state"
		data-ui-gen="2"
		class="ui-loading-state"
		:data-dense="dense ? 'true' : 'false'"
		:data-compact="compact ? 'true' : undefined"
		:data-bordered="bordered ? 'true' : 'false'"
		role="status"
		aria-live="polite"
		aria-busy="true"
	>
		<span class="ui-loading-state__icon"><UiSpinner density="compact" /></span>
		<div class="ui-loading-state__body">
			<p v-if="title" class="ui-loading-state__title">{{ title }}</p>
			<p v-if="description" class="ui-loading-state__description">{{ description }}</p>
			<div class="ui-loading-state__lines" aria-hidden="true">
				<span v-for="line in lineCount" :key="line"></span>
			</div>
		</div>
	</div>
</template>
