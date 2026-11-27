<script setup lang="ts">
	import { computed } from 'vue';
	import { Store } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import type { DesktopTileProps } from '../../desktop/browser/desktop-api.js';
	import { UiActionCard } from '../../ui/browser/ui-components-api.js';
	const props = defineProps<DesktopTileProps & { count?: number; loading: boolean }>();
	const { t, n } = useI18n({ useScope: 'global' });
	const empty = computed(() => props.count === 0);
</script>

<template>
	<UiActionCard
		class="marketplace-tile"
		:class="{ 'marketplace-tile--notice': empty }"
		:label="t('market')"
		:aria-busy="loading"
		@click="open"
	>
		<span class="marketplace-tile__heading">
			<span class="marketplace-tile__title">{{ t('market') }}</span>
			<span class="marketplace-tile__short-title">{{ t('marketplaceTile.shortTitle') }}</span>
		</span>
		<Store class="marketplace-tile__art" :stroke-width="1.05" aria-hidden="true" />
		<span class="marketplace-tile__summary">
			<span class="marketplace-tile__primary">
				<strong :style="{ '--count-characters': n(count ?? 0).length }">{{
					count === undefined ? '—' : n(count)
				}}</strong>
				<span>{{ t('desktop.installed') }}</span>
			</span>
			<span v-if="empty" class="marketplace-tile__notice">{{ t('marketplaceTile.empty') }}</span>
		</span>
	</UiActionCard>
</template>

<style scoped>
	.marketplace-tile {
		--_marketplace-ink: var(--ui-marketplace-tile-text, light-dark(#634658, #e6dcee));
		--_marketplace-muted: var(--ui-marketplace-tile-muted, light-dark(#7c5c6e, #b8a9c3));
		--_marketplace-art: var(--ui-marketplace-tile-art, light-dark(#c19aaa, #9f82b2));
		background: var(--ui-marketplace-tile-background, light-dark(#f0dfe6, #352b3e));
		color: var(--_marketplace-ink);
	}
	.marketplace-tile__heading {
		position: absolute;
		z-index: 1;
		top: clamp(12px, 9cqmin, 24px);
		left: clamp(12px, 9cqmin, 24px);
		max-width: calc(100% - 24px);
		font-size: clamp(12px, 7cqi, 15px);
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.marketplace-tile__art {
		position: absolute;
		top: 2%;
		right: -8%;
		width: 64%;
		height: 56%;
		color: var(--_marketplace-art);
		pointer-events: none;
	}
	.marketplace-tile__short-title {
		display: none;
	}
	.marketplace-tile__summary {
		position: absolute;
		bottom: clamp(16px, 10cqb, 28px);
		left: clamp(12px, 9cqmin, 24px);
		right: clamp(12px, 9cqmin, 24px);
		display: grid;
		gap: 10px;
		min-width: 0;
	}
	.marketplace-tile__primary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px 8px;
		min-width: 0;
	}
	.marketplace-tile__primary > span {
		color: var(--_marketplace-muted);
		font-size: 12px;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	strong {
		min-width: 0;
		max-width: 100%;
		font-size: clamp(20px, min(28cqmin, calc(110cqi / max(2, var(--count-characters)))), 56px);
		font-weight: 550;
		letter-spacing: -0.04em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.marketplace-tile__composition {
		display: flex;
		flex-wrap: wrap;
		gap: 5px 14px;
		color: var(--_marketplace-muted);
		font-size: 12px;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.marketplace-tile__notice {
		color: var(--_marketplace-muted);
		font-size: 11px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.marketplace-tile__notice--attention {
		color: var(--_marketplace-ink);
		font-weight: 550;
	}
	@container (max-height: 130px) {
		.marketplace-tile__summary {
			bottom: 11px;
			grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
			align-items: center;
			gap: 10px;
		}
		.marketplace-tile__primary {
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
		}
		.marketplace-tile__composition {
			display: grid;
			gap: 3px;
		}
		.marketplace-tile--notice .marketplace-tile__composition {
			display: none;
		}
		.marketplace-tile__primary > span,
		.marketplace-tile__composition,
		.marketplace-tile__notice {
			font-size: 10px;
		}
		.marketplace-tile__art {
			top: -12%;
			right: -8%;
			width: 46%;
			height: 100%;
		}
		strong {
			font-size: clamp(14px, min(24cqmin, calc(40cqi / max(2, var(--count-characters)))), 28px);
		}
	}
	@container (max-width: 150px) and (max-height: 130px) {
		.marketplace-tile :deep(.ui-action-card__content) {
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			gap: 4px;
			padding: 8px;
		}
		.marketplace-tile__heading,
		.marketplace-tile__summary {
			position: relative;
			inset: auto;
			max-width: 100%;
		}
		.marketplace-tile__heading {
			overflow: hidden;
			font-size: clamp(10px, 11cqi, 12px);
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.marketplace-tile__title {
			display: none;
		}
		.marketplace-tile__short-title {
			display: inline;
		}
		.marketplace-tile__summary {
			grid-template-columns: minmax(0, 1fr);
			gap: 2px;
		}
		.marketplace-tile__primary > span {
			font-size: clamp(9px, 10cqi, 10px);
		}
		.marketplace-tile__notice {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		strong {
			font-size: clamp(14px, min(24cqmin, calc(110cqi / max(2, var(--count-characters)))), 28px);
		}
	}
	@container (max-width: 109px) and (min-height: 131px) {
		.marketplace-tile__heading {
			left: 10px;
			max-width: calc(100% - 20px);
			font-size: 11px;
		}
		.marketplace-tile__title {
			display: none;
		}
		.marketplace-tile__short-title {
			display: inline;
		}
		.marketplace-tile__summary {
			left: 10px;
			right: 10px;
			gap: 8px;
		}
		.marketplace-tile--notice .marketplace-tile__composition {
			display: none;
		}
		.marketplace-tile__primary {
			flex-direction: column;
			align-items: flex-start;
			gap: 5px;
		}
		.marketplace-tile__art {
			top: 17%;
			right: -24%;
			width: 98%;
			height: 40%;
		}
		strong {
			font-size: clamp(14px, calc(110cqi / max(2, var(--count-characters))), 36px);
		}
		.marketplace-tile__composition,
		.marketplace-tile__primary > span {
			font-size: 10px;
		}
	}
</style>
