<script setup lang="ts">
	import { AppWindow, Package, Puzzle } from '@lucide/vue';
	import { computed, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiCard } from '../../ui/browser/ui-components-api.js';
	import type { MarketplacePlugin } from '../marketplace-types.js';
	import { marketplaceStatusTones, type MarketplaceInstalledStatus } from './marketplace-presentation.js';

	const props = defineProps<{
		name: string;
		kind: MarketplacePlugin['kind'];
		status: MarketplaceInstalledStatus;
		icon?: Component;
		builtin?: boolean;
		version: string;
		openable?: boolean;
	}>();
	defineEmits<{ manage: []; open: [] }>();
	const { t } = useI18n({ useScope: 'global' });
	const icon = computed(
		() => props.icon ?? (props.kind === 'application' ? AppWindow : props.kind === 'extension' ? Puzzle : Package),
	);
</script>

<template>
	<UiCard
		class="marketplace-installed-card"
		:title="name"
		:description="version"
		:icon="icon"
		:action-label="t('marketplace.manageBuiltin', { name })"
		@select="$emit('manage')"
	>
		<template v-if="builtin" #tags>
			<span class="marketplace-installed-card__builtin">{{ t('marketplace.builtin') }}</span>
		</template>
		<template #aside>
			<div class="marketplace-installed-card__controls">
				<UiBadge :tone="marketplaceStatusTones[status]" role="status" dot>{{
					t('marketplace.status.' + status)
				}}</UiBadge>
				<UiButton
					v-if="openable"
					density="compact"
					:aria-label="t('marketplace.openNamedApplication', { name })"
					@click="$emit('open')"
				>
					{{ t('marketplace.open') }}
				</UiButton>
			</div>
		</template>
	</UiCard>
</template>

<style scoped>
	.marketplace-installed-card :deep(.ui-card__side) {
		justify-content: flex-start;
	}
	.marketplace-installed-card__controls {
		display: grid;
		grid-template-columns: minmax(66px, max-content);
		gap: 6px;
	}
	.marketplace-installed-card__controls > [data-ui='badge'],
	.marketplace-installed-card__controls > [data-ui='button'] {
		width: 100%;
		justify-content: center;
	}
	.marketplace-installed-card__builtin {
		color: var(--ui-muted);
		font-size: 12px;
	}
</style>
