<script setup lang="ts">
	import { computed } from 'vue';
	import { Archive, ArrowDownToLine, RotateCcw } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import type { DesktopTileProps } from '../../desktop/browser/desktop-api.js';
	import { UiActionCard } from '../../ui/browser/ui-components-api.js';

	const props = defineProps<DesktopTileProps>();
	const { t } = useI18n({ useScope: 'global' });
	const expanded = computed(() => props.size.columns > 1 && props.size.rows > 1);
	const wide = computed(() => props.size.columns > props.size.rows);
</script>

<template>
	<UiActionCard
		class="backup-tile"
		:data-wide="wide"
		:data-expanded="expanded"
		:label="t('backup.title')"
		@click="open"
	>
		<span class="backup-tile__heading">{{ t('backup.tile.title') }}</span>
		<span class="backup-tile__art" aria-hidden="true">
			<span class="backup-tile__orbit" />
			<component :is="wide ? RotateCcw : Archive" :stroke-width="1.1" />
		</span>
		<span class="backup-tile__summary">
			<strong>{{ t(wide ? 'backup.tile.restore' : 'backup.tile.save') }}</strong>
			<span class="backup-tile__caption">{{ t(wide ? 'backup.tile.restoreHint' : 'backup.tile.saveHint') }}</span>
			<span v-if="expanded" class="backup-tile__features">
				<span><ArrowDownToLine :size="14" aria-hidden="true" />{{ t('backup.tile.export') }}</span>
				<span><RotateCcw :size="14" aria-hidden="true" />{{ t('backup.tile.import') }}</span>
			</span>
		</span>
	</UiActionCard>
</template>

<style scoped>
	.backup-tile {
		--_ink: var(--ui-backup-tile-text, light-dark(#354f76, #e1eafa));
		--_muted: var(--ui-backup-tile-muted, light-dark(#647b9c, #a4b6d0));
		--_art: var(--ui-backup-tile-art, light-dark(#91add3, #6989b6));
		background: var(--ui-backup-tile-background, light-dark(#e2ebf8, #253449));
		color: var(--_ink);
	}
	.backup-tile__heading {
		position: absolute;
		top: clamp(12px, 9cqmin, 24px);
		left: clamp(12px, 9cqmin, 24px);
		z-index: 1;
		font-size: clamp(11px, 7cqi, 15px);
		font-weight: 600;
	}
	.backup-tile__art {
		position: absolute;
		right: -8%;
		top: 13%;
		width: 70%;
		aspect-ratio: 1;
		color: var(--_art);
		transform: rotate(-12deg);
		pointer-events: none;
	}
	.backup-tile__art > svg {
		position: absolute;
		inset: 20%;
		width: 60%;
		height: 60%;
	}
	.backup-tile__orbit {
		position: absolute;
		inset: 0;
		border: 1px solid color-mix(in srgb, var(--_art) 36%, transparent);
		border-radius: 50%;
		box-shadow: 0 0 0 12px color-mix(in srgb, var(--_art) 7%, transparent);
	}
	.backup-tile__summary {
		position: absolute;
		inset-inline: clamp(12px, 9cqmin, 24px);
		bottom: clamp(14px, 9cqb, 24px);
		display: grid;
		gap: 6px;
	}
	.backup-tile strong {
		font-size: clamp(18px, 12cqi, 30px);
		font-weight: 550;
		line-height: 1.25;
		letter-spacing: -0.035em;
	}
	.backup-tile__caption {
		color: var(--_muted);
		font-size: clamp(10px, 5cqi, 12px);
		line-height: 1.4;
	}
	.backup-tile__features {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
	}
	.backup-tile__features > span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 9px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--_art) 13%, transparent);
		font-size: 11px;
	}
	.backup-tile[data-wide='true'] .backup-tile__art {
		width: 43%;
		top: -9%;
		right: -1%;
	}
	.backup-tile[data-wide='true'] .backup-tile__summary {
		right: 38%;
		bottom: 12px;
		gap: 3px;
	}
	.backup-tile[data-wide='true'] strong {
		font-size: clamp(16px, 9cqi, 24px);
	}
	.backup-tile[data-expanded='true'] .backup-tile__art {
		width: 59%;
		top: 5%;
	}
	@container (max-width: 109px) {
		.backup-tile__heading {
			left: 10px;
			font-size: 11px;
		}
		.backup-tile__summary {
			inset-inline: 10px;
			gap: 5px;
		}
		.backup-tile__art {
			top: 20%;
			width: 95%;
			right: -20%;
		}
		.backup-tile strong {
			font-size: 18px;
		}
	}
</style>
