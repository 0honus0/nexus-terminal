<script setup lang="ts">
	import prerelease from 'semver/functions/prerelease.js';
	import { computed, ref, watch } from 'vue';
	import { AppWindow, Puzzle, Info, Download, SlidersHorizontal } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import { resolvePluginIcon } from '../../plugin/plugin-api.browser.js';
	import { UiButton, UiDialog, UiSelect } from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceCatalogPlugin, MarketplaceRepository } from '../marketplace-catalog-types.js';
	import type { MarketplaceRepositorySource } from '../marketplace-install-types.js';
	import type { MarketplacePlugin } from '../marketplace-types.js';
	import { isMarketplaceUpdate, marketplaceDescription, marketplacePackageName } from './marketplace-presentation.js';

	const props = defineProps<{
		plugin: MarketplaceCatalogPlugin | undefined;
		repositories: readonly MarketplaceRepository[];
		installed?: MarketplacePlugin;
		update?: MarketplaceRepositorySource;
		installing: boolean;
	}>();
	const emit = defineEmits<{ manage: [id: string]; install: [source: MarketplaceRepositorySource] }>();
	const open = defineModel<boolean>('open', { default: false });
	const { t, locale } = useI18n({ useScope: 'global' });
	const selection = ref('');
	const release = ref<'stable' | 'prerelease'>('stable');
	const dependenciesOpen = ref(false);
	const sorted = computed(() => props.plugin?.versions ?? []);
	const releaseOptions = computed(() => [
		{ value: 'stable', label: t('marketplace.stableRelease') },
		{ value: 'prerelease', label: t('marketplace.developmentRelease') },
	]);
	const versions = computed(() =>
		sorted.value
			.filter((version) => (prerelease(version.package.version) ? 'prerelease' : 'stable') === release.value)
			.map((version) => ({
				version,
				value: JSON.stringify([version.repositoryId, version.package.version]),
				label: `${version.package.version} · ${props.repositories.find((repository) => repository.id === version.repositoryId)?.label ?? version.repositoryId}`,
			})),
	);
	watch(
		[() => props.plugin?.id, sorted, release, open],
		([id, all, , isOpen], previous) => {
			if (!isOpen || id !== previous?.[0]) dependenciesOpen.value = false;
			if (id !== previous?.[0] || (isOpen && !previous?.[3])) {
				// 优先正式版本；只有开发版本的包仍可直接查看和安装。
				const update = props.update;
				if (update) {
					release.value = prerelease(update.version) ? 'prerelease' : 'stable';
					selection.value = JSON.stringify([update.repositoryId, update.version]);
				} else {
					release.value = all.some((item) => !prerelease(item.package.version)) ? 'stable' : 'prerelease';
					selection.value = versions.value[0]?.value ?? '';
				}
			}
			if (!versions.value.some((option) => option.value === selection.value))
				selection.value = versions.value[0]?.value ?? '';
		},
		{ immediate: true },
	);
	const selectedOption = computed(() => versions.value.find((option) => option.value === selection.value));
	const selected = computed(() => selectedOption.value?.version);
	const selectedUpdate = computed(() =>
		props.installed && selected.value && isMarketplaceUpdate(props.installed, selected.value)
			? selected.value
			: undefined,
	);
	// 空分类保留包介绍及分类切换，不把另一分类的版本伪装成当前选项，也不允许安装。
	const displayPackage = computed(
		() => selected.value?.package ?? sorted.value[0]?.package ?? props.plugin?.versions[0]?.package,
	);
	const pluginDependencies = computed(() => Object.entries(selected.value?.package.nexus.dependsOn ?? {}));
	const sharedDependencies = computed(() => Object.entries(selected.value?.package.peerDependencies ?? {}));

	function install() {
		if (!props.plugin || !selected.value || props.installing || (props.installed && !selectedUpdate.value)) return;
		emit('install', {
			kind: 'repository',
			repositoryId: selected.value.repositoryId,
			pluginId: props.plugin.id,
			version: selected.value.package.version,
		});
	}
</script>

