<script setup lang="ts">
	import { AppWindow, ArrowUp, Package, Puzzle } from '@lucide/vue';
	import { computed, type Component } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, vSelectableAction } from '../../ui/browser/ui-components-api.js';
	import type { MarketplacePlugin } from '../marketplace-types.js';
	import { marketplaceStatusTones, type MarketplaceInstalledStatus } from './marketplace-presentation.js';

	const props = defineProps<{
		name: string;
		description?: string;
		accent?: string;
		kind: MarketplacePlugin['kind'];
		status: MarketplaceInstalledStatus;
		icon?: Component;
		version: string;
		openable?: boolean;
		updateVersion?: string;
		updateDisabled?: boolean;
	}>();
	defineEmits<{ manage: []; open: []; update: [] }>();
	const { t } = useI18n({ useScope: 'global' });
	const icon = computed(
		() => props.icon ?? (props.kind === 'application' ? AppWindow : props.kind === 'extension' ? Puzzle : Package),
	);
</script>

<template>
	<li class="installed-card-item">
		<article
			class="installed-card"
			:data-kind="kind ?? 'unknown'"
			:data-status="status"
			:style="accent ? { '--_accent': accent } : undefined"
		>
			<button
				v-selectable-action
				type="button"
				class="ui-card__main installed-card__main"
				:aria-label="t('marketplace.manageBuiltin', { name })"
				@click="$emit('manage')"
			>
				<span class="installed-card__heading">
					<span class="installed-card__icon" aria-hidden="true"><component :is="icon" :size="17" /></span>
					<strong class="installed-card__name" :title="name" data-ui-selection="text">{{ name }}</strong>
					<UiBadge class="installed-card__status" :tone="marketplaceStatusTones[status]" role="status" dot>{{
						t('marketplace.status.' + status)
					}}</UiBadge>
				</span>
				<span
					v-if="description"
					class="installed-card__description"
					:title="description"
					data-ui-selection="text"
					>{{ description }}</span
				>
			</button>
			<div class="installed-card__footer">
				<span class="installed-card__version" :title="version" data-ui-selection="text">v{{ version }}</span>
				<div v-if="openable || updateVersion" class="installed-card__actions">
					<UiButton
						v-if="updateVersion"
						density="compact"
						:disabled="updateDisabled"
						:aria-label="t('marketplace.updateNamed', { name, version: updateVersion })"
						:title="t('marketplace.updateVersion', { version: updateVersion })"
						@click="$emit('update')"
					>
						<template #leading><ArrowUp :size="12" /></template>
						{{ t('marketplace.confirmUpdate') }}
					</UiButton>
					<UiButton
						v-if="openable"
						density="compact"
						:tone="status === 'configuration' ? 'primary' : 'neutral'"
						:aria-label="
							t(
								status === 'configuration'
									? 'marketplace.configureNamedApplication'
									: 'marketplace.openNamedApplication',
								{ name },
							)
						"
						@click="$emit('open')"
					>
						{{ t(status === 'configuration' ? 'marketplace.configureApplication' : 'marketplace.open') }}
					</UiButton>
				</div>
			</div>
		</article>
	</li>
</template>

<style scoped>
	.installed-card-item {
		display: grid;
		min-width: 0;
	}
	.installed-card {
		--_accent: var(--ui-primary);
		--_inner-radius: calc(var(--marketplace-card-radius) - 1px);
		display: grid;
		grid-template-rows: 1fr auto;
		min-width: 0;
		border: 1px solid var(--ui-border);
		border-radius: var(--marketplace-card-radius);
		background: var(--ui-surface);
	}
	.installed-card[data-kind='extension'] {
		--_accent: var(--ui-success);
	}
	.installed-card:has(> .installed-card__main:hover) {
		border-color: color-mix(in srgb, var(--_accent) 45%, var(--ui-border));
	}
	.installed-card__main {
		appearance: none;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 7px;
		min-width: 0;
		padding: 10px 11px;
		border: 0;
		border-radius: var(--_inner-radius) var(--_inner-radius) 0 0;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.installed-card__main:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: -2px;
	}
	.installed-card__heading {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.installed-card__icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 5px;
		background: color-mix(in srgb, var(--_accent) 11%, transparent);
		color: var(--_accent);
	}
	.installed-card__name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: 13px;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.installed-card__status {
		box-sizing: border-box;
		flex: 0 1 auto;
		max-inline-size: 45%;
		padding: 2px 6px;
		border-radius: 4px;
		line-height: 1.25;
		overflow-wrap: anywhere;
		white-space: normal;
	}
	.installed-card__description {
		display: -webkit-box;
		overflow: hidden;
		color: var(--ui-muted);
		font-size: 12px;
		line-height: 1.4;
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}
	.installed-card__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-width: 0;
		min-height: 42px;
		padding: 6px 11px;
		border-block-start: 1px solid var(--ui-border);
		border-radius: 0 0 var(--_inner-radius) var(--_inner-radius);
		background: color-mix(in srgb, var(--ui-text) 2%, transparent);
	}
	.installed-card__version {
		display: block;
		min-width: 0;
		max-width: 100%;
		padding: 2px 4px;
		overflow: hidden;
		border: 1px solid var(--ui-border);
		border-radius: 4px;
		color: var(--ui-muted);
		font-size: 12px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.installed-card__actions {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		flex: none;
		align-items: center;
		gap: 4px;
	}
	.installed-card__actions :deep(.ui-button) {
		--ui-button-radius: 5px;
		--ui-button-padding-inline: 7px;
		--ui-button-gap: 4px;
		--ui-button-height: 28px;
		--ui-button-font-size: 11px;
	}
</style>
