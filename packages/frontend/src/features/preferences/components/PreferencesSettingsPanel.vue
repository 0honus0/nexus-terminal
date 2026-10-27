<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
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
	import { BackendLoggingPanel, useBackendLogging } from '@/features/logging/public';
	import MonitoringConfigurationPanel from './MonitoringConfigurationPanel.vue';
	import { usePreferencesEditor } from '../composables/use-preferences-editor';
	import {
		LOG_LEVELS,
		commonTimezones,
		preferenceLanguageNames,
		type UserPreferences,
	} from '../model/preferences-types';

	const { t } = useI18n();
	const feedback = useFeedback();
	const savingSection = ref<string | null>(null);

	const props = withDefaults(
		defineProps<{ locales?: readonly string[]; section?: 'all' | 'system' | 'workspace' }>(),
		{
			locales: () => ['en-US', 'zh-CN', 'ja-JP'],

			section: 'all',
		},
	);
	const editor = usePreferencesEditor(t);
	const backendLogging = useBackendLogging();
	const { form, baseline, loading, loadError, needsRefresh } = editor;
	useSettingsReloadSource({
		id: 'preferences-system',

		pending: () =>
			(!loading.value && (needsRefresh.value || Boolean(loadError.value))) ||
			(!backendLogging.busy.value && backendLogging.needsRefresh.value),

		reload: async () => {
			const requests: Promise<unknown>[] = [];
			if (!loading.value && (needsRefresh.value || loadError.value)) requests.push(editor.refresh());
			if (!backendLogging.busy.value && backendLogging.needsRefresh.value)
				requests.push(backendLogging.execute());
			await Promise.allSettled(requests);
		},
	});
	const languageDirty = computed(() => form.language !== baseline.value.language);
	const timezoneDirty = computed(() => form.timezone !== baseline.value.timezone);
	const frontendLogDirty = computed(() => form.frontendLogLevel !== baseline.value.frontendLogLevel);
	const backendLogDirty = computed(
		() =>
			backendLogging.snapshot.value !== null &&
			backendLogging.level.value !== backendLogging.snapshot.value.level,
	);
	const loggingDirty = computed(() => frontendLogDirty.value || backendLogDirty.value);

	const validatePatch = (patch: Partial<UserPreferences>): string | null => {
		const integerInRange = (value: number, min: number, max: number) =>
			Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;

		if (
			patch.dockerStatusIntervalSeconds !== undefined &&
			!integerInRange(patch.dockerStatusIntervalSeconds, 1, 86400)
		) {
			return t('settings.docker.error.invalidInterval');
		}
		if (patch.terminalScrollbackLimit !== undefined && !integerInRange(patch.terminalScrollbackLimit, 0, 100000)) {
			return t('settings.terminalScrollback.error.invalidInput');
		}
		if (
			patch.spreadsheetPreviewRowsPerPage !== undefined &&
			!integerInRange(patch.spreadsheetPreviewRowsPerPage, 10, 2000)
		) {
			return t('settings.workspace.spreadsheetPreviewLimits.invalidRows');
		}
		if (
			patch.spreadsheetPreviewMaxColumns !== undefined &&
			!integerInRange(patch.spreadsheetPreviewMaxColumns, 5, 200)
		) {
			return t('settings.workspace.spreadsheetPreviewLimits.invalidColumns');
		}
		return null;
	};

	const savePatch = async (sectionId: string, patch: Partial<UserPreferences>) => {
		const signal = editor.view.capture();
		if (signal.aborted) return;
		const validationError = validatePatch(patch);
		if (validationError) {
			feedback.notifyError(validationError);
			return;
		}

		savingSection.value = sectionId;
		try {
			if (!(await editor.save(patch))) return;
			const message = t('settings.preferences.saved');
			feedback.notifySuccess(message);
		} catch (cause) {
			if (!editor.view.isCurrent(signal)) return;
			const message = t('settings.preferences.saveFailed', {
				error: cause instanceof Error ? cause.message : String(cause),
			});
			feedback.notifyError(message);
		} finally {
			if (editor.view.isCurrent(signal)) savingSection.value = null;
		}
	};

	const saveLogging = async (): Promise<void> => {
		if (savingSection.value !== null || !loggingDirty.value) return;
		const signal = editor.view.capture();
		if (signal.aborted) return;
		const saveBackend = backendLogDirty.value;
		savingSection.value = 'logging';
		try {
			if (frontendLogDirty.value) {
				if (!(await editor.save({ frontendLogLevel: form.frontendLogLevel }))) return;
			}
			if (saveBackend) {
				await backendLogging.execute(true);
				if (backendLogging.needsRefresh.value) return;
			}
			if (!editor.view.isCurrent(signal)) return;
			const message = t('settings.preferences.saved');
			feedback.notifySuccess(message);
		} finally {
			if (editor.view.isCurrent(signal)) savingSection.value = null;
		}
	};
