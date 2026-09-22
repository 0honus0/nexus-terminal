<script setup lang="ts">
  import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { usePreferences } from '../composables/usePreferences';
  import type { PreferencesDto } from '../model/preferences';

  type GroupId = 'files' | 'commands' | 'monitoring' | 'layout';

  const { t } = useI18n();
  const feedback = useFeedback();
  const emit = defineEmits<{ saved: [preferences: PreferencesDto] }>();
  const preferences = usePreferences();
  const form = reactive<PreferencesDto>({ ...preferences.values.value });
  const loading = ref(true);
  const loadError = ref('');
  const savingGroup = ref<GroupId | null>(null);
  const groupMessages = reactive<Record<GroupId, { text: string; success: boolean } | null>>({
    files: null,
    commands: null,
    monitoring: null,
    layout: null,
  });
  let syncing = false;

  const fileKeys = [
    'showPopupFileEditor',
    'showPopupFileManager',
    'shareFileEditorTabs',
    'fileManagerShowDeleteConfirmation',
    'spreadsheetPreviewRowsPerPage',
    'spreadsheetPreviewMaxColumns',
  ] as const satisfies readonly (keyof PreferencesDto)[];
  const commandKeys = [
    'workspaceSidebarPersistent',
    'commandInputSyncTarget',
    'showConnectionTags',
    'showQuickCommandTags',
    'quickCommandsCollapsibleSearch',
    'quickCommandsCompactMode',
    'terminalScrollbackLimit',
    'terminalRightClickCopyPaste',
  ] as const satisfies readonly (keyof PreferencesDto)[];
  const monitoringKeys = [
    'dashboardShowLocalResources',
    'dashboardShowRemoteResources',
    'remoteHostRefreshIntervalSeconds',
    'showStatusMonitorIpAddress',
    'statusMonitorIntervalSeconds',
    'dockerStatusIntervalSeconds',
    'dockerDefaultExpand',
  ] as const satisfies readonly (keyof PreferencesDto)[];
  const layoutKeys = ['layoutLocked', 'navBarVisible'] as const satisfies readonly (keyof PreferencesDto)[];

  const sameValue = (left: unknown, right: unknown) => {
    if (left === right) return true;
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
      return JSON.stringify(left) === JSON.stringify(right);
    }
    return false;
  };

  const isDirty = (keys: readonly (keyof PreferencesDto)[]) =>
    keys.some((key) => !sameValue(form[key], preferences.values.value[key]));
  const filesDirty = computed(() => isDirty(fileKeys));
  const commandsDirty = computed(() => isDirty(commandKeys));
  const monitoringDirty = computed(() => isDirty(monitoringKeys));
  const layoutDirty = computed(() => isDirty(layoutKeys));
  const dirtyCount = computed(
    () => [filesDirty.value, commandsDirty.value, monitoringDirty.value, layoutDirty.value].filter(Boolean).length,
  );

  const patchFor = (keys: readonly (keyof PreferencesDto)[]): Partial<PreferencesDto> => {
    const patch: Partial<PreferencesDto> = {};
    for (const key of keys) (patch as Record<string, unknown>)[key] = form[key];
    return patch;
  };

  const validatePatch = (patch: Partial<PreferencesDto>): string | null => {
    const integerInRange = (value: number, min: number, max: number) =>
      Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
    if (
      patch.statusMonitorIntervalSeconds !== undefined &&
      !integerInRange(patch.statusMonitorIntervalSeconds, 1, 86400)
    )
      return t('settings.statusMonitor.error.invalidInterval');
    if (patch.dockerStatusIntervalSeconds !== undefined && !integerInRange(patch.dockerStatusIntervalSeconds, 1, 86400))
      return t('settings.docker.error.invalidInterval');
    if (
      patch.remoteHostRefreshIntervalSeconds !== undefined &&
      !integerInRange(patch.remoteHostRefreshIntervalSeconds, 1, 86400)
    )
      return t('settings.dashboardResources.error.invalidInterval');
    if (patch.terminalScrollbackLimit !== undefined && !integerInRange(patch.terminalScrollbackLimit, 0, 100000))
      return t('settings.terminalScrollback.error.invalidInput');
    if (
      patch.spreadsheetPreviewRowsPerPage !== undefined &&
      !integerInRange(patch.spreadsheetPreviewRowsPerPage, 10, 2000)
    )
      return t('settings.workspace.spreadsheetPreviewLimits.invalidRows');
    if (patch.spreadsheetPreviewMaxColumns !== undefined && !integerInRange(patch.spreadsheetPreviewMaxColumns, 5, 200))
      return t('settings.workspace.spreadsheetPreviewLimits.invalidColumns');
    return null;
  };

  const saveGroup = async (group: GroupId, keys: readonly (keyof PreferencesDto)[]) => {
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
      await preferences.update(patch);
      emit('saved', { ...preferences.values.value });
      const message = t('settings.preferences.saved');
      groupMessages[group] = { text: message, success: true };
      feedback.notifySuccess(message);
    } catch (cause) {
      const message = t('settings.preferences.saveFailed', {
        error: cause instanceof Error ? cause.message : String(cause),
      });
      groupMessages[group] = { text: message, success: false };
      feedback.notifyError(message);
    } finally {
      savingGroup.value = null;
    }
  };

  watch(
    preferences.values,
    async (value) => {
      if (savingGroup.value) return;
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
      if (!syncing) {
        for (const group of ['files', 'commands', 'monitoring', 'layout'] as const) {
          if (groupMessages[group]?.success) groupMessages[group] = null;
        }
      }
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
      loading.value = false;
    }
  });
