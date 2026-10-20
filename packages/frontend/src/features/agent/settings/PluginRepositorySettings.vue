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

	interface CatalogSource {
		source: string | null;
		catalog: PluginCatalog;
	}

	const props = defineProps<{
		blocked: boolean;
		publishers: PluginPublisher[];
		installations: PluginInstallation[];
		active: boolean;
	}>();
	const emit = defineEmits<{
		prepare: [entry: PluginCatalogEntry, source: string | null];
		trust: [label: string, pem: string];
		recommend: [];
	}>();
	const { t } = useI18n();
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
	const filteredCatalogs = computed(() => {
		const query = searchQuery.value.trim().toLowerCase();
		return catalogs.value.map(({ source, catalog }) => ({
			source,
			url: catalog.repositoryUrl,
			publishers: catalog.publishers,
			entries: catalog.packages.filter(
				(entry) =>
					!query ||
					[entry.displayName, entry.definitionId, entry.description].some((value) =>
						value.toLowerCase().includes(query),
					),
			),
		}));
	});

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
	<section class="space-y-3 border-t border-border pt-4">
		<p
			v-if="operation.notice.value && operation.notice.value !== 'saved'"
			role="status"
			class="text-sm text-warning"
		>
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<UiButton
			v-if="operation.notice.value === 'failed' || operation.notice.value === 'conflict' || unknown"
			type="button"
			:disabled="operation.busy.value"
			@click="load"
			>{{ t('agent.pluginManagement.readRepositories') }}</UiButton
		>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h4 class="text-sm font-semibold">{{ t('agent.pluginManagement.repositories') }}</h4>
			<div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
				<div class="relative w-full min-w-0 sm:w-auto sm:min-w-[280px]">
					<i
						class="fa-solid fa-link absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
						aria-hidden="true"
					></i>
					<input
						v-model="repositoryUrl"
						type="text"
						data-no-highlight
						class="h-8.5 w-full rounded-lg border border-border bg-background pl-7 pr-2.5 shadow-2xs text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none transition-all"
						:placeholder="t('agent.settings.plugins.repositoryUrl')"
						:aria-label="t('agent.settings.plugins.repositoryUrl')"
						:disabled="locked"
					/>
				</div>
				<UiButton
					appearance="solid"
					tone="primary"
					type="button"
					:disabled="locked || !repositoryUrl.trim()"
					@click="addRepository"
					>{{ t('agent.settings.plugins.addRepository') }}</UiButton
				>
			</div>
		</div>
		<div class="relative w-full">
			<i
				class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary"
				aria-hidden="true"
			></i>
			<input
				v-model="searchQuery"
				type="text"
				data-no-highlight
				class="h-8.5 w-full rounded-lg border border-border bg-background pl-8 pr-8 shadow-2xs text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none transition-all"
				:placeholder="t('agent.settings.plugins.searchPlaceholder')"
				:aria-label="t('agent.settings.plugins.searchPlaceholder')"
			/>
			<button
				v-if="searchQuery"
				type="button"
				class="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-xs text-text-secondary hover:text-foreground cursor-pointer"
				:aria-label="t('common.clear')"
				@click="searchQuery = ''"
			>
				<i class="fa-solid fa-circle-xmark" aria-hidden="true"></i>
			</button>
		</div>
		<div v-if="repositories?.urls.length" class="flex flex-wrap gap-2 border-t border-border pt-3">
			<div
				v-for="url in repositories.urls"
				:key="url"
				class="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 shadow-2xs text-xs"
			>
				<i class="fa-solid fa-globe text-[10px] text-primary/70" aria-hidden="true"></i>
				<span class="max-w-[24rem] truncate font-mono text-[11px] sm:max-w-[36rem]" :title="url">{{
					url
				}}</span>
				<button
					type="button"
					class="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-secondary hover:bg-error/10 hover:text-error disabled:opacity-50"
					:aria-label="t('agent.settings.plugins.removeRepository')"
					:disabled="locked"
					@click="removeRepository(url)"
				>
					<i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
				</button>
			</div>
		</div>
		<div class="space-y-3">
			<details
				v-for="group in filteredCatalogs"
				:key="group.url"
				open
				class="overflow-hidden rounded-xl border border-border bg-card shadow-2xs"
			>
				<summary class="cursor-pointer break-all bg-header/25 px-4 py-3 text-xs font-semibold">
					{{ group.source ?? t('agent.settings.plugins.officialRepository') }}
				</summary>
				<div class="space-y-3 p-3">
					<template v-if="group.source !== null">
						<div
							v-for="publisher in group.publishers"
							:key="publisher.keyId"
							class="rounded-lg bg-header/25 p-3 text-xs"
						>
							<span class="font-medium">{{ publisher.label }}</span>
							<details class="mt-2">
								<summary class="cursor-pointer text-text-secondary">
									{{ t('agent.settings.onboarding.detailsToggle') }}
								</summary>
								<p class="mt-2 break-all font-mono">{{ publisher.keyId }}</p>
							</details>
							<UiButton
								v-if="!publisherTrusted(publisher.keyId)"
								type="button"
								:disabled="locked"
								@click="emit('trust', publisher.label, publisher.publicKeyPem)"
								>{{ t('agent.settings.plugins.trustRemotePublisher') }}</UiButton
							>
						</div>
					</template>
					<article
						v-for="entry in group.entries"
						:key="entry.definitionId + ':' + entry.version"
						class="space-y-2 rounded-lg border border-border bg-background p-3 text-xs"
					>
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span class="font-semibold">{{ entry.displayName }}</span
							><span class="font-mono text-text-secondary">v{{ entry.version }}</span>
						</div>
						<p class="text-text-secondary">{{ entry.description }}</p>
						<div class="flex justify-end">
							<UiButton
								type="button"
								appearance="solid"
								tone="primary"
								:disabled="
									locked ||
									!entry.compatible ||
									(group.source !== null && !publisherTrusted(entry.publisherKeyId))
								"
								@click="prepare(entry, group.source)"
								>{{ t('agent.settings.plugins.prepareRemote') }}</UiButton
							>
						</div>
					</article>
					<p v-if="!group.entries.length" class="text-xs text-text-secondary">
						{{ t('agent.settings.plugins.searchEmpty') }}
					</p>
				</div>
			</details>
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