</script>

<template>
	<section class="settings-surface">
		<h2
			v-if="props.section !== 'system'"
			class="border-b border-border/60 px-6 py-4 text-lg font-semibold text-foreground"
		>
			{{ t('settings.workspace.title') }}
		</h2>

		<MonitoringConfigurationPanel v-if="props.section !== 'system'" class="m-6" />

		<UiLoadingState v-if="loading" compact :bordered="false" :title="t('common.loading')" />

		<fieldset v-else-if="props.section === 'system'" :disabled="needsRefresh || editor.saving.value">
			<div class="ui-settings-groups">
				<UiSettingsGroup :title="t('settings.language.title')" icon="fa-solid fa-language" tone="info">
					<template #actions>
						<UiButton
							type="submit"
							form="language-settings-form"
							:appearance="languageDirty ? 'solid' : 'soft'"
							:tone="languageDirty ? 'primary' : 'neutral'"
							:loading="savingSection === 'language'"
							:disabled="!languageDirty || savingSection !== null"
						>
							{{ t('common.save') }}
						</UiButton>
					</template>
					<form
						id="language-settings-form"
						class="space-y-4"
						@submit.prevent="savePatch('language', { language: form.language })"
					>
						<UiFormField :label="t('settings.language.selectLabel')" for-id="languageSelect">
							<UiSelect id="languageSelect" v-model="form.language" :disabled="savingSection !== null">
								<option v-for="locale in props.locales" :key="locale" :value="locale">
									{{ preferenceLanguageNames[locale] || locale }}
								</option>
							</UiSelect>
						</UiFormField>
					</form>
				</UiSettingsGroup>

				<UiSettingsGroup :title="t('settings.timezone.title')" icon="fa-solid fa-earth-asia" tone="primary">
					<template #actions>
						<UiButton
							type="submit"
							form="timezone-settings-form"
							:appearance="timezoneDirty ? 'solid' : 'soft'"
							:tone="timezoneDirty ? 'primary' : 'neutral'"
							:loading="savingSection === 'timezone'"
							:disabled="!timezoneDirty || savingSection !== null"
							>{{ t('common.save') }}</UiButton
						>
					</template>
					<form
						id="timezone-settings-form"
						class="space-y-4"
						@submit.prevent="savePatch('timezone', { timezone: form.timezone })"
					>
						<UiFormField :label="t('settings.timezone.selectLabel')" for-id="timezoneSelect">
							<UiSelect id="timezoneSelect" v-model="form.timezone" :disabled="savingSection !== null">
								<option v-for="timezone in commonTimezones" :key="timezone" :value="timezone">
									{{ timezone }}
								</option>
							</UiSelect>
						</UiFormField>
					</form>
				</UiSettingsGroup>

				<UiSettingsGroup :title="t('settings.logging.title')" icon="fa-solid fa-file-lines" tone="accent">
					<template #actions>
						<UiButton
							type="submit"
							form="logging-settings-form"
							:appearance="loggingDirty ? 'solid' : 'soft'"
							:tone="loggingDirty ? 'primary' : 'neutral'"
							:loading="savingSection === 'logging' || backendLogging.busy.value"
							:disabled="
								!loggingDirty ||
								savingSection !== null ||
								backendLogging.busy.value ||
								backendLogging.needsRefresh.value
							"
							>{{ t('common.save') }}</UiButton
						>
					</template>
					<form id="logging-settings-form" class="ui-settings-grid" @submit.prevent="saveLogging">
						<section class="space-y-3">
							<span class="text-xs font-semibold text-foreground">{{
								t('settings.logging.frontendTitle')
							}}</span>
							<UiSelect
								id="frontendLogLevelSelect"
								v-model="form.frontendLogLevel"
								:aria-label="t('settings.logging.frontendLabel')"
								:disabled="savingSection !== null"
							>
								<option v-for="level in LOG_LEVELS" :key="level" :value="level">
									{{ level.toUpperCase() }}
								</option>
							</UiSelect>
						</section>
						<BackendLoggingPanel
							:level="backendLogging.level.value"
							:busy="backendLogging.busy.value"
							:needs-refresh="backendLogging.needsRefresh.value"
							@update:level="backendLogging.level.value = $event"
						/>
					</form>
				</UiSettingsGroup>
			</div>
		</fieldset>
		<fieldset v-else :disabled="needsRefresh || editor.saving.value" class="space-y-6 p-6">
			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.popupEditor.title') }}</h3>
				<form
					class="space-y-4"
					@submit.prevent="savePatch('popup-editor', { showPopupFileEditor: form.showPopupFileEditor })"
				>
					<label
						for="showPopupFileEditor"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="showPopupFileEditor"
							v-model="form.showPopupFileEditor"
							:disabled="savingSection !== null"
						/>
						<span class="sr-only">{{ t('settings.popupEditor.title') }} — </span>
						{{ t('settings.popupEditor.enableLabel') }}
					</label>
					<p class="text-xs text-text-secondary">{{ t('settings.popupEditor.description') }}</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'popup-editor'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.popupFileManager.title') }}</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('popup-file-manager', { showPopupFileManager: form.showPopupFileManager })
					"
				>
					<label
						for="showPopupFileManager"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="showPopupFileManager"
							v-model="form.showPopupFileManager"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.popupFileManager.enableLabel') }}
					</label>
					<p class="text-xs text-text-secondary">{{ t('settings.popupFileManager.description') }}</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'popup-file-manager'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.shareEditorTabs.title') }}</h3>
				<form
					class="space-y-4"
					@submit.prevent="savePatch('share-editor-tabs', { shareFileEditorTabs: form.shareFileEditorTabs })"
				>
					<label
						for="shareFileEditorTabs"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="shareFileEditorTabs"
							v-model="form.shareFileEditorTabs"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.shareEditorTabs.enableLabel') }}
					</label>
					<p class="text-xs text-text-secondary">{{ t('settings.shareEditorTabs.description') }}</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'share-editor-tabs'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.sidebarPersistentTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('sidebar-persistent', { workspaceSidebarPersistent: form.workspaceSidebarPersistent })
					"
				>
					<label
						for="workspaceSidebarPersistent"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="workspaceSidebarPersistent"
							v-model="form.workspaceSidebarPersistent"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.sidebarPersistentLabel') }}
					</label>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.sidebarPersistentDescription') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'sidebar-persistent'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.commandInputSync.title') }}</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('command-input-sync', { commandInputSyncTarget: form.commandInputSyncTarget })
					"
				>
					<UiFormField :label="t('settings.commandInputSync.selectLabel')" for-id="commandInputSyncTarget">
						<UiSelect
							id="commandInputSyncTarget"
							v-model="form.commandInputSyncTarget"
							:disabled="savingSection !== null"
						>
							<option value="none">{{ t('settings.commandInputSync.targetNone') }}</option>
							<option value="quickCommands">
								{{ t('settings.commandInputSync.targetQuickCommands') }}
							</option>
							<option value="commandHistory">
								{{ t('settings.commandInputSync.targetCommandHistory') }}
							</option>
						</UiSelect>
						<p class="mt-1 text-xs text-text-secondary">{{ t('settings.commandInputSync.description') }}</p>
					</UiFormField>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'command-input-sync'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.showConnectionTagsTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="savePatch('connection-tags', { showConnectionTags: form.showConnectionTags })"
				>
					<label
						for="showConnectionTags"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="showConnectionTags"
							v-model="form.showConnectionTags"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.showConnectionTagsLabel') }}
					</label>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.showConnectionTagsDescription') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'connection-tags'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.showQuickCommandTagsTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('quick-command-tags', { showQuickCommandTags: form.showQuickCommandTags })
					"
				>
					<label
						for="showQuickCommandTags"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="showQuickCommandTags"
							v-model="form.showQuickCommandTags"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.showQuickCommandTagsLabel') }}
					</label>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.showQuickCommandTagsDescription') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'quick-command-tags'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.quickCommandsCollapsibleSearchTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('quick-command-search', {
							quickCommandsCollapsibleSearch: form.quickCommandsCollapsibleSearch,
						})
					"
				>
					<label
						for="quickCommandsCollapsibleSearch"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="quickCommandsCollapsibleSearch"
							v-model="form.quickCommandsCollapsibleSearch"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.quickCommandsCollapsibleSearchLabel') }}
					</label>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.quickCommandsCollapsibleSearchDescription') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'quick-command-search'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.quickCommandsCompactModeTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('quick-command-compact', { quickCommandsCompactMode: form.quickCommandsCompactMode })
					"
				>
					<label
						for="quickCommandsCompactMode"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="quickCommandsCompactMode"
							v-model="form.quickCommandsCompactMode"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.quickCommandsCompactModeLabel') }}
					</label>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.quickCommandsCompactModeDescription') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'quick-command-compact'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.terminalScrollback.title') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('terminal-scrollback', { terminalScrollbackLimit: form.terminalScrollbackLimit })
					"
				>
					<UiFormField :label="t('settings.terminalScrollback.limitLabel')" for-id="terminalScrollbackLimit">
						<UiNumberInput
							id="terminalScrollbackLimit"
							v-model="form.terminalScrollbackLimit"
							min="0"
							max="100000"
							step="1"
							:disabled="savingSection !== null"
						/>
						<p class="mt-1 text-xs text-text-secondary">{{ t('settings.terminalScrollback.limitHint') }}</p>
					</UiFormField>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'terminal-scrollback'"
							>{{ t('settings.terminalScrollback.saveButton') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.spreadsheetPreviewLimits.title') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('spreadsheet-preview', {
							spreadsheetPreviewRowsPerPage: form.spreadsheetPreviewRowsPerPage,
							spreadsheetPreviewMaxColumns: form.spreadsheetPreviewMaxColumns,
						})
					"
				>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
								:disabled="savingSection !== null"
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
								:disabled="savingSection !== null"
							/>
						</UiFormField>
					</div>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.spreadsheetPreviewLimits.hint') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'spreadsheet-preview'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.fileManagerDeleteConfirmTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('file-manager-delete', {
							fileManagerShowDeleteConfirmation: form.fileManagerShowDeleteConfirmation,
						})
					"
				>
					<label
						for="fileManagerShowDeleteConfirmation"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="fileManagerShowDeleteConfirmation"
							v-model="form.fileManagerShowDeleteConfirmation"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.fileManagerShowDeleteConfirmationLabel') }}
					</label>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'file-manager-delete'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.terminalRightClickCopyPasteTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('terminal-right-click', {
							terminalRightClickCopyPaste: form.terminalRightClickCopyPaste,
						})
					"
				>
					<label
						for="terminalRightClickCopyPaste"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="terminalRightClickCopyPaste"
							v-model="form.terminalRightClickCopyPaste"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.terminalRightClickCopyPasteLabel') }}
					</label>
					<p class="text-xs text-text-secondary">
						{{ t('settings.workspace.terminalRightClickCopyPasteDescription') }}
					</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'terminal-right-click'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.dashboardResources.title') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('dashboard-resources', {
							dashboardShowLocalResources: form.dashboardShowLocalResources,
							dashboardShowRemoteResources: form.dashboardShowRemoteResources,
						})
					"
				>
					<p class="text-xs text-text-secondary">{{ t('settings.dashboardResources.description') }}</p>
					<div class="space-y-3">
						<label
							for="dashboardShowLocalResources"
							class="flex cursor-pointer items-start gap-2 text-sm text-foreground select-none"
						>
							<UiCheckbox
								id="dashboardShowLocalResources"
								v-model="form.dashboardShowLocalResources"
								class="mt-0.5"
								:aria-label="t('settings.dashboardResources.localLabel')"
								:disabled="savingSection !== null"
							/>
							<span>
								<span class="block">{{ t('settings.dashboardResources.localLabel') }}</span>
								<span class="block text-xs text-text-secondary">{{
									t('settings.dashboardResources.localHint')
								}}</span>
							</span>
						</label>
						<label
							for="dashboardShowRemoteResources"
							class="flex cursor-pointer items-start gap-2 text-sm text-foreground select-none"
						>
							<UiCheckbox
								id="dashboardShowRemoteResources"
								v-model="form.dashboardShowRemoteResources"
								class="mt-0.5"
								:aria-label="t('settings.dashboardResources.remoteLabel')"
								:disabled="savingSection !== null"
							/>
							<span>
								<span class="block">{{ t('settings.dashboardResources.remoteLabel') }}</span>
								<span class="block text-xs text-text-secondary">{{
									t('settings.dashboardResources.remoteHint')
								}}</span>
							</span>
						</label>
					</div>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'dashboard-resources'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.statusMonitorShowIp.title') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('status-ip', { showStatusMonitorIpAddress: form.showStatusMonitorIpAddress })
					"
				>
					<label
						for="showStatusMonitorIpAddress"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="showStatusMonitorIpAddress"
							v-model="form.showStatusMonitorIpAddress"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.statusMonitorShowIp.enableLabel') }}
					</label>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'status-ip'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.docker.title') }}</h3>
				<form
					class="space-y-4"
					@submit.prevent="
						savePatch('docker', {
							dockerStatusIntervalSeconds: form.dockerStatusIntervalSeconds,
							dockerDefaultExpand: form.dockerDefaultExpand,
						})
					"
				>
					<UiFormField
						:label="t('settings.docker.refreshIntervalLabel')"
						for-id="dockerStatusIntervalSeconds"
					>
						<UiNumberInput
							id="dockerStatusIntervalSeconds"
							v-model="form.dockerStatusIntervalSeconds"
							min="1"
							step="1"
							:disabled="savingSection !== null"
						/>
						<p class="mt-1 text-xs text-text-secondary">{{ t('settings.docker.refreshIntervalHint') }}</p>
					</UiFormField>
					<label
						for="dockerDefaultExpand"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="dockerDefaultExpand"
							v-model="form.dockerDefaultExpand"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.docker.defaultExpandLabel') }}
					</label>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'docker'"
							>{{ t('settings.docker.saveButton') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.layoutLockTitle') }}
				</h3>
				<form class="space-y-4" @submit.prevent="savePatch('layout-lock', { layoutLocked: form.layoutLocked })">
					<label
						for="layoutLocked"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox id="layoutLocked" v-model="form.layoutLocked" :disabled="savingSection !== null" />
						{{ t('settings.workspace.layoutLockLabel') }}
					</label>
					<p class="text-xs text-text-secondary">{{ t('settings.workspace.layoutLockDescription') }}</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'layout-lock'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>

			<hr class="border-border" />

			<section class="settings-section-content">
				<h3 class="mb-3 text-base font-semibold text-foreground">
					{{ t('settings.workspace.navBarVisibleTitle') }}
				</h3>
				<form
					class="space-y-4"
					@submit.prevent="savePatch('nav-bar-visible', { navBarVisible: form.navBarVisible })"
				>
					<label
						for="navBarVisible"
						class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
					>
						<UiCheckbox
							id="navBarVisible"
							v-model="form.navBarVisible"
							:disabled="savingSection !== null"
						/>
						{{ t('settings.workspace.navBarVisibleLabel') }}
					</label>
					<p class="text-xs text-text-secondary">{{ t('settings.workspace.navBarVisibleDescription') }}</p>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="savingSection === 'nav-bar-visible'"
							>{{ t('common.save') }}</UiButton
						>
					</div>
				</form>
			</section>
		</fieldset>
	</section>
</template>
