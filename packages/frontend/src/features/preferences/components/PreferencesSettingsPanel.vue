<script setup lang="ts">
  import { nextTick, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { usePreferences } from '../composables/usePreferences';
  import { LOG_LEVELS, commonTimezones, preferenceLanguageNames, type Preferences } from '../model/preferences';

  const { t } = useI18n();
  const feedback = useFeedback();
  const savingSection = ref<string | null>(null);
  const loading = ref(true);
  const loadError = ref('');
  const props = withDefaults(defineProps<{ locales?: readonly string[]; section?: 'all' | 'system' | 'workspace' }>(), {
    locales: () => ['en-US', 'zh-CN', 'ja-JP'],
    section: 'all',
  });
  const emit = defineEmits<{ saved: [preferences: Preferences] }>();
  const preferences = usePreferences();
  const form = reactive<Preferences>({ ...preferences.values.value });
  const dirty = ref(false);
  const sectionMessages = reactive<Record<string, { text: string; success: boolean }>>({});
  let syncing = false;
  watch(
    preferences.values,
    async (value) => {
      if (dirty.value) return;
      syncing = true;
      Object.assign(form, value);
      await nextTick();
      syncing = false;
    },
    { deep: true },
  );
  watch(
    form,
    () => {
      if (!syncing) dirty.value = true;
    },
    { deep: true },
  );
  onMounted(async () => {
    try {
      await preferences.load();
    } catch (cause) {
      loadError.value = t('settings.preferences.loadFailed', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      feedback.notifyError(loadError.value);
    } finally {
      syncing = true;
      Object.assign(form, preferences.values.value);
      await nextTick();
      syncing = false;
      dirty.value = false;
      loading.value = false;
    }
  });

  const sameValue = (left: unknown, right: unknown) => {
    if (left === right) return true;
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
      return JSON.stringify(left) === JSON.stringify(right);
    }
    return false;
  };

  const refreshDirtyState = () => {
    dirty.value = (Object.keys(form) as (keyof Preferences)[]).some(
      (key) => !sameValue(form[key], preferences.values.value[key]),
    );
  };

  const validatePatch = (patch: Partial<Preferences>): string | null => {
    const integerInRange = (value: number, min: number, max: number) =>
      Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
    if (
      patch.statusMonitorIntervalSeconds !== undefined &&
      !integerInRange(patch.statusMonitorIntervalSeconds, 1, 86400)
    ) {
      return t('settings.statusMonitor.error.invalidInterval');
    }
    if (
      patch.dockerStatusIntervalSeconds !== undefined &&
      !integerInRange(patch.dockerStatusIntervalSeconds, 1, 86400)
    ) {
      return t('settings.docker.error.invalidInterval');
    }
    if (
      patch.remoteHostRefreshIntervalSeconds !== undefined &&
      !integerInRange(patch.remoteHostRefreshIntervalSeconds, 1, 86400)
    ) {
      return t('settings.dashboardResources.error.invalidInterval');
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

  const savePatch = async (sectionId: string, patch: Partial<Preferences>) => {
    const validationError = validatePatch(patch);
    if (validationError) {
      sectionMessages[sectionId] = { text: validationError, success: false };
      feedback.notifyError(validationError);
      return;
    }

    savingSection.value = sectionId;
    sectionMessages[sectionId] = { text: '', success: false };
    try {
      await preferences.update(patch);
      refreshDirtyState();
      emit('saved', { ...preferences.values.value });
      const message = t('settings.preferences.saved');
      sectionMessages[sectionId] = { text: message, success: true };
      feedback.notifySuccess(message);
    } catch (cause) {
      const message = t('settings.preferences.saveFailed', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      sectionMessages[sectionId] = { text: message, success: false };
      feedback.notifyError(message);
    } finally {
      savingSection.value = null;
    }
  };
</script>

<template>
  <section
    data-testid="preferences-settings"
    class="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
  >
    <h2 class="border-b border-border bg-header/50 px-6 py-4 text-lg font-semibold text-foreground">
      {{ props.section === 'system' ? t('settings.category.system') : t('settings.workspace.title') }}
    </h2>

    <div v-if="loading" class="p-4 text-center text-text-secondary">
      {{ t('common.loading') }}
    </div>

    <div v-else-if="props.section === 'system'" class="space-y-6 p-6">
      <p v-if="loadError" class="rounded border border-error/40 bg-error/5 p-3 text-sm text-error">
        {{ loadError }}
      </p>
      <form class="space-y-4" @submit.prevent="savePatch('language', { language: form.language })">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.language.title') }}</h3>
        <BaseFormField :label="t('settings.language.selectLabel')" for-id="languageSelect">
          <BaseSelect id="languageSelect" v-model="form.language" :disabled="savingSection !== null">
            <option v-for="locale in props.locales" :key="locale" :value="locale">
              {{ preferenceLanguageNames[locale] || locale }}
            </option>
          </BaseSelect>
        </BaseFormField>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <BaseButton type="submit" variant="primary" :loading="savingSection === 'language'">
            {{ t('settings.language.saveButton') }}
          </BaseButton>
          <p
            v-if="sectionMessages.language?.text"
            class="text-sm"
            :class="sectionMessages.language.success ? 'text-success' : 'text-error'"
          >
            {{ sectionMessages.language.text }}
          </p>
        </div>
      </form>

      <hr class="border-border/50" />

      <form class="space-y-4" @submit.prevent="savePatch('timezone', { timezone: form.timezone })">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.timezone.title') }}</h3>
        <BaseFormField :label="t('settings.timezone.selectLabel')" for-id="timezoneSelect">
          <BaseSelect id="timezoneSelect" v-model="form.timezone" :disabled="savingSection !== null">
            <option v-for="timezone in commonTimezones" :key="timezone" :value="timezone">{{ timezone }}</option>
          </BaseSelect>
          <p class="mt-1 text-xs text-text-secondary">{{ t('settings.timezone.description') }}</p>
        </BaseFormField>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <BaseButton type="submit" variant="primary" :loading="savingSection === 'timezone'">{{
            t('common.save')
          }}</BaseButton>
          <p
            v-if="sectionMessages.timezone?.text"
            class="text-sm"
            :class="sectionMessages.timezone.success ? 'text-success' : 'text-error'"
          >
            {{ sectionMessages.timezone.text }}
          </p>
        </div>
      </form>

      <hr class="border-border/50" />

      <form
        data-testid="logging-settings-form"
        class="space-y-4"
        @submit.prevent="
          savePatch('logging', { frontendLogLevel: form.frontendLogLevel, backendLogLevel: form.backendLogLevel })
        "
      >
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.logging.title') }}</h3>
        <div class="grid gap-4 md:grid-cols-2">
          <BaseFormField :label="t('settings.logging.frontendLabel')" for-id="frontendLogLevelSelect">
            <BaseSelect id="frontendLogLevelSelect" v-model="form.frontendLogLevel" :disabled="savingSection !== null">
              <option v-for="level in LOG_LEVELS" :key="level" :value="level">{{ level.toUpperCase() }}</option>
            </BaseSelect>
          </BaseFormField>
          <BaseFormField :label="t('settings.logging.backendLabel')" for-id="backendLogLevelSelect">
            <BaseSelect id="backendLogLevelSelect" v-model="form.backendLogLevel" :disabled="savingSection !== null">
              <option v-for="level in LOG_LEVELS" :key="level" :value="level">{{ level.toUpperCase() }}</option>
            </BaseSelect>
          </BaseFormField>
        </div>
        <p class="text-xs text-text-secondary">{{ t('settings.logging.description') }}</p>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <BaseButton type="submit" variant="primary" :loading="savingSection === 'logging'">{{
            t('common.save')
          }}</BaseButton>
          <p
            v-if="sectionMessages.logging?.text"
            class="text-sm"
            :class="sectionMessages.logging.success ? 'text-success' : 'text-error'"
          >
            {{ sectionMessages.logging.text }}
          </p>
        </div>
      </form>
    </div>

    <div v-else class="space-y-6 p-6">
      <p v-if="loadError" class="rounded border border-error/40 bg-error/5 p-3 text-sm text-error">
        {{ loadError }}
      </p>
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
            <BaseCheckbox
              id="showPopupFileEditor"
              v-model="form.showPopupFileEditor"
              :disabled="savingSection !== null"
            />
            <span class="sr-only">{{ t('settings.popupEditor.title') }} — </span>
            {{ t('settings.popupEditor.enableLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.popupEditor.description') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'popup-editor'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['popup-editor']?.text"
              class="text-sm"
              :class="sectionMessages['popup-editor'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['popup-editor'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.popupFileManager.title') }}</h3>
        <form
          class="space-y-4"
          @submit.prevent="savePatch('popup-file-manager', { showPopupFileManager: form.showPopupFileManager })"
        >
          <label
            for="showPopupFileManager"
            class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
          >
            <BaseCheckbox
              id="showPopupFileManager"
              v-model="form.showPopupFileManager"
              :disabled="savingSection !== null"
            />
            {{ t('settings.popupFileManager.enableLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.popupFileManager.description') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'popup-file-manager'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['popup-file-manager']?.text"
              class="text-sm"
              :class="sectionMessages['popup-file-manager'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['popup-file-manager'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

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
            <BaseCheckbox
              id="shareFileEditorTabs"
              v-model="form.shareFileEditorTabs"
              :disabled="savingSection !== null"
            />
            {{ t('settings.shareEditorTabs.enableLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.shareEditorTabs.description') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'share-editor-tabs'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['share-editor-tabs']?.text"
              class="text-sm"
              :class="sectionMessages['share-editor-tabs'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['share-editor-tabs'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

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
            <BaseCheckbox
              id="workspaceSidebarPersistent"
              v-model="form.workspaceSidebarPersistent"
              :disabled="savingSection !== null"
            />
            {{ t('settings.workspace.sidebarPersistentLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.sidebarPersistentDescription') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'sidebar-persistent'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['sidebar-persistent']?.text"
              class="text-sm"
              :class="sectionMessages['sidebar-persistent'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['sidebar-persistent'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.commandInputSync.title') }}</h3>
        <form
          class="space-y-4"
          @submit.prevent="savePatch('command-input-sync', { commandInputSyncTarget: form.commandInputSyncTarget })"
        >
          <BaseFormField :label="t('settings.commandInputSync.selectLabel')" for-id="commandInputSyncTarget">
            <BaseSelect
              id="commandInputSyncTarget"
              v-model="form.commandInputSyncTarget"
              :disabled="savingSection !== null"
            >
              <option value="none">{{ t('settings.commandInputSync.targetNone') }}</option>
              <option value="quickCommands">{{ t('settings.commandInputSync.targetQuickCommands') }}</option>
              <option value="commandHistory">{{ t('settings.commandInputSync.targetCommandHistory') }}</option>
            </BaseSelect>
            <p class="mt-1 text-xs text-text-secondary">{{ t('settings.commandInputSync.description') }}</p>
          </BaseFormField>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'command-input-sync'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['command-input-sync']?.text"
              class="text-sm"
              :class="sectionMessages['command-input-sync'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['command-input-sync'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

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
            <BaseCheckbox
              id="showConnectionTags"
              v-model="form.showConnectionTags"
              :disabled="savingSection !== null"
            />
            {{ t('settings.workspace.showConnectionTagsLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.showConnectionTagsDescription') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'connection-tags'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['connection-tags']?.text"
              class="text-sm"
              :class="sectionMessages['connection-tags'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['connection-tags'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">
          {{ t('settings.workspace.showQuickCommandTagsTitle') }}
        </h3>
        <form
          class="space-y-4"
          @submit.prevent="savePatch('quick-command-tags', { showQuickCommandTags: form.showQuickCommandTags })"
        >
          <label
            for="showQuickCommandTags"
            class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
          >
            <BaseCheckbox
              id="showQuickCommandTags"
              v-model="form.showQuickCommandTags"
              :disabled="savingSection !== null"
            />
            {{ t('settings.workspace.showQuickCommandTagsLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.showQuickCommandTagsDescription') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'quick-command-tags'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['quick-command-tags']?.text"
              class="text-sm"
              :class="sectionMessages['quick-command-tags'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['quick-command-tags'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content" data-testid="quick-command-search-display-setting">
        <h3 class="mb-3 text-base font-semibold text-foreground">
          {{ t('settings.workspace.quickCommandsCollapsibleSearchTitle') }}
        </h3>
        <form
          class="space-y-4"
          @submit.prevent="
            savePatch('quick-command-search', { quickCommandsCollapsibleSearch: form.quickCommandsCollapsibleSearch })
          "
        >
          <label
            for="quickCommandsCollapsibleSearch"
            class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
          >
            <BaseCheckbox
              id="quickCommandsCollapsibleSearch"
              v-model="form.quickCommandsCollapsibleSearch"
              data-testid="quick-command-collapsible-search-toggle"
              :disabled="savingSection !== null"
            />
            {{ t('settings.workspace.quickCommandsCollapsibleSearchLabel') }}
          </label>
          <p class="text-xs text-text-secondary">
            {{ t('settings.workspace.quickCommandsCollapsibleSearchDescription') }}
          </p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton
              type="submit"
              variant="primary"
              data-testid="quick-command-collapsible-search-save"
              :loading="savingSection === 'quick-command-search'"
              >{{ t('common.save') }}</BaseButton
            >
            <p
              v-if="sectionMessages['quick-command-search']?.text"
              class="text-sm"
              :class="sectionMessages['quick-command-search'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['quick-command-search'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

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
            <BaseCheckbox
              id="quickCommandsCompactMode"
              v-model="form.quickCommandsCompactMode"
              :disabled="savingSection !== null"
            />
            {{ t('settings.workspace.quickCommandsCompactModeLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.quickCommandsCompactModeDescription') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'quick-command-compact'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['quick-command-compact']?.text"
              class="text-sm"
              :class="sectionMessages['quick-command-compact'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['quick-command-compact'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.terminalScrollback.title') }}</h3>
        <form
          class="space-y-4"
          @submit.prevent="savePatch('terminal-scrollback', { terminalScrollbackLimit: form.terminalScrollbackLimit })"
        >
          <BaseFormField :label="t('settings.terminalScrollback.limitLabel')" for-id="terminalScrollbackLimit">
            <BaseInput
              id="terminalScrollbackLimit"
              v-model="form.terminalScrollbackLimit"
              type="number"
              min="0"
              max="100000"
              step="1"
              :disabled="savingSection !== null"
            />
            <p class="mt-1 text-xs text-text-secondary">{{ t('settings.terminalScrollback.limitHint') }}</p>
          </BaseFormField>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'terminal-scrollback'">{{
              t('settings.terminalScrollback.saveButton')
            }}</BaseButton>
            <p
              v-if="sectionMessages['terminal-scrollback']?.text"
              class="text-sm"
              :class="sectionMessages['terminal-scrollback'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['terminal-scrollback'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content" data-testid="spreadsheet-preview-pagination-setting">
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
            <BaseFormField
              :label="t('settings.workspace.spreadsheetPreviewLimits.rowsLabel')"
              for-id="spreadsheetPreviewRowsPerPage"
            >
              <BaseInput
                id="spreadsheetPreviewRowsPerPage"
                v-model="form.spreadsheetPreviewRowsPerPage"
                data-testid="spreadsheet-preview-rows-per-page"
                type="number"
                min="10"
                max="2000"
                step="1"
                :disabled="savingSection !== null"
              />
            </BaseFormField>
            <BaseFormField
              :label="t('settings.workspace.spreadsheetPreviewLimits.columnsLabel')"
              for-id="spreadsheetPreviewMaxColumns"
            >
              <BaseInput
                id="spreadsheetPreviewMaxColumns"
                v-model="form.spreadsheetPreviewMaxColumns"
                data-testid="spreadsheet-preview-column-limit"
                type="number"
                min="5"
                max="200"
                step="1"
                :disabled="savingSection !== null"
              />
            </BaseFormField>
          </div>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.spreadsheetPreviewLimits.hint') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton
              type="submit"
              variant="primary"
              data-testid="spreadsheet-preview-pagination-save"
              :loading="savingSection === 'spreadsheet-preview'"
              >{{ t('common.save') }}</BaseButton
            >
            <p
              v-if="sectionMessages['spreadsheet-preview']?.text"
              class="text-sm"
              :class="sectionMessages['spreadsheet-preview'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['spreadsheet-preview'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

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
            <BaseCheckbox
              id="fileManagerShowDeleteConfirmation"
              v-model="form.fileManagerShowDeleteConfirmation"
              :disabled="savingSection !== null"
            />
            {{ t('settings.workspace.fileManagerShowDeleteConfirmationLabel') }}
          </label>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'file-manager-delete'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['file-manager-delete']?.text"
              class="text-sm"
              :class="sectionMessages['file-manager-delete'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['file-manager-delete'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">
          {{ t('settings.workspace.terminalRightClickCopyPasteTitle') }}
        </h3>
        <form
          class="space-y-4"
          @submit.prevent="
            savePatch('terminal-right-click', { terminalRightClickCopyPaste: form.terminalRightClickCopyPaste })
          "
        >
          <label
            for="terminalRightClickCopyPaste"
            class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
          >
            <BaseCheckbox
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
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'terminal-right-click'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['terminal-right-click']?.text"
              class="text-sm"
              :class="sectionMessages['terminal-right-click'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['terminal-right-click'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.dashboardResources.title') }}</h3>
        <form
          class="space-y-4"
          @submit.prevent="
            savePatch('dashboard-resources', {
              dashboardShowLocalResources: form.dashboardShowLocalResources,
              dashboardShowRemoteResources: form.dashboardShowRemoteResources,
              remoteHostRefreshIntervalSeconds: form.remoteHostRefreshIntervalSeconds,
            })
          "
        >
          <p class="text-xs text-text-secondary">{{ t('settings.dashboardResources.description') }}</p>
          <div class="space-y-3">
            <label
              for="dashboardShowLocalResources"
              class="flex cursor-pointer items-start gap-2 text-sm text-foreground select-none"
            >
              <BaseCheckbox
                id="dashboardShowLocalResources"
                v-model="form.dashboardShowLocalResources"
                class="mt-0.5"
                :aria-label="t('settings.dashboardResources.localLabel')"
                :disabled="savingSection !== null"
              />
              <span>
                <span class="block">{{ t('settings.dashboardResources.localLabel') }}</span>
                <span class="block text-xs text-text-secondary">{{ t('settings.dashboardResources.localHint') }}</span>
              </span>
            </label>
            <label
              for="dashboardShowRemoteResources"
              class="flex cursor-pointer items-start gap-2 text-sm text-foreground select-none"
            >
              <BaseCheckbox
                id="dashboardShowRemoteResources"
                v-model="form.dashboardShowRemoteResources"
                class="mt-0.5"
                :aria-label="t('settings.dashboardResources.remoteLabel')"
                :disabled="savingSection !== null"
              />
              <span>
                <span class="block">{{ t('settings.dashboardResources.remoteLabel') }}</span>
                <span class="block text-xs text-text-secondary">{{ t('settings.dashboardResources.remoteHint') }}</span>
              </span>
            </label>
            <BaseFormField
              :label="t('settings.dashboardResources.refreshIntervalLabel')"
              for-id="remoteHostRefreshIntervalSeconds"
            >
              <BaseInput
                id="remoteHostRefreshIntervalSeconds"
                v-model="form.remoteHostRefreshIntervalSeconds"
                type="number"
                min="1"
                max="86400"
                step="1"
                :disabled="savingSection !== null"
              />
              <p class="mt-1 text-xs text-text-secondary">{{ t('settings.dashboardResources.refreshIntervalHint') }}</p>
            </BaseFormField>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'dashboard-resources'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['dashboard-resources']?.text"
              class="text-sm"
              :class="sectionMessages['dashboard-resources'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['dashboard-resources'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.statusMonitorShowIp.title') }}</h3>
        <form
          class="space-y-4"
          @submit.prevent="savePatch('status-ip', { showStatusMonitorIpAddress: form.showStatusMonitorIpAddress })"
        >
          <label
            for="showStatusMonitorIpAddress"
            class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
          >
            <BaseCheckbox
              id="showStatusMonitorIpAddress"
              v-model="form.showStatusMonitorIpAddress"
              :disabled="savingSection !== null"
            />
            {{ t('settings.statusMonitorShowIp.enableLabel') }}
          </label>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'status-ip'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['status-ip']?.text"
              class="text-sm"
              :class="sectionMessages['status-ip'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['status-ip'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.statusMonitor.title') }}</h3>
        <form
          class="space-y-4"
          @submit.prevent="
            savePatch('status-monitor', { statusMonitorIntervalSeconds: form.statusMonitorIntervalSeconds })
          "
        >
          <BaseFormField
            :label="t('settings.statusMonitor.refreshIntervalLabel')"
            for-id="statusMonitorIntervalSeconds"
          >
            <BaseInput
              id="statusMonitorIntervalSeconds"
              v-model="form.statusMonitorIntervalSeconds"
              type="number"
              min="1"
              step="1"
              :disabled="savingSection !== null"
            />
            <p class="mt-1 text-xs text-text-secondary">{{ t('settings.statusMonitor.refreshIntervalHint') }}</p>
          </BaseFormField>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'status-monitor'">{{
              t('settings.statusMonitor.saveButton')
            }}</BaseButton>
            <p
              v-if="sectionMessages['status-monitor']?.text"
              class="text-sm"
              :class="sectionMessages['status-monitor'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['status-monitor'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

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
          <BaseFormField :label="t('settings.docker.refreshIntervalLabel')" for-id="dockerStatusIntervalSeconds">
            <BaseInput
              id="dockerStatusIntervalSeconds"
              v-model="form.dockerStatusIntervalSeconds"
              type="number"
              min="1"
              step="1"
              :disabled="savingSection !== null"
            />
            <p class="mt-1 text-xs text-text-secondary">{{ t('settings.docker.refreshIntervalHint') }}</p>
          </BaseFormField>
          <label
            for="dockerDefaultExpand"
            class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none"
          >
            <BaseCheckbox
              id="dockerDefaultExpand"
              v-model="form.dockerDefaultExpand"
              :disabled="savingSection !== null"
            />
            {{ t('settings.docker.defaultExpandLabel') }}
          </label>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'docker'">{{
              t('settings.docker.saveButton')
            }}</BaseButton>
            <p
              v-if="sectionMessages.docker?.text"
              class="text-sm"
              :class="sectionMessages.docker.success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages.docker.text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.workspace.layoutLockTitle') }}</h3>
        <form class="space-y-4" @submit.prevent="savePatch('layout-lock', { layoutLocked: form.layoutLocked })">
          <label for="layoutLocked" class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none">
            <BaseCheckbox id="layoutLocked" v-model="form.layoutLocked" :disabled="savingSection !== null" />
            {{ t('settings.workspace.layoutLockLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.layoutLockDescription') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'layout-lock'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['layout-lock']?.text"
              class="text-sm"
              :class="sectionMessages['layout-lock'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['layout-lock'].text }}
            </p>
          </div>
        </form>
      </section>

      <hr class="border-border/50" />

      <section class="settings-section-content">
        <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.workspace.navBarVisibleTitle') }}</h3>
        <form class="space-y-4" @submit.prevent="savePatch('nav-bar-visible', { navBarVisible: form.navBarVisible })">
          <label for="navBarVisible" class="flex cursor-pointer items-center gap-2 text-sm text-foreground select-none">
            <BaseCheckbox id="navBarVisible" v-model="form.navBarVisible" :disabled="savingSection !== null" />
            {{ t('settings.workspace.navBarVisibleLabel') }}
          </label>
          <p class="text-xs text-text-secondary">{{ t('settings.workspace.navBarVisibleDescription') }}</p>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <BaseButton type="submit" variant="primary" :loading="savingSection === 'nav-bar-visible'">{{
              t('common.save')
            }}</BaseButton>
            <p
              v-if="sectionMessages['nav-bar-visible']?.text"
              class="text-sm"
              :class="sectionMessages['nav-bar-visible'].success ? 'text-success' : 'text-error'"
            >
              {{ sectionMessages['nav-bar-visible'].text }}
            </p>
          </div>
        </form>
      </section>
    </div>
  </section>
</template>
