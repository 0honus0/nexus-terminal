<script setup lang="ts">
	import { computed, reactive, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { structurallyEqual } from '@/foundation/data';
	import { UiButton, UiCheckbox, UiFormField, UiInput, UiSelect } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import MonitoringConfigurationPanel from './MonitoringConfigurationPanel.vue';
	import { usePreferencesEditor } from '../composables/use-preferences-editor';
	import type { UserPreferences } from '../model/preferences-types';

	type GroupId = 'files' | 'commands' | 'monitoring' | 'layout';

	const { t } = useI18n();
	const feedback = useFeedback();
	const emit = defineEmits<{ saved: [preferences: UserPreferences] }>();
	const editor = usePreferencesEditor(t);
	const { form, baseline, loading, loadError, needsRefresh, preferences } = editor;
	const savingGroup = ref<GroupId | null>(null);
	const groupMessages = reactive<Record<GroupId, { text: string; success: boolean } | null>>({
		files: null,
		commands: null,
		monitoring: null,
		layout: null,
	});

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
	const dirtyCount = computed(
		() => [filesDirty.value, commandsDirty.value, monitoringDirty.value, layoutDirty.value].filter(Boolean).length,
	);

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
			groupMessages[group] = { text: validationError, success: false };
			feedback.notifyError(validationError);
			return;
		}
		savingGroup.value = group;
		groupMessages[group] = null;
		try {
			if (!(await editor.save(patch))) return;
			emit('saved', { ...preferences.values.value });
			const message = t('settings.preferences.saved');
			groupMessages[group] = { text: message, success: true };
			feedback.notifySuccess(message);
		} catch (cause) {
			if (!editor.view.isCurrent(signal)) return;
			const message = t('settings.preferences.saveFailed', {
				error: cause instanceof Error ? cause.message : String(cause),
			});
			groupMessages[group] = { text: message, success: false };
			feedback.notifyError(message);
		} finally {
			if (editor.view.isCurrent(signal)) savingGroup.value = null;
		}
	};
</script>