</script>

<template>
  <section
    data-testid="preferences-settings"
    class="overflow-hidden rounded-xl border border-border bg-background shadow-sm"
  >
    <header
      class="flex flex-col gap-2 border-b border-border bg-header/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
    >
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

    <div v-if="loading" class="p-6 text-center text-sm text-text-secondary">{{ t('common.loading') }}</div>
    <div v-else class="space-y-4 p-3 sm:p-5">
      <p v-if="loadError" class="rounded-lg border border-error/40 bg-error/5 p-3 text-sm text-error">
        {{ loadError }}
      </p>

      <form class="rounded-xl border border-border/70 bg-card/35" @submit.prevent="saveGroup('files', fileKeys)">
        <div class="border-b border-border/60 px-4 py-3">
          <h3 class="text-sm font-semibold text-foreground">{{ t('settings.workspace.groups.files') }}</h3>
          <p class="mt-1 text-xs text-text-secondary">{{ t('settings.workspace.groups.filesHint') }}</p>
        </div>
        <div class="grid gap-3 p-3 lg:grid-cols-2">
          <div class="min-w-0 rounded-lg bg-background/70 p-3">
            <label
              for="showPopupFileEditor"
              class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
            >
              <BaseCheckbox
                id="showPopupFileEditor"
                v-model="form.showPopupFileEditor"
                :disabled="savingGroup !== null"
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
          <div class="min-w-0 rounded-lg bg-background/70 p-3">
            <label
              for="showPopupFileManager"
              class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
            >
              <BaseCheckbox
                id="showPopupFileManager"
                v-model="form.showPopupFileManager"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              />
              <span>{{ t('settings.popupFileManager.enableLabel') }}</span>
            </label>
            <p class="mt-2 text-xs leading-5 text-text-secondary">{{ t('settings.popupFileManager.description') }}</p>
          </div>
          <div class="min-w-0 rounded-lg bg-background/70 p-3">
            <label
              for="shareFileEditorTabs"
              class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
            >
              <BaseCheckbox
                id="shareFileEditorTabs"
                v-model="form.shareFileEditorTabs"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              />
              <span>{{ t('settings.shareEditorTabs.enableLabel') }}</span>
            </label>
            <p class="mt-2 text-xs leading-5 text-text-secondary">{{ t('settings.shareEditorTabs.description') }}</p>
          </div>
          <div class="min-w-0 rounded-lg bg-background/70 p-3">
            <label
              for="fileManagerShowDeleteConfirmation"
              class="flex cursor-pointer items-start gap-2 text-sm font-medium text-foreground"
            >
              <BaseCheckbox
                id="fileManagerShowDeleteConfirmation"
                v-model="form.fileManagerShowDeleteConfirmation"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              />
              <span>{{ t('settings.workspace.fileManagerShowDeleteConfirmationLabel') }}</span>
            </label>
          </div>
          <div
            class="min-w-0 rounded-lg bg-background/70 p-3 lg:col-span-2"
            data-testid="spreadsheet-preview-pagination-setting"
          >
            <div class="mb-3 text-sm font-medium text-foreground">
              {{ t('settings.workspace.spreadsheetPreviewLimits.title') }}
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
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
                  :disabled="savingGroup !== null"
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
                  :disabled="savingGroup !== null"
                />
              </BaseFormField>
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
          <BaseButton
            data-testid="spreadsheet-preview-pagination-save"
            type="submit"
            variant="primary"
            :disabled="!filesDirty"
            :loading="savingGroup === 'files'"
            >{{ t('settings.workspace.saveGroup') }}</BaseButton
          >
        </div>
      </form>

      <form class="rounded-xl border border-border/70 bg-card/35" @submit.prevent="saveGroup('commands', commandKeys)">
        <div class="border-b border-border/60 px-4 py-3">
          <h3 class="text-sm font-semibold text-foreground">{{ t('settings.workspace.groups.commands') }}</h3>
          <p class="mt-1 text-xs text-text-secondary">{{ t('settings.workspace.groups.commandsHint') }}</p>
        </div>
        <div class="grid gap-3 p-3 lg:grid-cols-2">
          <div class="rounded-lg bg-background/70 p-3">
            <label for="workspaceSidebarPersistent" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="workspaceSidebarPersistent"
                v-model="form.workspaceSidebarPersistent"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.workspace.sidebarPersistentLabel') }}</span></label
            >
            <p class="mt-2 text-xs text-text-secondary">{{ t('settings.workspace.sidebarPersistentDescription') }}</p>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <BaseFormField :label="t('settings.commandInputSync.selectLabel')" for-id="commandInputSyncTarget">
              <BaseSelect
                id="commandInputSyncTarget"
                v-model="form.commandInputSyncTarget"
                :disabled="savingGroup !== null"
              >
                <option value="none">{{ t('settings.commandInputSync.targetNone') }}</option>
                <option value="quickCommands">{{ t('settings.commandInputSync.targetQuickCommands') }}</option>
                <option value="commandHistory">{{ t('settings.commandInputSync.targetCommandHistory') }}</option>
              </BaseSelect>
            </BaseFormField>
            <p class="mt-2 text-xs text-text-secondary">{{ t('settings.commandInputSync.description') }}</p>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <label for="showConnectionTags" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="showConnectionTags"
                v-model="form.showConnectionTags"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.workspace.showConnectionTagsLabel') }}</span></label
            >
            <p class="mt-2 text-xs text-text-secondary">{{ t('settings.workspace.showConnectionTagsDescription') }}</p>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <label for="showQuickCommandTags" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="showQuickCommandTags"
                v-model="form.showQuickCommandTags"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.workspace.showQuickCommandTagsLabel') }}</span></label
            >
            <p class="mt-2 text-xs text-text-secondary">
              {{ t('settings.workspace.showQuickCommandTagsDescription') }}
            </p>
          </div>
          <div class="rounded-lg bg-background/70 p-3" data-testid="quick-command-search-display-setting">
            <label
              for="quickCommandsCollapsibleSearch"
              class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="quickCommandsCollapsibleSearch"
                v-model="form.quickCommandsCollapsibleSearch"
                data-testid="quick-command-collapsible-search-toggle"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.workspace.quickCommandsCollapsibleSearchLabel') }}</span></label
            >
            <p class="mt-2 text-xs text-text-secondary">
              {{ t('settings.workspace.quickCommandsCollapsibleSearchDescription') }}
            </p>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <label for="quickCommandsCompactMode" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="quickCommandsCompactMode"
                v-model="form.quickCommandsCompactMode"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.workspace.quickCommandsCompactModeLabel') }}</span></label
            >
            <p class="mt-2 text-xs text-text-secondary">
              {{ t('settings.workspace.quickCommandsCompactModeDescription') }}
            </p>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <BaseFormField :label="t('settings.terminalScrollback.limitLabel')" for-id="terminalScrollbackLimit">
              <BaseInput
                id="terminalScrollbackLimit"
                v-model="form.terminalScrollbackLimit"
                type="number"
                min="0"
                max="100000"
                step="1"
                :disabled="savingGroup !== null"
              />
            </BaseFormField>
            <p class="mt-2 text-xs text-text-secondary">{{ t('settings.terminalScrollback.limitHint') }}</p>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <label for="terminalRightClickCopyPaste" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="terminalRightClickCopyPaste"
                v-model="form.terminalRightClickCopyPaste"
                :disabled="savingGroup !== null"
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
          <BaseButton
            data-testid="quick-command-collapsible-search-save"
            type="submit"
            variant="primary"
            :disabled="!commandsDirty"
            :loading="savingGroup === 'commands'"
            >{{ t('settings.workspace.saveGroup') }}</BaseButton
          >
        </div>
      </form>

      <form
        class="rounded-xl border border-border/70 bg-card/35"
        @submit.prevent="saveGroup('monitoring', monitoringKeys)"
      >
        <div class="border-b border-border/60 px-4 py-3">
          <h3 class="text-sm font-semibold text-foreground">{{ t('settings.workspace.groups.monitoring') }}</h3>
          <p class="mt-1 text-xs text-text-secondary">{{ t('settings.workspace.groups.monitoringHint') }}</p>
        </div>
        <div class="grid gap-3 p-3 lg:grid-cols-2">
          <div class="rounded-lg bg-background/70 p-3">
            <div class="space-y-2">
              <label for="dashboardShowLocalResources" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
                ><BaseCheckbox
                  id="dashboardShowLocalResources"
                  v-model="form.dashboardShowLocalResources"
                  :aria-label="t('settings.dashboardResources.localLabel')"
                  :disabled="savingGroup !== null"
                  class="mt-0.5"
                /><span>{{ t('settings.dashboardResources.localLabel') }}</span></label
              >
              <label
                for="dashboardShowRemoteResources"
                class="flex cursor-pointer items-start gap-2 text-sm font-medium"
                ><BaseCheckbox
                  id="dashboardShowRemoteResources"
                  v-model="form.dashboardShowRemoteResources"
                  :aria-label="t('settings.dashboardResources.remoteLabel')"
                  :disabled="savingGroup !== null"
                  class="mt-0.5"
                /><span>{{ t('settings.dashboardResources.remoteLabel') }}</span></label
              >
            </div>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <BaseFormField
              :label="t('settings.dashboardResources.refreshIntervalLabel')"
              for-id="remoteHostRefreshIntervalSeconds"
              ><BaseInput
                id="remoteHostRefreshIntervalSeconds"
                v-model="form.remoteHostRefreshIntervalSeconds"
                type="number"
                min="1"
                max="86400"
                step="1"
                :disabled="savingGroup !== null"
            /></BaseFormField>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <label for="showStatusMonitorIpAddress" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="showStatusMonitorIpAddress"
                v-model="form.showStatusMonitorIpAddress"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.statusMonitorShowIp.enableLabel') }}</span></label
            >
            <div class="mt-3">
              <BaseFormField
                :label="t('settings.statusMonitor.refreshIntervalLabel')"
                for-id="statusMonitorIntervalSeconds"
                ><BaseInput
                  id="statusMonitorIntervalSeconds"
                  v-model="form.statusMonitorIntervalSeconds"
                  type="number"
                  min="1"
                  max="86400"
                  step="1"
                  :disabled="savingGroup !== null"
              /></BaseFormField>
            </div>
          </div>
          <div class="rounded-lg bg-background/70 p-3">
            <BaseFormField :label="t('settings.docker.refreshIntervalLabel')" for-id="dockerStatusIntervalSeconds"
              ><BaseInput
                id="dockerStatusIntervalSeconds"
                v-model="form.dockerStatusIntervalSeconds"
                type="number"
                min="1"
                max="86400"
                step="1"
                :disabled="savingGroup !== null"
            /></BaseFormField>
            <label for="dockerDefaultExpand" class="mt-3 flex cursor-pointer items-start gap-2 text-sm font-medium"
              ><BaseCheckbox
                id="dockerDefaultExpand"
                v-model="form.dockerDefaultExpand"
                :disabled="savingGroup !== null"
                class="mt-0.5"
              /><span>{{ t('settings.docker.defaultExpandLabel') }}</span></label
            >
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
          <p class="min-h-4 text-xs" :class="groupMessages.monitoring?.success ? 'text-success' : 'text-error'">
            {{ groupMessages.monitoring?.text }}
          </p>
          <BaseButton
            type="submit"
            variant="primary"
            :disabled="!monitoringDirty"
            :loading="savingGroup === 'monitoring'"
            >{{ t('settings.workspace.saveGroup') }}</BaseButton
          >
        </div>
      </form>

      <details class="rounded-xl border border-border/70 bg-card/35">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none">
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
            <div class="rounded-lg bg-background/70 p-3">
              <label for="layoutLocked" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
                ><BaseCheckbox
                  id="layoutLocked"
                  v-model="form.layoutLocked"
                  :disabled="savingGroup !== null"
                  class="mt-0.5"
                /><span>{{ t('settings.workspace.layoutLockLabel') }}</span></label
              >
              <p class="mt-2 text-xs text-text-secondary">{{ t('settings.workspace.layoutLockDescription') }}</p>
            </div>
            <div class="rounded-lg bg-background/70 p-3">
              <label for="navBarVisible" class="flex cursor-pointer items-start gap-2 text-sm font-medium"
                ><BaseCheckbox
                  id="navBarVisible"
                  v-model="form.navBarVisible"
                  :disabled="savingGroup !== null"
                  class="mt-0.5"
                /><span>{{ t('settings.workspace.navBarVisibleLabel') }}</span></label
              >
              <p class="mt-2 text-xs text-text-secondary">{{ t('settings.workspace.navBarVisibleDescription') }}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
            <p class="min-h-4 text-xs" :class="groupMessages.layout?.success ? 'text-success' : 'text-error'">
              {{ groupMessages.layout?.text }}
            </p>
            <BaseButton type="submit" variant="primary" :disabled="!layoutDirty" :loading="savingGroup === 'layout'">{{
              t('settings.workspace.saveGroup')
            }}</BaseButton>
          </div>
        </form>
      </details>
    </div>
  </section>
</template>
