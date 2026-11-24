<script setup lang="ts">
	import { computed } from 'vue';
	import { AppWindow, Puzzle, ArrowUp, ArrowUpRight, Check, Boxes, PackageOpen } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import { resolvePluginIcon } from '../../plugin/plugin-api.browser.js';
	import { UiEmptyState, UiLoadingTiles, vSelectableAction } from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceCatalogPlugin } from '../marketplace-catalog-types.js';
	import type { MarketplaceRepositorySource } from '../marketplace-install-types.js';
	import type { MarketplacePlugin } from '../marketplace-types.js';
	import { marketplaceDescription, marketplacePackageName } from './marketplace-presentation.js';
	const props = defineProps<{
		plugins: readonly MarketplaceCatalogPlugin[];
		installed: readonly MarketplacePlugin[];
		updates: ReadonlyMap<string, MarketplaceRepositorySource>;
		query: string;
		refreshing: boolean;
		failed: boolean;
	}>();
	const emit = defineEmits<{ inspect: [pluginId: string] }>();
	const { t, n, locale } = useI18n({ useScope: 'global' });
	const loadingIcons = [AppWindow, PackageOpen, Boxes, Puzzle];
	const groups = computed(() =>
		(['application', 'extension'] as const)
			.map((kind) => ({
				kind,
				plugins: props.plugins.flatMap((plugin) => {
					const pack = plugin.versions[0]?.package;
					if (pack?.nexus.kind !== kind) return [];

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
					return search.includes(props.query.trim().toLowerCase())
						? [{ plugin, pack, name, icon: resolvePluginIcon(pack.nexus.icon) }]
						: [];
				}),
			}))
			.filter(({ plugins }) => !props.refreshing || plugins.length),
	);
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
		<div v-if="refreshing && !plugins.length" class="catalog-placeholder">
			<UiLoadingTiles class="catalog-loading" :icons="loadingIcons" :label="t('marketplace.loadingCatalog')" />
		</div>
		<UiEmptyState v-else-if="failed" :icon="Puzzle" :title="t('marketplace.catalogUnavailable')" />
		<template v-else>
			<section v-for="group in groups" :key="group.kind" class="catalog-section" :data-kind="group.kind">
				<header class="catalog-heading">
					<div>
						<h2>
							{{ t(group.kind === 'application' ? 'applications' : 'marketplace.extensions')
							}}<span>{{ n(group.plugins.length) }}</span>
						</h2>
					</div>
				</header>
				<div class="catalog-grid">
					<button
						v-selectable-action
						v-for="{ plugin, pack, name, icon } in group.plugins"
						:key="plugin.id"
						type="button"
						class="catalog-card"
						:aria-label="t('marketplace.viewPlugin', { name: name })"
						@click="emit('inspect', plugin.id)"
					>
						<div class="catalog-card__art" aria-hidden="true">
							<component
								:is="icon ?? (group.kind === 'application' ? AppWindow : Puzzle)"
								:size="icon ? 36 : group.kind === 'application' ? 30 : 24"
								:stroke-width="1.5"
							/><span v-if="!icon && group.kind === 'application'">{{ name.slice(0, 1) }}</span>
						</div>
						<div class="catalog-card__body" data-ui-selection="text">
							<div class="catalog-card__title">
								<h3>{{ name }}</h3>
								<ArrowUpRight :size="15" aria-hidden="true" />
							</div>
							<p v-if="marketplaceDescription(pack, locale)">
								{{ marketplaceDescription(pack, locale) }}
							</p>
							<footer>
								<span class="catalog-card__package">{{ plugin.id }}</span>
								<span v-if="updates.has(plugin.id)" class="catalog-card__update">
									<ArrowUp :size="12" aria-hidden="true" />{{ t('marketplace.updateAvailable') }}
								</span>
								<span
									v-else-if="installed.some((item) => item.pluginId === plugin.id)"
									class="catalog-card__installed"
									><Check :size="12" />{{ t('marketplace.installed') }}</span
								><span v-else>v{{ pack.version }}</span>
							</footer>
						</div>
					</button>
				</div>
				<UiEmptyState
					v-if="!group.plugins.length"
					:icon="group.kind === 'application' ? AppWindow : Puzzle"
					:title="
						t(
							query.trim()
								? 'logViewer.noMatches'
								: `marketplace.empty${group.kind === 'application' ? 'Applications' : 'Extensions'}`,
						)
					"
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
		--ui-loading-tile-radius: 12px;
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
		border-radius: 22px;
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
		margin: 0 0 5px;
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
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
		gap: 14px;
	}
	.catalog-card {
		min-width: 0;
		text-align: start;
		padding: 0;
		border: 1px solid var(--ui-border);
		border-radius: 18px;
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
	.catalog-card__art {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 100px;
		padding: 20px 24px;
		color: var(--ui-primary);
		background: linear-gradient(
			130deg,
			color-mix(in srgb, var(--ui-primary) 13%, var(--ui-surface)),
			color-mix(in srgb, var(--ui-primary) 3%, var(--ui-surface))
		);
	}
	.catalog-card:nth-child(3n + 2) .catalog-card__art {
		color: var(--ui-success);
		background: linear-gradient(
			130deg,
			color-mix(in srgb, var(--ui-success) 13%, var(--ui-surface)),
			var(--ui-surface)
		);
	}
	.catalog-card:nth-child(3n) .catalog-card__art {
		color: var(--ui-warning);
		background: linear-gradient(
			130deg,
			color-mix(in srgb, var(--ui-warning) 12%, var(--ui-surface)),
			var(--ui-surface)
		);
	}
	.catalog-card__art span {
		font-size: 62px;
		line-height: 1;
		font-weight: 600;
		opacity: 0.16;
	}
	.catalog-card__body {
		padding: 17px;
		min-width: 0;
	}
	.catalog-card__title {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
	}
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.catalog-card__title > svg {
		flex: none;
		color: var(--ui-muted);
		opacity: 0.6;
	}
	.catalog-card__body > p {
		color: var(--ui-muted);
		font-size: 11px;
		line-height: 1.7;
		margin: 9px 0 17px;
		min-height: 3.4em;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: var(--ui-muted);
		font-size: 9px;
	}
	.catalog-card__package {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	footer > :last-child {
		flex: none;
	}
	.catalog-card__installed,
	.catalog-card__update {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.catalog-card__installed {
		color: var(--ui-success);
	}
	.catalog-card__update {
		color: var(--ui-primary);
	}
	[data-kind='extension'] .catalog-grid {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr));
	}
	[data-kind='extension'] .catalog-card {
		display: flex;
		align-items: flex-start;
		padding: 18px;
		gap: 14px;
	}
	[data-kind='extension'] .catalog-card__art {
		width: 48px;
		height: 48px;
		padding: 0;
		border-radius: 14px;
		justify-content: center;
		flex: none;
	}
	[data-kind='extension'] .catalog-card__body {
		flex: 1;
		padding: 0;
	}
	[data-kind='extension'] .catalog-card__body > p {
		margin-bottom: 13px;
	}
	@container (max-width: 699px) {
		.market-hero {
			padding: 24px 20px;
		}
		.market-hero__art {
			display: none;
		}
		.catalog-grid {
			grid-template-columns: 1fr;
		}
		[data-kind='application'] .catalog-card {
			display: flex;
			align-items: stretch;
		}
		[data-kind='application'] .catalog-card__art {
			width: 78px;
			height: auto;
			flex: none;
			padding: 16px;
			justify-content: center;
		}
		.catalog-card__art span {
			display: none;
		}
		.catalog-card__body {
			flex: 1;
		}
	}
</style>
