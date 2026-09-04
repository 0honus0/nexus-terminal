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
  <section data-testid="data-management-settings" class="space-y-8 rounded-lg border border-border bg-background p-6">
    <div class="space-y-3">
      <h3 class="text-base font-semibold">{{ t('settings.backup.title') }}</h3>
      <p class="max-w-3xl text-sm text-text-secondary">{{ t('settings.backup.description') }}</p>
      <form class="max-w-xl space-y-3" @submit.prevent="exportBackup">
        <BaseFormField :label="t('settings.backup.currentPassword')">
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
            {{ t('settings.backup.export') }}
          </BaseButton>
          <p v-if="exportMessage" :class="exportSuccess ? 'text-success' : 'text-error'" class="text-sm">
            {{ exportMessage }}
          </p>
        </div>
      </form>
    </div>

    <div class="space-y-3 border-t border-border pt-6">
      <h3 class="text-base font-semibold">{{ t('settings.backup.import') }}</h3>
      <p class="max-w-3xl text-sm text-text-secondary">{{ t('settings.backup.importDescription') }}</p>
      <form class="max-w-xl space-y-3" @submit.prevent="importBackup">
        <BaseFormField :label="t('settings.backup.backupFile')">
          <input
            ref="importInput"
            data-testid="backup-import-file"
            type="file"
            accept=".nexus-backup,application/octet-stream"
            required
            class="block w-full text-sm text-text-secondary"
            @change="selectFile"
          />
        </BaseFormField>
        <BaseFormField :label="t('settings.backup.backupPassword')">
          <BaseInput v-model="importPassword" type="password" autocomplete="off" />
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
            {{ t('settings.backup.import') }}
          </BaseButton>
          <p v-if="importMessage" :class="importSuccess ? 'text-success' : 'text-error'" class="text-sm">
            {{ importMessage }}
          </p>
        </div>
      </form>
    </div>

    <div class="space-y-3 border-t border-border pt-6">
      <h3 class="text-base font-semibold">{{ t('settings.exportConnections.title') }}</h3>
      <p class="max-w-3xl text-sm text-text-secondary">{{ t('settings.exportConnections.decryptKeyInfo') }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <BaseButton :loading="connectionsLoading" @click="exportConnections">
          {{ t('settings.exportConnections.buttonText') }}
        </BaseButton>
        <p v-if="connectionsMessage" :class="connectionsSuccess ? 'text-success' : 'text-error'" class="text-sm">
          {{ connectionsMessage }}
        </p>
      </div>
    </div>
  </section>
</template>
