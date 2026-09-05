<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { AppearanceSettingsPanel, useAppearanceStore } from '@/features/appearance/public';
  import { BackupSettingsPanel } from '@/features/backup/public';
  import { PreferencesSettingsPanel, type Preferences } from '@/features/preferences/public';
  import { SecuritySettingsPanel } from '@/features/security/public';
  import { useAuthSession } from '@/features/auth/public';
  import { setLocale, supportedLocales } from '@/app/i18n';
  import AboutPanel from './AboutPanel.vue';

  type SettingsTab = 'workspace' | 'system' | 'security' | 'ipControl' | 'data' | 'appearance' | 'about';

  const { t } = useI18n();
  const auth = useAuthSession();
  const appearance = useAppearanceStore();
  const active = ref<SettingsTab>('workspace');
  const tabs = computed<readonly { value: SettingsTab; label: string }[]>(() => [
    { value: 'workspace', label: t('settings.tabs.workspace') },
    { value: 'system', label: t('settings.tabs.system') },
    { value: 'security', label: t('settings.tabs.security') },
    { value: 'ipControl', label: t('settings.tabs.ipControl') },
    { value: 'data', label: t('settings.tabs.dataManagement') },
    { value: 'appearance', label: t('settings.tabs.appearance') },
    { value: 'about', label: t('settings.tabs.about') },
  ]);

  const handlePreferencesSaved = (preferences: Preferences) => {
    setLocale(preferences.language);
  };
</script>

<template>
  <main class="min-h-screen bg-background p-4 text-foreground">
    <div class="mx-auto max-w-7xl">
      <div
        class="mb-6 flex gap-1 overflow-x-auto bg-background py-2"
        role="tablist"
        :aria-label="t('settings.sectionsAriaLabel')"
      >
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="active === tab.value"
          :aria-controls="`settings-panel-${tab.value}`"
          class="shrink-0 rounded-md px-4 py-2 text-sm font-medium transition-colors duration-150 ease-in-out focus:outline-none"
          :class="
            active === tab.value
              ? 'bg-primary text-white'
              : 'text-text-secondary hover:bg-header/50 hover:text-foreground'
          "
          @click="active = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="space-y-6">
        <PreferencesSettingsPanel
          v-if="active === 'workspace'"
          id="settings-panel-workspace"
          section="workspace"
          :locales="supportedLocales"
          @saved="handlePreferencesSaved"
        />
        <PreferencesSettingsPanel
          v-else-if="active === 'system'"
          id="settings-panel-system"
          section="system"
          :locales="supportedLocales"
          @saved="handlePreferencesSaved"
        />
        <SecuritySettingsPanel
          v-else-if="active === 'security'"
          id="settings-panel-security"
          section="security"
          :two-factor-enabled="auth.user.value?.twoFactorEnabled"
          @auth-changed="auth.refreshSession"
        />
        <SecuritySettingsPanel
          v-else-if="active === 'ipControl'"
          id="settings-panel-ipControl"
          section="ipControl"
          :two-factor-enabled="auth.user.value?.twoFactorEnabled"
          @auth-changed="auth.refreshSession"
        />
        <BackupSettingsPanel v-else-if="active === 'data'" id="settings-panel-data" />
        <AppearanceSettingsPanel
          v-else-if="active === 'appearance'"
          id="settings-panel-appearance"
          @customize="appearance.openCustomizer()"
        />
        <AboutPanel v-else id="settings-panel-about" />
      </div>
    </div>
  </main>
</template>
