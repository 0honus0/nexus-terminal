<script setup lang="ts">
	import { nextTick, computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import {
		UiBadge,
		UiButton,
		UiCheckbox,
		UiConfirmationPanel,
		UiEmptyState,
		UiInlineNotice,
		UiInput,
		UiModal,
		UiPopover,
		UiSearchInput,
		UiSelect,
		type UiTone,
	} from '@/foundation/ui';
	import { getPluginCatalog, getPluginRepositories, updatePluginRepositories } from '../api/plugin-management-api';
	import { useAgentManagementOperation } from '../../composables/use-agent-management-operation';
	import type {
		PluginCatalog,
		PluginCatalogEntry,
		PluginRepositories,
		PluginPublisher,
		PluginInstallation,
		PluginPackageInstallation,
		PluginVersion,
	} from '../model/plugin-types';
	import { useOperationFeedback } from '@/shared/feedback/public';
	import {
		isPluginUpgrade,
		localizeCatalogEntry,
		mergePluginCatalogs,
		satisfiesAppRequirements,
	} from '../model/plugin-market-rules';
	import { installedPluginRequirements, isPluginPackageReferenced } from '../model/plugin-package-rules';
	import { AgentManagementFailure } from '../../model/management-failure';
	import type { ManagedApp } from '../../model/app-management-types';
	import type { PluginCatalogSource, PluginCatalogOption } from '../model/plugin-market-types';

	const props = defineProps<{
		blocked: boolean;
		publishers: PluginPublisher[];
		installations: PluginInstallation[];
		packageInstallations: PluginPackageInstallation[];
		retainedPackageIds: string[];
		versions: PluginVersion[];
		retainedAppIds: string[];
		clearing: boolean;
		apps: ManagedApp[];
		active: boolean;
	}>();
	const emit = defineEmits<{
		prepare: [entry: PluginCatalogEntry, source: string | null];
		trust: [label: string, pem: string];
		recommend: [];
		officialPublishers: [keyIds: string[]];
		clearData: [installation: PluginInstallation];
		retirePackage: [installation: PluginPackageInstallation, clearData: boolean];
	}>();
	const { t, locale } = useI18n();

	const catalogText = (entry: PluginCatalogEntry) => localizeCatalogEntry(entry, locale.value);

	const feedback = useOperationFeedback('agent.settings.plugin-market');
	const copiedSourceUrl = ref('');
	const repositories = ref<PluginRepositories | null>(null);
	const repositoryUrl = ref('');
	const repositoryManagerOpen = ref(false);
	const searchQuery = ref('');
	const catalogs = ref<PluginCatalogSource[]>([]);
	const catalogLoading = ref(false);
	let catalogLoadToken: symbol | null = null;
	const selectedVersions = ref(new Map<string, string>());
	const sourceErrors = ref<
		{ source: string; stale: boolean; reason: 'failed' | 'forbidden' | 'version_conflict' | 'limit_exceeded' }[]
	>([]);
	let catalogRevision: number | null = null;
	const clearAppId = ref('');
	const clearAppName = ref('');
	const installationsByDefinition = computed(
		() =>
			new Map(
				props.packageInstallations.map((installation) => [
					JSON.stringify([installation.publisherKeyId, installation.packageId]),
					installation,
				]),
			),
	);
	const appRequirements = computed(() => installedPluginRequirements(props.packageInstallations, props.versions));

	const packageRemoval = ref<{ packageId: string; revision: number } | null>(null);
	const clearPackageData = ref(false);
	const retainedPackages = computed(() => new Set(props.retainedPackageIds));
	const removalPackage = computed(() => {
		const intent = packageRemoval.value;
		return intent
			? props.packageInstallations.find(
					(item) => item.packageId === intent.packageId && item.revision === intent.revision,
				)
			: undefined;
	});
	const retainedPackagesOutsideCatalog = computed(() => {
		const versions = new Map(props.versions.map((version) => [version.packageHash, version]));
		const query = searchQuery.value.trim().toLowerCase();
		return props.packageInstallations
			.filter(
				(item) =>
					item.status === 'removed' &&
					retainedPackages.value.has(item.packageId) &&
					!catalogs.value.some(({ catalog }) =>
						catalog.packages.some(
							(entry) =>
								entry.definitionId === item.packageId && entry.publisherKeyId === item.publisherKeyId,
						),
					),
			)
			.map((installation) => ({
				installation,
				name: versions.get(installation.packageHash)?.manifest.displayName ?? installation.packageId,
			}))
			.filter(
				(item) =>
					!query ||
					item.name.toLowerCase().includes(query) ||
					item.installation.packageId.toLowerCase().includes(query),
			);
	});

	const retainedApps = computed(() => new Set(props.retainedAppIds));
	const appsById = computed(() => new Map(props.apps.map((app) => [app.id, app])));
	const trustedPublishers = computed(
		() =>
			new Set(
				props.publishers
					.filter((publisher) => publisher.revokedAt === null)
					.map((publisher) => publisher.keyId),
			),
	);
	const clearInstallation = computed(() =>
		props.installations.find(
			(installation) => installation.appId === clearAppId.value && installation.status === 'removed',
		),
	);
	const retainedOutsideCatalog = computed(() => {
		const catalogIds = new Set(
			catalogs.value.flatMap((source) =>
				source.catalog.packages.map((entry) => JSON.stringify([entry.publisherKeyId, entry.definitionId])),
			),
		);
		const versions = new Map(props.versions.map((version) => [version.packageHash, version]));
		const query = searchQuery.value.trim().toLowerCase();
		return props.installations
			.filter(
				(installation) =>
					installation.status === 'removed' &&
					retainedApps.value.has(installation.appId) &&
					!catalogIds.has(JSON.stringify([installation.publisherKeyId, installation.definitionId])),
			)
			.map((installation) => ({
				installation,
				name: versions.get(installation.packageHash)?.manifest.displayName ?? installation.definitionId,
			}))
			.filter(
				(item) =>
					!query ||
					item.name.toLowerCase().includes(query) ||
					item.installation.definitionId.toLowerCase().includes(query),
			);
	});
	watch(
		() => props.active && retainedApps.value.has(clearAppId.value),
		(visible) => {
			if (!visible) clearAppId.value = '';
		},
	);
	const unknown = ref(false);
	const acknowledged = ref(false);
	let writeIntent: symbol | null = null;
	const operation = useAgentManagementOperation(
		(reason) => {
			repositories.value = null;
			repositoryUrl.value = '';
			repositoryManagerOpen.value = false;
			searchQuery.value = '';
			catalogs.value = [];
			sourceErrors.value = [];
			selectedVersions.value.clear();
			catalogRevision = null;
			catalogLoading.value = false;
			catalogLoadToken = null;
			packageRemoval.value = null;
			clearPackageData.value = false;
			unknown.value = reason === 'view' && (unknown.value || writeIntent !== null);
			acknowledged.value = false;
		},
		() => props.active,
	);
	const locked = computed(
		() => props.blocked || operation.busy.value || operation.refreshRequired.value || unknown.value,
	);

	const mergedPlugins = computed(() =>
		mergePluginCatalogs(catalogs.value, props.packageInstallations, appRequirements.value, selectedVersions.value),
	);
	const totalPluginCount = computed(() => mergedPlugins.value.length);
	const filteredPlugins = computed(() => {
		const query = searchQuery.value.trim().toLowerCase();
		return mergedPlugins.value.filter(
			(group) =>
				!query ||
				group.options.some(({ entry, source, catalog }) =>
					[
						catalogText(entry).displayName,
						entry.definitionId,
						catalogText(entry).description,
						source ?? catalog.repositoryUrl,
					].some((value) => value.toLowerCase().includes(query)),
				),
		);
	});
	const catalogSources = computed(() => {
		const snapshots = new Map(catalogs.value.map((item) => [item.source, item.catalog]));
		const official = snapshots.get(null);
		return [
			...(official ? [{ source: null, sourceUrl: official.repositoryUrl }] : []),
			...(repositories.value?.urls ?? []).map((url) => ({ source: url, sourceUrl: url })),
		].map(({ source, sourceUrl }) => {
			const address = new URL(sourceUrl);
			const github = address.hostname === 'github.com' || address.hostname === 'raw.githubusercontent.com';
			return {
				key: source ?? 'official',
				owner: github ? (address.pathname.split('/').filter(Boolean)[0] ?? address.host) : address.host,
				github,
				official: source === null,
				sourceUrl,
				removalUrl: source,
			};
		});
	});

	function selectVersion(id: string, value: string | number | null): void {
		if (typeof value === 'string') selectedVersions.value.set(id, value);
	}

	function needsVersionChoice(source: string | null, entry: PluginCatalogEntry): boolean {
		const group = mergedPlugins.value.find((item) => item.id === entry.definitionId);
		return group?.selected.source === source && group.needsVersionChoice;
	}

	function sourceLabel(option: PluginCatalogOption): string {
		const url = new URL(option.source ?? option.catalog.repositoryUrl);
		const owner =
			url.hostname === 'github.com' || url.hostname === 'raw.githubusercontent.com'
				? url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || url.host
				: url.host + url.pathname + url.search;
		return (
			t(
				option.source === null
					? 'agent.settings.plugins.officialRepository'
					: 'agent.settings.plugins.thirdPartyRepository',
			) +
			' · ' +
			owner
		);
	}

	function sourceLabelForCopy(official: boolean, url: string): string {
		return (
			t(official ? 'agent.settings.plugins.officialRepository' : 'agent.settings.plugins.thirdPartyRepository') +
			' · ' +
			(copiedSourceUrl.value === url ? t('common.copied') : t('agent.settings.plugins.copy'))
		);
	}

	async function copyCatalogUrl(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			copiedSourceUrl.value = url;
		} catch (cause) {
			feedback.notifyError({ operation: 'copy-source', message: t('agent.settings.plugins.copyFailed'), cause });
		}
	}

	function trustRemotePublisher(catalog: PluginCatalog, keyId: string): void {
		if (locked.value) return;
		const publisher = catalog.publishers.find((item) => item.keyId === keyId);
		if (publisher) emit('trust', publisher.label, publisher.publicKeyPem);
	}

	async function reload(): Promise<void> {
		if (props.blocked || operation.busy.value) return;
		await load();
	}

	defineExpose({ reload, busy: operation.busy });

	function publisherTrusted(keyId: string): boolean {
		return trustedPublishers.value.has(keyId);
	}

	function prepare(entry: PluginCatalogEntry, source: string | null): void {
		if (
			locked.value ||
			!entry.compatible ||
			!satisfiesAppRequirements(entry, appRequirements.value) ||
			hasNewerInstalled(entry) ||
			needsVersionChoice(source, entry)
		)
			return;
		if (source === null && entry.definitionId === 'nexus.agent' && !installedFor(entry)) emit('recommend');
		else emit('prepare', entry, source);
	}

	function installedFor(entry: PluginCatalogEntry): PluginPackageInstallation | undefined {
		const installation = installationsByDefinition.value.get(
			JSON.stringify([entry.publisherKeyId, entry.definitionId]),
		);
		return installation?.status !== 'removed' ? installation : undefined;
	}

	function retainedFor(entry: PluginCatalogEntry): PluginInstallation | undefined {
		return props.installations.find(
			(installation) =>
				installation.definitionId === entry.definitionId &&
				installation.publisherKeyId === entry.publisherKeyId &&
				installation.status === 'removed' &&
				retainedApps.value.has(installation.appId),
		);
	}

	function retainedPackageFor(entry: PluginCatalogEntry): PluginPackageInstallation | undefined {
		const installation = installationsByDefinition.value.get(
			JSON.stringify([entry.publisherKeyId, entry.definitionId]),
		);
		return installation?.status === 'removed' && retainedPackages.value.has(installation.packageId)
			? installation
			: undefined;
	}

	function hasRetainedData(entry: PluginCatalogEntry): boolean {
		return retainedFor(entry) !== undefined || retainedPackageFor(entry) !== undefined;
	}

	function requestClearData(entry: PluginCatalogEntry): void {
		if (locked.value) return;
		const app = retainedFor(entry);
		if (app) requestClearRetained(app, catalogText(entry).displayName);
		else {
			const installation = retainedPackageFor(entry);
			if (installation) requestPackageRemoval(installation);
		}
	}

	function requestClearRetained(installation: PluginInstallation, name: string): void {
		if (props.blocked || !retainedApps.value.has(installation.appId)) return;
		clearAppName.value = name;
		clearAppId.value = installation.appId;
	}

	function confirmClearData(): void {
		if (!props.blocked && clearInstallation.value) emit('clearData', clearInstallation.value);
	}

	function packageReferenced(installation: PluginPackageInstallation): boolean {
		return isPluginPackageReferenced(installation, props.installations, appRequirements.value);
	}

	function requestPackageRemoval(installation: PluginPackageInstallation): void {
		if (props.blocked || packageReferenced(installation)) return;
		packageRemoval.value = { packageId: installation.packageId, revision: installation.revision };
		clearPackageData.value = installation.status === 'removed';
	}

	function confirmPackageRemoval(): void {
		if (!props.blocked && removalPackage.value && !packageReferenced(removalPackage.value))
			emit('retirePackage', removalPackage.value, clearPackageData.value);
	}

	function hasNewerInstalled(entry: PluginCatalogEntry): boolean {
		const installation = installedFor(entry);
		return installation !== undefined && isPluginUpgrade(entry.version, installation.version);
	}

	function catalogEntryState(entry: PluginCatalogEntry): { label: string; tone: UiTone } {
		if (!satisfiesAppRequirements(entry, appRequirements.value))
			return { label: t('agent.settings.plugins.dependencyVersion'), tone: 'warning' };
		if (!entry.compatible) {
			return { label: t('agent.settings.plugins.incompatible'), tone: 'warning' };
		}
		const installation = installedFor(entry);
		if (!installation) {
			return { label: t('agent.settings.plugins.stateNotInstalled'), tone: 'neutral' };
		}
		if (installation.status === 'draining') {
			return { label: t('agent.settings.plugins.stateDraining'), tone: 'warning' };
		}
		if (hasNewerInstalled(entry)) return { label: t('agent.settings.plugins.installedNewer'), tone: 'neutral' };
		if (isPluginUpgrade(installation.version, entry.version)) {
			return { label: t('agent.settings.plugins.stateUpgrade'), tone: 'primary' };
		}
		const binding = props.installations.find(
			(item) =>
				item.definitionId === entry.definitionId &&
				item.publisherKeyId === entry.publisherKeyId &&
				item.status !== 'removed',
		);
		const app = binding ? appsById.value.get(binding.appId) : undefined;
		if (app?.enabled) {
			return { label: t('agent.settings.plugins.stateEnabled'), tone: 'success' };
		}
		if (app) {
			return { label: t('agent.settings.plugins.stateDisabled'), tone: 'neutral' };
		}
		return { label: t('agent.settings.plugins.stateInstalled'), tone: 'success' };
	}

	function catalogEntryAction(entry: PluginCatalogEntry): string {
		const installation = installedFor(entry);
		if (hasNewerInstalled(entry)) return t('agent.settings.plugins.installedNewer');
		if (hasRetainedData(entry)) return t('agent.settings.plugins.reinstall');
		if (!installation) return t('agent.settings.plugins.prepareRemote');
		if (isPluginUpgrade(installation.version, entry.version)) return t('agent.settings.plugins.prepareUpgrade');
		return t('agent.settings.plugins.reverifyPackage');
	}

	async function load(): Promise<void> {
		await operation.execute(
			getPluginRepositories,
			(value) => {
				repositories.value = value;
			},
			{ write: false },
		);
		if (operation.refreshRequired.value || operation.notice.value || !repositories.value) return;
		const revision = repositories.value.version;
		const sources = [null, ...repositories.value.urls];
		if (catalogRevision !== revision) {
			catalogs.value = [];
			selectedVersions.value.clear();
			catalogRevision = revision;
		}
		sourceErrors.value = [];
		const token = Symbol();
		catalogLoadToken = token;
		catalogLoading.value = true;
		await operation.execute(
			async (signal) => {
				const results = await Promise.allSettled(
					sources.map(async (source) => {
						try {
							const catalog = await getPluginCatalog(source, signal);
							if (signal.aborted || repositories.value?.version !== revision) return;
							const snapshots = new Map(catalogs.value.map((item) => [item.source, item]));
							snapshots.set(source, { source, catalog });
							catalogs.value = sources.flatMap((key) => {
								const snapshot = snapshots.get(key);
								return snapshot ? [snapshot] : [];
							});
							if (source === null)
								emit(
									'officialPublishers',
									catalog.publishers.map((publisher) => publisher.keyId),
								);
						} catch (cause) {
							if (signal.aborted) throw cause;
							if (repositories.value?.version !== revision) return;
							sourceErrors.value.push({
								source: source ?? 'official',
								reason:
									cause instanceof AgentManagementFailure &&
									(cause.code === 'forbidden' ||
										cause.code === 'version_conflict' ||
										cause.code === 'limit_exceeded')
										? cause.code
										: 'failed',
								stale: catalogs.value.some((item) => item.source === source),
							});
						}
					}),
				);
				for (const result of results) if (result.status === 'rejected') throw result.reason;
			},
			() => {
				if (sourceErrors.value.length) operation.notice.value = 'failed';
			},
			{ write: false, background: true },
		);
		if (catalogLoadToken === token) {
			catalogLoading.value = false;
			catalogLoadToken = null;
		}
	}

	async function save(urls: string[]): Promise<void> {
		if (locked.value || !repositories.value) return;
		const original = structuredClone(toRaw(repositories.value));
		const intent = Symbol();
		writeIntent = intent;
		await operation.execute(
			(signal) => updatePluginRepositories(original, urls, signal),
			(value) => {
				repositories.value = value;
				repositoryUrl.value = '';
			},
			{
				write: true,
				refreshAfterSuccess: true,

				onFailure() {
					unknown.value = operation.notice.value === 'unknown';
				},
			},
		);
		if (writeIntent === intent) writeIntent = null;
		if (operation.notice.value === 'saved') await load();
	}

	function closeRepositoryManager(): void {
		if (operation.busy.value) return;
		repositoryManagerOpen.value = false;
		repositoryUrl.value = '';
	}

	async function addRepository(): Promise<void> {
		const url = repositoryUrl.value.trim();
		if (!url || !repositories.value || repositories.value.urls.includes(url)) return;
		await save([...repositories.value.urls, url]);
	}

	async function removeRepository(url: string): Promise<void> {
		if (!repositories.value) return;
		await save(repositories.value.urls.filter((value) => value !== url));
	}

	function newIntent(): void {
		if (operation.busy.value || operation.refreshRequired.value || !acknowledged.value) return;
		unknown.value = false;
		acknowledged.value = false;
	}

	function initial(): void {
		if (repositories.value === null) void load();
	}

	onMounted(initial);
	onActivated(async () => {
		await nextTick();
		initial();
	});
	watch(
		() => props.active,
		(active) => {
			if (active) initial();
		},
	);
