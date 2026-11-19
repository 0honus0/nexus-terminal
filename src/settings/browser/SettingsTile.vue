<script setup lang="ts">
	import { computed } from 'vue';
	import { Languages, Monitor, Moon, Sun } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import type { DesktopTileProps } from '../../desktop/browser/desktop-api.js';
	import { UiActionCard } from '../../ui/browser/ui-components-api.js';
	const props = defineProps<DesktopTileProps & { theme: 'system' | 'light' | 'dark' }>();
	const { t, locale } = useI18n({ useScope: 'global' });
	const settingsThemeIcons = { system: Monitor, light: Sun, dark: Moon };
	const showTheme = computed(() => props.size.rows > 1);
	const showLanguage = computed(() => props.size.columns > 1);
	const illustration = computed(() => (showTheme.value ? settingsThemeIcons[props.theme] : Languages));
</script>

<template>
	<UiActionCard class="settings-tile" :data-theme="theme" :label="t('settings')" @click="open">
		<span class="settings-tile__heading">{{ t('settings') }}</span>
		<component
			:is="illustration"
			class="settings-tile__theme-icon"
			:class="{ 'settings-tile__theme-icon--sun': showTheme && theme === 'light' }"
			:stroke-width="1.05"
			aria-hidden="true"
		/>
		<span class="settings-tile__summary">
			<span v-if="showTheme" class="settings-tile__detail settings-tile__detail--theme">
				<span>{{ t('desktop.appearance.title') }}</span>
				<strong>{{ t('desktop.appearance.' + theme) }}</strong>
			</span>
			<span v-if="showLanguage" class="settings-tile__detail settings-tile__detail--language">
				<span>{{ t('language') }}</span>
				<strong>{{ t(`localeNames.${locale}`) }}</strong>
			</span>
		</span>
	</UiActionCard>
</template>

<style scoped>
	.settings-tile {
		--_settings-ink: var(--ui-settings-tile-text, light-dark(#51442e, #344d68));
		--_settings-muted: var(--ui-settings-tile-muted, light-dark(#8a7651, #50657d));
		--_settings-art: var(--ui-settings-tile-art, light-dark(#e5be62, #86a7c9));
		background: var(--ui-settings-tile-background, light-dark(#f5e7c9, #d9e6f2));
		color: var(--_settings-ink);
	}
	.settings-tile__heading {
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
	.settings-tile__theme-icon {
		position: absolute;
		top: 2%;
		right: -10%;
		width: 70%;
		height: 68%;
		color: var(--_settings-art);
		pointer-events: none;
	}
	.settings-tile__theme-icon--sun :deep(circle) {
		fill: currentColor;
		stroke: none;
	}
	.settings-tile__summary {
		position: absolute;
		bottom: clamp(16px, 10cqb, 28px);
		left: clamp(12px, 9cqmin, 24px);
		display: grid;
		gap: 14px;
		max-width: 76%;
	}
	.settings-tile__detail {
		display: grid;
		gap: 5px;
		min-width: 0;
	}
	.settings-tile__detail > span {
		color: var(--_settings-muted);
		font-size: 11px;
		line-height: 1.3;
	}
	strong {
		font-size: clamp(20px, 17cqi, 44px);
		font-weight: 600;
		letter-spacing: -0.04em;
		line-height: 1.2;
		overflow-wrap: anywhere;
	}
	.settings-tile__detail--language strong {
		font-size: clamp(14px, 8cqi, 20px);
		font-weight: 500;
		letter-spacing: 0;
	}
	@container (max-height: 130px) {
		.settings-tile__summary {
			bottom: 12px;
			max-width: 65%;
		}
		.settings-tile__detail {
			gap: 3px;
		}
		.settings-tile__detail > span {
			font-size: 10px;
		}
		.settings-tile__detail--language strong {
			font-size: clamp(16px, 11cqi, 24px);
		}
		.settings-tile__theme-icon {
			top: -12%;
			right: -4%;
			width: 48%;
			height: 114%;
		}
	}
	@container (max-width: 109px) and (min-height: 131px) {
		.settings-tile__theme-icon {
			top: 18%;
			right: -24%;
			width: 98%;
			height: 46%;
		}
		.settings-tile__summary {
			bottom: 18px;
			gap: 5px;
		}
		strong {
			font-size: 20px;
		}
	}
	.settings-tile[data-theme='system'] {
		--_settings-ink: var(--ui-settings-system-text, var(--ui-settings-tile-text, light-dark(#514361, #e9e1f2)));
		--_settings-muted: var(--ui-settings-system-muted, var(--ui-settings-tile-muted, light-dark(#71617f, #b7aac5)));
		--_settings-art: var(--ui-settings-system-art, var(--ui-settings-tile-art, light-dark(#a08bb8, #a891c6)));
		background: var(
			--ui-settings-system-background,
			var(--ui-settings-tile-background, light-dark(#e9e3f1, #302b3b))
		);
	}
</style>
