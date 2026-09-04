<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseTabs } from '@/foundation/ui';
  import { AppearanceSettingsPanel } from '@/features/appearance/public';
  import { BackupSettingsPanel } from '@/features/backup/public';
  import { PreferencesSettingsPanel, type Preferences } from '@/features/preferences/public';
  import { SecuritySettingsPanel } from '@/features/security/public';
  import { useAuthSession } from '@/features/auth/public';
  import { setLocale, supportedLocales } from '@/app/i18n';
  import AboutPanel from './AboutPanel.vue';

  const { t } = useI18n();
  const auth = useAuthSession();
  const active = ref('preferences');
  const tabs = computed(() => [
    { value: 'preferences', label: t('settings.tabs.system') },
    { value: 'security', label: t('settings.tabs.security') },
    { value: 'appearance', label: t('settings.tabs.appearance') },
    { value: 'data', label: t('settings.tabs.dataManagement') },
    { value: 'about', label: t('settings.tabs.about') },
  ]);

  const handlePreferencesSaved = (preferences: Preferences) => {
    setLocale(preferences.language);
  };
</script>

<template>
  <main class="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
    <header>
      <h1 class="text-2xl font-semibold text-foreground">{{ t('nav.settings') }}</h1>
    </header>

    <BaseTabs v-model="active" :items="tabs" :aria-label="t('settings.sectionsAriaLabel')" />

    <PreferencesSettingsPanel
      v-if="active === 'preferences'"
      :locales="supportedLocales"
      @saved="handlePreferencesSaved"
    />
    <SecuritySettingsPanel
      v-else-if="active === 'security'"
      :two-factor-enabled="auth.user.value?.twoFactorEnabled"
      @auth-changed="auth.refreshSession"
    />
    <AppearanceSettingsPanel v-else-if="active === 'appearance'" />
    <BackupSettingsPanel v-else-if="active === 'data'" />
    <AboutPanel v-else />
  </main>
</template>
