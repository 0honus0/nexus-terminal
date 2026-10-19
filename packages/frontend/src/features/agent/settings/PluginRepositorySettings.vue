<script setup lang="ts">
	import { onActivated, onMounted, ref, toRaw, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox } from '@/foundation/ui';
	import {
		getPluginCatalog,
		getPluginRecommendation,
		getPluginRepositories,
		installRecommendedPlugin,
		stagePluginCatalogEntry,
		updatePluginRepositories,
	} from '../api/plugin-management-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type {
		PluginCatalog,
		PluginCatalogEntry,
		PluginRecommendation,
		PluginRepositories,
		PluginStage,
	} from '../model/plugin-types';

	const { t } = useI18n();
	const repositories = ref<PluginRepositories | null>(null);
	const draft = ref('');
	const repositoryUrl = ref('');
	const catalog = ref<PluginCatalog | null>(null);
	const catalogSource = ref<string | null>(null);
	const recommendation = ref<PluginRecommendation | null>(null);
	const staged = ref<PluginStage | null>(null);
	const unknown = ref(false);
	const acknowledged = ref(false);
	const operation = useAgentManagementOperation(() => {
		repositories.value = null;
		draft.value = '';
		repositoryUrl.value = '';
		catalog.value = null;
		recommendation.value = null;
		staged.value = null;
		unknown.value = false;
		acknowledged.value = false;
		catalogSource.value = null;
	});
	watch(repositoryUrl, () => {
		catalog.value = null;
	});

	async function load(): Promise<void> {
		await operation.execute(
			async (signal) => {
				const [repositories, recommendation] = await Promise.all([
					getPluginRepositories(signal),
					getPluginRecommendation(signal),
				]);
				return { repositories, recommendation };
			},
			(value) => {
				repositories.value = value.repositories;
				draft.value = value.repositories.urls.join('\n');
				recommendation.value = value.recommendation;
				catalog.value = null;
			},
			{ write: false },
		);
	}

	async function readCatalog(official: boolean): Promise<void> {
		if (operation.busy.value || operation.refreshRequired.value) {
			return;
		}
		const url = official ? null : repositoryUrl.value;
		await operation.execute(
			(signal) => getPluginCatalog(url, signal),
			(value) => {
				catalog.value = value;
				catalogSource.value = official ? null : value.repositoryUrl;
			},
			{ write: false },
		);
	}

	async function write<T>(action: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void): Promise<void> {
		if (unknown.value || operation.busy.value || operation.refreshRequired.value) {
			return;
		}
		await operation.execute(action, accept, {
			write: true,
			refreshAfterSuccess: true,

			onFailure() {
				unknown.value = operation.notice.value === 'unknown';
			},
		});
	}

	async function save(): Promise<void> {
		if (!repositories.value) {
			return;
		}
		const original = structuredClone(toRaw(repositories.value));
		const urls = draft.value
			.split('\n')
			.map((value) => value.trim())
			.filter(Boolean);
		await write(
			(signal) => updatePluginRepositories(original, urls, signal),
			(value) => {
				repositories.value = value;
				draft.value = value.urls.join('\n');
			},
		);
	}

	async function stage(entry: PluginCatalogEntry): Promise<void> {
		if (!catalog.value || !entry.compatible) {
			return;
		}
		const original = structuredClone(toRaw(entry));
		const source = catalogSource.value;
		await write(
			(signal) => stagePluginCatalogEntry(original, source, signal),
			(value) => {
				staged.value = value;
			},
		);
	}

	async function installRecommended(): Promise<void> {
		if (!recommendation.value?.entry || !recommendation.value.entry.compatible) {
			return;
		}
		await write(installRecommendedPlugin, () => {
			recommendation.value = null;
		});
	}

	function newIntent(): void {
		if (operation.busy.value || operation.refreshRequired.value || !acknowledged.value) {
			return;
		}
		unknown.value = false;
		acknowledged.value = false;
	}

	function initial(): void {
		if (operation.refreshRequired.value) {
			void load();
		}
	}

	onMounted(initial);
	onActivated(initial);
