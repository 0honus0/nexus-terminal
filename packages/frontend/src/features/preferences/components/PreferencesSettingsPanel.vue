<script setup lang="ts">
  import { onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { usePreferences } from '../composables/usePreferences';
  import { commonTimezones, preferenceLanguageNames, type Preferences } from '../model/preferences';

  const { t } = useI18n();
  const feedback = useFeedback();
  const saving = ref(false);
  const props = withDefaults(defineProps<{ locales?: readonly string[] }>(), {
    locales: () => ['en-US', 'zh-CN', 'ja-JP'],
  });
  const emit = defineEmits<{ saved: [preferences: Preferences] }>();
  const preferences = usePreferences();
  const form = reactive<Preferences>({ ...preferences.values.value });
  watch(preferences.values, (value) => Object.assign(form, value), { deep: true });
  onMounted(() => preferences.load());
  const save = async () => {
    const integerInRange = (value: number, min: number, max: number) =>
      Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
    if (!integerInRange(form.statusMonitorIntervalSeconds, 1, 86400)) {
      feedback.notifyError(t('settings.statusMonitor.error.invalidInterval'));
      return;
    }
    if (!integerInRange(form.dockerStatusIntervalSeconds, 1, 86400)) {
      feedback.notifyError(t('settings.docker.error.invalidInterval'));
      return;
    }
    if (!integerInRange(form.remoteHostRefreshIntervalSeconds, 1, 86400)) {
      feedback.notifyError(t('settings.dashboardResources.error.invalidInterval'));
      return;
    }
    if (!integerInRange(form.terminalScrollbackLimit, 0, 100000)) {
      feedback.notifyError(t('settings.terminalScrollback.error.invalidInput'));
      return;
    }
    if (!integerInRange(form.spreadsheetPreviewRowsPerPage, 10, 2000)) {
      feedback.notifyError(t('settings.workspace.spreadsheetPreviewLimits.invalidRows'));
      return;
    }
    if (!integerInRange(form.spreadsheetPreviewMaxColumns, 5, 200)) {
      feedback.notifyError(t('settings.workspace.spreadsheetPreviewLimits.invalidColumns'));
      return;
    }
    saving.value = true;
    try {
      await preferences.update({ ...form });
      emit('saved', { ...form });
      feedback.notifySuccess(t('settings.preferences.saved'));
    } catch (cause) {
      feedback.notifyError(
        t('settings.preferences.saveFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    } finally {
      saving.value = false;
    }
  };
</script>

<template>
  <form
    data-testid="preferences-settings"
    class="space-y-6 rounded-lg border border-border bg-background p-6"
    @submit.prevent="save"
  >
    <div class="grid gap-5 md:grid-cols-2">
      <BaseFormField :label="t('settings.language.title')" for-id="languageSelect">
        <BaseSelect id="languageSelect" v-model="form.language"
          ><option v-for="locale in props.locales" :key="locale" :value="locale">
            {{ preferenceLanguageNames[locale] || locale }}
          </option></BaseSelect
        >
      </BaseFormField>
      <BaseFormField :label="t('settings.timezone.title')" for-id="timezoneSelect">
        <BaseSelect id="timezoneSelect" v-model="form.timezone"
          ><option v-for="timezone in commonTimezones" :key="timezone" :value="timezone">
            {{ timezone }}
          </option></BaseSelect
        >
        <p class="mt-1 text-xs text-text-secondary">{{ t('settings.timezone.description') }}</p>
      </BaseFormField>
      <BaseFormField :label="t('settings.statusMonitor.refreshIntervalLabel')" for-id="statusMonitorIntervalSeconds"
        ><BaseInput id="statusMonitorIntervalSeconds" v-model="form.statusMonitorIntervalSeconds" type="number" min="1"
      /></BaseFormField>
      <BaseFormField :label="t('settings.docker.refreshIntervalLabel')" for-id="dockerStatusIntervalSeconds"
        ><BaseInput id="dockerStatusIntervalSeconds" v-model="form.dockerStatusIntervalSeconds" type="number" min="1"
      /></BaseFormField>
      <BaseFormField
        :label="t('settings.dashboardResources.refreshIntervalLabel')"
        for-id="remoteHostRefreshIntervalSeconds"
      >
        <BaseInput
          id="remoteHostRefreshIntervalSeconds"
          data-testid="dashboard-remote-refresh-interval"
          v-model="form.remoteHostRefreshIntervalSeconds"
          type="number"
          min="1"
          max="86400"
        />
      </BaseFormField>
      <BaseFormField :label="t('settings.terminalScrollback.title')" for-id="terminalScrollbackLimit"
        ><BaseInput
          id="terminalScrollbackLimit"
          v-model="form.terminalScrollbackLimit"
          type="number"
          min="0"
          max="100000"
      /></BaseFormField>
      <BaseFormField :label="t('settings.commandInputSync.title')" for-id="commandInputSyncTarget">
        <BaseSelect id="commandInputSyncTarget" v-model="form.commandInputSyncTarget">
          <option value="none">{{ t('settings.commandInputSync.targetNone') }}</option>
          <option value="quickCommands">{{ t('settings.commandInputSync.targetQuickCommands') }}</option>
          <option value="commandHistory">{{ t('settings.commandInputSync.targetCommandHistory') }}</option>
        </BaseSelect>
      </BaseFormField>
      <BaseFormField
        :label="t('settings.workspace.spreadsheetPreviewLimits.rowsLabel')"
        for-id="spreadsheetPreviewRowsPerPage"
        ><BaseInput
          id="spreadsheetPreviewRowsPerPage"
          v-model="form.spreadsheetPreviewRowsPerPage"
          type="number"
          min="10"
          max="2000"
      /></BaseFormField>
      <BaseFormField
        :label="t('settings.workspace.spreadsheetPreviewLimits.columnsLabel')"
        for-id="spreadsheetPreviewMaxColumns"
        ><BaseInput
          id="spreadsheetPreviewMaxColumns"
          v-model="form.spreadsheetPreviewMaxColumns"
          type="number"
          min="5"
          max="200"
      /></BaseFormField>
    </div>
    <div class="grid gap-3 md:grid-cols-2">
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox id="showPopupFileEditor" v-model="form.showPopupFileEditor" />{{
          t('settings.popupEditor.title')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.shareFileEditorTabs" />{{ t('settings.shareEditorTabs.title') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.showPopupFileManager" />{{ t('settings.popupFileManager.title') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox data-testid="dashboard-show-local-resources" v-model="form.dashboardShowLocalResources" />{{
          t('settings.dashboardResources.localLabel')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox data-testid="dashboard-show-remote-resources" v-model="form.dashboardShowRemoteResources" />{{
          t('settings.dashboardResources.remoteLabel')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.workspaceSidebarPersistent" />{{
          t('settings.workspace.sidebarPersistentLabel')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.showStatusMonitorIpAddress" />{{ t('settings.statusMonitorShowIp.title') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.dockerDefaultExpand" />{{ t('settings.docker.defaultExpandLabel') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox
          v-model="form.quickCommandsCollapsibleSearch"
          data-testid="quick-command-collapsible-search-toggle"
        />{{ t('settings.workspace.quickCommandsCollapsibleSearchLabel') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.quickCommandsCompactMode" />{{
          t('settings.workspace.quickCommandsCompactModeLabel')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.terminalRightClickCopyPaste" />{{
          t('settings.workspace.terminalRightClickCopyPasteLabel')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.layoutLocked" />{{ t('layoutConfigurator.lockLayout') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.navBarVisible" />{{ t('header.show') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.fileManagerShowDeleteConfirmation" />{{
          t('settings.workspace.fileManagerShowDeleteConfirmationLabel')
        }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.showConnectionTags" />{{ t('settings.workspace.showConnectionTagsLabel') }}</label
      >
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox v-model="form.showQuickCommandTags" />{{
          t('settings.workspace.showQuickCommandTagsLabel')
        }}</label
      >
    </div>
    <BaseButton data-testid="preferences-save" type="submit" variant="primary" :loading="saving">{{
      t('common.save')
    }}</BaseButton>
  </form>
</template>
