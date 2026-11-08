<script setup lang="ts">
	import { computed, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { logger } from '@/client/logging/logger';
	import { UiButton, UiCheckbox, UiFormField, UiInlineNotice, UiSelect } from '@/foundation/ui';
	import type { ManagedApp } from '../../model/app-management-types';
	import type { PluginPackageInstallation } from '../model/plugin-types';
	import type { PluginInstance, PluginInstanceSettings } from '../model/plugin-instance-types';
	import {
		createPluginInstance,
		listPluginInstances,
		readPluginInstanceSettings,
		updatePluginInstance,
	} from '../api/plugin-instance-api';
	import PluginSettingsDialog from './PluginSettingsDialog.vue';
	import PluginConfigurationEditor from './PluginConfigurationEditor.vue';
	import PluginConnectionEditor from './PluginConnectionEditor.vue';
	import PluginSettingsFrame from '../host/PluginSettingsFrame.vue';
	import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
	import { pendingPluginConfiguration, savePluginConfiguration } from '../api/plugin-configuration-writes';

	const props = defineProps<{ installation: PluginPackageInstallation; name: string; apps: ManagedApp[] }>();
	const emit = defineEmits<{ close: [] }>();
	const { t } = useI18n();
	const appId = ref('');
	const instanceId = ref('');
	const instances = ref<PluginInstance[]>([]);
	const source = ref<PluginInstanceSettings | null>(null);
	const draft = ref('{}');
	const status = ref<'loading' | 'failed' | 'ready'>('loading');
	const busy = ref(false);
	const failed = ref(false);
	const uncertain = ref(false);
	let generation = 0;
	let request: AbortController | null = null;
	let mutation: symbol | null = null;
	const scope = useAuthenticatedViewScope({
		onRevoke() {
			generation++;
			request?.abort();
			mutation = null;
			busy.value = false;
			source.value = null;
		},
	});
	const appOptions = computed(() => props.apps.map((app) => ({ value: app.id, label: app.name })));
	const instanceOptions = computed(() =>
		instances.value.map((instance) => ({ value: instance.id, label: instance.name })),
	);

	async function load(): Promise<void> {
		const current = ++generation;
		request?.abort();
		request = new AbortController();
		const signal = AbortSignal.any([request.signal, scope.capture()]);
		status.value = 'loading';
		source.value = null;
		try {
			if (!appId.value) {
				status.value = 'ready';
				return;
			}
			const entries = (await listPluginInstances(appId.value, signal)).filter(
				(item) => item.packageId === props.installation.packageId,
			);
			if (signal.aborted || current !== generation) return;
			instances.value = entries;
			const selected = entries.find((entry) => entry.id === instanceId.value) ?? entries[0];
			instanceId.value = selected?.id ?? '';
			if (selected) {
				const value = await readPluginInstanceSettings(appId.value, selected.id, signal);
				if (signal.aborted || current !== generation) return;
				source.value = value;
				const pending = pendingPluginConfiguration(appId.value, selected.id);
				uncertain.value = pending !== null;
				draft.value =
					pending?.documentJson ??
					(value.configuration.revision
						? value.configuration.documentJson
						: (value.settings?.defaultsJson ?? '{}'));
			}
			status.value = 'ready';
		} catch (error) {
			if (signal.aborted || current !== generation) return;
			status.value = 'failed';
			logger.error({ err: error }, 'Plugin settings read failed');
		}
	}

	async function create(): Promise<void> {
		if (!appId.value || busy.value) return;
		const signal = scope.capture();
		const current = generation;
		const selectedApp = appId.value;
		const intent = Symbol();
		mutation = intent;
		busy.value = true;
		failed.value = false;
		try {
			const value = await createPluginInstance(selectedApp, props.installation.packageId, props.name, signal);
			if (!scope.isCurrent(signal) || current !== generation) return;
			instanceId.value = value.id;
			await load();
		} catch (error) {
			if (!scope.isCurrent(signal) || current !== generation || mutation !== intent) return;
			failed.value = true;
			logger.error({ err: error }, 'Plugin instance creation failed');
		} finally {
			if (mutation === intent) {
				mutation = null;
				busy.value = false;
			}
		}
	}

	async function save(): Promise<void> {
		const value = source.value;
		if (!value?.settings || busy.value) return;
		const selectedApp = appId.value;
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) return;
		const current = generation;
		const intent = Symbol();
		mutation = intent;
		const command = pendingPluginConfiguration(selectedApp, value.instance.id) ?? {
			operationKey: crypto.randomUUID(),
			expectedPackageRevision: value.packageRevision,
			expectedRevision: value.configuration.revision,
			schemaRevision: value.settings.schemaRevision,
			documentJson: draft.value,
		};
		busy.value = true;
		failed.value = false;
		try {
			await savePluginConfiguration(selectedApp, value.instance.id, command);
			if (!scope.isCurrent(signal) || current !== generation) return;
			uncertain.value = false;
			await load();
		} catch (error) {
			if (!scope.isCurrent(signal) || current !== generation) return;
			failed.value = true;
			uncertain.value = pendingPluginConfiguration(selectedApp, value.instance.id) !== null;
			logger.error({ err: error }, 'Plugin configuration write failed');
		} finally {
			if (mutation === intent) {
				mutation = null;
				busy.value = false;
			}
		}
	}

	async function enabled(value: boolean): Promise<void> {
		const original = source.value?.instance;
		if (!original || busy.value) return;
		const signal = scope.capture();
		const current = generation;
		const selectedApp = appId.value;
		const intent = Symbol();
		mutation = intent;
		busy.value = true;
		try {
			await updatePluginInstance(
				selectedApp,
				original.id,
				{
					expectedRevision: original.revision,
					name: original.name,
					selected: original.selected,
					enabled: value,
				},
				signal,
			);
			if (!scope.isCurrent(signal) || current !== generation) return;
			await load();
		} catch (error) {
			if (!scope.isCurrent(signal) || current !== generation || mutation !== intent) return;
			failed.value = true;
			logger.error({ err: error }, 'Plugin instance update failed');
		} finally {
			if (mutation === intent) {
				mutation = null;
				busy.value = false;
			}
		}
	}

	watch(appId, () => {
		instanceId.value = '';
		uncertain.value = false;
		void load();
	});
	watch(
		() => props.apps,
		(apps) => {
			if (!apps.some((app) => app.id === appId.value)) appId.value = apps[0]?.id ?? '';
		},
		{ immediate: true },
	);
	onBeforeUnmount(() => {
		generation++;
		request?.abort();
	});
