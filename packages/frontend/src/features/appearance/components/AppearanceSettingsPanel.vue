<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner, BaseTabs } from '@/foundation/ui';
  import BasicAppearancePanel from './BasicAppearancePanel.vue';
  import TerminalBackgroundSettingsPanel from './TerminalBackgroundSettingsPanel.vue';
  import TerminalThemeSettingsPanel from './TerminalThemeSettingsPanel.vue';
  import { useAppearanceStore } from '../store/appearance.store';

  const { t } = useI18n();
  const store = useAppearanceStore();
  const loading = ref(!store.loaded);
  const activeTab = ref('ui');
  const tabs = computed(() => [
    { value: 'ui', label: t('styleCustomizer.uiStyles') },
    { value: 'terminal', label: t('styleCustomizer.terminalThemeSelection'), testId: 'style-customizer-terminal-tab' },
    { value: 'background', label: t('styleCustomizer.backgroundSettings') },
  ]);

  onMounted(async () => {
    try {
      await store.load();
    } finally {
      loading.value = false;
    }
  });
</script>

<template>
  <section data-testid="style-customizer" class="space-y-6 rounded-lg border border-border bg-background p-6">
    <BaseSpinner v-if="loading" />
    <template v-else>
      <BaseTabs v-model="activeTab" :items="tabs" :aria-label="t('settings.appearance.title')" />
      <BasicAppearancePanel v-if="activeTab === 'ui'" />
      <TerminalThemeSettingsPanel v-else-if="activeTab === 'terminal'" />
      <TerminalBackgroundSettingsPanel v-else />
    </template>
  </section>
</template>
