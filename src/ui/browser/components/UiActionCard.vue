<script setup lang="ts">
	import type { UiActionCardProps } from '../ui-component-types.js';

	import { useId } from 'vue';
	/** 只提供原生按钮语义及内容容器；点击由调用方处理，不包含窗口或业务逻辑。 */
	defineProps<UiActionCardProps>();
	const contentId = useId();
</script>

<template>
	<button type="button" class="ui-action-card" :disabled="disabled" :aria-label="label" :aria-describedby="contentId">
		<span :id="contentId" class="ui-action-card__content"><slot /></span>
	</button>
</template>

<style scoped>
	.ui-action-card {
		position: relative;
		display: block;
		width: 100%;
		height: 100%;
		padding: var(--ui-action-card-padding, 0);
		border: 0;
		border-radius: var(--ui-action-card-radius, inherit);
		background: var(--ui-action-card-background, transparent);
		color: var(--ui-action-card-text, var(--ui-text));
		font: inherit;
		text-align: start;
		overflow: hidden;
		cursor: pointer;
	}
	.ui-action-card:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: -4px;
	}
	.ui-action-card:disabled {
		cursor: default;
	}
	.ui-action-card__content {
		display: block;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}
</style>