</script>

<template>
	<PluginSettingsDialog
		:visible="true"
		:package-name="name"
		:package-version="installation.version"
		:app-options="appOptions"
		:app-id="appId"
		:status="status"
		:busy="busy"
		@update:app-id="appId = $event"
		@reload="load"
		@close="emit('close')"
	>
		<div class="h-full space-y-4 overflow-y-auto pb-4">
			<UiInlineNotice v-if="failed" tone="warning" compact>{{
				t('agent.settings.plugins.settings.failed')
			}}</UiInlineNotice>
			<div class="flex items-end gap-2">
				<UiFormField
					class="min-w-0 flex-1"
					:for-id="`${installation.packageId}-instance`"
					:label="t('agent.settings.plugins.settings.instance')"
				>
					<UiSelect
						:id="`${installation.packageId}-instance`"
						:model-value="instanceId"
						:options="instanceOptions"
						:disabled="busy || uncertain"
						@update:model-value="
							(value) => {
								if (typeof value === 'string') {
									instanceId = value;
									load();
								}
							}
						"
					/>
				</UiFormField>
				<UiButton :disabled="busy || uncertain" @click="create">{{
					t('agent.settings.plugins.settings.addInstance')
				}}</UiButton>
			</div>
			<label v-if="source" class="inline-flex min-w-0 items-start gap-2 text-sm text-foreground">
				<UiCheckbox
					class="shrink-0"
					:aria-label="t('agent.settings.plugins.settings.enabled')"
					:model-value="source.instance.enabled"
					:disabled="busy || uncertain"
					@update:model-value="enabled"
				/>
				<span class="min-w-0">{{ t('agent.settings.plugins.settings.enabled') }}</span>
			</label>
			<PluginConnectionEditor
				v-if="source?.connectionKinds.length"
				:key="source.instance.id"
				:app-id="appId"
				:instance-id="source.instance.id"
				:kinds="source.connectionKinds"
				@saved="load"
			/>
			<PluginSettingsFrame
				v-if="source?.settings?.frontendEntry && !uncertain"
				:app-id="appId"
				:instance-id="source.instance.id"
				:package-revision="source.packageRevision"
				@saved="load"
			/>
			<form v-else-if="source?.settings" id="plugin-configuration-form" @submit.prevent="save">
				<PluginConfigurationEditor
					:schema-json="source.settings.schemaJson"
					v-model:document-json="draft"
					:disabled="busy || uncertain"
				/>
			</form>
		</div>
		<template #actions>
			<UiButton
				v-if="source?.settings && (!source.settings.frontendEntry || uncertain)"
				type="submit"
				form="plugin-configuration-form"
				appearance="solid"
				tone="primary"
				:loading="busy"
				:disabled="busy"
				>{{ t('common.save') }}</UiButton
			>
		</template>
	</PluginSettingsDialog>
</template>