</script>
<template>
	<section class="space-y-3 rounded border border-border p-3">
		<h4>{{ t('agent.pluginManagement.repositories') }}</h4>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="operation.refreshRequired.value" class="text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<UiButton type="button" :disabled="operation.busy.value" @click="load">{{
			t('agent.pluginManagement.readRepositories')
		}}</UiButton>
		<fieldset :disabled="operation.busy.value || operation.refreshRequired.value || unknown" class="space-y-2">
			<label class="block text-sm"
				>{{ t('agent.pluginManagement.repositoryLines')
				}}<textarea v-model="draft" class="mt-1 w-full rounded border border-border bg-background p-2" />
			</label>
			<UiButton type="button" :disabled="repositories === null" @click="save">{{ t('common.save') }}</UiButton>
		</fieldset>
		<label class="block text-sm"
			>{{ t('agent.pluginManagement.repositoryUrl')
			}}<input
				v-model="repositoryUrl"
				:disabled="operation.busy.value"
				class="ml-2 rounded border border-border bg-background p-2"
		/></label>
		<UiButton
			type="button"
			:disabled="operation.busy.value || operation.refreshRequired.value"
			@click="readCatalog(true)"
			>{{ t('agent.pluginManagement.officialCatalog') }}</UiButton
		>
		<UiButton
			type="button"
			:disabled="operation.busy.value || operation.refreshRequired.value || !repositoryUrl"
			@click="readCatalog(false)"
			>{{ t('agent.pluginManagement.remoteCatalog') }}</UiButton
		>
		<template v-if="catalog">
			<p class="break-all text-xs">{{ catalog.repositoryUrl }}</p>
			<p v-for="publisher in catalog.publishers" :key="publisher.keyId" class="break-all text-xs">
				{{ publisher.label }} · {{ publisher.keyId }}
			</p>
			<article
				v-for="entry in catalog.packages"
				:key="entry.definitionId + ':' + entry.version"
				class="space-y-2 border-t border-border py-2 text-xs"
			>
				<p>{{ entry.displayName }} · {{ entry.definitionId }} · {{ entry.version }}</p>
				<p>{{ entry.description }}</p>
				<p class="break-all">{{ entry.publisherKeyId }} · {{ entry.sha256 }} · {{ entry.sizeBytes }} B</p>
				<p>
					{{ entry.minVersion }} – {{ entry.maxVersion }} · SDK {{ entry.sdkVersion }} ·
					{{
						entry.compatible
							? t('agent.pluginManagement.compatible')
							: t('agent.pluginManagement.incompatible')
					}}
				</p>
				<UiButton
					type="button"
					:disabled="operation.busy.value || operation.refreshRequired.value || unknown || !entry.compatible"
					@click="stage(entry)"
					>{{ t('agent.pluginManagement.stage') }}</UiButton
				>
			</article>
		</template>
		<p v-if="staged" class="break-all text-xs">{{ staged.id }} · v{{ staged.version }} · {{ staged.status }}</p>
		<p class="text-sm">{{ t('agent.pluginManagement.recommendedHelp') }}</p>
		<p v-if="recommendation?.entry">{{ recommendation.entry.displayName }} · {{ recommendation.entry.version }}</p>
		<UiButton
			type="button"
			:disabled="
				operation.busy.value || operation.refreshRequired.value || unknown || !recommendation?.entry?.compatible
			"
			@click="installRecommended"
			>{{ t('agent.pluginManagement.installRecommended') }}</UiButton
		>
		<template v-if="unknown"
			><p class="text-warning">{{ t('agent.pluginManagement.unknown') }}</p>
			<UiCheckbox v-model="acknowledged">{{ t('agent.pluginManagement.acknowledge') }}</UiCheckbox
			><UiButton
				type="button"
				:disabled="operation.busy.value || operation.refreshRequired.value || !acknowledged"
				@click="newIntent"
				>{{ t('agent.pluginManagement.newIntent') }}</UiButton
			></template
		>
	</section>
</template>
