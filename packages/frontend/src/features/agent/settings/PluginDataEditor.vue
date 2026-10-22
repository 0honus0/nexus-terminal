<script setup lang="ts">
	import { ref, toRaw, useId, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiBadge, UiButton, UiCheckbox, UiEmptyState, UiFormField, UiInput, UiTextarea } from '@/foundation/ui';
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
	const id = useId();
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
	<details class="plugin-data" @toggle="onToggle">
		<summary class="plugin-data__summary">
			<span class="plugin-data__icon" aria-hidden="true">
				<i class="fa-solid fa-database"></i>
			</span>
			<span class="plugin-data__heading">
				<span class="plugin-data__title">{{
					t(retainedOnly ? 'agent.settings.plugins.deleteData' : 'agent.pluginManagement.snapshot')
				}}</span>
				<span class="plugin-data__meta">
					{{ installation.definitionId }} · v{{ installation.version }} · r{{ installation.revision }}
				</span>
			</span>
			<UiBadge v-if="snapshot && !retainedOnly" tone="neutral" density="compact">
				r{{ snapshot.revision }} · {{ snapshot.items.length }}
			</UiBadge>
			<i class="plugin-data__chevron fa-solid fa-chevron-down" aria-hidden="true"></i>
		</summary>

		<div class="plugin-data__body">
			<p class="plugin-data__help">
				{{ t(retainedOnly ? 'agent.settings.plugins.deleteDataWarning' : 'agent.pluginManagement.dataHelp') }}
			</p>
			<div v-if="!retainedOnly || operation.notice.value" class="plugin-data__toolbar">
				<UiButton
					type="button"
					appearance="soft"
					density="compact"
					:disabled="disabled || operation.busy.value"
					@click="read"
				>
					<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
					{{ t('agent.pluginManagement.readData') }}
				</UiButton>
				<span v-if="snapshot && !retainedOnly" class="plugin-data__snapshot-meta">
					{{ t('agent.pluginManagement.snapshotRevision', { revision: snapshot.revision }) }}
				</span>
			</div>

			<section v-if="snapshot && !retainedOnly" class="plugin-data__snapshot">
				<div class="plugin-data__section-head">
					<h5>{{ t('agent.pluginManagement.snapshot') }}</h5>
					<span>{{ snapshot.items.length }}</span>
				</div>
				<UiEmptyState
					v-if="!snapshot.items.length"
					icon="fa-solid fa-database"
					:title="t('agent.pluginManagement.noSnapshotItems')"
					dense
				/>
				<ul v-else class="plugin-data__items">
					<li v-for="item in snapshot.items" :key="item.key">
						<div class="plugin-data__item-head">
							<code>{{ item.key }}</code>
							<span>v{{ item.version }}</span>
						</div>
						<pre>{{
							item.valueJson === null ? t('agent.pluginManagement.tombstone') : item.valueJson
						}}</pre>
					</li>
				</ul>
			</section>

			<fieldset :disabled="disabled || operation.busy.value || pending !== null" class="plugin-data__form">
				<template v-if="!retainedOnly">
					<section class="plugin-data__form-section">
						<div class="plugin-data__section-head">
							<h5>{{ t('agent.pluginManagement.keyEditor') }}</h5>
							<span>{{ t('agent.pluginManagement.keyEditorHint') }}</span>
						</div>
						<div class="plugin-data__key-row">
							<UiFormField :label="t('agent.pluginManagement.dataKey')" :for-id="`${id}-data-key`">
								<UiInput :id="`${id}-data-key`" v-model="key" autocomplete="off" spellcheck="false" />
							</UiFormField>
							<UiButton
								type="button"
								appearance="soft"
								density="compact"
								:disabled="!key"
								@click="readKey"
							>
								{{ t('agent.pluginManagement.readKey') }}
							</UiButton>
						</div>
						<UiFormField :label="'JSON'" :for-id="`${id}-data-json`">
							<UiTextarea :id="`${id}-data-json`" v-model="valueJson" :min-rows="5" class="font-mono" />
						</UiFormField>
						<div class="plugin-data__actions">
							<UiButton
								type="button"
								appearance="solid"
								tone="primary"
								density="compact"
								:disabled="operation.refreshRequired.value || loadedKey !== key || !key || !valueJson"
								@click="save(false)"
							>
								{{ t('common.save') }}
							</UiButton>
							<UiButton
								type="button"
								tone="danger"
								density="compact"
								:disabled="operation.refreshRequired.value || loadedKey !== key || !key"
								@click="save(true)"
							>
								{{ t('common.delete') }}
							</UiButton>
						</div>
					</section>

					<section class="plugin-data__form-section">
						<div class="plugin-data__section-head">
							<h5>{{ t('agent.pluginManagement.migration') }}</h5>
							<span>{{ t('agent.pluginManagement.migrationHint') }}</span>
						</div>
						<UiFormField
							:label="t('agent.pluginManagement.migrationItems')"
							:for-id="`${id}-migration-json`"
						>
							<UiTextarea
								:id="`${id}-migration-json`"
								v-model="migrationJson"
								:min-rows="5"
								class="font-mono"
							/>
						</UiFormField>
						<div class="plugin-data__actions">
							<UiButton
								type="button"
								density="compact"
								:disabled="operation.refreshRequired.value || snapshot === null || !migrationJson"
								@click="migrate"
							>
								<i class="fa-solid fa-right-left" aria-hidden="true"></i>
								{{ t('agent.pluginManagement.migrate') }}
							</UiButton>
						</div>
					</section>
				</template>

				<section v-if="installation.status === 'removed'" class="plugin-data__danger">
					<div class="plugin-data__danger-copy">
						<h5>{{ t('agent.pluginManagement.purge') }}</h5>
						<p>{{ t('agent.settings.plugins.deleteDataWarning') }}</p>
					</div>
					<label class="plugin-data__check">
						<UiCheckbox v-model="purgeAcknowledged" />
						<span>{{ t('agent.pluginManagement.confirmPurge') }}</span>
					</label>
					<UiButton
						type="button"
						tone="danger"
						density="compact"
						:disabled="operation.refreshRequired.value || !purgeAcknowledged"
						@click="purge"
					>
						{{ t('agent.pluginManagement.purge') }}
					</UiButton>
				</section>
			</fieldset>

			<section v-if="pending" class="plugin-data__pending">
				<div class="plugin-data__section-head">
					<h5>{{ t('agent.pluginManagement.pendingIntent') }}</h5>
				</div>
				<p class="plugin-data__pending-copy">
					{{ t('agent.pluginManagement.pendingData')
					}}<template v-if="!retainedOnly"> · {{ pending.operationId }}</template>
				</p>
				<div class="plugin-data__actions">
					<UiButton
						v-if="pendingAction === 'write'"
						type="button"
						appearance="soft"
						density="compact"
						:disabled="disabled || operation.busy.value"
						@click="inspectPendingKey"
					>
						{{ t('agent.pluginManagement.readKey') }}
					</UiButton>
					<UiButton
						type="button"
						appearance="solid"
						tone="primary"
						density="compact"
						:disabled="disabled || operation.busy.value || operation.refreshRequired.value"
						@click="dispatch"
					>
						{{ t('agent.pluginManagement.retryDataIntent') }}
					</UiButton>
				</div>
				<pre v-if="observedData !== null" class="plugin-data__observed">{{ observedData }}</pre>
				<label class="plugin-data__check">
					<UiCheckbox v-model="abandonAcknowledged" />
					<span>{{ t('agent.pluginManagement.acknowledge') }}</span>
				</label>
				<UiButton
					type="button"
					density="compact"
					:disabled="
						disabled || operation.busy.value || operation.refreshRequired.value || !abandonAcknowledged
					"
					@click="abandon"
				>
					{{ t('agent.pluginManagement.newIntent') }}
				</UiButton>
			</section>
		</div>
	</details>
