<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { structurallyEqual } from '@/foundation/data';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiSelect, UiSettingsGroup } from '@/foundation/ui';
	import { useFeedback, useSettingsReloadSource } from '@/shared/feedback/public';
	import MonitoringConfigurationPanel from './MonitoringConfigurationPanel.vue';
	import { usePreferencesEditor } from '../composables/use-preferences-editor';
	import type { UserPreferences } from '../model/preferences-types';

	type GroupId = 'files' | 'commands' | 'monitoring' | 'layout';

	const { t } = useI18n();
	const feedback = useFeedback();
	const emit = defineEmits<{ saved: [preferences: UserPreferences] }>();
	const editor = usePreferencesEditor(t);
	const { form, baseline, loading, loadError, needsRefresh, preferences } = editor;
	useSettingsReloadSource({
		id: 'preferences-workspace',

		pending: () => !loading.value && (needsRefresh.value || Boolean(loadError.value)),

		reload: editor.refresh,
	});
	const savingGroup = ref<GroupId | null>(null);

	const fileKeys = [
		'showPopupFileEditor',
		'showPopupFileManager',
		'shareFileEditorTabs',
		'fileManagerShowDeleteConfirmation',
		'spreadsheetPreviewRowsPerPage',
		'spreadsheetPreviewMaxColumns',
	] as const satisfies readonly (keyof UserPreferences)[];
	const commandKeys = [
		'workspaceSidebarPersistent',
		'commandInputSyncTarget',
		'showConnectionTags',
		'showQuickCommandTags',
		'quickCommandsCollapsibleSearch',
		'quickCommandsCompactMode',
		'terminalScrollbackLimit',
		'terminalRightClickCopyPaste',
	] as const satisfies readonly (keyof UserPreferences)[];
	const monitoringKeys = [
		'dashboardShowLocalResources',
		'dashboardShowRemoteResources',

		'showStatusMonitorIpAddress',

		'dockerStatusIntervalSeconds',
		'dockerDefaultExpand',
	] as const satisfies readonly (keyof UserPreferences)[];
	const layoutKeys = ['layoutLocked', 'navBarVisible'] as const satisfies readonly (keyof UserPreferences)[];

	const isDirty = (keys: readonly (keyof UserPreferences)[]) =>
		keys.some((key) => !structurallyEqual(form[key], baseline.value[key]));

	const filesDirty = computed(() => isDirty(fileKeys));
	const commandsDirty = computed(() => isDirty(commandKeys));
	const monitoringDirty = computed(() => isDirty(monitoringKeys));
	const layoutDirty = computed(() => isDirty(layoutKeys));

	const patchFor = (keys: readonly (keyof UserPreferences)[]): Partial<UserPreferences> => {
		const patch: Partial<UserPreferences> = {};
		for (const key of keys) (patch as Record<string, unknown>)[key] = form[key];
		return patch;
	};

	const validatePatch = (patch: Partial<UserPreferences>): string | null => {
		const integerInRange = (value: number, min: number, max: number) =>
			Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;

		if (
			patch.dockerStatusIntervalSeconds !== undefined &&
			!integerInRange(patch.dockerStatusIntervalSeconds, 1, 86400)
		)
			return t('settings.docker.error.invalidInterval');
		if (patch.terminalScrollbackLimit !== undefined && !integerInRange(patch.terminalScrollbackLimit, 0, 100000))
			return t('settings.terminalScrollback.error.invalidInput');
		if (
			patch.spreadsheetPreviewRowsPerPage !== undefined &&
			!integerInRange(patch.spreadsheetPreviewRowsPerPage, 10, 2000)
		)
			return t('settings.workspace.spreadsheetPreviewLimits.invalidRows');
		if (
			patch.spreadsheetPreviewMaxColumns !== undefined &&
			!integerInRange(patch.spreadsheetPreviewMaxColumns, 5, 200)
		)
			return t('settings.workspace.spreadsheetPreviewLimits.invalidColumns');
		return null;
	};

	const saveGroup = async (group: GroupId, keys: readonly (keyof UserPreferences)[]) => {
		const signal = editor.view.capture();
		if (signal.aborted) return;
		const patch = patchFor(keys);
		const validationError = validatePatch(patch);
		if (validationError) {
			feedback.notifyError(validationError);
			return;
		}
		savingGroup.value = group;
		try {
			if (!(await editor.save(patch))) return;
			emit('saved', { ...preferences.values.value });
			const message = t('settings.preferences.saved');
			feedback.notifySuccess(message);
		} catch (cause) {
			if (!editor.view.isCurrent(signal)) return;
			const message = t('settings.preferences.saveFailed', {
				error: cause instanceof Error ? cause.message : String(cause),
			});
			feedback.notifyError(message);
		} finally {
			if (editor.view.isCurrent(signal)) savingGroup.value = null;
		}
	};
