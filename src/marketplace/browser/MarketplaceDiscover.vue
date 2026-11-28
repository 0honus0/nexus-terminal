<script setup lang="ts">
	import { computed } from 'vue';
	import { AppWindow, Puzzle, Boxes, PackageOpen } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import { resolvePluginIcon } from '../../plugin/plugin-api.browser.js';
	import { UiEmptyState, UiLoadingTiles, vSelectableAction } from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceCatalogPlugin } from '../marketplace-catalog-types.js';
	import type { MarketplacePlugin } from '../marketplace-types.js';
	import { marketplaceDescription, marketplacePackageName } from './marketplace-presentation.js';
	const props = defineProps<{
		plugins: readonly MarketplaceCatalogPlugin[];
		installed?: readonly MarketplacePlugin[];
		query: string;
		refreshing: boolean;
		failed: boolean;
	}>();
	const emit = defineEmits<{ inspect: [pluginId: string] }>();
	const { t, n, locale } = useI18n({ useScope: 'global' });
	const loadingIcons = [AppWindow, PackageOpen, Boxes, Puzzle];
	const installedIds = computed(() => new Set(props.installed?.map(({ pluginId }) => pluginId)));
	const searchQuery = computed(() => props.query.trim().toLowerCase());
	const groups = computed(() =>
		(['application', 'extension'] as const)
			.map((kind) => ({
				kind,
				plugins: props.plugins.flatMap((plugin) => {
					const pack = plugin.versions[0]?.package;
					if (pack?.nexus.kind !== kind || installedIds.value.has(plugin.id)) return [];

					const name = marketplacePackageName(pack, locale.value);
					const search = [
						plugin.id,
						name,
						pack.displayName,
						pack.description,
						...Object.values(pack.nexus.i18n ?? {}).flatMap(({ description, displayName }) => [
							description,
							displayName,
						]),
					]
						.join(' ')
						.toLowerCase();
					return search.includes(searchQuery.value)
						? [{ plugin, pack, name, icon: resolvePluginIcon(pack.nexus.icon) }]
						: [];
				}),
			}))
			.filter(
				({ kind, plugins }) =>
					kind === 'application' || (!props.refreshing && !searchQuery.value) || plugins.length,
			),
	);
	const noMatches = computed(() => !!searchQuery.value && groups.value.every(({ plugins }) => !plugins.length));
</script>

<template>
	<div class="market-discover">
		<div class="market-hero">
			<div>
				<h1>{{ t('marketplace.heading') }}</h1>
			</div>
			<div class="market-hero__art" aria-hidden="true">
				<AppWindow :size="40" :stroke-width="1.3" /><Puzzle :size="26" :stroke-width="1.4" />
			</div>
		</div>
		<div v-if="refreshing && (!plugins.length || installed === undefined)" class="catalog-placeholder">
			<UiLoadingTiles class="catalog-loading" :icons="loadingIcons" :label="t('marketplace.loadingCatalog')" />
		</div>
		<UiEmptyState
			v-else-if="failed || installed === undefined"
			:icon="Puzzle"
			:title="t('marketplace.catalogUnavailable')"
		/>
		<template v-else>
			<section v-for="group in groups" :key="group.kind" class="catalog-section" :data-kind="group.kind">
				<header class="catalog-heading">
					<h2>
						{{ t(group.kind === 'application' ? 'applications' : 'marketplace.extensions')
						}}<span>{{ n(group.plugins.length) }}</span>
					</h2>
				</header>
				<div v-if="group.plugins.length" class="catalog-grid">
					<button
						v-selectable-action
						v-for="{ plugin, pack, name, icon } in group.plugins"
						:key="plugin.id"
						type="button"
						class="catalog-card"
						:aria-label="t('marketplace.viewPlugin', { name: name })"
						@click="emit('inspect', plugin.id)"
					>
						<div class="catalog-card__head">
							<span class="catalog-card__icon" aria-hidden="true">
								<component
									:is="icon ?? (group.kind === 'application' ? AppWindow : Puzzle)"
									:size="25"
									:stroke-width="1.6"
								/>
							</span>
							<h3 class="catalog-card__name" data-ui-selection="text">{{ name }}</h3>
						</div>
						<p
							v-if="marketplaceDescription(pack, locale)"
							class="catalog-card__description"
							data-ui-selection="text"
						>
							{{ marketplaceDescription(pack, locale) }}
						</p>
						<span
							v-if="group.kind === 'extension'"
							class="catalog-card__package"
							data-ui-selection="text"
							:title="plugin.id"
						>
							{{ plugin.id }}
						</span>
					</button>
				</div>
				<UiEmptyState v-else-if="noMatches" :icon="Puzzle" :title="t('marketplace.noMatchingPlugins')" />
				<UiEmptyState
					v-else-if="!searchQuery"
					:icon="group.kind === 'application' ? AppWindow : Puzzle"
					:title="t(`marketplace.empty${group.kind === 'application' ? 'Applications' : 'Extensions'}`)"
				/>
			</section>
		</template>
	</div>
</template>

