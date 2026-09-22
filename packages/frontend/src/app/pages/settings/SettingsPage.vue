<script setup lang="ts">
  import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { loadAppearanceSettingsPanel, useAppearance } from '@/features/appearance/public';
  import { AgentSettingsPanel } from '@/features/agent/public';
  import { BackupSettingsPanel } from '@/features/backup/public';
  import {
    loadPreferencesSettingsPanel,
    loadWorkspacePreferencesPanel,
    type PreferencesDto,
  } from '@/features/preferences/public';
  import { SecuritySettingsPanel } from '@/features/security/public';
  import { useAuthSession } from '@/features/auth/public';
  import { setLocale, supportedLocales } from '@/app/i18n';
  import AboutPanel from './AboutPanel.vue';

  const PreferencesSettingsPanel = defineAsyncComponent(loadPreferencesSettingsPanel);
  const WorkspacePreferencesPanel = defineAsyncComponent(loadWorkspacePreferencesPanel);
  const AppearanceSettingsPanel = defineAsyncComponent(loadAppearanceSettingsPanel);
  type SettingsTab = 'workspace' | 'system' | 'security' | 'ipControl' | 'data' | 'appearance' | 'agent' | 'about';

  const { t } = useI18n();
  const auth = useAuthSession();
  const appearance = useAppearance();
  const active = ref<SettingsTab>('workspace');
  const visited = reactive(new Set<SettingsTab>(['workspace']));
  watch(active, (value) => visited.add(value), { immediate: true });
  const tabs = computed<readonly { value: SettingsTab; label: string }[]>(() => [
    { value: 'workspace', label: t('settings.tabs.workspace') },
    { value: 'system', label: t('settings.tabs.system') },
    { value: 'security', label: t('settings.tabs.security') },
    { value: 'ipControl', label: t('settings.tabs.ipControl') },
    { value: 'data', label: t('settings.tabs.dataManagement') },
    { value: 'appearance', label: t('settings.tabs.appearance') },
    { value: 'agent', label: t('agent.settings.tab') },
    { value: 'about', label: t('settings.tabs.about') },
  ]);

  const handlePreferencesSaved = (preferences: PreferencesDto) => {
    setLocale(preferences.language);
  };
</script>

<template>
  <main class="min-h-screen bg-background p-4 text-foreground">
    <div class="mx-auto max-w-7xl">
      <label v-if="active === 'agent'" class="mb-4 block sm:hidden">
        <span class="sr-only">{{ t('settings.sectionsAriaLabel') }}</span>
        <select
          v-model="active"
          class="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm"
          :aria-label="t('settings.sectionsAriaLabel')"
        >
          <option v-for="tab in tabs" :key="tab.value" :value="tab.value">{{ tab.label }}</option>
        </select>
      </label>

      <div class="mb-6 flex justify-center">
        <div
          class="flex flex-wrap items-center justify-center gap-1 rounded-2xl border border-border/70 bg-card/40 p-1.5 shadow-xs"
          :class="{ 'agent-settings-tabs': active === 'agent' }"
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
            class="min-w-0 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors duration-150 ease-in-out focus:outline-none sm:shrink-0 sm:px-4"
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
      </div>

      <div class="space-y-6">
        <WorkspacePreferencesPanel
          v-if="visited.has('workspace')"
          v-show="active === 'workspace'"
          id="settings-panel-workspace"
        />
        <PreferencesSettingsPanel
          v-if="visited.has('system')"
          v-show="active === 'system'"
          id="settings-panel-system"
          section="system"
          :locales="supportedLocales"
          @saved="handlePreferencesSaved"
        />
        <SecuritySettingsPanel
          v-if="visited.has('security')"
          v-show="active === 'security'"
          id="settings-panel-security"
          section="security"
          :two-factor-enabled="auth.user.value?.twoFactorEnabled"
          @auth-changed="auth.refreshSession"
        />
        <SecuritySettingsPanel
          v-if="visited.has('ipControl')"
          v-show="active === 'ipControl'"
          id="settings-panel-ipControl"
          section="ipControl"
          :two-factor-enabled="auth.user.value?.twoFactorEnabled"
          @auth-changed="auth.refreshSession"
        />
        <BackupSettingsPanel v-if="visited.has('data')" v-show="active === 'data'" id="settings-panel-data" />
        <AppearanceSettingsPanel
          v-if="visited.has('appearance')"
          v-show="active === 'appearance'"
          id="settings-panel-appearance"
          @customize="appearance.openCustomizer()"
        />
        <AgentSettingsPanel v-if="visited.has('agent')" v-show="active === 'agent'" />
        <AboutPanel v-if="visited.has('about')" v-show="active === 'about'" id="settings-panel-about" />
      </div>
    </div>
  </main>
</template>

<style scoped>
  @media (max-width: 639px) {
    .agent-settings-tabs {
      display: none;
    }
  }
</style>
