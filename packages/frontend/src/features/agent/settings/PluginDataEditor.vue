<script setup lang="ts">
	import { ref, toRaw, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	import {
		getPluginDataSnapshot,
		migratePluginData,
		decodePluginMigration,
		getPluginData,
		mutatePluginData,
		purgePluginData,
	} from '../api/plugin-data-api';
	import { useAgentManagementOperation } from '../composables/use-agent-management-operation';
	import type {
		PluginInstallation,
		PluginDataSnapshot,
		PluginMigrationIntent,
		PluginDataIntent,
	} from '../model/plugin-types';
	import { listPluginInstallations } from '../api/plugin-management-api';
	import { AgentManagementFailure } from '../model/management-failure';

	const props = withDefaults(
		defineProps<{
			installation: PluginInstallation;
			disabled: boolean;
			retainedOnly?: boolean;
			active?: boolean;
		}>(),
		{ retainedOnly: false, active: true },
	);
	const emit = defineEmits<{ changed: [] }>();
	const { t } = useI18n();
	const snapshot = ref<PluginDataSnapshot | null>(null);
	const key = ref('');
	const loadedKey = ref<string | null>(null);
	const keyVersion = ref(0);
	const abandonAcknowledged = ref(false);
	const valueJson = ref('');
	const migrationJson = ref('');
	const purgeAcknowledged = ref(false);
	const pending = ref<
		PluginMigrationIntent | PluginDataIntent | { operationId: string; expectedRevision: number } | null
	>(null);
	const pendingAction = ref<'migration' | 'write' | 'purge' | null>(null);
	const observedData = ref<string | null>(null);
	const operation = useAgentManagementOperation(
		(reason) => {
			snapshot.value = null;
			loadedKey.value = null;
			keyVersion.value = 0;
			abandonAcknowledged.value = false;
			key.value = '';
			valueJson.value = '';
			migrationJson.value = '';
			if (reason !== 'view') {
				pending.value = null;
				pendingAction.value = null;
			}
			purgeAcknowledged.value = false;
			observedData.value = null;
		},
		() => props.active,
	);

	function onToggle(event: Event): void {
		if (
			props.retainedOnly &&
			event.target instanceof HTMLDetailsElement &&
			event.target.open &&
			operation.refreshRequired.value &&
			!operation.busy.value
		)
			void read();
	}

	watch(
		() => props.active,
		(active) => {
			if (active && props.retainedOnly && operation.refreshRequired.value) void read();
		},
	);

	async function read(): Promise<void> {
		if (props.disabled || operation.busy.value) {
			return;
		}
		await operation.execute(
			async (signal) => {
				const current = (await listPluginInstallations(signal)).find(
					(item) => item.appId === props.installation.appId,
				);
				if (
					!current ||
					(pending.value === null &&
						(current.revision !== props.installation.revision ||
							current.status !== props.installation.status))
				) {
					throw new AgentManagementFailure('version_conflict', 'confirmed');
				}
				return current.status === 'draining' ? getPluginDataSnapshot(current.appId, signal) : null;
			},
			(value) => {
				snapshot.value = value;
			},
			{ write: false },
		);
	}

	async function readKey(): Promise<void> {
		if (props.disabled || operation.busy.value || pending.value !== null || operation.refreshRequired.value) {
			return;
		}
		const requested = key.value;
		loadedKey.value = null;
		await operation.execute(
			(signal) => getPluginData(props.installation.appId, requested, signal),
			(item) => {
				if (key.value === requested) {
					valueJson.value = item?.valueJson ?? '';
					loadedKey.value = requested;
					keyVersion.value = item?.version ?? 0;
				}
			},
			{ write: false },
		);
	}

	async function save(remove: boolean): Promise<void> {
		if (
			loadedKey.value !== key.value ||
			props.disabled ||
			pending.value !== null ||
			operation.busy.value ||
			operation.refreshRequired.value
		) {
			return;
		}
		const intent: PluginDataIntent = {
			key: key.value,
			expectedRevision: props.installation.revision,
			expectedVersion: keyVersion.value,
			operationId: crypto.randomUUID(),
			valueJson: remove ? null : valueJson.value,
		};
		pending.value = intent;
		pendingAction.value = 'write';
		await dispatch();
	}

	async function inspectPendingKey(): Promise<void> {
		const intent = pending.value;
		if (props.disabled || operation.busy.value || intent === null || !('key' in intent)) {
			return;
		}
		await operation.execute(
			(signal) => getPluginData(props.installation.appId, intent.key, signal),
			(value) => {
				observedData.value =
					value === null
						? 'not_found'
						: JSON.stringify({ key: value.key, version: value.version, valueJson: value.valueJson });
			},
			{ write: false },
		);
	}

	async function migrate(): Promise<void> {
		if (
			!snapshot.value ||
			props.disabled ||
			pending.value !== null ||
			operation.busy.value ||
			operation.refreshRequired.value
		) {
			return;
		}
		await operation.execute(
			async () => {
				try {
					const raw: unknown = JSON.parse(migrationJson.value);
					return decodePluginMigration({
						expectedRevision: snapshot.value?.revision,
						operationId: crypto.randomUUID(),
						items: raw,
					});
				} catch (cause) {
					throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
				}
			},
			(intent) => {
				pending.value = intent;
				pendingAction.value = 'migration';
			},
			{ write: false },
		);
		await dispatch();
	}

	async function purge(): Promise<void> {
		if (
			props.installation.status !== 'removed' ||
			!purgeAcknowledged.value ||
			props.disabled ||
			pending.value !== null ||
			operation.busy.value ||
			operation.refreshRequired.value
		) {
			return;
		}
		pending.value = { expectedRevision: props.installation.revision, operationId: crypto.randomUUID() };
		pendingAction.value = 'purge';
		await dispatch();
	}

	async function dispatch(): Promise<void> {
		if (!pending.value || props.disabled || operation.busy.value || operation.refreshRequired.value) {
			return;
		}
		const intent = structuredClone(toRaw(pending.value));
		const action = pendingAction.value;
		await operation.execute(
			async (signal) => {
				if (action === 'migration' && 'items' in intent) {
					await migratePluginData(props.installation.appId, intent, signal);
				} else if (action === 'write' && 'key' in intent) {
					await mutatePluginData(props.installation.appId, intent, signal);
				} else if (action === 'purge') {
					await purgePluginData(
						props.installation.appId,
						intent.expectedRevision,
						intent.operationId,
						signal,
					);
				} else {
					throw new AgentManagementFailure('invalid_input', 'not_dispatched');
				}
			},
			() => {
				pending.value = null;
				loadedKey.value = null;
				pendingAction.value = null;
				valueJson.value = '';
				migrationJson.value = '';
				purgeAcknowledged.value = false;
				emit('changed');
			},
			{ write: true, refreshAfterSuccess: true },
		);
	}

	watch(
		pending,
		() => {
			observedData.value = null;
		},
		{ flush: 'sync' },
	);
	watch(key, () => {
		loadedKey.value = null;
		valueJson.value = '';
	});

	function abandon(): void {
		if (props.disabled || operation.busy.value || operation.refreshRequired.value || !abandonAcknowledged.value) {
			return;
		}
		pending.value = null;
		pendingAction.value = null;
		abandonAcknowledged.value = false;
		loadedKey.value = null;
		valueJson.value = '';
		migrationJson.value = '';
		emit('changed');
	}
</script>
<template>
	<details class="space-y-2 rounded border border-border p-2" @toggle="onToggle">
		<summary>{{ t(retainedOnly ? 'agent.settings.plugins.deleteData' : 'agent.pluginManagement.data') }}</summary>
		<p class="text-xs">
			{{ t(retainedOnly ? 'agent.settings.plugins.deleteDataWarning' : 'agent.pluginManagement.dataHelp') }}
		</p>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<UiButton
			v-if="!retainedOnly || operation.notice.value"
			type="button"
			:disabled="disabled || operation.busy.value"
			@click="read"
			>{{ t('agent.pluginManagement.readData') }}</UiButton
		>
		<template v-if="snapshot && !retainedOnly">
			<p class="text-xs">r{{ snapshot.revision }} · {{ snapshot.items.length }}</p>
			<p v-for="item in snapshot.items" :key="item.key" class="break-all text-xs">
				{{ item.key }} · v{{ item.version }} ·
				{{ item.valueJson === null ? t('agent.pluginManagement.tombstone') : item.valueJson }}
			</p>
		</template>
		<fieldset :disabled="disabled || operation.busy.value || pending !== null" class="space-y-2">
			<template v-if="!retainedOnly"
				><label class="block"
					>{{ t('agent.pluginManagement.dataKey')
					}}<input v-model="key" class="ml-2 rounded border border-border bg-background p-2"
				/></label>
				<UiButton type="button" :disabled="!key" @click="readKey">{{
					t('agent.pluginManagement.readKey')
				}}</UiButton>
				<label class="block"
					>JSON<textarea
						v-model="valueJson"
						class="mt-1 w-full rounded border border-border bg-background p-2"
					/>
				</label>
				<UiButton
					type="button"
					:disabled="operation.refreshRequired.value || loadedKey !== key || !key || !valueJson"
					@click="save(false)"
					>{{ t('common.save') }}</UiButton
				>
				<UiButton
					type="button"
					:disabled="operation.refreshRequired.value || loadedKey !== key || !key"
					@click="save(true)"
					>{{ t('common.delete') }}</UiButton
				>
				<label class="block"
					>{{ t('agent.pluginManagement.migrationItems')
					}}<textarea
						v-model="migrationJson"
						class="mt-1 w-full rounded border border-border bg-background p-2"
					/>
				</label>
				<UiButton
					type="button"
					:disabled="operation.refreshRequired.value || snapshot === null || !migrationJson"
					@click="migrate"
					>{{ t('agent.pluginManagement.migrate') }}</UiButton
				> </template
			><label v-if="installation.status === 'removed'" class="block"
				><input v-model="purgeAcknowledged" type="checkbox" />{{
					t('agent.pluginManagement.confirmPurge')
				}}</label
			>
			<UiButton
				v-if="installation.status === 'removed'"
				type="button"
				:disabled="operation.refreshRequired.value || installation.status !== 'removed' || !purgeAcknowledged"
				@click="purge"
				>{{ t('agent.pluginManagement.purge') }}</UiButton
			>
		</fieldset>
		<template v-if="pending"
			><p class="break-all text-xs">
				{{ t('agent.pluginManagement.pendingData')
				}}<template v-if="!retainedOnly"> · {{ pending.operationId }}</template>
			</p>
			<UiButton
				v-if="pendingAction === 'write'"
				type="button"
				:disabled="disabled || operation.busy.value"
				@click="inspectPendingKey"
				>{{ t('agent.pluginManagement.readKey') }}</UiButton
			>
			<p v-if="observedData !== null" class="whitespace-pre-wrap break-all text-xs">{{ observedData }}</p>
			<UiButton
				type="button"
				:disabled="disabled || operation.busy.value || operation.refreshRequired.value"
				@click="dispatch"
				>{{ t('agent.pluginManagement.retryDataIntent') }}</UiButton
			>
			<label class="block text-xs"
				><input v-model="abandonAcknowledged" type="checkbox" />{{
					t('agent.pluginManagement.acknowledge')
				}}</label
			>
			<UiButton
				type="button"
				:disabled="disabled || operation.busy.value || operation.refreshRequired.value || !abandonAcknowledged"
				@click="abandon"
				>{{ t('agent.pluginManagement.newIntent') }}</UiButton
			>
		</template>
	</details>
</template>
