<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseFormField, BaseInput } from '@/foundation/ui';
  import { backupApi } from '../api/backupApi';

  const { t } = useI18n();
  const exportPassword = ref('');
  const exportLoading = ref(false);
  const exportMessage = ref('');
  const exportSuccess = ref(false);

  const importPassword = ref('');
  const importFile = ref<File | null>(null);
  const importInput = ref<HTMLInputElement | null>(null);
  const importLoading = ref(false);
  const importMessage = ref('');
  const importSuccess = ref(false);

  const connectionsLoading = ref(false);
  const connectionsMessage = ref('');
  const connectionsSuccess = ref(false);

  const exportBackup = async () => {
    if (!exportPassword.value) return;
    exportLoading.value = true;
    exportMessage.value = '';
    exportSuccess.value = false;
    try {
      await backupApi.exportFull(exportPassword.value);
      exportPassword.value = '';
      exportSuccess.value = true;
      exportMessage.value = t('settings.backup.exported');
    } catch (cause) {
      exportMessage.value = apiErrorMessage(cause, t('settings.backup.exportFailed'));
    } finally {
      exportLoading.value = false;
    }
  };

  const importBackup = async () => {
    if (!importFile.value) {
      importSuccess.value = false;
      importMessage.value = t('settings.backup.selectFile');
      return;
    }
    importLoading.value = true;
    importMessage.value = '';
    importSuccess.value = false;
    try {
      const result = await backupApi.importFull(importFile.value, importPassword.value || undefined);
      importPassword.value = '';
      importFile.value = null;
      if (importInput.value) importInput.value.value = '';
      importSuccess.value = true;
      importMessage.value = t('settings.backup.importedWithCounts', {
        rows: Number(result.restoredRows ?? 0),
        files: Number(result.restoredFiles ?? 0),
      });
      window.setTimeout(() => window.location.reload(), 300);
    } catch (cause) {
      importMessage.value = apiErrorMessage(cause, t('settings.backup.importFailed'));
    } finally {
      importLoading.value = false;
    }
  };

  const exportConnections = async () => {
    connectionsLoading.value = true;
    connectionsMessage.value = '';
    connectionsSuccess.value = false;
    try {
      await backupApi.exportConnections();
      connectionsSuccess.value = true;
      connectionsMessage.value = t('settings.exportConnections.success');
    } catch (cause) {
      connectionsMessage.value = apiErrorMessage(cause, t('settings.exportConnections.error'));
    } finally {
      connectionsLoading.value = false;
    }
  };

  const selectFile = (event: Event) => {
    importFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
    importMessage.value = '';
  };
</script>

<template>
  <section
    data-testid="data-management-settings"
    class="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
  >
    <h2 class="border-b border-border bg-header/50 px-6 py-4 text-lg font-semibold text-foreground">
      {{ t('settings.category.dataManagement') }}
    </h2>
    <div class="space-y-8 p-6">
      <section>
        <h3 class="mb-2 text-base font-semibold text-foreground">{{ t('settings.backup.title') }}</h3>
        <p class="mb-4 max-w-3xl text-sm text-text-secondary">{{ t('settings.backup.description') }}</p>
        <form class="space-y-3" @submit.prevent="exportBackup">
          <BaseFormField :label="t('settings.backup.currentPassword')" class="max-w-md">
            <BaseInput
              v-model="exportPassword"
              data-testid="backup-export-password"
              type="password"
              autocomplete="current-password"
              required
            />
          </BaseFormField>
          <div class="flex flex-wrap items-center gap-3">
            <BaseButton
              data-testid="backup-export"
              type="submit"
              variant="primary"
              :loading="exportLoading"
              :disabled="!exportPassword"
            >
              <template #leading
                ><i :class="exportLoading ? 'fas fa-spinner fa-spin' : 'fas fa-download'" aria-hidden="true"></i
              ></template>
              {{ exportLoading ? t('common.loading') : t('settings.backup.export') }}
            </BaseButton>
            <p v-if="exportMessage" :class="exportSuccess ? 'text-success' : 'text-error'" class="text-sm">
              {{ exportMessage }}
            </p>
          </div>
        </form>
      </section>

      <section class="border-t border-border pt-6">
        <h3 class="mb-2 text-base font-semibold text-foreground">{{ t('settings.backup.import') }}</h3>
        <p class="mb-4 max-w-3xl text-sm text-text-secondary">{{ t('settings.backup.importDescription') }}</p>
        <form class="space-y-3" @submit.prevent="importBackup">
          <BaseFormField :label="t('settings.backup.backupFile')" class="max-w-xl">
            <input
              ref="importInput"
              data-testid="backup-import-file"
              type="file"
              accept=".nexus-backup,application/octet-stream"
              required
              class="block w-full text-sm text-text-secondary file:mr-4 file:rounded-md file:border-0 file:bg-button file:px-4 file:py-2 file:text-button-text hover:file:bg-button-hover"
              @change="selectFile"
            />
          </BaseFormField>
          <BaseFormField :label="t('settings.backup.backupPassword')" class="max-w-md">
            <BaseInput
              v-model="importPassword"
              data-testid="backup-import-password"
              type="password"
              autocomplete="off"
            />
            <p class="mt-1 text-xs text-text-secondary">{{ t('settings.backup.backupPasswordHelp') }}</p>
          </BaseFormField>
          <div class="flex flex-wrap items-center gap-3">
            <BaseButton
              data-testid="backup-import"
              type="submit"
              variant="primary"
              :loading="importLoading"
              :disabled="!importFile"
            >
              <template #leading
                ><i :class="importLoading ? 'fas fa-spinner fa-spin' : 'fas fa-upload'" aria-hidden="true"></i
              ></template>
              {{ importLoading ? t('common.loading') : t('settings.backup.import') }}
            </BaseButton>
            <p v-if="importMessage" :class="importSuccess ? 'text-success' : 'text-error'" class="text-sm">
              {{ importMessage }}
            </p>
          </div>
        </form>
      </section>

      <section class="border-t border-border pt-6">
        <h3 class="mb-2 text-base font-semibold text-foreground">{{ t('settings.exportConnections.title') }}</h3>
        <p class="mb-4 max-w-3xl text-sm text-text-secondary">{{ t('settings.exportConnections.decryptKeyInfo') }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <BaseButton :loading="connectionsLoading" @click="exportConnections">
            <template #leading
              ><i :class="connectionsLoading ? 'fas fa-spinner fa-spin' : 'fas fa-file-export'" aria-hidden="true"></i
            ></template>
            {{ t('settings.exportConnections.buttonText') }}
          </BaseButton>
          <p v-if="connectionsMessage" :class="connectionsSuccess ? 'text-success' : 'text-error'" class="text-sm">
            {{ connectionsMessage }}
          </p>
        </div>
      </section>
    </div>
  </section>
</template>
