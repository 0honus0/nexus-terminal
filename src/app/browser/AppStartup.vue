<script setup lang="ts">
	import { LoaderCircle } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiLoadingTiles } from '../../ui/browser/ui-components-api.js';

	const { failed, motionEnabled } = defineProps<{ failed: boolean; motionEnabled: boolean }>();
	defineEmits<{ retry: [] }>();
	const { t } = useI18n({ useScope: 'global' });
</script>

<template>
	<div class="app-startup">
		<UiLoadingTiles class="app-startup__content" :active="motionEnabled && !failed">
			<template #caption>
				<div class="app-startup__caption">
					<span class="app-startup__brand" aria-hidden="true">NEXUS TERMINAL</span>
					<template v-if="failed">
						<p role="alert">{{ t('notices.APP_DESKTOP_LOAD_FAILED') }}</p>
						<UiButton tone="primary" @click="$emit('retry')">{{ t('startup.reload') }}</UiButton>
					</template>
					<p v-else role="status" :aria-label="t('startup.loading')">
						<LoaderCircle v-if="!motionEnabled" :size="16" aria-hidden="true" />
						{{ t('startup.loading') }}
					</p>
				</div>
			</template>
		</UiLoadingTiles>
	</div>
</template>

<style scoped>
	.app-startup {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: grid;
		place-items: center;
		padding: 24px;
		background:
			radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--ui-primary) 9%, transparent), transparent 58%),
			var(--ui-background);
		color: var(--ui-muted);
	}
	.app-startup__content {
		--ui-loading-caption-gap: 34px;
		transform: translateY(-3vh);
	}
	.app-startup__brand {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 2.4px;
	}
	.app-startup__caption p {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		margin: 10px 0 0;
		color: var(--ui-text);
		font-size: 14px;
		line-height: 1.7;
		font-weight: 450;
	}
	.app-startup__caption button {
		margin-top: 16px;
	}
</style>
