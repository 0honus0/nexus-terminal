<script setup lang="ts">
	import { computed, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiEmptyState, UiInfoHint, UiInlineNotice, UiSelect } from '@/foundation/ui';
	import type { ManagedApp } from '../model/app-management-types';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { logger } from '@/client/logging/logger';
	import { listPluginInstances, readPluginInstanceSettings } from '../plugins/api/plugin-instance-api';
	import { listPluginPackageInstallations, listPluginVersions } from '../plugins/api/plugin-management-api';
	import type { PluginPackageInstallation } from '../plugins/model/plugin-types';
	import type { PluginInstance } from '../plugins/model/plugin-instance-types';
	import PluginInstanceSettings from '../plugins/components/PluginInstanceSettings.vue';

	const props = withDefaults(defineProps<{ apps: ManagedApp[]; active: boolean; embedded?: boolean }>(), {
		embedded: false,
	});
	const { t } = useI18n();
	const selectedAppId = ref('');
	const selectedApp = computed(() => props.apps.find((app) => app.id === selectedAppId.value));
	const entries = ref<{ instance: PluginInstance; installation: PluginPackageInstallation; name: string }[]>([]);
	const settings = ref<(typeof entries.value)[number] | null>(null);
	const loading = ref(false);
	const failed = ref(false);
	let generation = 0;
	let request: AbortController | null = null;
	const scope = useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke() {
			generation++;
			request?.abort();
			entries.value = [];
			settings.value = null;
			loading.value = false;
		},
	});

	async function load(): Promise<void> {
		const appId = selectedAppId.value;
		const current = ++generation;
		request?.abort();
		if (!appId || !props.active) return;
		const identity = scope.capture();
		request = new AbortController();
		const signal = AbortSignal.any([request.signal, identity]);
		loading.value = true;
		failed.value = false;
		try {
			const [instances, packages, versions] = await Promise.all([
				listPluginInstances(appId, signal),
				listPluginPackageInstallations(signal),
				listPluginVersions(signal),
			]);
			const declarations = await Promise.all(
				instances.map((item) => readPluginInstanceSettings(appId, item.id, signal)),
			);
			if (signal.aborted || current !== generation) return;
			entries.value = declarations.flatMap((value) => {
				const installation = packages.installations.find(
					(item) => item.packageId === value.instance.packageId && item.status === 'installed',
				);
				if (!installation || !value.connectionKinds.length) return [];
				const version = versions.find((item) => item.packageHash === installation.packageHash);
				return [
					{
						instance: value.instance,
						installation,
						name: version?.manifest?.displayName ?? installation.packageId,
					},
				];
			});
		} catch (error) {
			if (signal.aborted || current !== generation) return;
			failed.value = true;
			logger.error({ err: error }, 'Plugin connection directory read failed');
		} finally {
			if (current === generation) loading.value = false;
		}
	}

	function close(): void {
		settings.value = null;
		void load();
	}

	watch(
		() => props.apps,
		(apps) => {
			if (!apps.some((app) => app.id === selectedAppId.value)) selectedAppId.value = apps[0]?.id ?? '';
		},
		{ immediate: true },
	);
	watch(
		[selectedAppId, () => props.active],
		() => {
			generation++;
			entries.value = [];
			settings.value = null;
			void load();
		},
		{ immediate: true },
	);
	onBeforeUnmount(() => {
		generation++;
		request?.abort();
	});
</script>

<template>
	<section
		:class="embedded ? 'min-w-0' : 'ui-glass-panel overflow-hidden rounded-2xl'"
		:aria-label="t('agent.settings.integrationManagement.title')"
	>
		<div
			class="agent-settings-head ui-glass-chrome flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5"
		>
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-foreground">
					{{ t('agent.settings.integrationManagement.title') }}
				</h3>
				<UiInfoHint :text="t('agent.settings.integrationManagement.description')" />
			</div>
			<div class="flex min-w-0 basis-full items-center justify-end gap-2 sm:flex-1 sm:basis-auto">
				<UiSelect
					v-if="apps.length > 1"
					v-model="selectedAppId"
					class="min-w-0 flex-1 sm:flex-[0_1_10rem]"
					:options="apps.map((app) => ({ value: app.id, label: app.name }))"
					:aria-label="t('agent.settings.appManagement.chooseApp')"
					:title="selectedApp?.name"
				/>
				<UiButton :disabled="loading" @click="load">{{ t('agent.settings.plugins.settings.reload') }}</UiButton>
			</div>
		</div>
		<div class="space-y-3 py-3" :aria-busy="loading">
			<UiInlineNotice v-if="failed" tone="warning" compact>{{
				t('agent.settings.plugins.settings.failed')
			}}</UiInlineNotice>
			<article
				v-for="item in entries"
				:key="item.instance.id"
				class="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-header/25 p-3.5"
			>
				<div class="min-w-0">
					<h4 class="break-words text-sm font-semibold text-foreground">{{ item.instance.name }}</h4>
					<p class="text-xs text-text-secondary">{{ item.name }}</p>
				</div>
				<UiButton @click="settings = item">{{ t('agent.settings.plugins.settings.open') }}</UiButton>
			</article>
			<UiEmptyState
				v-if="!loading && !failed && !entries.length"
				compact
				:bordered="false"
				icon="fa-solid fa-plug"
				:title="t('agent.settings.integrationManagement.empty')"
			/>
		</div>
		<PluginInstanceSettings
			v-if="active && settings && selectedApp"
			:key="settings.instance.id"
			:installation="settings.installation"
			:name="settings.name"
			:apps="[selectedApp]"
			@close="close"
		/>
	</section>
</template>
