<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { structurallyEqual } from '@/foundation/data';
	import {
		UiButton,
		UiCheckbox,
		UiLoadingState,
		UiFormField,
		UiNumberInput,
		UiSelect,
		UiSettingsGroup,
	} from '@/foundation/ui';
	import { useFeedback, useSettingsReloadSource } from '@/shared/feedback/public';
	import {
		SETTINGS_MONITORING_MAX_SECONDS,
		SETTINGS_MONITORING_MIN_SECONDS,
	} from '@nexus-terminal/shared/preferences/configuration/values';
	import { usePreferencesEditor } from '../composables/use-preferences-editor';
	import { useMonitoringConfiguration } from '../composables/use-monitoring-configuration';
	import type { UserPreferences } from '../model/preferences-types';

	type GroupId = 'files' | 'commands' | 'monitoring' | 'layout';

	const { t } = useI18n();
	const feedback = useFeedback();
	const emit = defineEmits<{ saved: [preferences: UserPreferences] }>();
	const editor = usePreferencesEditor(t);
	const monitoringCore = useMonitoringConfiguration({ notify: false });
	const { form, baseline, loading, loadError, needsRefresh, preferences } = editor;
	useSettingsReloadSource({
		id: 'preferences-workspace',

		pending: () =>
			(!loading.value && (needsRefresh.value || Boolean(loadError.value))) ||
			(!monitoringCore.loading.value && monitoringCore.needsRefresh.value),

		reload: async () => {
			const requests: Promise<unknown>[] = [];
			if (!loading.value && (needsRefresh.value || loadError.value)) requests.push(editor.refresh());
			if (!monitoringCore.loading.value && monitoringCore.needsRefresh.value)
				requests.push(monitoringCore.refresh());
			await Promise.allSettled(requests);
		},
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
		'showCommandBarClear',
		'showCommandBarFocusSwitch',
		'showCommandBarEditor',
		'showCommandBarSearch',
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
	const monitoringCoreDirty = computed(() => {
		const snapshot = monitoringCore.snapshot.value;
		const draft = monitoringCore.draft.value;
		return Boolean(
			snapshot &&
			draft &&
			(snapshot.statusIntervalSeconds !== draft.statusIntervalSeconds ||
				snapshot.hostIntervalSeconds !== draft.hostIntervalSeconds),
		);
	});
	const monitoringBusy = computed(() => savingGroup.value !== null || needsRefresh.value || loading.value);
	const monitoringCoreBusy = computed(
		() => monitoringBusy.value || monitoringCore.loading.value || monitoringCore.needsRefresh.value,
	);
	const monitoringGroupDirty = computed(() => monitoringDirty.value || monitoringCoreDirty.value);
	const monitoringGroupValid = computed(
		() =>
			!monitoringCoreDirty.value ||
			Boolean(
				monitoringCore.draft.value &&
				Number.isSafeInteger(monitoringCore.draft.value.statusIntervalSeconds) &&
				monitoringCore.draft.value.statusIntervalSeconds >= SETTINGS_MONITORING_MIN_SECONDS &&
				monitoringCore.draft.value.statusIntervalSeconds <= SETTINGS_MONITORING_MAX_SECONDS &&
				Number.isSafeInteger(monitoringCore.draft.value.hostIntervalSeconds) &&
				monitoringCore.draft.value.hostIntervalSeconds >= SETTINGS_MONITORING_MIN_SECONDS &&
				monitoringCore.draft.value.hostIntervalSeconds <= SETTINGS_MONITORING_MAX_SECONDS,
			),
	);
	const canSaveMonitoringPreferences = computed(() => monitoringDirty.value && !needsRefresh.value && !loading.value);
	const monitoringGroupCanSave = computed(
		() =>
			savingGroup.value === null &&
			monitoringGroupDirty.value &&
			monitoringGroupValid.value &&
			(monitoringCore.canSave.value || canSaveMonitoringPreferences.value),
	);
	const monitoringStatusInterval = computed({
		get: () => monitoringCore.draft.value?.statusIntervalSeconds ?? null,

		set: (value: string | number | null) => {
			if (monitoringCore.draft.value) monitoringCore.draft.value.statusIntervalSeconds = Number(value);
		},
	});
	const monitoringHostInterval = computed({
		get: () => monitoringCore.draft.value?.hostIntervalSeconds ?? null,

		set: (value: string | number | null) => {
			if (monitoringCore.draft.value) monitoringCore.draft.value.hostIntervalSeconds = Number(value);
		},
	});

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

	const saveMonitoringGroup = async (): Promise<void> => {
		const signal = editor.view.capture();
		if (signal.aborted || !monitoringGroupCanSave.value) return;
		const patch = patchFor(monitoringKeys);
		const validationError = validatePatch(patch);
		if (validationError) {
			feedback.notifyError(validationError);
			return;
		}

		savingGroup.value = 'monitoring';
		try {
			const saveCore = monitoringCore.canSave.value;
			const savePreferences = canSaveMonitoringPreferences.value;
			if (saveCore && !(await monitoringCore.save())) {
				if (!editor.view.isCurrent(signal)) return;
				const failure = monitoringCore.feedback.value;
				feedback.notifyError(
					t('settings.monitoring.feedback.' + (failure && failure !== 'saved' ? failure : 'request_failed')),
				);
				return;
			}
			if (savePreferences) {
				if (!(await editor.save(patch))) return;
				emit('saved', { ...preferences.values.value });
			}
			if (!editor.view.isCurrent(signal)) return;
			feedback.notifySuccess(
				saveCore ? t('settings.monitoring.feedback.saved') : t('settings.preferences.saved'),
			);
		} catch (cause) {
			if (!editor.view.isCurrent(signal)) return;
			feedback.notifyError(
				t('settings.preferences.saveFailed', {
					error: cause instanceof Error ? cause.message : String(cause),
				}),
			);
		} finally {
			if (editor.view.isCurrent(signal)) savingGroup.value = null;
		}
	};
</script>

<template>
	<section class="workspace-preferences settings-surface min-w-0">
		<UiLoadingState v-if="loading" compact :bordered="false" :title="t('common.loading')" />
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
								<UiNumberInput
									id="spreadsheetPreviewRowsPerPage"
									v-model="form.spreadsheetPreviewRowsPerPage"
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
								<UiNumberInput
									id="spreadsheetPreviewMaxColumns"
									v-model="form.spreadsheetPreviewMaxColumns"
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
						<div class="workspace-preferences__command-buttons">
							<strong class="workspace-preferences__section-label">
								{{ t('settings.workspace.commandBarButtons.title') }}
							</strong>
							<div class="workspace-preferences__command-button-grid">
								<label class="workspace-preferences__toggle" for="showCommandBarClear">
									<UiCheckbox
										id="showCommandBarClear"
										v-model="form.showCommandBarClear"
										:disabled="savingGroup !== null || needsRefresh || loading"
									/>
									<span>
										<strong>{{ t('settings.workspace.commandBarButtons.clear') }}</strong>
									</span>
								</label>
								<label class="workspace-preferences__toggle" for="showCommandBarFocusSwitch">
									<UiCheckbox
										id="showCommandBarFocusSwitch"
										v-model="form.showCommandBarFocusSwitch"
										:disabled="savingGroup !== null || needsRefresh || loading"
									/>
									<span>
										<strong>{{ t('settings.workspace.commandBarButtons.focusSwitch') }}</strong>
									</span>
								</label>
								<label class="workspace-preferences__toggle" for="showCommandBarEditor">
									<UiCheckbox
										id="showCommandBarEditor"
										v-model="form.showCommandBarEditor"
										:disabled="savingGroup !== null || needsRefresh || loading"
									/>
									<span>
										<strong>{{ t('settings.workspace.commandBarButtons.editor') }}</strong>
									</span>
								</label>
								<label class="workspace-preferences__toggle" for="showCommandBarSearch">
									<UiCheckbox
										id="showCommandBarSearch"
										v-model="form.showCommandBarSearch"
										:disabled="savingGroup !== null || needsRefresh || loading"
									/>
									<span>
										<strong>{{ t('settings.workspace.commandBarButtons.search') }}</strong>
									</span>
								</label>
							</div>
						</div>
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
							<UiNumberInput
								id="terminalScrollbackLimit"
								v-model="form.terminalScrollbackLimit"
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
				data-monitoring-configuration
			>
				<template #description>
					<span v-if="monitoringCore.snapshot.value">
						{{
							t('settings.monitoring.effective', {
								status: monitoringCore.snapshot.value.effectiveMonitoring.statusIntervalSeconds,
								host: monitoringCore.snapshot.value.effectiveMonitoring.hostIntervalSeconds,
							})
						}}
					</span>
				</template>
				<template #actions>
					<UiButton
						type="submit"
						form="workspace-monitoring-form"
						:appearance="monitoringGroupCanSave ? 'solid' : 'soft'"
						:tone="monitoringGroupCanSave ? 'primary' : 'neutral'"
						:disabled="!monitoringGroupCanSave"
						:loading="savingGroup === 'monitoring' || monitoringCore.loading.value"
						data-monitoring-save
						>{{ t('common.save') }}</UiButton
					>
				</template>
				<form id="workspace-monitoring-form" @submit.prevent="saveMonitoringGroup">
					<div class="workspace-preferences__monitor-grid">
						<div class="workspace-preferences__monitor-card">
							<label class="workspace-preferences__monitor-toggle" for="dashboardShowLocalResources">
								<UiCheckbox
									id="dashboardShowLocalResources"
									v-model="form.dashboardShowLocalResources"
									:aria-label="t('settings.dashboardResources.localLabel')"
									:disabled="monitoringBusy"
								/>
								<strong>{{ t('settings.dashboardResources.localLabel') }}</strong>
							</label>
							<div v-if="monitoringCore.draft.value" class="workspace-preferences__monitor-interval">
								<span>{{ t('settings.monitoring.statusShort') }}</span>
								<UiNumberInput
									v-model="monitoringStatusInterval"
									class="workspace-preferences__monitor-input"
									:aria-label="t('settings.monitoring.status')"
									icon="fa-regular fa-clock"
									:unit="t('settings.monitoring.secondsUnit')"
									density="compact"
									:min="SETTINGS_MONITORING_MIN_SECONDS"
									:max="SETTINGS_MONITORING_MAX_SECONDS"
									step="1"
									:disabled="monitoringCoreBusy"
									data-monitoring-status
								/>
							</div>
						</div>
						<div class="workspace-preferences__monitor-card">
							<label class="workspace-preferences__monitor-toggle" for="dashboardShowRemoteResources">
								<UiCheckbox
									id="dashboardShowRemoteResources"
									v-model="form.dashboardShowRemoteResources"
									:aria-label="t('settings.dashboardResources.remoteLabel')"
									:disabled="monitoringBusy"
								/>
								<strong>{{ t('settings.dashboardResources.remoteLabel') }}</strong>
							</label>
							<div v-if="monitoringCore.draft.value" class="workspace-preferences__monitor-interval">
								<span>{{ t('settings.monitoring.hostShort') }}</span>
								<UiNumberInput
									v-model="monitoringHostInterval"
									class="workspace-preferences__monitor-input"
									:aria-label="t('settings.monitoring.host')"
									icon="fa-regular fa-clock"
									:unit="t('settings.monitoring.secondsUnit')"
									density="compact"
									:min="SETTINGS_MONITORING_MIN_SECONDS"
									:max="SETTINGS_MONITORING_MAX_SECONDS"
									step="1"
									:disabled="monitoringCoreBusy"
									data-monitoring-host
								/>
							</div>
						</div>
						<div class="workspace-preferences__monitor-card">
							<label class="workspace-preferences__monitor-toggle" for="showStatusMonitorIpAddress">
								<UiCheckbox
									id="showStatusMonitorIpAddress"
									v-model="form.showStatusMonitorIpAddress"
									:disabled="monitoringBusy"
								/>
								<strong>{{ t('settings.statusMonitorShowIp.enableLabel') }}</strong>
							</label>
						</div>
						<div class="workspace-preferences__monitor-card">
							<label class="workspace-preferences__monitor-toggle" for="dockerDefaultExpand">
								<UiCheckbox
									id="dockerDefaultExpand"
									v-model="form.dockerDefaultExpand"
									:disabled="monitoringBusy"
								/>
								<strong>{{ t('settings.docker.defaultExpandLabel') }}</strong>
							</label>
							<div class="workspace-preferences__monitor-interval">
								<span>{{ t('settings.monitoring.refreshShort') }}</span>
								<UiNumberInput
									id="dockerStatusIntervalSeconds"
									v-model="form.dockerStatusIntervalSeconds"
									class="workspace-preferences__monitor-input"
									:aria-label="t('settings.docker.refreshIntervalLabel')"
									icon="fa-regular fa-clock"
									:unit="t('settings.monitoring.secondsUnit')"
									density="compact"
									min="1"
									max="86400"
									step="1"
									:disabled="monitoringBusy"
								/>
							</div>
						</div>
					</div>
				</form>
			</UiSettingsGroup>

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

	.workspace-preferences__command-buttons {
		display: grid;
		min-width: 0;
		grid-column: 1 / -1;
		gap: 8px;
	}

	.workspace-preferences__section-label {
		color: var(--text-color-secondary);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	.workspace-preferences__command-button-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
	}

	.workspace-preferences__command-button-grid .workspace-preferences__toggle {
		align-items: center;
		padding: 9px 10px;
	}

	.workspace-preferences__monitor-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.workspace-preferences__monitor-card {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		min-height: 54px;
		padding: 10px 12px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--card-bg-color) 54%, transparent);
	}

	.workspace-preferences__monitor-toggle {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 10px;
		cursor: pointer;
	}

	.workspace-preferences__monitor-toggle strong {
		color: var(--text-color);
		font-size: 12px;
		font-weight: 600;
		line-height: 1.45;
	}

	.workspace-preferences__monitor-interval {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 7px;
		color: var(--text-color-secondary);
		font-size: 10px;
		white-space: nowrap;
	}

	.workspace-preferences__monitor-input {
		width: 108px;
	}

	.workspace-preferences__interval-field {
		align-self: start;
	}

	.workspace-preferences__interval-input {
		width: min(100%, 16rem);
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
		.workspace-preferences__field-grid,
		.workspace-preferences__monitor-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 900px) {
		.workspace-preferences__command-button-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 480px) {
		.workspace-preferences__monitor-card {
			flex-wrap: wrap;
			gap: 8px 12px;
		}

		.workspace-preferences__monitor-interval {
			width: 100%;
			justify-content: flex-end;
		}
	}
</style>
