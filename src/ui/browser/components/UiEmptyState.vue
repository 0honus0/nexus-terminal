<script setup lang="ts">
	import type { UiEmptyStateProps } from '../ui-component-types.js';
	defineProps<UiEmptyStateProps>();
</script>
<template>
	<div class="ui-empty-state" data-ui="empty-state">
		<span v-if="icon || $slots.icon" class="ui-empty-state__icon" aria-hidden="true"
			><slot name="icon"><component :is="icon" :size="26" /></slot
		></span>
		<h3>{{ title }}</h3>
		<p v-if="description">{{ description }}</p>
		<div v-if="$slots.default" class="ui-empty-state__actions"><slot /></div>
	</div>
</template>
<style scoped>
	.ui-empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 40px 20px;
		text-align: center;
		color: var(--ui-text);
	}
	.ui-empty-state__icon {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		color: var(--ui-muted);
		background: color-mix(in srgb, var(--ui-muted) 8%, transparent);
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}
	p {
		max-width: 36ch;
		margin: 0;
		color: var(--ui-muted);
		font-size: 12px;
		line-height: 1.8;
	}
	.ui-empty-state__actions {
		margin-top: 4px;
	}
</style>
