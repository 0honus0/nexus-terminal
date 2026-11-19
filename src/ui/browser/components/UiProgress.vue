<script setup lang="ts">
	import type { UiProgressProps } from '../ui-component-types.js';
	defineProps<UiProgressProps>();
</script>

<template>
	<progress class="ui-progress" data-ui="progress" :value="value" max="100" :aria-label="label" />
</template>

<style scoped>
	.ui-progress {
		display: block;
		width: 100%;
		height: var(--ui-progress-height, 4px);
		border: 0;
		border-radius: 999px;
		overflow: hidden;
		accent-color: var(--ui-progress-color, var(--ui-primary));
		background: var(--ui-border);
	}
	.ui-progress::-webkit-progress-bar {
		background: var(--ui-border);
		border-radius: inherit;
	}
	.ui-progress::-webkit-progress-value {
		background: var(--ui-progress-color, var(--ui-primary));
		border-radius: inherit;
		transition: width var(--ui-motion-duration, 140ms);
	}
	.ui-progress::-moz-progress-bar {
		background: var(--ui-progress-color, var(--ui-primary));
		border-radius: inherit;
	}
</style>
