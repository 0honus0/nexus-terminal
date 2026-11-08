<script setup lang="ts">
	import { prerelease, compare } from 'semver';
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
		recommendedCatalogEntries,
		satisfiesAppRequirements,
	} from '../model/plugin-market-rules';
	import { AgentManagementFailure } from '../../model/management-failure';
	import type { ManagedApp } from '../../model/app-management-types';

	interface CatalogSource {
		source: string | null;
		catalog: PluginCatalog;
	}

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
		cancelPackageUpdate: [installation: PluginPackageInstallation];
		settings: [installation: PluginPackageInstallation];
	}>();
	const { t, locale } = useI18n();

	const catalogText = (entry: PluginCatalogEntry) => localizeCatalogEntry(entry, locale.value);

	const feedback = useOperationFeedback('agent.settings.plugin-market');
	const collapsedSources = ref(new Set<string>());
	const copiedSourceUrl = ref('');
	const repositories = ref<PluginRepositories | null>(null);
	const repositoryUrl = ref('');
	const searchQuery = ref('');
	const catalogs = ref<CatalogSource[]>([]);
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
	const appRequirements = computed(() => {
		const installedHashes = new Set(
			props.packageInstallations.filter((item) => item.status !== 'removed').map((item) => item.packageHash),
		);
		return props.versions
			.filter((version) => installedHashes.has(version.packageHash))
			.flatMap((version) => version.manifest.dependencies);
	});

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
	const managedPackages = computed(() => {
		const versions = new Map(props.versions.map((version) => [version.packageHash, version]));
		const query = searchQuery.value.trim().toLowerCase();
		return props.packageInstallations
			.filter((item) => item.status !== 'removed' || retainedPackages.value.has(item.packageId))
			.map((installation) => ({
				installation,
				name: versions.get(installation.packageHash)?.manifest.displayName ?? installation.packageId,
				settings:
					versions.get(installation.packageHash)?.publisherKeyId === installation.publisherKeyId &&
					versions.get(installation.packageHash)?.manifest.id === installation.packageId &&
					versions.get(installation.packageHash)?.manifest.version === installation.version &&
					versions.get(installation.packageHash)?.manifest.settings !== null &&
					versions.get(installation.packageHash)?.manifest.settings !== undefined,
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

	const totalPluginCount = computed(() =>
		catalogs.value.reduce(
			(total, item) => total + recommendedCatalogEntries(item.catalog.packages, appRequirements.value).length,
			0,
		),
	);
	const configuredRepositories = computed(() => repositories.value?.urls.map((url) => ({ url })) ?? []);
	const filteredCatalogGroups = computed(() => {
		const query = searchQuery.value.trim().toLowerCase();
		return catalogs.value
			.map(({ source, catalog }) => {
				const address = new URL(catalog.repositoryUrl);
				const segments = address.pathname.split('/').filter(Boolean);
				const owner =
					address.hostname === 'github.com' || address.hostname === 'raw.githubusercontent.com'
						? (segments[0] ?? address.hostname)
						: address.hostname;
				return {
					key: source ?? 'official',
					owner,
					official: source === null,
					sourceUrl: catalog.repositoryUrl,
					packages: recommendedCatalogEntries(catalog.packages, appRequirements.value)
						.map(
							(candidate) =>
								catalog.packages.find(
									(entry) =>
										entry.definitionId === candidate.definitionId &&
										entry.publisherKeyId === candidate.publisherKeyId &&
										entry.version === selectedVersions.value.get(versionKey(source, candidate)),
								) ?? candidate,
						)
						.filter(
							(entry) =>
								!query ||
								[
									catalogText(entry).displayName,
									entry.definitionId,
									catalogText(entry).description,
								].some((value) => value.toLowerCase().includes(query)),
						)
						.map((entry) => ({ package: entry, catalog, source, official: source === null })),
				};
			})
			.filter((group) => group.packages.length > 0 || !query);
	});

	function versionKey(source: string | null, entry: PluginCatalogEntry): string {
		return JSON.stringify([source, entry.publisherKeyId, entry.definitionId]);
	}

	function versionOptions(catalog: PluginCatalog, entry: PluginCatalogEntry): PluginCatalogEntry[] {
		return catalog.packages
			.filter(
				(candidate) =>
					candidate.definitionId === entry.definitionId && candidate.publisherKeyId === entry.publisherKeyId,
			)
			.toSorted((left, right) => compare(right.version, left.version));
	}

	function selectVersion(source: string | null, entry: PluginCatalogEntry, version: string | number | null): void {
		if (typeof version === 'string') selectedVersions.value.set(versionKey(source, entry), version);
	}

	function needsVersionChoice(source: string | null, entry: PluginCatalogEntry): boolean {
		return (
			prerelease(entry.version) !== null &&
			selectedVersions.value.get(versionKey(source, entry)) !== entry.version
		);
	}

	function isGroupExpanded(key: string): boolean {
		return !collapsedSources.value.has(key);
	}

	function toggleGroup(key: string): void {
		if (collapsedSources.value.has(key)) collapsedSources.value.delete(key);
		else collapsedSources.value.add(key);
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

	function requestClearData(entry: PluginCatalogEntry): void {
		const installation = retainedFor(entry);
		if (locked.value || !installation) return;
		requestClearRetained(installation, catalogText(entry).displayName);
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
		return (
			props.installations.some(
				(item) =>
					item.status !== 'removed' &&
					item.definitionId === installation.packageId &&
					item.publisherKeyId === installation.publisherKeyId,
			) ||
			appRequirements.value.some(
				(requirement) =>
					requirement.packageId === installation.packageId &&
					requirement.publisherKeyId === installation.publisherKeyId,
			)
		);
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
		if (retainedFor(entry)) return t('agent.settings.plugins.reinstall');
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
		<div class="rounded-xl bg-header/25 p-3.5 sm:p-4">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					<i class="fa-solid fa-boxes-stacked text-xs text-primary" aria-hidden="true"></i>
					<h4 class="min-w-0 break-words text-xs font-semibold text-foreground">
						{{ t('agent.settings.plugins.remoteRepositories') }}
					</h4>
					<UiBadge v-if="totalPluginCount > 0" tone="primary" density="compact">
						{{ totalPluginCount }}
					</UiBadge>
				</div>
				<UiButton
					type="button"
					appearance="ghost"
					tone="neutral"
					density="compact"
					class="shrink-0"
					:loading="operation.busy.value || catalogLoading"
					:disabled="locked"
					:aria-label="t('agent.settings.plugins.refreshRemote')"
					:title="t('agent.settings.plugins.refreshRemote')"
					@click="reload"
				>
					<i
						v-if="!operation.busy.value && !catalogLoading"
						class="fa-solid fa-arrows-rotate text-xs"
						aria-hidden="true"
					></i>
					<span class="plugin-market__refresh-label">{{ t('agent.settings.plugins.refreshRemote') }}</span>
				</UiButton>
			</div>

			<div class="plugin-market__add mt-3">
				<UiInput
					v-model="repositoryUrl"
					:aria-label="t('agent.settings.plugins.repositoryUrl')"
					density="compact"
					class="min-w-0 w-full"
					:placeholder="t('agent.settings.plugins.repositoryUrl')"
					:disabled="locked"
				>
					<template #leading>
						<i class="fa-solid fa-link" aria-hidden="true"></i>
					</template>
				</UiInput>
				<div class="flex items-center justify-end gap-2">
					<UiButton
						appearance="solid"
						tone="primary"
						density="compact"
						type="button"
						:disabled="locked || !repositoryUrl.trim()"
						:aria-label="t('agent.settings.plugins.addRepository')"
						:title="t('agent.settings.plugins.addRepository')"
						@click="addRepository"
					>
						<i class="fa-solid fa-plus" aria-hidden="true"></i>
						<span class="plugin-market__add-label">{{ t('agent.settings.plugins.addRepository') }}</span>
					</UiButton>
				</div>
			</div>

			<div class="mt-3 w-full">
				<UiSearchInput
					v-model="searchQuery"
					:aria-label="t('agent.settings.plugins.searchPlaceholder')"
					density="compact"
					class="w-full"
					:placeholder="t('agent.settings.plugins.searchPlaceholder')"
					:clear-label="t('common.clear')"
				/>
			</div>

			<div v-if="configuredRepositories.length" class="mt-3 flex flex-wrap gap-2 pt-3 border-t border-border">
				<div
					v-for="repository in configuredRepositories"
					:key="repository.url"
					class="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 shadow-2xs text-xs"
				>
					<i class="fa-solid fa-globe text-[10px] text-primary/70" aria-hidden="true"></i>
					<span
						class="min-w-0 max-w-[36rem] truncate font-mono text-[11px] text-foreground"
						:title="repository.url"
						>{{ repository.url }}</span
					>
					<UiButton
						type="button"
						appearance="ghost"
						tone="danger"
						density="compact"
						icon-only
						class="shrink-0"
						:aria-label="t('agent.settings.plugins.removeRepository')"
						:title="t('agent.settings.plugins.removeRepository')"
						:disabled="locked"
						@click="removeRepository(repository.url)"
					>
						<i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
					</UiButton>
				</div>
			</div>

			<div v-if="filteredCatalogGroups.length" class="mt-3.5 pt-3.5 border-t border-border space-y-3">
				<div
					v-for="group in filteredCatalogGroups"
					:key="group.key"
					class="ui-glass-chrome overflow-hidden rounded-xl transition-all duration-200"
				>
					<div
						role="button"
						tabindex="0"
						:aria-expanded="isGroupExpanded(group.key)"
						class="w-full flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2.5 sm:py-3 hover:bg-header/30 transition-colors select-none cursor-pointer"
						@click="toggleGroup(group.key)"
						@keydown.enter.space.prevent="toggleGroup(group.key)"
					>
						<div class="plugin-market__repository-heading">
							<i
								:class="
									isGroupExpanded(group.key)
										? 'fa-solid fa-chevron-down'
										: 'fa-solid fa-chevron-right'
								"
								class="text-[11px] text-text-secondary w-3 text-center transition-transform shrink-0"
								aria-hidden="true"
							></i>
							<div
								class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-header/80 text-foreground/80 border border-border/60"
							>
								<i class="fa-brands fa-github text-xs" aria-hidden="true"></i>
							</div>
							<div class="plugin-market__repository-owner">
								<span
									class="ui-catalog-group-label min-w-0 break-all text-xs sm:text-sm font-bold text-foreground font-mono"
									>{{ group.owner }}</span
								>
							</div>
							<UiBadge
								v-if="group.official"
								class="ui-catalog-tag-badge shrink-0"
								tone="primary"
								density="compact"
							>
								<i class="fa-solid fa-certificate text-[8px]" aria-hidden="true"></i>
								<span>{{ t('agent.settings.plugins.officialRepository') }}</span>
							</UiBadge>
							<UiBadge v-else appearance="ghost" density="compact" class="ui-catalog-type-badge shrink-0">
								<i class="fa-solid fa-network-wired text-[8px]" aria-hidden="true"></i>
								<span>{{ t('agent.settings.plugins.thirdPartyRepository') }}</span>
							</UiBadge>
							<UiBadge
								class="plugin-market__repository-count shrink-0 font-mono"
								appearance="ghost"
								density="compact"
							>
								{{ t('agent.settings.plugins.pluginCount', { count: group.packages.length }) }}
							</UiBadge>

							<UiButton
								v-if="group.sourceUrl"
								type="button"
								appearance="ghost"
								density="compact"
								class="plugin-market__source font-mono text-[11px] text-text-secondary"
								:title="group.sourceUrl"
								@click.stop="copyCatalogUrl(group.sourceUrl)"
								@keydown.stop
								:aria-label="t('agent.settings.plugins.copy')"
							>
								<i
									:class="
										copiedSourceUrl === group.sourceUrl
											? 'fa-solid fa-check text-success'
											: 'fa-regular fa-copy'
									"
									class="text-[10px] shrink-0"
									aria-hidden="true"
								></i>
								<span class="min-w-0 truncate">
									{{ group.sourceUrl }}
								</span>
							</UiButton>
						</div>
					</div>

					<div v-if="isGroupExpanded(group.key)" class="space-y-1 px-3 pb-1 sm:px-4">
						<div class="grid grid-cols-1">
							<div
								v-for="{ package: entry, catalog, official, source } in group.packages"
								:key="`${entry.publisherKeyId}/${entry.definitionId}`"
								class="plugin-market__entry border-b border-border/30 py-3 last:border-b-0 hover:bg-card/30"
							>
								<div class="flex items-start gap-3 min-w-0">
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

									<div class="min-w-0 flex-1">
										<div class="plugin-market__entry-heading">
											<span
												:title="
													entry.contributionKinds
														.map((kind) =>
															t(`agent.settings.plugins.contributionKinds.${kind}`),
														)
														.join(', ')
												"
												class="plugin-market__name ui-catalog-name text-xs sm:text-sm font-bold text-foreground"
												>{{ catalogText(entry).displayName }}</span
											>
											<UiSelect
												fit-content
												class="plugin-market__version"
												:aria-label="t('agent.settings.plugins.selectVersion')"
												:model-value="needsVersionChoice(source, entry) ? '' : entry.version"
												:disabled="locked"
												density="compact"
												@update:model-value="selectVersion(source, entry, $event)"
											>
												<option v-if="needsVersionChoice(source, entry)" value="">
													{{ t('agent.settings.plugins.selectVersion') }}
												</option>
												<option
													v-for="version in versionOptions(catalog, entry)"
													:key="version.version"
													:value="version.version"
												>
													v{{ version.version }}
												</option>
											</UiSelect>
											<UiBadge
												class="ui-catalog-status-badge"
												:tone="catalogEntryState(entry).tone"
												density="compact"
												>{{ catalogEntryState(entry).label }}</UiBadge
											>
											<UiBadge
												v-if="retainedFor(entry)"
												class="ui-catalog-status-badge"
												tone="warning"
												density="compact"
											>
												{{ t('agent.settings.plugins.hasRetainedData') }}
											</UiBadge>
											<span
												class="plugin-market__definition font-mono text-[11px] text-text-secondary"
											>
												{{ entry.definitionId }}
											</span>
										</div>

										<div class="mt-1 space-y-1 text-xs text-text-secondary">
											<p class="plugin-market__description text-xs leading-relaxed">
												{{ catalogText(entry).description }}
											</p>
											<span
												v-if="!entry.compatible"
												class="block break-all text-[11px] text-warning font-mono"
											>
												{{
													entry.compatibilityReason === 'host_version'
														? t('agent.settings.plugins.compatibilityShort', {
																min: entry.compatibility.host.minVersion,
																max: entry.compatibility.host.maxVersion,
															})
														: t(
																`agent.settings.plugins.compatibilityReasons.${entry.compatibilityReason}`,
															)
												}}
											</span>
										</div>
									</div>
								</div>

								<div class="plugin-market__actions">
									<UiButton
										v-if="retainedFor(entry)"
										type="button"
										appearance="soft"
										tone="danger"
										:disabled="locked"
										@click="requestClearData(entry)"
									>
										{{ t('agent.settings.plugins.deleteData') }}
									</UiButton>
									<UiButton
										appearance="soft"
										tone="neutral"
										v-if="!official && !publisherTrusted(entry.publisherKeyId)"
										type="button"
										:disabled="
											locked ||
											!catalog.publishers.some(
												(publisher) => publisher.keyId === entry.publisherKeyId,
											)
										"
										@click="trustRemotePublisher(catalog, entry.publisherKeyId)"
									>
										{{ t('agent.settings.plugins.trustRemotePublisher') }}
									</UiButton>

									<UiButton
										type="button"
										:appearance="installedFor(entry) ? 'soft' : 'solid'"
										:tone="installedFor(entry) ? 'neutral' : 'primary'"
										:disabled="
											locked ||
											!entry.compatible ||
											!satisfiesAppRequirements(entry, appRequirements) ||
											hasNewerInstalled(entry) ||
											needsVersionChoice(source, entry) ||
											(!official && !publisherTrusted(entry.publisherKeyId))
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
				</div>
			</div>

			<h4
				v-if="managedPackages.length || retainedOutsideCatalog.length"
				class="mt-5 border-t border-border pt-4 text-xs font-semibold text-foreground"
			>
				{{ t('agent.settings.plugins.managedPackages') }}
			</h4>
			<div
				v-for="item in managedPackages"
				:key="item.installation.packageId"
				class="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border/35 py-3"
			>
				<div class="min-w-0 space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-semibold text-foreground">{{ item.name }}</span>
						<UiBadge density="compact">v{{ item.installation.version }}</UiBadge>
						<UiBadge v-if="item.installation.status === 'removed'" tone="warning" density="compact">{{
							t('agent.settings.plugins.hasRetainedData')
						}}</UiBadge>
						<UiBadge
							v-else
							:tone="item.installation.status === 'installed' ? 'success' : 'warning'"
							density="compact"
							>{{ t(`agent.settings.plugins.packageStates.${item.installation.status}`) }}</UiBadge
						>
					</div>
					<p v-if="packageReferenced(item.installation)" class="text-xs text-text-secondary">
						{{ t('agent.settings.plugins.packageReferenced') }}
					</p>
				</div>
				<div class="flex flex-wrap items-center justify-end gap-2">
					<UiButton
						v-if="item.settings"
						type="button"
						appearance="soft"
						:disabled="!active || locked || item.installation.status !== 'installed'"
						@click="emit('settings', item.installation)"
						>{{ t('agent.settings.plugins.settings.open') }}</UiButton
					>
					<UiButton
						v-if="item.installation.status === 'draining'"
						type="button"
						appearance="soft"
						:disabled="blocked"
						@click="emit('cancelPackageUpdate', item.installation)"
						>{{ t('agent.settings.plugins.cancelUpgrade') }}</UiButton
					>
					<UiButton
						type="button"
						appearance="soft"
						tone="danger"
						:disabled="blocked || packageReferenced(item.installation)"
						@click="requestPackageRemoval(item.installation)"
						>{{
							t(
								item.installation.status === 'removed'
									? 'agent.settings.plugins.deleteData'
									: 'agent.settings.plugins.uninstallPackage',
							)
						}}</UiButton
					>
				</div>
			</div>

			<div
				v-for="item in retainedOutsideCatalog"
				:key="item.installation.appId"
				class="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border/35 py-3"
			>
				<div class="min-w-0 space-y-1">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-semibold text-foreground">{{ item.name }}</span>
						<UiBadge tone="warning" density="compact">{{
							t('agent.settings.plugins.hasRetainedData')
						}}</UiBadge>
					</div>
					<p class="text-xs text-text-secondary">
						{{ t('agent.settings.plugins.retainedSourceUnavailable') }}
					</p>
				</div>
				<UiButton
					type="button"
					appearance="soft"
					tone="danger"
					:disabled="blocked"
					@click="requestClearRetained(item.installation, item.name)"
				>
					{{ t('agent.settings.plugins.deleteData') }}
				</UiButton>
			</div>
			<UiEmptyState
				v-if="
					catalogs.length > 0 &&
					searchQuery &&
					!filteredCatalogGroups.length &&
					!retainedOutsideCatalog.length &&
					!managedPackages.length
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
			<UiCheckbox v-model="acknowledged">{{ t('agent.pluginManagement.acknowledge') }}</UiCheckbox>
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
			<UiCheckbox v-if="removalPackage?.status !== 'removed'" v-model="clearPackageData" :disabled="clearing">{{
				t('agent.settings.plugins.clearPackageData')
			}}</UiCheckbox>
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

	.plugin-market__add {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
	}

	.plugin-market__repository-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}

	.plugin-market__repository-owner {
		min-width: 0;
		flex: 1;
	}

	.plugin-market__version {
		max-width: 100%;
	}

	.plugin-market__source {
		flex-basis: 100%;
		min-width: 0;
		max-width: 100%;
		justify-content: flex-start;
	}

	.plugin-market__entry {
		display: grid;
		min-width: 0;
		gap: 12px;
	}

	.plugin-market__entry-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
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

	.plugin-market__actions {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}

	@container plugin-market (max-width: 24rem) {
		.plugin-market__name {
			flex-basis: 100%;
		}

		.plugin-market__actions {
			justify-content: flex-start;
		}

		.plugin-market__add-label,
		.plugin-market__repository-count {
			display: none;
		}

		.plugin-market__refresh-label {
			display: none;
		}
	}

	@container plugin-market (min-width: 48rem) {
		.plugin-market__entry {
			grid-template-columns: minmax(0, 1fr) minmax(0, auto);
			align-items: center;
			column-gap: 24px;
		}

		.plugin-market__actions {
			max-width: 24rem;
		}

		.plugin-market__definition {
			display: inline;
		}
	}
</style>
