<script setup lang="ts">
	import { useI18n } from 'vue-i18n';

	defineOptions({ inheritAttrs: false });
	const { t } = useI18n();
</script>

<template>
	<div class="history-chart-loading" role="status" aria-busy="true">
		<span>{{ t('common.loading') }}</span>
	</div>
</template>

<style scoped>
	.history-chart-loading {
		position: relative;
		display: grid;
		flex: 1 1 0;
		place-items: center;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: calc(10px / var(--status-scale, 1));
		line-height: 1.4;
	}

	.history-chart-loading::before {
		position: absolute;
		inset: 0 4px 14px 2px;
		background: linear-gradient(to bottom, var(--border-color) 1px, transparent 1px) 0 0 / 100% 25%;
		content: '';
		pointer-events: none;
		animation: status-chart-loading-pulse 1.8s ease-in-out infinite;
	}

	.history-chart-loading > span {
		position: relative;
		padding: 2px 6px;
		border-radius: 4px;
		background: var(--app-bg-color);
	}

	@keyframes status-chart-loading-pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 0.45;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.history-chart-loading::before {
			opacity: 0.3;
			animation: none;
		}
	}
</style>
