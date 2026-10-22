<script setup lang="ts">
	import { computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import { getPluginCatalog, getPluginRepositories, updatePluginRepositories } from '../api/plugin-management-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type {
		PluginCatalog,
		PluginCatalogEntry,
		PluginRepositories,
		PluginPublisher,
		PluginInstallation,
	} from '../model/plugin-types';
	import { useOperationFeedback } from '@/shared/feedback/public';
	import type { ManagedApp } from '../model/app-management-types';

	interface CatalogSource {
		source: string | null;
		catalog: PluginCatalog;
	}

	const props = defineProps<{
		blocked: boolean;
		publishers: PluginPublisher[];
		installations: PluginInstallation[];
		apps: ManagedApp[];
		active: boolean;
	}>();
	const emit = defineEmits<{
		prepare: [entry: PluginCatalogEntry, source: string | null];
		trust: [label: string, pem: string];
		recommend: [];
		officialPublishers: [keyIds: string[]];
	}>();
	const { t } = useI18n();
	const feedback = useOperationFeedback('agent.settings.plugin-market');
	const collapsedSources = ref(new Set<string>());
	const copiedSourceUrl = ref('');
	const repositories = ref<PluginRepositories | null>(null);
	const repositoryUrl = ref('');
	const searchQuery = ref('');
	const catalogs = ref<CatalogSource[]>([]);
	const unknown = ref(false);
	const acknowledged = ref(false);
	let writeIntent: symbol | null = null;
	const operation = useAgentManagementOperation(
		(reason) => {
			repositories.value = null;
			repositoryUrl.value = '';
			searchQuery.value = '';
			catalogs.value = [];
			unknown.value = reason === 'view' && (unknown.value || writeIntent !== null);
			acknowledged.value = false;
		},
		() => props.active,
	);
	const locked = computed(
		() => props.blocked || operation.busy.value || operation.refreshRequired.value || unknown.value,
	);

	const totalPluginCount = computed(() =>
		catalogs.value.reduce((total, item) => total + item.catalog.packages.length, 0),
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
					packages: catalog.packages
						.filter(
							(entry) =>
								!query ||
								[entry.displayName, entry.definitionId, entry.description].some((value) =>
									value.toLowerCase().includes(query),
								),
						)
						.map((entry) => ({ package: entry, catalog, source, official: source === null })),
				};
			})
			.filter((group) => group.packages.length > 0 || !query);
	});

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
		return props.publishers.some((publisher) => publisher.keyId === keyId && publisher.revokedAt === null);
	}

	function prepare(entry: PluginCatalogEntry, source: string | null): void {
		if (locked.value || !entry.compatible) return;
		if (
			source === null &&
			entry.definitionId === 'nexus.agent' &&
			!props.installations.some((item) => item.definitionId === entry.definitionId && item.status !== 'removed')
		)
			emit('recommend');
		else emit('prepare', entry, source);
	}

	function installedFor(entry: PluginCatalogEntry): PluginInstallation | undefined {
		return props.installations.find(
			(installation) => installation.definitionId === entry.definitionId && installation.status !== 'removed',
		);
	}

	function catalogEntryState(entry: PluginCatalogEntry): { label: string; tone: string } {
		if (!entry.compatible) {
			return { label: t('agent.settings.plugins.incompatible'), tone: 'bg-warning/10 text-warning' };
		}
		const installation = installedFor(entry);
		if (!installation) {
			return { label: t('agent.settings.plugins.stateNotInstalled'), tone: 'bg-header text-text-secondary' };
		}
		if (installation.status === 'draining') {
			return { label: t('agent.settings.plugins.stateDraining'), tone: 'bg-warning/10 text-warning' };
		}
		if (installation.version !== entry.version) {
			return { label: t('agent.settings.plugins.stateUpgrade'), tone: 'bg-primary/10 text-primary' };
		}
		const app = props.apps.find((item) => item.id === installation.appId);
		if (app?.enabled) {
			return { label: t('agent.settings.plugins.stateEnabled'), tone: 'bg-success/10 text-success' };
		}
		if (app) {
			return { label: t('agent.settings.plugins.stateDisabled'), tone: 'bg-header text-text-secondary' };
		}
		return { label: t('agent.settings.plugins.stateInstalled'), tone: 'bg-success/10 text-success' };
	}

	function catalogEntryAction(entry: PluginCatalogEntry): string {
		const installation = installedFor(entry);
		if (!installation) return t('agent.settings.plugins.prepareRemote');
		if (installation.version !== entry.version) return t('agent.settings.plugins.prepareUpgrade');
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
		const sources = [null, ...repositories.value.urls];
		await operation.execute(
			async (signal) => {
				const items: CatalogSource[] = [];
				let failed = false;
				for (const source of sources) {
					try {
						items.push({ source, catalog: await getPluginCatalog(source, signal) });
					} catch (cause) {
						if (signal.aborted) throw cause;
						failed = true;
					}
				}
				return { items, failed };
			},
			(result) => {
				catalogs.value = result.items;
				emit(
					'officialPublishers',
					result.items
						.find((item) => item.source === null)
						?.catalog.publishers.map((publisher) => publisher.keyId) ?? [],
				);
				if (result.failed) operation.notice.value = 'failed';
			},
			{ write: false },
		);
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
	onActivated(initial);
	watch(
		() => props.active,
		(active) => {
			if (active) initial();
		},
	);
</script>
<template>
	<section class="space-y-3">
		<UiButton
			v-if="operation.notice.value === 'failed' || operation.notice.value === 'conflict' || unknown"
			type="button"
			:disabled="operation.busy.value"
			@click="load"
			>{{ t('agent.pluginManagement.readRepositories') }}</UiButton
		>
		<div class="rounded-xl bg-header/25 p-3.5 sm:p-4">
			<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex items-center gap-2">
					<i class="fa-solid fa-boxes-stacked text-xs text-primary" aria-hidden="true"></i>
					<h4 class="text-xs font-semibold text-foreground">
						{{ t('agent.settings.plugins.remoteRepositories') }}
					</h4>
					<span
						v-if="totalPluginCount > 0"
						class="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary"
					>
						{{ totalPluginCount }}
					</span>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<div class="relative w-full min-w-0 sm:w-auto sm:min-w-[280px]">
						<i
							class="fa-solid fa-link absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
							aria-hidden="true"
						></i>
						<input
							v-model="repositoryUrl"
							:aria-label="t('agent.settings.plugins.repositoryUrl')"
							type="text"
							data-no-highlight
							class="h-8.5 w-full rounded-lg border border-border bg-background pl-7 pr-2.5 shadow-2xs text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none transition-all"
							:placeholder="t('agent.settings.plugins.repositoryUrl')"
							:disabled="locked"
						/>
					</div>
					<UiInfoHint
						v-if="!repositoryUrl.trim()"
						:text="t('agent.settings.disabledReason.repositoryRequired')"
					/>
					<UiButton
						appearance="solid"
						tone="primary"
						type="button"
						:disabled="locked || !repositoryUrl.trim()"
						@click="addRepository"
					>
						{{ t('agent.settings.plugins.addRepository') }}
					</UiButton>
					<UiButton
						type="button"
						appearance="soft"
						tone="neutral"
						:disabled="locked"
						:aria-label="t('agent.settings.plugins.refreshRemote')"
						@click="reload"
					>
						<i
							class="fa-solid fa-arrows-rotate text-xs"
							:class="{ 'fa-spin': operation.busy.value }"
							aria-hidden="true"
						></i>
						<span class="hidden whitespace-nowrap min-[360px]:inline">{{
							t('agent.settings.plugins.refreshRemote')
						}}</span>
					</UiButton>
				</div>
			</div>

			<div class="mt-3 relative w-full">
				<i
					class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary"
					aria-hidden="true"
				></i>
				<input
					v-model="searchQuery"
					:aria-label="t('agent.settings.plugins.searchPlaceholder')"
					type="text"
					data-no-highlight
					class="h-8.5 w-full rounded-lg border border-border bg-background pl-8 pr-8 shadow-2xs text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none transition-all"
					:placeholder="t('agent.settings.plugins.searchPlaceholder')"
				/>
				<button
					v-if="searchQuery"
					type="button"
					class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-xs text-text-secondary hover:text-foreground cursor-pointer"
					@click="searchQuery = ''"
					:aria-label="t('common.clear')"
				>
					<i class="fa-solid fa-circle-xmark"></i>
				</button>
			</div>

			<div v-if="configuredRepositories.length" class="mt-3 flex flex-wrap gap-2 pt-3 border-t border-border">
				<div
					v-for="repository in configuredRepositories"
					:key="repository.url"
					class="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 shadow-2xs text-xs"
				>
					<i class="fa-solid fa-globe text-[10px] text-primary/70" aria-hidden="true"></i>
					<span
						class="max-w-[24rem] sm:max-w-[36rem] truncate font-mono text-[11px] text-foreground"
						:title="repository.url"
						>{{ repository.url }}</span
					>
					<button
						type="button"
						class="inline-flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-error/10 hover:text-error transition-colors disabled:opacity-50 cursor-pointer"
						:aria-label="t('agent.settings.plugins.removeRepository')"
						:disabled="locked"
						@click="removeRepository(repository.url)"
					>
						<i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
					</button>
				</div>
			</div>

			<div v-if="filteredCatalogGroups.length" class="mt-3.5 pt-3.5 border-t border-border space-y-3">
				<div
					v-for="group in filteredCatalogGroups"
					:key="group.key"
					class="overflow-hidden rounded-xl bg-header/25 transition-all duration-200"
				>
					<div
						role="button"
						tabindex="0"
						:aria-expanded="isGroupExpanded(group.key)"
						class="w-full flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2.5 sm:py-3 hover:bg-header/30 transition-colors select-none cursor-pointer"
						@click="toggleGroup(group.key)"
						@keydown.enter.space.prevent="toggleGroup(group.key)"
					>
						<div class="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
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
							<div class="flex items-baseline gap-1.5 shrink-0">
								<span class="text-xs text-text-secondary shrink-0"
									>{{ t('agent.settings.plugins.repositorySource') }}:</span
								>
								<span class="text-xs sm:text-sm font-bold text-foreground font-mono">{{
									group.owner
								}}</span>
							</div>
							<span
								v-if="group.official"
								class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0"
							>
								<i class="fa-solid fa-certificate text-[8px]" aria-hidden="true"></i>
								<span>{{ t('agent.settings.plugins.officialRepository') }}</span>
							</span>
							<span
								v-else
								class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/60 px-2 py-0.5 text-[10px] font-medium text-text-secondary shrink-0"
							>
								<i class="fa-solid fa-network-wired text-[8px]" aria-hidden="true"></i>
								<span>{{ t('agent.settings.plugins.thirdPartyRepository') }}</span>
							</span>
							<span
								class="hidden xs:inline-flex rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 text-[10px] font-mono text-text-secondary shrink-0"
							>
								{{ t('agent.settings.plugins.pluginCount', { count: group.packages.length }) }}
							</span>

							<button
								v-if="group.sourceUrl"
								type="button"
								class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-header/60 hover:bg-header hover:border-border hover:text-foreground px-2 py-1 text-[11px] font-mono text-text-secondary transition-colors cursor-pointer max-w-full"
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
								<span
									class="truncate max-w-[280px] sm:max-w-[420px] md:max-w-[620px] lg:max-w-[820px] text-[11px]"
									>{{ group.sourceUrl }}</span
								>
							</button>
						</div>
					</div>

					<div
						v-if="isGroupExpanded(group.key)"
						class="space-y-1 border-t border-border/30 bg-background/25 px-3 sm:px-4"
					>
						<div class="flex items-center justify-between px-1 text-xs text-text-secondary font-medium">
							<div class="flex items-center gap-1.5">
								<i class="fa-solid fa-puzzle-piece text-[10px] text-primary" aria-hidden="true"></i>
								<span>{{ t('agent.settings.plugins.repositoryPlugins') }}</span>
							</div>
							<span class="font-mono text-[11px]">{{
								t('agent.settings.plugins.pluginCount', { count: group.packages.length })
							}}</span>
						</div>

						<div class="grid grid-cols-1">
							<div
								v-for="{ package: entry, catalog, official, source } in group.packages"
								:key="`${entry.definitionId}@${entry.version}`"
								class="flex flex-col justify-between gap-3 border-b border-border/30 py-3 last:border-b-0 sm:flex-row sm:items-center hover:bg-card/30"
							>
								<div class="flex items-center gap-3 min-w-0 flex-1">
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
										<div class="flex flex-wrap items-center gap-2">
											<span class="text-xs sm:text-sm font-bold text-foreground truncate">{{
												entry.displayName
											}}</span>
											<span
												class="rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
											>
												v{{ entry.version }}
											</span>
											<span
												class="rounded-full px-2 py-0.5 text-[11px] font-medium"
												:class="catalogEntryState(entry).tone"
												>{{ catalogEntryState(entry).label }}</span
											>
											<span class="hidden md:inline font-mono text-[11px] text-text-secondary/60">
												{{ entry.definitionId }}
											</span>
										</div>

										<div class="mt-0.5 flex items-center gap-2 text-xs text-text-secondary">
											<p
												class="truncate text-[11px] leading-relaxed max-w-md lg:max-w-xl"
												:title="
													entry.definitionId === 'nexus.agent'
														? t('agent.settings.plugins.summaryNexusAgent')
														: entry.definitionId === 'nexus.fullstack'
															? t('agent.settings.plugins.summaryNexusFullstack')
															: entry.description
												"
											>
												{{
													entry.definitionId === 'nexus.agent'
														? t('agent.settings.plugins.summaryNexusAgent')
														: entry.definitionId === 'nexus.fullstack'
															? t('agent.settings.plugins.summaryNexusFullstack')
															: entry.description
												}}
											</p>
											<span
												v-if="!entry.compatible"
												class="shrink-0 text-[11px] text-warning font-mono"
											>
												{{
													t('agent.settings.plugins.compatibilityShort', {
														min: entry.minVersion,
														max: entry.maxVersion,
													})
												}}
											</span>
										</div>
									</div>
								</div>

								<div
									class="flex shrink-0 items-center justify-between gap-2.5 pt-2 sm:justify-end sm:border-0 sm:pt-0"
								>
									<span
										class="hidden sm:inline-flex items-center gap-1 text-[11px] text-text-secondary/70 font-mono"
									>
										<i class="fa-solid fa-shield-check text-success text-[10px]"></i>
										<span>Ed25519</span>
									</span>

									<div class="flex items-center gap-1.5">
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
			</div>

			<div
				v-else-if="catalogs.length > 0 && searchQuery"
				class="mt-3.5 pt-6 pb-6 text-center border-t border-border"
			>
				<div
					class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-header/60 text-text-secondary mb-2"
				>
					<i class="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i>
				</div>
				<p class="text-xs text-text-secondary">{{ t('agent.settings.plugins.searchEmpty') }}</p>
				<button
					type="button"
					class="mt-2 text-xs text-primary hover:underline cursor-pointer"
					@click="searchQuery = ''"
				>
					{{ t('agent.settings.plugins.clearSearch') }}
				</button>
			</div>
		</div>
		<template v-if="unknown">
			<p class="text-warning">{{ t('agent.pluginManagement.unknown') }}</p>
			<UiCheckbox v-model="acknowledged">{{ t('agent.pluginManagement.acknowledge') }}</UiCheckbox>
			<UiButton
				type="button"
				:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
				@click="newIntent"
				>{{ t('agent.pluginManagement.newIntent') }}</UiButton
			>
		</template>
	</section>
</template>