</script>

<template>
	<section class="workspace-preferences settings-surface min-w-0">
		<div v-if="loading" class="p-6 text-center text-sm text-text-secondary">{{ t('common.loading') }}</div>
		<div v-else class="ui-settings-groups">
			<UiSettingsGroup :title="t('settings.workspace.groups.files')" icon="fa-solid fa-folder-tree" tone="info">
				<template #actions>
					<UiButton
						type="submit"
						form="workspace-files-form"
						:appearance="filesDirty ? 'solid' : 'soft'"
						:tone="filesDirty ? 'primary' : 'neutral'"
						:disabled="!filesDirty"
						:loading="savingGroup === 'files'"
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<form id="workspace-files-form" @submit.prevent="saveGroup('files', fileKeys)">
					<div class="workspace-preferences__grid">
						<label class="workspace-preferences__toggle" for="showPopupFileEditor">
							<UiCheckbox
								id="showPopupFileEditor"
								v-model="form.showPopupFileEditor"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.popupEditor.enableLabel') }}</strong>
								<small>{{ t('settings.popupEditor.description') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="showPopupFileManager">
							<UiCheckbox
								id="showPopupFileManager"
								v-model="form.showPopupFileManager"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.popupFileManager.enableLabel') }}</strong>
								<small>{{ t('settings.popupFileManager.description') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="shareFileEditorTabs">
							<UiCheckbox
								id="shareFileEditorTabs"
								v-model="form.shareFileEditorTabs"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.shareEditorTabs.enableLabel') }}</strong>
								<small>{{ t('settings.shareEditorTabs.description') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="fileManagerShowDeleteConfirmation">
							<UiCheckbox
								id="fileManagerShowDeleteConfirmation"
								v-model="form.fileManagerShowDeleteConfirmation"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.fileManagerShowDeleteConfirmationLabel') }}</strong>
							</span>
						</label>
						<div class="workspace-preferences__field-grid">
							<UiFormField
								:label="t('settings.workspace.spreadsheetPreviewLimits.rowsLabel')"
								for-id="spreadsheetPreviewRowsPerPage"
							>
								<UiInput
									id="spreadsheetPreviewRowsPerPage"
									v-model="form.spreadsheetPreviewRowsPerPage"
									type="number"
									min="10"
									max="2000"
									step="1"
									:disabled="savingGroup !== null || needsRefresh || loading"
								/>
							</UiFormField>
							<UiFormField
								:label="t('settings.workspace.spreadsheetPreviewLimits.columnsLabel')"
								for-id="spreadsheetPreviewMaxColumns"
							>
								<UiInput
									id="spreadsheetPreviewMaxColumns"
									v-model="form.spreadsheetPreviewMaxColumns"
									type="number"
									min="5"
									max="200"
									step="1"
									:disabled="savingGroup !== null || needsRefresh || loading"
								/>
							</UiFormField>
						</div>
						<p class="workspace-preferences__hint">
							{{ t('settings.workspace.spreadsheetPreviewLimits.hint') }}
						</p>
					</div>
				</form>
			</UiSettingsGroup>

			<UiSettingsGroup :title="t('settings.workspace.groups.commands')" icon="fa-solid fa-terminal" tone="accent">
				<template #actions>
					<UiButton
						type="submit"
						form="workspace-commands-form"
						:appearance="commandsDirty ? 'solid' : 'soft'"
						:tone="commandsDirty ? 'primary' : 'neutral'"
						:disabled="!commandsDirty"
						:loading="savingGroup === 'commands'"
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<form id="workspace-commands-form" @submit.prevent="saveGroup('commands', commandKeys)">
					<div class="workspace-preferences__grid">
						<label class="workspace-preferences__toggle" for="workspaceSidebarPersistent">
							<UiCheckbox
								id="workspaceSidebarPersistent"
								v-model="form.workspaceSidebarPersistent"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.sidebarPersistentLabel') }}</strong>
								<small>{{ t('settings.workspace.sidebarPersistentDescription') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="showConnectionTags">
							<UiCheckbox
								id="showConnectionTags"
								v-model="form.showConnectionTags"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.showConnectionTagsLabel') }}</strong>
								<small>{{ t('settings.workspace.showConnectionTagsDescription') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="showQuickCommandTags">
							<UiCheckbox
								id="showQuickCommandTags"
								v-model="form.showQuickCommandTags"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.showQuickCommandTagsLabel') }}</strong>
								<small>{{ t('settings.workspace.showQuickCommandTagsDescription') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="quickCommandsCollapsibleSearch">
							<UiCheckbox
								id="quickCommandsCollapsibleSearch"
								v-model="form.quickCommandsCollapsibleSearch"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.quickCommandsCollapsibleSearchLabel') }}</strong>
								<small>{{ t('settings.workspace.quickCommandsCollapsibleSearchDescription') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="quickCommandsCompactMode">
							<UiCheckbox
								id="quickCommandsCompactMode"
								v-model="form.quickCommandsCompactMode"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.quickCommandsCompactModeLabel') }}</strong>
								<small>{{ t('settings.workspace.quickCommandsCompactModeDescription') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="terminalRightClickCopyPaste">
							<UiCheckbox
								id="terminalRightClickCopyPaste"
								v-model="form.terminalRightClickCopyPaste"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.terminalRightClickCopyPasteLabel') }}</strong>
								<small>{{ t('settings.workspace.terminalRightClickCopyPasteDescription') }}</small>
							</span>
						</label>
						<UiFormField
							:label="t('settings.commandInputSync.selectLabel')"
							for-id="commandInputSyncTarget"
						>
							<UiSelect
								id="commandInputSyncTarget"
								v-model="form.commandInputSyncTarget"
								:disabled="savingGroup !== null || needsRefresh || loading"
							>
								<option value="none">{{ t('settings.commandInputSync.targetNone') }}</option>
								<option value="quickCommands">
									{{ t('settings.commandInputSync.targetQuickCommands') }}
								</option>
								<option value="commandHistory">
									{{ t('settings.commandInputSync.targetCommandHistory') }}
								</option>
							</UiSelect>
							<p class="workspace-preferences__hint">{{ t('settings.commandInputSync.description') }}</p>
						</UiFormField>
						<UiFormField
							:label="t('settings.terminalScrollback.limitLabel')"
							for-id="terminalScrollbackLimit"
						>
							<UiInput
								id="terminalScrollbackLimit"
								v-model="form.terminalScrollbackLimit"
								type="number"
								min="0"
								max="100000"
								step="1"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<p class="workspace-preferences__hint">{{ t('settings.terminalScrollback.limitHint') }}</p>
						</UiFormField>
					</div>
				</form>
			</UiSettingsGroup>

			<UiSettingsGroup
				:title="t('settings.workspace.groups.monitoring')"
				icon="fa-solid fa-gauge-high"
				tone="success"
			>
				<template #actions>
					<UiButton
						type="submit"
						form="workspace-monitoring-form"
						:appearance="monitoringDirty ? 'solid' : 'soft'"
						:tone="monitoringDirty ? 'primary' : 'neutral'"
						:disabled="!monitoringDirty"
						:loading="savingGroup === 'monitoring'"
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<form
					id="workspace-monitoring-form"
					class="mt-4"
					@submit.prevent="saveGroup('monitoring', monitoringKeys)"
				>
					<div class="workspace-preferences__grid">
						<label class="workspace-preferences__toggle" for="dashboardShowLocalResources">
							<UiCheckbox
								id="dashboardShowLocalResources"
								v-model="form.dashboardShowLocalResources"
								:aria-label="t('settings.dashboardResources.localLabel')"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span
								><strong>{{ t('settings.dashboardResources.localLabel') }}</strong></span
							>
						</label>
						<label class="workspace-preferences__toggle" for="dashboardShowRemoteResources">
							<UiCheckbox
								id="dashboardShowRemoteResources"
								v-model="form.dashboardShowRemoteResources"
								:aria-label="t('settings.dashboardResources.remoteLabel')"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span
								><strong>{{ t('settings.dashboardResources.remoteLabel') }}</strong></span
							>
						</label>
						<label class="workspace-preferences__toggle" for="showStatusMonitorIpAddress">
							<UiCheckbox
								id="showStatusMonitorIpAddress"
								v-model="form.showStatusMonitorIpAddress"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span
								><strong>{{ t('settings.statusMonitorShowIp.enableLabel') }}</strong></span
							>
						</label>
						<label class="workspace-preferences__toggle" for="dockerDefaultExpand">
							<UiCheckbox
								id="dockerDefaultExpand"
								v-model="form.dockerDefaultExpand"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span
								><strong>{{ t('settings.docker.defaultExpandLabel') }}</strong></span
							>
						</label>
						<div class="workspace-preferences__field-grid">
							<UiFormField
								:label="t('settings.docker.refreshIntervalLabel')"
								for-id="dockerStatusIntervalSeconds"
							>
								<UiInput
									id="dockerStatusIntervalSeconds"
									v-model="form.dockerStatusIntervalSeconds"
									type="number"
									min="1"
									max="86400"
									step="1"
									:disabled="savingGroup !== null || needsRefresh || loading"
								/>
							</UiFormField>
						</div>
					</div>
				</form>
			</UiSettingsGroup>

			<MonitoringConfigurationPanel />

			<UiSettingsGroup
				:title="t('settings.workspace.groups.advanced')"
				icon="fa-solid fa-sliders"
				tone="primary"
				compact
			>
				<template #actions>
					<UiButton
						type="submit"
						form="workspace-layout-form"
						:appearance="layoutDirty ? 'solid' : 'soft'"
						:tone="layoutDirty ? 'primary' : 'neutral'"
						:disabled="!layoutDirty"
						:loading="savingGroup === 'layout'"
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<form id="workspace-layout-form" @submit.prevent="saveGroup('layout', layoutKeys)">
					<div class="workspace-preferences__grid">
						<label class="workspace-preferences__toggle" for="layoutLocked">
							<UiCheckbox
								id="layoutLocked"
								v-model="form.layoutLocked"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.layoutLockLabel') }}</strong>
								<small>{{ t('settings.workspace.layoutLockDescription') }}</small>
							</span>
						</label>
						<label class="workspace-preferences__toggle" for="navBarVisible">
							<UiCheckbox
								id="navBarVisible"
								v-model="form.navBarVisible"
								:disabled="savingGroup !== null || needsRefresh || loading"
							/>
							<span>
								<strong>{{ t('settings.workspace.navBarVisibleLabel') }}</strong>
								<small>{{ t('settings.workspace.navBarVisibleDescription') }}</small>
							</span>
						</label>
					</div>
				</form>
			</UiSettingsGroup>
		</div>
	</section>
</template>

<style scoped>
	.workspace-preferences__grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px 18px;
	}

	.workspace-preferences__toggle {
		display: flex;
		min-width: 0;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 11px;
		border-radius: 11px;
		background: color-mix(in srgb, var(--card-bg-color) 54%, transparent);
		cursor: pointer;
	}

	.workspace-preferences__toggle strong {
		display: block;
		color: var(--text-color);
		font-size: 12px;
		font-weight: 600;
		line-height: 1.45;
	}

	.workspace-preferences__toggle small {
		display: block;
		margin-top: 3px;
		color: var(--text-color-secondary);
		font-size: 11px;
		font-weight: 400;
		line-height: 1.55;
	}

	.workspace-preferences__field-grid {
		display: grid;
		min-width: 0;
		grid-column: 1 / -1;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.workspace-preferences__hint {
		margin-top: 5px;
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.55;
	}

	.workspace-preferences__footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 14px;
	}

	@media (max-width: 760px) {
		.workspace-preferences__grid,
		.workspace-preferences__field-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
