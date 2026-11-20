<script setup lang="ts">
	import prerelease from 'semver/functions/prerelease.js';
	import { computed, ref, watch } from 'vue';
	import { AppWindow, Puzzle, Info, Download, SlidersHorizontal } from '@lucide/vue';
	import { useI18n } from 'vue-i18n';
	import { resolvePluginIcon } from '../../plugin/plugin-api.browser.js';
	import { UiButton, UiDialog, UiSelect } from '../../ui/browser/ui-components-api.js';
	import type { MarketplaceCatalogPlugin, MarketplaceRepository } from '../marketplace-catalog-types.js';
	import type { MarketplaceRepositorySource } from '../marketplace-install-types.js';
	import { marketplaceDescription, marketplacePackageName } from './marketplace-presentation.js';

	const props = defineProps<{
		plugin: MarketplaceCatalogPlugin | undefined;
		repositories: readonly MarketplaceRepository[];
		installed: boolean;
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
			if (id !== previous?.[0]) {
				// 优先正式版本；只有开发版本的包仍可直接查看和安装。
				release.value = all.some((item) => !prerelease(item.package.version)) ? 'stable' : 'prerelease';
			}
			if (id !== previous?.[0] || !versions.value.some((option) => option.value === selection.value))
				selection.value = versions.value[0]?.value ?? '';
		},
		{ immediate: true },
	);
	const selected = computed(() => versions.value.find((option) => option.value === selection.value)?.version);
	// 空分类保留包介绍及分类切换，不把另一分类的版本伪装成当前选项，也不允许安装。
	const displayPackage = computed(
		() => selected.value?.package ?? sorted.value[0]?.package ?? props.plugin?.versions[0]?.package,
	);
	const pluginDependencies = computed(() => Object.entries(selected.value?.package.nexus.dependsOn ?? {}));
	const sharedDependencies = computed(() => Object.entries(selected.value?.package.peerDependencies ?? {}));

	function install() {
		if (!props.plugin || !selected.value || props.installing) return;
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
			<div class="catalog-detail__hero" :data-kind="displayPackage.nexus.kind">
				<div class="catalog-detail__top">
					<span class="catalog-detail__icon"
						><component
							:is="
								resolvePluginIcon(displayPackage.nexus.icon) ??
								(displayPackage.nexus.kind === 'application' ? AppWindow : Puzzle)
							"
							:size="30"
							:stroke-width="1.5"
					/></span>
					<span class="catalog-detail__kind">{{
						t(
							displayPackage.nexus.kind === 'application'
								? 'marketplace.application'
								: 'marketplace.plugin',
						)
					}}</span>
				</div>
				<h2>{{ marketplacePackageName(displayPackage, locale) }}</h2>
				<small data-ui-selection="text">{{ plugin.id }}</small>
			</div>
			<p class="catalog-detail__description" data-ui-selection="text">
				{{
					marketplaceDescription(displayPackage, locale) ?? t(`marketplace.${displayPackage.nexus.kind}Hint`)
				}}
			</p>
			<div class="catalog-detail__version">
				<span>{{ t('marketplace.versionSource') }}</span>
				<div class="catalog-detail__version-controls">
					<UiSelect
						v-model="selection"
						:options="versions"
						:disabled="installing"
						block
						:aria-label="t('marketplace.versionSource')"
						:placeholder="t('marketplace.noReleaseVersions')"
					/>
					<UiSelect
						v-model="release"
						:options="releaseOptions"
						:disabled="installing"
						block
						:aria-label="t('marketplace.releaseChannel')"
						content-align="end"
					/>
				</div>
			</div>
		</template>
		<template v-if="plugin && displayPackage" #footer>
			<UiButton :disabled="!selected" @click="dependenciesOpen = true"
				><template #leading><Info :size="17" /></template>{{ t('marketplace.details') }}</UiButton
			>
			<UiButton v-if="installed" tone="primary" @click="emit('manage', plugin.id)">
				<template #leading><SlidersHorizontal :size="17" /></template>{{ t('marketplace.manageInstalled') }}
			</UiButton>
			<UiButton
				v-else
				tone="primary"
				:loading="installing"
				:disabled="!selected"
				loading-animation="spinner"
				@click="install"
			>
				<template #leading><Download :size="17" /></template>{{ t('marketplace.previewInstall') }}
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
	.catalog-detail__hero {
		--detail-accent: var(--ui-primary);
		padding: 22px;
		border: 1px solid color-mix(in srgb, var(--detail-accent) 16%, var(--ui-border));
		border-radius: 20px;
		background: linear-gradient(
			125deg,
			color-mix(in srgb, var(--detail-accent) 15%, var(--ui-surface)),
			color-mix(in srgb, var(--detail-accent) 4%, var(--ui-surface))
		);
	}
	.catalog-detail__hero[data-kind='extension'] {
		--detail-accent: var(--ui-success);
	}
	.catalog-detail__top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
	}
	.catalog-detail__icon {
		color: var(--detail-accent);
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--ui-surface) 75%, transparent);
	}
	.catalog-detail__kind {
		padding: 6px 11px;
		border-radius: 8px;
		color: var(--detail-accent);
		background: color-mix(in srgb, var(--detail-accent) 12%, var(--ui-surface));
		font-size: 11px;
		font-weight: 600;
	}
	h2 {
		font-size: 25px;
		font-weight: 600;
		margin: 20px 0 8px;
	}
	small {
		font-size: 11px;
		color: var(--ui-muted);
		overflow-wrap: anywhere;
	}
	.catalog-detail__description {
		color: var(--ui-muted);
		font-size: 13px;
		line-height: 1.8;
		margin: 22px 0;
	}
	.catalog-detail__version {
		display: grid;
		gap: 10px;
		font-size: 12px;
	}
	.catalog-detail__version-controls {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 118px;
		gap: 10px;
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
