<script setup lang="ts">
	import type { UiCardProps } from '../ui-component-types.js';
	import { vSelectableAction } from '../ui-selection.js';
	withDefaults(defineProps<UiCardProps>(), { tone: 'primary' });
	defineEmits<{ select: [] }>();
</script>

<template>
	<article class="ui-card" data-ui="card" :data-tone="tone">
		<button
			v-selectable-action
			type="button"
			class="ui-card__main"
			:disabled="disabled"
			:aria-label="actionLabel"
			@click="$emit('select')"
		>
			<span v-if="icon || $slots.icon" class="ui-card__icon"
				><slot name="icon"><component :is="icon" :size="23" /></slot
			></span>
			<span class="ui-card__body" data-ui-selection="text">
				<strong :title="title">{{ title }}</strong>
				<span v-if="description" class="ui-card__description" :title="description">{{ description }}</span>
				<span v-if="$slots.tags" class="ui-card__tags"><slot name="tags" /></span>
			</span>
		</button>
		<div v-if="$slots.aside || $slots.badge || $slots.actions" class="ui-card__side">
			<slot name="aside">
				<div v-if="$slots.badge" class="ui-card__badge"><slot name="badge" /></div>
				<div v-if="$slots.actions" class="ui-card__actions"><slot name="actions" /></div>
			</slot>
		</div>
		<div v-if="$slots.footer" class="ui-card__footer"><slot name="footer" /></div>
	</article>
</template>

<style scoped>
	.ui-card {
		--_card-accent: var(--ui-primary);
		position: relative;
		min-width: 0;
		display: flex;
		gap: 8px;
		border: 1px solid var(--ui-card-border, var(--ui-border));
		border-radius: var(--ui-card-radius, 16px);
		background: var(--ui-card-background, var(--ui-surface));
		color: var(--ui-text);
		transition: border-color var(--ui-motion-duration, 140ms);
	}
	.ui-card[data-tone='success'] {
		--_card-accent: var(--ui-success, #469885);
	}
	.ui-card:has(> .ui-card__footer) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		row-gap: 0;
	}
	.ui-card:has(> .ui-card__footer):not(:has(> .ui-card__side)) > .ui-card__main {
		grid-column: 1 / -1;
	}
	.ui-card__footer {
		grid-column: 1 / -1;
		min-width: 0;
		padding: var(--ui-card-footer-padding, 0 14px 12px);
	}
	.ui-card[data-tone='warning'] {
		--_card-accent: var(--ui-warning, #bf8b39);
	}
	.ui-card[data-tone='danger'] {
		--_card-accent: var(--ui-danger, #ca5468);
	}
	.ui-card[data-tone='neutral'] {
		--_card-accent: var(--ui-muted);
	}
	.ui-card:has(.ui-card__main:not(:disabled)):hover {
		border-color: color-mix(in srgb, var(--_card-accent) 45%, var(--ui-border));
	}
	/* 主操作聚焦时标识整张卡片；独立操作按钮保留自己的焦点范围。 */
	.ui-card:has(> .ui-card__main:focus-visible) {
		outline: 2px solid var(--ui-primary);
		outline-offset: -3px;
	}
	.ui-card__main {
		all: unset;
		-webkit-tap-highlight-color: transparent;
		box-sizing: border-box;
		display: flex;
		flex: 1;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: var(--ui-card-padding, 14px 16px);
		border-radius: inherit;
		cursor: pointer;
	}
	.ui-card__main:focus-visible {
		outline: none;
	}
	.ui-card__main:disabled {
		cursor: default;
		opacity: var(--ui-disabled-opacity, 0.55);
	}
	.ui-card__icon {
		display: grid;
		place-items: center;
		align-self: center;
		flex: none;
		width: 46px;
		height: 46px;
		border-radius: 14px;
		color: var(--_card-accent);
		background: color-mix(in srgb, var(--_card-accent) 10%, transparent);
	}
	.ui-card__body {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 4px;
	}
	.ui-card__body strong {
		font-size: 14px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ui-card__description {
		font-size: 12px;
		color: var(--ui-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ui-card__tags {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 1px;
	}
	.ui-card__side {
		display: flex;
		flex: none;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		gap: var(--ui-card-actions-gap, 4px);
		padding: 12px 12px 12px 0;
	}
	.ui-card__actions {
		display: flex;
	}
	.ui-card__actions:only-child {
		margin-top: auto;
	}
	@container (max-width:400px) {
		.ui-card__main {
			padding: var(--ui-card-padding, 12px 8px 12px 12px);
			gap: 10px;
		}
		.ui-card__icon {
			width: 35px;
			height: 35px;
			border-radius: 10px;
		}
		.ui-card__side {
			padding: 10px 6px 10px 0;
		}
		.ui-card__body strong {
			font-size: 13px;
		}
	}
</style>