</script>
<template>
	<section class="plugin-market space-y-3">
		<UiButton
			v-if="operation.notice.value === 'failed' || operation.notice.value === 'conflict' || unknown"
			type="button"
			:disabled="operation.busy.value"
			@click="load"
			>{{ t('agent.pluginManagement.readRepositories') }}</UiButton
		>
		<div class="plugin-market__content">
			<div class="flex min-w-0 items-center gap-2">
				<i class="fa-solid fa-boxes-stacked text-xs text-primary" aria-hidden="true"></i>
				<h4 class="min-w-0 break-words text-xs font-semibold text-foreground">
					{{ t('agent.settings.plugins.remoteRepositories') }}
				</h4>
				<UiBadge v-if="totalPluginCount > 0" tone="primary" density="compact">
					{{ totalPluginCount }}
				</UiBadge>
			</div>

			<div class="plugin-market__tools mt-3">
				<UiSearchInput
					v-model="searchQuery"
					:aria-label="t('agent.settings.plugins.searchPlaceholder')"
					density="compact"
					class="min-w-0 w-full"
					:placeholder="t('agent.settings.plugins.searchPlaceholder')"
					:clear-label="t('common.clear')"
				/>
				<UiButton
					type="button"
					appearance="ghost"
					density="compact"
					:aria-label="t('agent.settings.plugins.manageRepositories')"
					:title="t('agent.settings.plugins.manageRepositories')"
					@click="repositoryManagerOpen = true"
					><i class="fa-solid fa-database" aria-hidden="true"></i
					><span class="plugin-market__add-label">{{
						t('agent.settings.plugins.manageRepositories')
					}}</span></UiButton
				>
			</div>
			<UiModal
				:visible="active && repositoryManagerOpen"
				:title="t('agent.settings.plugins.manageRepositories')"
				:aria-label="t('agent.settings.plugins.manageRepositories')"
				panel-class="max-w-xl rounded-2xl p-4 sm:p-6"
				:close-on-backdrop="!operation.busy.value"
				:close-on-escape="!operation.busy.value"
				:restore-focus="true"
				@close="closeRepositoryManager"
			>
				<template #header-actions>
					<UiButton
						type="button"
						appearance="ghost"
						density="compact"
						icon-only
						:aria-label="t('common.close')"
						:title="t('common.close')"
						:disabled="operation.busy.value"
						@click="closeRepositoryManager"
						><i class="fa-solid fa-xmark" aria-hidden="true"></i
					></UiButton>
				</template>

				<div class="space-y-3">
					<form
						class="plugin-market__add"
						:aria-label="t('agent.settings.plugins.addRepository')"
						@submit.prevent="addRepository"
					>
						<UiInput
							v-model="repositoryUrl"
							:aria-label="t('agent.settings.plugins.repositoryUrl')"
							density="compact"
							class="min-w-0 w-full"
							:placeholder="t('agent.settings.plugins.repositoryUrl')"
							:disabled="locked"
							><template #leading><i class="fa-solid fa-link" aria-hidden="true"></i></template
						></UiInput>
						<UiButton
							appearance="solid"
							tone="primary"
							density="compact"
							type="submit"
							:disabled="locked || !repositoryUrl.trim()"
							:aria-label="t('agent.settings.plugins.addRepository')"
							:title="t('agent.settings.plugins.addRepository')"
							><i class="fa-solid fa-plus" aria-hidden="true"></i
							><span class="plugin-market__dialog-action-label">{{
								t('agent.settings.plugins.addRepository')
							}}</span></UiButton
						>
						<UiButton
							type="button"
							appearance="ghost"
							density="compact"
							:loading="operation.busy.value || catalogLoading"
							:disabled="locked"
							:aria-label="t('agent.settings.plugins.refreshRemote')"
							:title="t('agent.settings.plugins.refreshRemote')"
							@click="reload"
							><i
								v-if="!operation.busy.value && !catalogLoading"
								class="fa-solid fa-arrows-rotate"
								aria-hidden="true"
							></i
							><span class="plugin-market__dialog-action-label">{{
								t('agent.settings.plugins.refreshRemote')
							}}</span></UiButton
						>
					</form>

					<div v-if="catalogSources.length" class="plugin-market__sources">
						<div v-for="group in catalogSources" :key="group.key" class="plugin-market__source">
							<button
								type="button"
								class="inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-xs text-text-secondary"
								:title="group.sourceUrl"
								:aria-label="sourceLabelForCopy(group.official, group.sourceUrl)"
								@click="copyCatalogUrl(group.sourceUrl)"
							>
								<i
									:class="group.github ? 'fa-brands fa-github' : 'fa-solid fa-server'"
									aria-hidden="true"
								></i>
								<span class="ui-catalog-group-label min-w-0 truncate">{{ group.owner }}</span>
								<UiBadge
									:class="group.official ? 'ui-catalog-tag-badge' : 'ui-catalog-type-badge'"
									:tone="group.official ? 'primary' : 'neutral'"
									density="compact"
									>{{
										t(
											group.official
												? 'agent.settings.plugins.officialRepository'
												: 'agent.settings.plugins.thirdPartyRepository',
										)
									}}</UiBadge
								>
							</button>
							<UiButton
								v-if="group.removalUrl !== null"
								type="button"
								appearance="ghost"
								tone="danger"
								density="compact"
								icon-only
								:aria-label="t('agent.settings.plugins.removeRepository') + ' · ' + group.owner"
								:title="t('agent.settings.plugins.removeRepository')"
								:disabled="locked"
								@click="removeRepository(group.removalUrl)"
								><i class="fa-regular fa-trash-can text-[11px]" aria-hidden="true"></i
							></UiButton>
						</div>
					</div>
				</div>
			</UiModal>

			<div v-if="filteredPlugins.length" class="plugin-market__entries">
				<div
					v-for="{ id, selected: { entry, catalog, source, key: selectedKey }, options } in filteredPlugins"
					:key="id"
					class="plugin-market__entry rounded-xl border border-border/60 bg-card/20 p-3"
				>
					<div class="plugin-market__entry-heading">
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm shadow-2xs transition-transform"
							:class="
								entry.definitionId === 'nexus.agent'
									? 'bg-primary/15 text-primary ring-1 ring-primary/25'
									: entry.definitionId === 'nexus.fullstack'
										? 'bg-success/15 text-success ring-1 ring-success/25'
										: 'bg-primary/10 text-primary ring-1 ring-primary/20'
							"
						>
							<i
								:class="
									entry.definitionId === 'nexus.agent'
										? 'fa-solid fa-wand-magic-sparkles'
										: entry.definitionId === 'nexus.fullstack'
											? 'fa-solid fa-layer-group'
											: 'fa-solid fa-puzzle-piece'
								"
								aria-hidden="true"
							></i>
						</div>
						<span
							:title="
								entry.contributionKinds
									.map((kind) => t(`agent.settings.plugins.contributionKinds.${kind}`))
									.join(', ')
							"
							class="plugin-market__name ui-catalog-name text-xs sm:text-sm font-bold text-foreground"
							>{{ catalogText(entry).displayName }}</span
						>
						<div class="plugin-market__entry-status">
							<UiBadge
								class="ui-catalog-status-badge"
								:tone="catalogEntryState(entry).tone"
								density="compact"
								>{{ catalogEntryState(entry).label }}</UiBadge
							>
							<UiBadge
								v-if="hasRetainedData(entry)"
								class="ui-catalog-status-badge"
								tone="warning"
								density="compact"
							>
								{{ t('agent.settings.plugins.hasRetainedData') }}
							</UiBadge>
						</div>
					</div>
					<div class="plugin-market__entry-body text-text-secondary">
						<p class="plugin-market__description text-xs leading-relaxed">
							{{ catalogText(entry).description }}
						</p>
						<span v-if="!entry.compatible" class="block break-all text-[11px] text-warning font-mono">
							{{
								entry.compatibilityReason === 'host_version'
									? t('agent.settings.plugins.compatibilityShort', {
											min: entry.compatibility.host.minVersion,
											max: entry.compatibility.host.maxVersion,
										})
									: t(`agent.settings.plugins.compatibilityReasons.${entry.compatibilityReason}`)
							}}
						</span>
						<span class="plugin-market__definition font-mono text-[11px] text-text-secondary">
							{{ entry.definitionId }}
						</span>
					</div>
					<div class="plugin-market__entry-footer">
						<UiSelect
							density="comfortable"
							class="plugin-market__version"
							:aria-label="t('agent.settings.plugins.selectVersion')"
							:model-value="needsVersionChoice(source, entry) ? '' : selectedKey"
							:disabled="locked"
							@update:model-value="selectVersion(id, $event)"
						>
							<option v-if="needsVersionChoice(source, entry)" value="">
								{{ t('agent.settings.plugins.selectVersion') }}
							</option>
							<option v-for="option in options" :key="option.key" :value="option.key">
								v{{ option.entry.version }} · {{ sourceLabel(option) }}
							</option>
						</UiSelect>

						<div class="plugin-market__actions">
							<UiButton
								density="comfortable"
								v-if="hasRetainedData(entry)"
								type="button"
								appearance="soft"
								tone="danger"
								:disabled="locked"
								@click="requestClearData(entry)"
							>
								{{ t('agent.settings.plugins.deleteData') }}
							</UiButton>
							<UiButton
								density="comfortable"
								appearance="soft"
								tone="neutral"
								v-if="source !== null && !publisherTrusted(entry.publisherKeyId)"
								type="button"
								:disabled="
									locked ||
									!catalog.publishers.some((publisher) => publisher.keyId === entry.publisherKeyId)
								"
								@click="trustRemotePublisher(catalog, entry.publisherKeyId)"
							>
								{{ t('agent.settings.plugins.trustRemotePublisher') }}
							</UiButton>

							<UiButton
								density="comfortable"
								type="button"
								:appearance="installedFor(entry) ? 'soft' : 'solid'"
								:tone="installedFor(entry) ? 'neutral' : 'primary'"
								:disabled="
									locked ||
									!entry.compatible ||
									!satisfiesAppRequirements(entry, appRequirements) ||
									hasNewerInstalled(entry) ||
									needsVersionChoice(source, entry) ||
									(source !== null && !publisherTrusted(entry.publisherKeyId))
								"
								@click="prepare(entry, source)"
							>
								<i
									:class="
										installedFor(entry)
											? 'fa-solid fa-arrows-rotate text-[11px]'
											: 'fa-solid fa-download text-[11px]'
									"
									aria-hidden="true"
								></i>
								<span>{{ catalogEntryAction(entry) }}</span>
							</UiButton>
						</div>
					</div>
				</div>
			</div>

			<div
				v-if="retainedPackagesOutsideCatalog.length || retainedOutsideCatalog.length"
				class="plugin-market__managed-list mt-3"
			>
				<article
					v-for="item in retainedPackagesOutsideCatalog"
					:key="item.installation.packageId"
					:aria-label="item.name"
					class="plugin-market__managed-entry rounded-xl border border-border/60 bg-card/20 px-3 py-2.5"
				>
					<div class="plugin-market__managed-identity">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs"
							:class="
								item.installation.status === 'removed'
									? 'bg-warning/10 text-warning'
									: 'bg-primary/10 text-primary'
							"
						>
							<i
								:class="
									item.installation.status === 'removed'
										? 'fa-solid fa-box-archive'
										: 'fa-solid fa-puzzle-piece'
								"
								aria-hidden="true"
							></i>
						</div>
						<div class="plugin-market__managed-labels">
							<h5 class="ui-catalog-name max-w-full truncate text-xs font-semibold" :title="item.name">
								{{ item.name }}
							</h5>
							<span class="font-mono text-[11px] text-text-secondary"
								>v{{ item.installation.version }}</span
							>
							<UiBadge
								v-if="item.installation.status !== 'installed'"
								class="ui-catalog-status-badge"
								tone="warning"
								density="compact"
								>{{
									item.installation.status === 'removed'
										? t('agent.settings.plugins.hasRetainedData')
										: t(`agent.settings.plugins.packageStates.${item.installation.status}`)
								}}</UiBadge
							>
						</div>
					</div>
					<div class="plugin-market__managed-actions">
						<UiPopover
							v-if="active && packageReferenced(item.installation)"
							:ariaLabel="t('agent.settings.plugins.packageReferenced')"
							:title="t('agent.settings.plugins.packageReferenced')"
							trigger-appearance="ghost"
							density="compact"
							icon-only
							align="end"
						>
							<template #trigger
								><i class="fa-solid fa-link text-[11px] text-text-secondary" aria-hidden="true"></i
							></template>
							<template #panel>
								<p class="max-w-64 text-xs leading-relaxed text-text-secondary">
									{{ t('agent.settings.plugins.packageReferenced') }}
								</p>
							</template>
						</UiPopover>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							density="compact"
							:title="
								t(
									item.installation.status === 'removed'
										? 'agent.settings.plugins.deleteData'
										: 'agent.settings.plugins.uninstallPackage',
								)
							"
							:aria-label="
								t(
									item.installation.status === 'removed'
										? 'agent.settings.plugins.deleteData'
										: 'agent.settings.plugins.uninstallPackage',
								)
							"
							:disabled="blocked || packageReferenced(item.installation)"
							@click="requestPackageRemoval(item.installation)"
						>
							<i class="fa-regular fa-trash-can text-[11px]" aria-hidden="true"></i
							><span class="plugin-market__managed-action-label">{{
								t(
									item.installation.status === 'removed'
										? 'agent.settings.plugins.deleteData'
										: 'agent.settings.plugins.uninstallPackage',
								)
							}}</span>
						</UiButton>
					</div>
				</article>
				<article
					v-for="item in retainedOutsideCatalog"
					:key="item.installation.appId"
					:aria-label="item.name"
					class="plugin-market__managed-entry rounded-xl border border-border/60 bg-card/20 px-3 py-2.5"
				>
					<div class="plugin-market__managed-identity">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-xs text-warning"
						>
							<i class="fa-solid fa-box-archive" aria-hidden="true"></i>
						</div>
						<div class="plugin-market__managed-labels">
							<h5 class="ui-catalog-name max-w-full truncate text-xs font-semibold" :title="item.name">
								{{ item.name }}
							</h5>
							<UiBadge class="ui-catalog-status-badge" tone="warning" density="compact">{{
								t('agent.settings.plugins.hasRetainedData')
							}}</UiBadge>
						</div>
					</div>
					<div class="plugin-market__managed-actions">
						<UiPopover
							v-if="active"
							:ariaLabel="t('agent.settings.plugins.retainedSourceUnavailable')"
							:title="t('agent.settings.plugins.retainedSourceUnavailable')"
							trigger-appearance="ghost"
							density="compact"
							icon-only
							align="end"
						>
							<template #trigger
								><i
									class="fa-solid fa-circle-info text-[11px] text-text-secondary"
									aria-hidden="true"
								></i
							></template>
							<template #panel>
								<p class="max-w-64 text-xs leading-relaxed text-text-secondary">
									{{ t('agent.settings.plugins.retainedSourceUnavailable') }}
								</p>
							</template>
						</UiPopover>
						<UiButton
							type="button"
							appearance="ghost"
							tone="danger"
							density="compact"
							:aria-label="t('agent.settings.plugins.deleteData')"
							:title="t('agent.settings.plugins.deleteData')"
							:disabled="blocked"
							@click="requestClearRetained(item.installation, item.name)"
						>
							<i class="fa-regular fa-trash-can text-[11px]" aria-hidden="true"></i
							><span class="plugin-market__managed-action-label">{{
								t('agent.settings.plugins.deleteData')
							}}</span>
						</UiButton>
					</div>
				</article>
			</div>
			<UiEmptyState
				v-if="
					catalogs.length > 0 &&
					searchQuery &&
					!filteredPlugins.length &&
					!retainedOutsideCatalog.length &&
					!retainedPackagesOutsideCatalog.length
				"
				class="mt-3.5 border-t border-border pt-4 pb-4"
				compact
				:bordered="false"
				icon="fa-solid fa-magnifying-glass"
				:title="t('agent.settings.plugins.searchEmpty')"
			>
				<template #action>
					<UiButton appearance="ghost" density="compact" @click="searchQuery = ''">
						{{ t('agent.settings.plugins.clearSearch') }}
					</UiButton>
				</template>
			</UiEmptyState>
		</div>
		<UiInlineNotice v-for="failure in sourceErrors" :key="failure.source" tone="warning">
			{{ failure.source }} — {{ t(`agent.settings.plugins.sourceErrors.${failure.reason}`) }}
			<span v-if="failure.stale">({{ t('agent.settings.plugins.catalogStale') }})</span>
		</UiInlineNotice>
		<UiInlineNotice v-if="unknown" tone="warning">
			<p>{{ t('agent.pluginManagement.unknown') }}</p>
			<label class="inline-flex min-w-0 items-start gap-2 text-sm text-foreground">
				<UiCheckbox
					v-model="acknowledged"
					class="shrink-0"
					:aria-label="t('agent.pluginManagement.acknowledge')"
				/>
				<span class="min-w-0">{{ t('agent.pluginManagement.acknowledge') }}</span>
			</label>
			<UiButton
				type="button"
				:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
				@click="newIntent"
				>{{ t('agent.pluginManagement.newIntent') }}</UiButton
			>
		</UiInlineNotice>
		<UiConfirmationPanel
			:visible="active && Boolean(removalPackage)"
			:title="
				t(
					removalPackage?.status === 'removed'
						? 'agent.settings.plugins.clearDataTitle'
						: 'agent.settings.plugins.uninstallPackage',
				)
			"
			:description="removalPackage?.packageId"
			tone="danger"
			:close-on-backdrop="!clearing"
			:close-on-escape="!clearing"
			@close="packageRemoval = null"
		>
			<label
				v-if="removalPackage?.status !== 'removed'"
				class="inline-flex min-w-0 items-start gap-2 text-sm text-foreground"
			>
				<UiCheckbox
					v-model="clearPackageData"
					class="shrink-0"
					:aria-label="t('agent.settings.plugins.clearPackageData')"
					:disabled="clearing"
				/>
				<span class="min-w-0">{{ t('agent.settings.plugins.clearPackageData') }}</span>
			</label>
			<p class="text-sm leading-relaxed text-text-secondary">
				{{ t('agent.settings.plugins.packageDataScope') }}
			</p>
			<template #actions>
				<UiButton type="button" :disabled="clearing" @click="packageRemoval = null">{{
					t('common.cancel')
				}}</UiButton>
				<UiButton
					type="button"
					appearance="solid"
					tone="danger"
					:loading="clearing"
					:disabled="blocked || !removalPackage || packageReferenced(removalPackage)"
					@click="confirmPackageRemoval"
					>{{
						t(
							removalPackage?.status === 'removed'
								? 'agent.settings.plugins.deleteData'
								: 'agent.settings.plugins.uninstallPackage',
						)
					}}</UiButton
				>
			</template>
		</UiConfirmationPanel>

		<UiConfirmationPanel
			:visible="active && Boolean(clearInstallation) && retainedApps.has(clearAppId)"
			:title="t('agent.settings.plugins.clearDataTitle')"
			:description="t('agent.settings.plugins.clearDataPrompt', { name: clearAppName })"
			tone="danger"
			:close-on-backdrop="!clearing"
			:close-on-escape="!clearing"
			@close="clearAppId = ''"
		>
			<p class="text-sm leading-relaxed text-text-secondary">{{ t('agent.settings.plugins.clearDataScope') }}</p>
			<template #actions>
				<UiButton type="button" :disabled="clearing" @click="clearAppId = ''">{{
					t('common.cancel')
				}}</UiButton>
				<UiButton
					type="button"
					appearance="solid"
					tone="danger"
					:loading="clearing"
					:disabled="blocked"
					@click="confirmClearData"
				>
					{{ t('agent.settings.plugins.deleteData') }}
				</UiButton>
			</template>
		</UiConfirmationPanel>
	</section>
