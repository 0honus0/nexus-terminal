<script setup lang="ts">
	import type { UiBadgeProps } from '../ui-component-types.js';
	withDefaults(defineProps<UiBadgeProps>(), { tone: 'neutral', dot: false });
</script>
<template>
	<span class="ui-badge" data-ui="badge" :data-tone="tone"
		><span v-if="dot" class="ui-badge__dot" aria-hidden="true" /><slot
	/></span>
</template>
<style scoped>
	.ui-badge {
		--badge-color: var(--ui-muted);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		width: fit-content;
		max-width: 100%;
		padding: 4px 9px;
		border-radius: 7px;
		background: color-mix(in srgb, var(--badge-color) 10%, transparent);
		color: var(--badge-color);
		font-size: 11px;
		font-weight: 600;
		line-height: 1.5;
		white-space: nowrap;
	}
	.ui-badge[data-tone='primary'] {
		--badge-color: var(--ui-primary);
	}
	.ui-badge[data-tone='success'] {
		--badge-color: var(--ui-success);
	}
	.ui-badge[data-tone='warning'] {
		--badge-color: var(--ui-warning);
	}
	.ui-badge[data-tone='danger'] {
		--badge-color: var(--ui-danger);
	}
	.ui-badge__dot {
		width: 5px;
		height: 5px;
		flex: none;
		border-radius: 50%;
		background: currentColor;
	}
</style>
