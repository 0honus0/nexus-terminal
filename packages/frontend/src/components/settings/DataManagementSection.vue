<template>
  <div
    v-if="settings"
    data-testid="data-management-settings"
    class="bg-background border border-border rounded-lg shadow-sm overflow-hidden"
  >
    <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
      {{ t('settings.category.dataManagement', '数据管理') }}
    </h2>

    <div class="p-6 space-y-8">
      <section class="settings-section-content">
        <h3 class="text-base font-semibold text-foreground mb-2">完整备份</h3>
        <p class="text-sm text-text-secondary mb-4">
          导出连接、代理、SSH 密钥、标签、快捷指令、主题、外观与工作区设置、背景文件及自定义 HTML 主题。
          账户、Passkey、审计日志和 IP 封禁记录不会写入备份。
        </p>
        <form class="space-y-3" @submit.prevent="handleExportBackup">
          <label class="block max-w-md">
            <span class="block text-sm font-medium text-foreground mb-1">当前登录密码</span>
            <input
              data-testid="backup-export-password"
              v-model="exportPassword"
              type="password"
              autocomplete="current-password"
              required
              class="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="用于验证身份并加密备份包"
            />
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <button
              data-testid="backup-export"
              type="submit"
              :disabled="exportLoading || !exportPassword"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium inline-flex items-center"
            >
              <i v-if="exportLoading" class="fas fa-spinner fa-spin mr-2"></i>
              <i v-else class="fas fa-download mr-2"></i>
              {{ exportLoading ? t('common.loading') : '导出完整备份' }}
            </button>
            <p v-if="exportMessage" :class="['text-sm', exportSuccess ? 'text-success' : 'text-error']">
              {{ exportMessage }}
            </p>
          </div>
        </form>
      </section>

      <section class="settings-section-content border-t border-border pt-6">
        <h3 class="text-base font-semibold text-foreground mb-2">导入备份</h3>
        <p class="text-sm text-text-secondary mb-4">
          同一实例导出的备份可在登录后直接导入；来自其他实例的备份需要输入导出时使用的登录密码。
          导入会替换当前实例中的业务数据和自定义主题文件。
        </p>
        <form class="space-y-3" @submit.prevent="handleImportBackup">
          <label class="block max-w-xl">
            <span class="block text-sm font-medium text-foreground mb-1">备份文件</span>
            <input
              data-testid="backup-import-file"
              type="file"
              accept=".nexus-backup,application/octet-stream"
              required
              class="block w-full text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-button file:text-button-text hover:file:bg-button-hover"
              @change="handleBackupFileChange"
            />
          </label>
          <label class="block max-w-md">
            <span class="block text-sm font-medium text-foreground mb-1">备份密码（跨实例时填写）</span>
            <input
              data-testid="backup-import-password"
              v-model="importPassword"
              type="password"
              autocomplete="off"
              class="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="同一实例导入可留空"
            />
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <button
              data-testid="backup-import"
              type="submit"
              :disabled="importLoading || !selectedBackupFile"
              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium inline-flex items-center"
            >
              <i v-if="importLoading" class="fas fa-spinner fa-spin mr-2"></i>
              <i v-else class="fas fa-upload mr-2"></i>
              {{ importLoading ? t('common.loading') : '导入完整备份' }}
            </button>
            <p v-if="importMessage" :class="['text-sm', importSuccess ? 'text-success' : 'text-error']">
              {{ importMessage }}
            </p>
          </div>
        </form>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { useSettingsStore } from '../../stores/settings.store';
  import { useDataBackup } from '../../composables/settings/useDataBackup';

  const settingsStore = useSettingsStore();
  const { settings } = storeToRefs(settingsStore);
  const { t } = useI18n();

  const {
    exportPassword,
    exportLoading,
    exportMessage,
    exportSuccess,
    importPassword,
    selectedBackupFile,
    importLoading,
    importMessage,
    importSuccess,
    handleExportBackup,
    handleBackupFileChange,
    handleImportBackup,
  } = useDataBackup();
</script>