</template>

<style scoped>
	.plugin-market {
		min-width: 0;
		container: plugin-market / inline-size;
	}

	.plugin-market__tools {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
	}

	.plugin-market__add {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 8px;
	}

	.plugin-market__content {
		padding: 1rem;
	}

	.plugin-market__sources {
		display: grid;
		gap: 0.5rem;
	}
	.plugin-market__source {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		max-width: 100%;
		justify-content: space-between;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
	}

	.plugin-market__version {
		min-width: 0;
		max-width: 100%;
		flex-shrink: 1;
	}

	.plugin-market__entries {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		padding-block: 0.75rem;
	}

	.plugin-market__entry {
		display: grid;
		grid-template-rows: auto 1fr auto;
		min-width: 0;
		gap: 0.75rem;
	}

	.plugin-market__entry-heading {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.625rem;
	}

	.plugin-market__entry-status {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.375rem;
	}

	.plugin-market__entry-body {
		min-width: 0;
	}

	.plugin-market__name,
	.plugin-market__description {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.plugin-market__definition {
		display: none;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.plugin-market__entry-footer {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}

	.plugin-market__managed-list {
		display: grid;
		gap: 0.5rem;
	}

	.plugin-market__managed-entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.plugin-market__managed-identity {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.plugin-market__managed-labels {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		min-width: 0;
	}

	.plugin-market__managed-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.plugin-market__managed-action-label {
		display: none;
	}

	.plugin-market__actions {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	@container plugin-market (max-width: 24rem) {
		.plugin-market__entry-footer {
			grid-template-columns: minmax(0, 1fr);
		}
		.plugin-market__content {
			padding: 0;
		}

		.plugin-market__add-label {
			display: none;
		}
	}

	@media (max-width: 639px) {
		.plugin-market__dialog-action-label {
			display: none;
		}
	}

	@container plugin-market (min-width: 48rem) {
		.plugin-market__managed-action-label {
			display: inline;
		}

		.plugin-market__entries {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.plugin-market__definition {
			display: block;
			margin-top: 0.375rem;
		}
	}
</style>