<template>
	<section class="workspace-preferences min-w-0">
		<UiButton
			v-if="needsRefresh || loadError"
			class="mb-3"
			:disabled="loading || editor.saving.value"
			@click="editor.refresh"
			>{{ t('common.refresh') }}</UiButton
		>
		<header class="flex flex-col gap-2 px-1 py-3 sm:flex-row sm:items-center sm:justify-between">
			<div class="min-w-0">
				<h2 class="text-lg font-semibold text-foreground">{{ t('settings.workspace.title') }}</h2>
				<p class="mt-1 max-w-3xl text-xs leading-5 text-text-secondary">
					{{ t('settings.workspace.organizedDescription') }}
				</p>
			</div>
			<span
				v-if="dirtyCount"
				class="w-fit shrink-0 rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning"
			>
				{{ t('settings.workspace.unsavedGroups', { count: dirtyCount }) }}
			</span>
		</header>

		<MonitoringConfigurationPanel class="mb-5" />

		<div v-if="loading" class="p-6 text-center text-sm text-text-secondary">{{ t('common.loading') }}</div>
		<div v-else class="space-y-5">
			<p v-if="loadError" class="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error">
				{{ loadError }}
			</p>

			<form class="workspace-preferences__group" @submit.prevent="saveGroup('files', fileKeys)">
				<div class="border-b border-border/60 px-4 py-3">
					<h3 class="text-sm font-semibold text-foreground">{{ t('settings.workspace.groups.files') }}</h3>
					<p class="mt-1 text-xs text-text-secondary">{{ t('settings.workspace.groups.filesHint') }}</p>
				</div>
				<div class="grid gap-3 p-3 lg:grid-cols-2">
					<div class="workspace-preferences__field">
						<label
							for="showPopupFileEditor"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
						>
							<UiCheckbox
								id="showPopupFileEditor"
								v-model="form.showPopupFileEditor"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/>
							<span class="min-w-0">{{ t('settings.popupEditor.enableLabel') }}</span>
						</label>
						<details class="mt-2 text-xs text-text-secondary">
							<summary class="cursor-pointer select-none text-primary">
								{{ t('settings.workspace.moreDetails') }}
							</summary>
							<p class="mt-1 leading-5">{{ t('settings.popupEditor.description') }}</p>
						</details>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="showPopupFileManager"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
						>
							<UiCheckbox
								id="showPopupFileManager"
								v-model="form.showPopupFileManager"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/>
							<span>{{ t('settings.popupFileManager.enableLabel') }}</span>
						</label>
						<p class="mt-2 text-xs leading-5 text-text-secondary">
							{{ t('settings.popupFileManager.description') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="shareFileEditorTabs"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
						>
							<UiCheckbox
								id="shareFileEditorTabs"
								v-model="form.shareFileEditorTabs"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/>
							<span>{{ t('settings.shareEditorTabs.enableLabel') }}</span>
						</label>
						<p class="mt-2 text-xs leading-5 text-text-secondary">
							{{ t('settings.shareEditorTabs.description') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="fileManagerShowDeleteConfirmation"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
						>
							<UiCheckbox
								id="fileManagerShowDeleteConfirmation"
								v-model="form.fileManagerShowDeleteConfirmation"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/>
							<span>{{ t('settings.workspace.fileManagerShowDeleteConfirmationLabel') }}</span>
						</label>
					</div>
					<div class="workspace-preferences__field lg:col-span-2">
						<div class="mb-3 text-sm font-medium text-foreground">
							{{ t('settings.workspace.spreadsheetPreviewLimits.title') }}
						</div>
						<div class="grid gap-3 sm:grid-cols-2">
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
						<p class="mt-2 text-xs leading-5 text-text-secondary">
							{{ t('settings.workspace.spreadsheetPreviewLimits.hint') }}
						</p>
					</div>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
					<p class="min-h-4 text-xs" :class="groupMessages.files?.success ? 'text-success' : 'text-error'">
						{{ groupMessages.files?.text }}
					</p>
					<UiButton
						type="submit"
						appearance="solid"
						tone="primary"
						:disabled="!filesDirty"
						:loading="savingGroup === 'files'"
						>{{ t('settings.workspace.saveGroup') }}</UiButton
					>
				</div>
			</form>

			<form class="workspace-preferences__group" @submit.prevent="saveGroup('commands', commandKeys)">
				<div class="border-b border-border/60 px-4 py-3">
					<h3 class="text-sm font-semibold text-foreground">{{ t('settings.workspace.groups.commands') }}</h3>
					<p class="mt-1 text-xs text-text-secondary">{{ t('settings.workspace.groups.commandsHint') }}</p>
				</div>
				<div class="grid gap-3 p-3 lg:grid-cols-2">
					<div class="workspace-preferences__field">
						<label
							for="workspaceSidebarPersistent"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="workspaceSidebarPersistent"
								v-model="form.workspaceSidebarPersistent"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.workspace.sidebarPersistentLabel') }}</span></label
						>
						<p class="mt-2 text-xs text-text-secondary">
							{{ t('settings.workspace.sidebarPersistentDescription') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
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
						</UiFormField>
						<p class="mt-2 text-xs text-text-secondary">{{ t('settings.commandInputSync.description') }}</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="showConnectionTags"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="showConnectionTags"
								v-model="form.showConnectionTags"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.workspace.showConnectionTagsLabel') }}</span></label
						>
						<p class="mt-2 text-xs text-text-secondary">
							{{ t('settings.workspace.showConnectionTagsDescription') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="showQuickCommandTags"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="showQuickCommandTags"
								v-model="form.showQuickCommandTags"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.workspace.showQuickCommandTagsLabel') }}</span></label
						>
						<p class="mt-2 text-xs text-text-secondary">
							{{ t('settings.workspace.showQuickCommandTagsDescription') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="quickCommandsCollapsibleSearch"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="quickCommandsCollapsibleSearch"
								v-model="form.quickCommandsCollapsibleSearch"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.workspace.quickCommandsCollapsibleSearchLabel') }}</span></label
						>
						<p class="mt-2 text-xs text-text-secondary">
							{{ t('settings.workspace.quickCommandsCollapsibleSearchDescription') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="quickCommandsCompactMode"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="quickCommandsCompactMode"
								v-model="form.quickCommandsCompactMode"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.workspace.quickCommandsCompactModeLabel') }}</span></label
						>
						<p class="mt-2 text-xs text-text-secondary">
							{{ t('settings.workspace.quickCommandsCompactModeDescription') }}
						</p>
					</div>
					<div class="workspace-preferences__field">
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
						</UiFormField>
						<p class="mt-2 text-xs text-text-secondary">{{ t('settings.terminalScrollback.limitHint') }}</p>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="terminalRightClickCopyPaste"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="terminalRightClickCopyPaste"
								v-model="form.terminalRightClickCopyPaste"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.workspace.terminalRightClickCopyPasteLabel') }}</span></label
						>
						<p class="mt-2 text-xs text-text-secondary">
							{{ t('settings.workspace.terminalRightClickCopyPasteDescription') }}
						</p>
					</div>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
					<p class="min-h-4 text-xs" :class="groupMessages.commands?.success ? 'text-success' : 'text-error'">
						{{ groupMessages.commands?.text }}
					</p>
					<UiButton
						type="submit"
						appearance="solid"
						tone="primary"
						:disabled="!commandsDirty"
						:loading="savingGroup === 'commands'"
						>{{ t('settings.workspace.saveGroup') }}</UiButton
					>
				</div>
			</form>

			<form class="workspace-preferences__group" @submit.prevent="saveGroup('monitoring', monitoringKeys)">
				<div class="border-b border-border/60 px-4 py-3">
					<h3 class="text-sm font-semibold text-foreground">
						{{ t('settings.workspace.groups.monitoring') }}
					</h3>
					<p class="mt-1 text-xs text-text-secondary">{{ t('settings.workspace.groups.monitoringHint') }}</p>
				</div>
				<div class="grid gap-3 p-3 lg:grid-cols-2">
					<div class="workspace-preferences__field">
						<div class="space-y-2">
							<label
								for="dashboardShowLocalResources"
								class="flex cursor-pointer items-start gap-2 text-sm font-medium"
								><UiCheckbox
									id="dashboardShowLocalResources"
									v-model="form.dashboardShowLocalResources"
									:aria-label="t('settings.dashboardResources.localLabel')"
									:disabled="savingGroup !== null || needsRefresh || loading"
									class="mt-0.5"
								/><span>{{ t('settings.dashboardResources.localLabel') }}</span></label
							>
							<label
								for="dashboardShowRemoteResources"
								class="flex cursor-pointer items-start gap-2 text-sm font-medium"
								><UiCheckbox
									id="dashboardShowRemoteResources"
									v-model="form.dashboardShowRemoteResources"
									:aria-label="t('settings.dashboardResources.remoteLabel')"
									:disabled="savingGroup !== null || needsRefresh || loading"
									class="mt-0.5"
								/><span>{{ t('settings.dashboardResources.remoteLabel') }}</span></label
							>
						</div>
					</div>
					<div class="workspace-preferences__field">
						<label
							for="showStatusMonitorIpAddress"
							class="flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="showStatusMonitorIpAddress"
								v-model="form.showStatusMonitorIpAddress"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.statusMonitorShowIp.enableLabel') }}</span></label
						>
					</div>
					<div class="workspace-preferences__field">
						<UiFormField
							:label="t('settings.docker.refreshIntervalLabel')"
							for-id="dockerStatusIntervalSeconds"
							><UiInput
								id="dockerStatusIntervalSeconds"
								v-model="form.dockerStatusIntervalSeconds"
								type="number"
								min="1"
								max="86400"
								step="1"
								:disabled="savingGroup !== null || needsRefresh || loading"
						/></UiFormField>
						<label
							for="dockerDefaultExpand"
							class="mt-3 flex cursor-pointer items-start gap-2 text-sm font-medium"
							><UiCheckbox
								id="dockerDefaultExpand"
								v-model="form.dockerDefaultExpand"
								:disabled="savingGroup !== null || needsRefresh || loading"
								class="mt-0.5"
							/><span>{{ t('settings.docker.defaultExpandLabel') }}</span></label
						>
					</div>
				</div>
				<div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
					<p
						class="min-h-4 text-xs"
						:class="groupMessages.monitoring?.success ? 'text-success' : 'text-error'"
					>
						{{ groupMessages.monitoring?.text }}
					</p>
					<UiButton
						type="submit"
						appearance="solid"
						tone="primary"
						:disabled="!monitoringDirty"
						:loading="savingGroup === 'monitoring'"
						>{{ t('settings.workspace.saveGroup') }}</UiButton
					>
				</div>
			</form>

			<details class="workspace-preferences__group">
				<summary
					class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none hover:bg-card/20 transition-colors"
				>
					<span
						><span class="block text-sm font-semibold text-foreground">{{
							t('settings.workspace.groups.advanced')
						}}</span
						><span class="mt-1 block text-xs text-text-secondary">{{
							t('settings.workspace.groups.advancedHint')
						}}</span></span
					>
					<i class="fa-solid fa-chevron-down shrink-0 text-xs text-text-secondary" aria-hidden="true"></i>
				</summary>
				<form class="border-t border-border/60" @submit.prevent="saveGroup('layout', layoutKeys)">
					<div class="grid gap-3 p-3 lg:grid-cols-2">
						<div class="workspace-preferences__field">
							<label for="layoutLocked" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
								><UiCheckbox
									id="layoutLocked"
									v-model="form.layoutLocked"
									:disabled="savingGroup !== null || needsRefresh || loading"
									class="mt-0.5"
								/><span>{{ t('settings.workspace.layoutLockLabel') }}</span></label
							>
							<p class="mt-2 text-xs text-text-secondary">
								{{ t('settings.workspace.layoutLockDescription') }}
							</p>
						</div>
						<div class="workspace-preferences__field">
							<label for="navBarVisible" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
								><UiCheckbox
									id="navBarVisible"
									v-model="form.navBarVisible"
									:disabled="savingGroup !== null || needsRefresh || loading"
									class="mt-0.5"
								/><span>{{ t('settings.workspace.navBarVisibleLabel') }}</span></label
							>
							<p class="mt-2 text-xs text-text-secondary">
								{{ t('settings.workspace.navBarVisibleDescription') }}
							</p>
						</div>
					</div>
					<div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
						<p
							class="min-h-4 text-xs"
							:class="groupMessages.layout?.success ? 'text-success' : 'text-error'"
						>
							{{ groupMessages.layout?.text }}
						</p>
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:disabled="!layoutDirty"
							:loading="savingGroup === 'layout'"
							>{{ t('settings.workspace.saveGroup') }}</UiButton
						>
					</div>
				</form>
			</details>
		</div>
	</section>
</template>

<style scoped>
	.workspace-preferences__group {
		border-top: 1px solid var(--border-color);
	}
	.workspace-preferences__field {
		min-width: 0;
		padding: 12px 4px;
	}
</style>
