<script setup lang="ts">
	import { computed } from 'vue';

	const props = withDefaults(
		defineProps<{
			tone?: 'info' | 'success' | 'warning' | 'danger';
			icon?: string;
			role?: 'alert' | 'status';
			compact?: boolean;
		}>(),
		{
			tone: 'info',
			icon: undefined,
			role: undefined,
			compact: false,
		},
	);

	const resolvedIcon = computed(() => {
		if (props.icon) return props.icon;
		if (props.tone === 'success') return 'fa-solid fa-circle-check';
		if (props.tone === 'warning' || props.tone === 'danger') return 'fa-solid fa-triangle-exclamation';
		return 'fa-solid fa-circle-info';
	});
</script>

<template>
	<div
		data-ui="inline-notice"
		data-ui-gen="2"
		:role="props.role || (props.tone === 'danger' || props.tone === 'warning' ? 'alert' : 'status')"
		class="ui-inline-notice"
		:data-tone="props.tone"
		:data-compact="props.compact || undefined"
	>
		<i class="ui-inline-notice__icon" :class="resolvedIcon" aria-hidden="true"></i>
		<div class="ui-inline-notice__body"><slot /></div>
		<div v-if="$slots.actions" class="ui-inline-notice__actions"><slot name="actions" /></div>
	</div>
</template>

<style scoped>
	.ui-inline-notice {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 9px;
		padding: 10px 12px;
		border-radius: 11px;
		background: color-mix(in srgb, var(--link-active-color) 8%, transparent);
		color: color-mix(in srgb, var(--link-active-color) 76%, var(--text-color));
		font-size: 12px;
		line-height: 1.55;
	}

	.ui-inline-notice[data-tone='success'] {
		background: color-mix(in srgb, var(--status-success-color) 9%, transparent);
		color: var(--status-success-color);
	}

	.ui-inline-notice[data-tone='warning'] {
		background: color-mix(in srgb, var(--status-warning-color) 10%, transparent);
		color: var(--status-warning-color);
	}

	.ui-inline-notice[data-tone='danger'] {
		background: color-mix(in srgb, var(--status-error-color) 9%, transparent);
		color: var(--status-error-color);
	}

	.ui-inline-notice[data-compact] {
		gap: 7px;
		padding: 7px 9px;
		border-radius: 9px;
		font-size: 11px;
	}

	.ui-inline-notice__icon {
		flex: 0 0 auto;
		margin-top: 0.16em;
		font-size: 10px;
	}

	.ui-inline-notice__body {
		min-width: 0;
		flex: 1;
		overflow-wrap: anywhere;
	}

	.ui-inline-notice__actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}

	@media (max-width: 480px) {
		.ui-inline-notice {
			flex-wrap: wrap;
		}

		.ui-inline-notice__actions {
			width: 100%;
			justify-content: flex-end;
			padding-left: 19px;
		}
	}
</style>