</template>

<style scoped>
	.plugin-data {
		min-width: 0;
		overflow: hidden;
		border-radius: 11px;
		background: color-mix(in srgb, var(--header-bg-color) 24%, transparent);
	}

	.plugin-data__summary {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 9px;
		padding: 10px 11px;
		cursor: pointer;
		list-style: none;
	}

	.plugin-data__summary::-webkit-details-marker {
		display: none;
	}

	.plugin-data__icon {
		display: grid;
		width: 27px;
		height: 27px;
		flex: 0 0 auto;
		place-items: center;
		border-radius: 8px;
		background: color-mix(in srgb, var(--link-active-color) 9%, transparent);
		color: var(--link-active-color);
		font-size: 9px;
	}

	.plugin-data__heading {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 2px;
	}

	.plugin-data__title {
		color: var(--text-color);
		font-size: 11px;
		font-weight: 650;
	}

	.plugin-data__meta {
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 9px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.plugin-data__chevron {
		flex: 0 0 auto;
		color: var(--text-color-secondary);
		font-size: 8px;
		transition: transform 150ms ease;
	}

	.plugin-data[open] .plugin-data__chevron {
		transform: rotate(180deg);
	}

	.plugin-data__body {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 10px;
		padding: 0 11px 11px;
	}

	.plugin-data__help {
		color: var(--text-color-secondary);
		font-size: 10px;
		line-height: 1.6;
	}

	.plugin-data__notice {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		padding: 8px 9px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--link-active-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 10px;
		line-height: 1.5;
	}

	.plugin-data__notice > i {
		margin-top: 2px;
	}

	.plugin-data__toolbar,
	.plugin-data__actions,
	.plugin-data__key-row {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 7px;
	}

	.plugin-data__key-row {
		align-items: flex-end;
	}

	.plugin-data__key-row > :first-child {
		min-width: 160px;
		flex: 1;
	}

	.plugin-data__snapshot-meta {
		color: var(--text-color-secondary);
		font-size: 9px;
	}

	.plugin-data__snapshot,
	.plugin-data__form-section,
	.plugin-data__pending {
		min-width: 0;
		padding: 10px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--card-bg-color) 40%, transparent);
	}

	.plugin-data__section-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 8px;
	}

	.plugin-data__section-head h5 {
		color: var(--text-color);
		font-size: 10.5px;
		font-weight: 650;
	}

	.plugin-data__section-head > span {
		color: var(--text-color-secondary);
		font-size: 9px;
	}

	.plugin-data__items {
		display: flex;
		max-height: 224px;
		flex-direction: column;
		gap: 5px;
		overflow-y: auto;
	}

	.plugin-data__items li {
		min-width: 0;
		padding: 8px;
		border-radius: 7px;
		background: color-mix(in srgb, var(--header-bg-color) 40%, transparent);
	}

	.plugin-data__item-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.plugin-data__item-head code,
	.plugin-data__items pre,
	.plugin-data__observed {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 9px;
	}

	.plugin-data__item-head code {
		overflow-wrap: anywhere;
		color: var(--text-color);
	}

	.plugin-data__item-head span {
		color: var(--text-color-secondary);
		font-size: 8.5px;
	}

	.plugin-data__items pre {
		margin-top: 4px;
		overflow-wrap: anywhere;
		color: var(--text-color-secondary);
		white-space: pre-wrap;
	}

	.plugin-data__form {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 9px;
	}

	.plugin-data__form-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.plugin-data__danger {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border-radius: 9px;
		background: color-mix(in srgb, var(--status-error-color) 7%, transparent);
	}

	.plugin-data__danger-copy h5 {
		color: var(--status-error-color);
		font-size: 10.5px;
		font-weight: 650;
	}

	.plugin-data__danger-copy p,
	.plugin-data__pending-copy {
		margin-top: 3px;
		color: var(--text-color-secondary);
		font-size: 9.5px;
		line-height: 1.55;
	}

	.plugin-data__check {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		color: var(--text-color-secondary);
		cursor: pointer;
		font-size: 10px;
		line-height: 1.55;
	}

	.plugin-data__pending {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: color-mix(in srgb, var(--status-warning-color) 7%, var(--card-bg-color) 32%);
	}

	.plugin-data__observed {
		max-height: 150px;
		padding: 8px;
		overflow: auto;
		border-radius: 7px;
		background: color-mix(in srgb, var(--header-bg-color) 44%, transparent);
		color: var(--text-color-secondary);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	@media (max-width: 560px) {
		.plugin-data__summary {
			align-items: flex-start;
		}

		.plugin-data__summary :deep([data-ui='badge']) {
			display: none;
		}

		.plugin-data__key-row {
			align-items: stretch;
		}

		.plugin-data__key-row > :first-child {
			min-width: 100%;
		}

		.plugin-data__key-row :deep([data-ui='button']) {
			align-self: flex-start;
		}

		.plugin-data__actions :deep([data-ui='button']) {
			flex: 1 1 auto;
		}
	}
</style>