<style scoped>
	.market-discover {
		display: flex;
		flex: 1;
		flex-direction: column;
	}
	.catalog-placeholder {
		flex: 1;
		min-height: 160px;
		display: grid;
		place-items: center;
	}
	.catalog-loading {
		--ui-loading-tile-size: 40px;
		--ui-loading-tile-gap: 9px;
		--ui-loading-tile-radius: var(--marketplace-card-radius);
		--ui-loading-icon-size: 20px;
		--ui-loading-caption-size: 12px;
	}
	.market-hero {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 28px 30px;
		margin-bottom: 28px;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--ui-primary) 10%, transparent);
		border-radius: var(--marketplace-card-radius);
		background: linear-gradient(115deg, light-dark(#e5ddec, #30273f), light-dark(#f3edf5, #272331));
	}
	h1 {
		font-size: clamp(21px, 3cqi, 29px);
		font-weight: 620;
		letter-spacing: -0.8px;
		margin: 0;
	}

	.market-hero__art {
		display: flex;
		align-items: center;
		flex: none;
		color: var(--ui-primary);
		opacity: 0.55;
		transform: rotate(-10deg);
	}
	.market-hero__art > :first-child {
		box-sizing: content-box;
		padding: 23px;
		border: 1px solid color-mix(in srgb, var(--ui-primary) 20%, transparent);
		border-radius: 24px;
		background: color-mix(in srgb, var(--ui-surface) 55%, transparent);
	}
	.market-hero__art > :last-child {
		margin: 40px 0 0 -15px;
		padding: 8px;
		box-sizing: content-box;
		border-radius: 15px;
		background: var(--ui-surface);
	}
	.catalog-section + .catalog-section {
		margin-top: 30px;
	}
	.catalog-heading {
		margin-bottom: 14px;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 0;
		font-size: 17px;
		font-weight: 600;
	}
	h2 span {
		font-size: 10px;
		color: var(--ui-muted);
		background: color-mix(in srgb, var(--ui-text) 6%, transparent);
		border-radius: 6px;
		padding: 3px 6px;
	}
	.catalog-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
		gap: 14px;
	}
	.catalog-card {
		display: grid;
		grid-template-rows: auto 1fr;
		min-width: 0;
		text-align: start;
		padding: 0;
		font: inherit;
		border: 1px solid var(--ui-border);
		border-radius: var(--marketplace-card-radius);
		background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
		color: var(--ui-text);
		overflow: hidden;
		cursor: pointer;
		transition:
			border-color var(--ui-motion-duration),
			background var(--ui-motion-duration);
	}
	.catalog-card:hover {
		border-color: color-mix(in srgb, var(--ui-primary) 60%, var(--ui-border));
		background: var(--ui-surface);
	}
	.catalog-card__head {
		--catalog-accent: var(--ui-primary);

		display: flex;
		align-items: center;
		gap: 14px;
		padding: 18px 20px;
		min-height: 100px;
		border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 65%, transparent);
		background: linear-gradient(
			130deg,
			color-mix(in srgb, var(--catalog-accent) 13%, var(--ui-surface)),
			color-mix(in srgb, var(--catalog-accent) 3%, var(--ui-surface))
		);
	}
	.catalog-card:nth-child(3n + 2) .catalog-card__head {
		--catalog-accent: var(--ui-success);
	}
	.catalog-card:nth-child(3n) .catalog-card__head {
		--catalog-accent: var(--ui-warning);
	}
	.catalog-card__icon {
		display: grid;
		flex: none;
		place-items: center;
		width: 42px;
		height: 42px;
		border-radius: 10px;
		color: var(--ui-primary);
		background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-surface));
	}
	[data-kind='application'] .catalog-card__icon {
		width: 52px;
		height: 52px;
		border-radius: 12px;
		color: var(--catalog-accent);
		background: color-mix(in srgb, var(--catalog-accent) 13%, var(--ui-surface));
	}
	.catalog-card__name {
		min-width: 0;
		margin: 0;
		font-size: 18px;
		font-weight: 650;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}
	.catalog-card__description {
		display: -webkit-box;
		align-self: start;
		margin: 14px 20px 16px;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		overflow-wrap: anywhere;
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.55;
	}
	[data-kind='extension'] .catalog-grid {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
	}
	[data-kind='extension'] .catalog-card {
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-rows: auto 1fr auto;
		gap: 4px 13px;
		padding: 14px;
	}
	[data-kind='extension'] .catalog-card__head {
		display: contents;
	}
	[data-kind='extension'] .catalog-card__icon {
		grid-area: 1 / 1 / span 3;
		align-self: center;
	}
	[data-kind='extension'] .catalog-card__name {
		grid-area: 1 / 2;
		font-size: 16px;
	}
	[data-kind='extension'] .catalog-card__description {
		grid-area: 2 / 2;
		margin: 0;
	}
	.catalog-card__package {
		grid-area: 3 / 2;
		min-width: 0;
		margin-top: 5px;
		color: var(--ui-muted);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@container (max-width: 699px) {
		.market-hero {
			padding: 24px 20px;
		}
		.market-hero__art {
			display: none;
		}
	}
	@container (max-width: 520px) {
		.catalog-card__head {
			min-height: 82px;
			padding: 12px 16px;
		}
		[data-kind='application'] .catalog-card__description {
			margin-inline: 16px;
		}
		.catalog-grid,
		[data-kind='extension'] .catalog-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
