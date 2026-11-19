<script setup lang="ts">
	import type { UiListItemProps } from '../ui-component-types.js';
	defineProps<UiListItemProps>();
</script>
<template>
	<li class="ui-list-item" data-ui="list-item">
		<span v-if="icon || $slots.icon" class="ui-list-item__icon">
			<slot name="icon"><component :is="icon" :size="20" /></slot>
		</span>
		<div class="ui-list-item__body" data-ui-selection="text">
			<div class="ui-list-item__heading">
				<strong :title="title">{{ title }}</strong><slot name="badge" />
			</div>
			<div v-if="description || $slots.description" class="ui-list-item__description" :title="description">
				<slot name="description">{{ description }}</slot>
			</div>
		</div>
		<div v-if="$slots.actions" class="ui-list-item__actions"><slot name="actions" /></div>
	</li>
</template>
<style scoped>
	.ui-list-item {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: var(--ui-list-item-padding, 14px 16px);
		color: var(--ui-text);
	}
	.ui-list-item + .ui-list-item {
		border-top: 1px solid var(--ui-list-border, var(--ui-border));
	}
	.ui-list-item__icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 28px;
		color: var(--ui-primary);
	}
	.ui-list-item__body {
		flex: 1;
		min-width: 0;
	}
	.ui-list-item__heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.ui-list-item__heading strong {
		min-width: 0;
		font-size: 13px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.ui-list-item__description {
		margin-top: 5px;
		color: var(--ui-muted);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ui-list-item__actions {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		max-width: 55%;
	}
	@container (max-width: 360px) {
		.ui-list-item {
			padding: var(--ui-list-item-padding, 12px);
			gap: 8px;
		}
		.ui-list-item__icon {
			width: 22px;
		}
	}
</style>