<template>
	<UiDialog v-model:open="open" :title="t('marketplace.pluginDetails')" :close-label="t('closeApplication')">
		<template v-if="plugin && displayPackage">
			<div class="catalog-detail__summary" :data-kind="displayPackage.nexus.kind">
				<span class="catalog-detail__icon" aria-hidden="true">
					<component
						:is="
							resolvePluginIcon(displayPackage.nexus.icon) ??
							(displayPackage.nexus.kind === 'application' ? AppWindow : Puzzle)
						"
						:size="24"
						:stroke-width="1.65"
					/>
				</span>
				<div class="catalog-detail__identity" data-ui-selection="text">
					<h2>{{ marketplacePackageName(displayPackage, locale) }}</h2>
					<small>{{ plugin.id }}</small>
				</div>
				<span class="catalog-detail__kind">{{
					t(displayPackage.nexus.kind === 'application' ? 'marketplace.application' : 'marketplace.plugin')
				}}</span>
			</div>
			<p
				v-if="marketplaceDescription(displayPackage, locale)"
				class="catalog-detail__description"
				data-ui-selection="text"
			>
				{{ marketplaceDescription(displayPackage, locale) }}
			</p>
			<div class="catalog-detail__version">
				<div v-if="installed" class="catalog-detail__installed">
					<span>{{ t('marketplace.installed') }}</span>
					<strong data-ui-selection="text">{{ installed.version }}</strong>
				</div>
				<div class="catalog-detail__version-controls">
					<div class="catalog-detail__field">
						<span aria-hidden="true">{{ t('marketplace.releaseChannel') }}</span>
						<UiSelect
							v-model="release"
							:options="releaseOptions"
							:disabled="installing"
							block
							:aria-label="t('marketplace.releaseChannel')"
							content-align="start"
						/>
					</div>
					<div class="catalog-detail__field catalog-detail__field--version">
						<span aria-hidden="true">{{ t('marketplace.versionSource') }}</span>
						<UiSelect
							v-model="selection"
							:options="versions"
							:disabled="installing"
							block
							:aria-label="t('marketplace.versionSource')"
							:placeholder="t('marketplace.noReleaseVersions')"
							:title="selectedOption?.label"
							content-align="start"
						/>
					</div>
				</div>
			</div>
		</template>
		<template v-if="plugin && displayPackage" #footer>
			<UiButton :disabled="!selected" @click="dependenciesOpen = true"
				><template #leading><Info :size="17" /></template>{{ t('marketplace.details') }}</UiButton
			>
			<UiButton
				v-if="installed"
				:tone="selectedUpdate ? 'neutral' : 'primary'"
				@click="emit('manage', plugin.id)"
			>
				<template #leading><SlidersHorizontal :size="17" /></template>{{ t('marketplace.manageInstalled') }}
			</UiButton>
			<UiButton
				v-if="!installed || selectedUpdate"
				tone="primary"
				:loading="installing"
				:disabled="!selected"
				loading-animation="spinner"
				@click="install"
			>
				<template #leading><Download :size="17" /></template
				>{{
					selectedUpdate
						? t('marketplace.updateVersion', { version: selectedUpdate.package.version })
						: t('marketplace.confirmInstall')
				}}
			</UiButton>
		</template>
	</UiDialog>
	<UiDialog
		v-if="open"
		v-model:open="dependenciesOpen"
		:title="t('marketplace.dependencyDetails')"
		:close-label="t('closeApplication')"
	>
		<template v-if="plugin && selected">
			<section class="catalog-dependencies__section">
				<h3>{{ t('marketplace.pluginDependencies') }}</h3>
				<dl v-if="pluginDependencies.length" class="catalog-dependencies__list">
					<div v-for="[id, range] in pluginDependencies" :key="id">
						<dt data-ui-selection="text">{{ id }}</dt>
						<dd data-ui-selection="text">
							<code>{{ range }}</code>
						</dd>
					</div>
				</dl>
				<p v-else class="catalog-dependencies__empty">
					{{ t('marketplace.noPluginDependencies') }}
				</p>
			</section>
			<section v-if="sharedDependencies.length" class="catalog-dependencies__section">
				<h3>{{ t('marketplace.sharedDependencies') }}</h3>
				<dl class="catalog-dependencies__list">
					<div v-for="[id, range] in sharedDependencies" :key="id">
						<dt data-ui-selection="text">{{ id }}</dt>
						<dd data-ui-selection="text">
							<code>{{ range }}</code>
						</dd>
					</div>
				</dl>
			</section>
		</template>
	</UiDialog>
</template>

<style scoped>
	.catalog-detail__summary {
		--detail-accent: var(--ui-primary);

		display: flex;
		align-items: center;
		gap: 12px;
	}
	.catalog-detail__summary[data-kind='extension'] {
		--detail-accent: var(--ui-success);
	}
	.catalog-detail__icon {
		color: var(--detail-accent);
		display: grid;
		flex: none;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 11px;
		background: color-mix(in srgb, var(--detail-accent) 12%, var(--ui-surface));
	}
	.catalog-detail__identity {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.catalog-detail__kind {
		flex: none;
		padding: 3px 8px;
		border-radius: 8px;
		color: var(--detail-accent);
		background: color-mix(in srgb, var(--detail-accent) 9%, var(--ui-surface));
		font-size: 11px;
		font-weight: 600;
	}
	h2 {
		font-size: 19px;
		font-weight: 650;
		line-height: 1.3;
		margin: 0;
	}
	small {
		font-size: 11px;
		color: var(--ui-muted);
	}
	.catalog-detail__description {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.8;
		margin: 12px 0 0;
	}
	.catalog-detail__version {
		display: grid;
		gap: 12px;
		margin-top: 16px;
		padding: 12px;
		border: 1px solid var(--ui-border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--ui-text) 2%, var(--ui-surface));
		font-size: 12px;
	}
	.catalog-detail__installed {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--ui-border);
		color: var(--ui-muted);
	}
	.catalog-detail__installed strong {
		min-width: 0;
		color: var(--ui-text);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.catalog-detail__version-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.catalog-detail__field {
		flex: 1 0 min(100%, 120px);
		display: grid;
		gap: 5px;
		min-width: 0;
		color: var(--ui-muted);
	}
	.catalog-detail__field--version {
		flex: 2 0 min(100%, 180px);
	}
	.catalog-dependencies__section + .catalog-dependencies__section {
		margin-top: 24px;
	}
	h3 {
		font-size: 12px;
		font-weight: 600;
		margin: 0 0 12px;
	}
	.catalog-dependencies__list {
		margin: 0;
	}
	.catalog-dependencies__list > div {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 0;
		font-size: 12px;
		line-height: 1.6;
	}
	.catalog-dependencies__list dt {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.catalog-dependencies__list dd {
		min-width: 0;
		max-width: 45%;
		color: var(--ui-muted);
		margin: 0;
		text-align: end;
		overflow-wrap: anywhere;
	}
	.catalog-dependencies__empty {
		color: var(--ui-muted);
		font-size: 12px;
		margin: 0;
	}
</style>
