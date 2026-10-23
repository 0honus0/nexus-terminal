<script setup lang="ts">
	withDefaults(
		defineProps<{
			tone?: 'neutral' | 'danger';
			disabled?: boolean;
		}>(),
		{
			tone: 'neutral',
			disabled: false,
		},
	);
</script>

<template>
	<button
		data-ui="context-menu-item"
		data-ui-gen="2"
		:data-tone="tone"
		type="button"
		role="menuitem"
		:disabled="disabled"
		class="ui-context-menu-item"
	>
		<slot />
	</button>
</template>

<style scoped>
	.ui-context-menu-item {
		display: flex;
		width: calc(100% - 8px);
		min-width: 0;
		align-items: center;
		gap: 9px;
		margin-inline: 4px;
		padding: 7px 10px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--ui-text);
		cursor: pointer;
		font: inherit;
		font-size: 12px;
		line-height: 1.4;
		text-align: left;
		transition:
			background-color 140ms ease,
			color 140ms ease;
	}

	.ui-context-menu-item:not(:disabled):hover,
	.ui-context-menu-item:not(:disabled):focus-visible {
		outline: 0;
		background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		color: var(--link-active-color);
	}

	.ui-context-menu-item[data-tone='danger'] {
		color: var(--status-error-color);
	}

	.ui-context-menu-item[data-tone='danger']:not(:disabled):hover,
	.ui-context-menu-item[data-tone='danger']:not(:disabled):focus-visible {
		background: color-mix(in srgb, var(--status-error-color) 10%, transparent);
		color: var(--status-error-color);
	}

	.ui-context-menu-item:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.ui-context-menu-item :slotted(i) {
		width: 14px;
		flex: 0 0 14px;
		text-align: center;
	}

	.ui-context-menu-item :slotted(span) {
		min-width: 0;
	}
</style>
