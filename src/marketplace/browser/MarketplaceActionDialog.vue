<script setup lang="ts">
	import { Package, TriangleAlert } from '@lucide/vue';
	import { useId, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiDialog } from '../../ui/browser/ui-components-api.js';

	defineProps<{
		title: string;
		name: string;
		pluginId: string;
		version?: string;
		icon?: Component;
		notice: string;
		tone: 'warning' | 'danger';
		closeDisabled?: boolean;
	}>();
	const open = defineModel<boolean>('open', { required: true });
	const { t } = useI18n({ useScope: 'global' });
	const noticeId = useId();
</script>

<template>
	<UiDialog
		v-model:open="open"
		class="marketplace-action-dialog"
		:title="title"
		:close-label="t('closeApplication')"
		:close-disabled="closeDisabled"
		:aria-describedby="noticeId"
		:resizable="false"
		size="sm"
	>
		<div class="marketplace-action-body">
			<div class="marketplace-action-target">
				<div class="marketplace-action-target__icon" aria-hidden="true">
					<component :is="icon ?? Package" :size="18" />
				</div>
				<strong class="marketplace-action-target__name" data-ui-selection="text">{{ name }}</strong>
				<span v-if="version" class="marketplace-action-target__version" data-ui-selection="text"
					>v{{ version }}</span
				>
				<span v-if="name !== pluginId" class="marketplace-action-target__package" data-ui-selection="text">
					{{ pluginId }}
				</span>
			</div>
			<div class="marketplace-action-notice" :data-tone="tone">
				<TriangleAlert :size="16" aria-hidden="true" />
				<p :id="noticeId">{{ notice }}</p>
			</div>
			<slot />
		</div>
		<template #footer><slot name="footer" /></template>
	</UiDialog>
</template>

<style scoped>
	:global(.marketplace-action-dialog) {
		--ui-dialog-width: 420px;
		--ui-dialog-radius: 14px;
		--ui-dialog-padding: 18px;
		--ui-dialog-action-height: 36px;
		--ui-dialog-footer-gap: 8px;
	}

	:global(.marketplace-action-dialog .ui-dialog__header) {
		align-items: center;
		padding-block: 12px;
	}

	:global(.marketplace-action-dialog .ui-dialog__body) {
		padding-block-end: 16px;
	}

	:global(.marketplace-action-dialog .ui-dialog__footer) {
		justify-content: flex-end;
		padding-block: 12px;
		border-block-start: 1px solid var(--ui-border);
		background: color-mix(in srgb, var(--ui-text) 2%, var(--ui-surface));
	}

	:global(.marketplace-action-dialog .ui-dialog__footer > [data-ui='button']) {
		--ui-button-radius: 6px;
		flex: 0 1 auto;
	}

	.marketplace-action-body {
		display: grid;
		gap: 12px;
	}

	.marketplace-action-target {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 3px 8px;
		min-width: 0;
		padding: 10px;
		border: 1px solid var(--ui-border);
		border-radius: 8px;
	}

	.marketplace-action-target__icon {
		display: grid;
		grid-column: 1;
		grid-row: 1 / span 2;
		width: 34px;
		height: 34px;
		place-items: center;
		border-radius: 5px;
		background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
		color: var(--ui-primary);
	}

	.marketplace-action-target__name {
		grid-column: 2;
		grid-row: 1;
		min-width: 0;
		font-size: 14px;
		font-weight: 650;
		overflow-wrap: anywhere;
	}

	.marketplace-action-target__package,
	.marketplace-action-target__version {
		color: var(--ui-muted);
		font-size: 11px;
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	.marketplace-action-target__package {
		grid-column: 2 / -1;
		grid-row: 2;
		min-width: 0;
	}

	.marketplace-action-target__version {
		grid-column: 3;
		grid-row: 1;
		max-width: clamp(68px, 22vw, 108px);
		padding: 2px 5px;
		border: 1px solid var(--ui-border);
		border-radius: 4px;
		font-variant-numeric: tabular-nums;
	}

	.marketplace-action-notice {
		--_notice-tone: var(--ui-warning);
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 9px 10px;
		border: 1px solid color-mix(in srgb, var(--_notice-tone) 28%, var(--ui-border));
		border-radius: 7px;
		background: color-mix(in srgb, var(--_notice-tone) 9%, var(--ui-surface));
	}

	.marketplace-action-notice[data-tone='danger'] {
		--_notice-tone: var(--ui-danger);
	}

	.marketplace-action-notice svg {
		flex: none;
		margin-block-start: 2px;
		color: var(--_notice-tone);
	}

	.marketplace-action-notice p {
		margin: 0;
		color: var(--ui-text);
		font-size: 12px;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
</style>
