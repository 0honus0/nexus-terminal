<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
  import { UiButton, UiSurface } from '@/foundation/ui';
  import { useI18n } from 'vue-i18n';
  import BasicAppearancePanel from './BasicAppearancePanel.vue';
  import TerminalBackgroundSettingsPanel from './TerminalBackgroundSettingsPanel.vue';
  import TerminalThemeSettingsPanel from './TerminalThemeSettingsPanel.vue';

  const props = defineProps<{ visible: boolean }>();
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
  const activeTab = ref<'ui' | 'terminal' | 'background' | 'other'>('ui');
  const tabs = [
    { id: 'ui', label: 'styleCustomizer.uiStyles' },
    { id: 'terminal', label: 'styleCustomizer.terminalStyles' },
    { id: 'background', label: 'styleCustomizer.backgroundSettings' },
    { id: 'other', label: 'styleCustomizer.otherSettings' },
  ] as const;
  const root = ref<HTMLElement | null>(null);
  const dialog = ref<HTMLElement | null>(null);
  const uiPanel = ref<InstanceType<typeof BasicAppearancePanel> | null>(null);
  const drag = reactive({ active: false, startX: 0, startY: 0, left: 0, top: 0 });

  const centerDialog = async (): Promise<void> => {
    await nextTick();
    if (!dialog.value) return;
    dialog.value.style.left = '';
    dialog.value.style.top = '';
  };

  const handleResize = (): void => {
    if (!drag.active) {
      void centerDialog();
    }
  };

  onMounted(() => {
    activeTab.value = 'ui';
    void centerDialog();
    window.addEventListener('resize', handleResize);
  });

  watch(
    () => props.visible,
    (visible) => {
      if (!visible) return;
      activeTab.value = 'ui';
      void centerDialog();
    },
  );

  const startDrag = (event: MouseEvent): void => {
    if (!dialog.value || !root.value || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    drag.active = true;
    drag.startX = event.clientX;
    drag.startY = event.clientY;
    drag.left = dialog.value.offsetLeft;
    drag.top = dialog.value.offsetTop;
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('mouseup', stopDrag);
  };

  const moveDrag = (event: MouseEvent): void => {
    if (!drag.active || !dialog.value || !root.value) return;
    const maxLeft = Math.max(0, root.value.clientWidth - dialog.value.offsetWidth);
    const maxTop = Math.max(0, root.value.clientHeight - dialog.value.offsetHeight);
    dialog.value.style.left = `${Math.max(0, Math.min(maxLeft, drag.left + event.clientX - drag.startX))}px`;
    dialog.value.style.top = `${Math.max(0, Math.min(maxTop, drag.top + event.clientY - drag.startY))}px`;
  };

  const stopDrag = (): void => {
    drag.active = false;
    document.removeEventListener('mousemove', moveDrag);
    document.removeEventListener('mouseup', stopDrag);
  };

  onBeforeUnmount(() => {
    stopDrag();
    window.removeEventListener('resize', handleResize);
  });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.visible"
      ref="root"
      data-ui="overlay"
      class="fixed inset-0 z-[1000] flex items-center justify-center"
      @click.self="emit('close')"
    >
      <div
        ref="dialog"
        class="absolute flex h-full w-full flex-col overflow-hidden rounded-lg bg-background text-foreground shadow-[0px_0px_15px_rgb(0_0_0_/_0.15)] md:h-[85vh] md:max-h-[700px] md:w-[90%] md:max-w-[800px]"
      >
        <header
          class="flex shrink-0 cursor-move items-center justify-between border-b border-border bg-header px-4 py-3"
          @mousedown="startDrag"
        >
          <h2 class="m-0 text-lg text-foreground md:text-xl">{{ t('styleCustomizer.title') }}</h2>
          <UiButton appearance="ghost" icon-only :aria-label="t('common.close')" @click="emit('close')">
            &times;
          </UiButton>
        </header>

        <div class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <nav
            class="flex w-full shrink-0 flex-row flex-wrap justify-center gap-1.5 overflow-y-auto border-b border-border bg-header p-2 md:w-[128px] md:flex-col md:flex-nowrap md:justify-start md:border-b-0 md:border-r md:py-3"
            :aria-label="t('settings.appearance.title')"
          >
            <UiButton
              v-for="tab in tabs"
              :key="tab.id"
              density="compact"
              :appearance="activeTab === tab.id ? 'soft' : 'ghost'"
              :tone="activeTab === tab.id ? 'primary' : 'neutral'"
              :aria-pressed="activeTab === tab.id"
              class="md:w-full"
              @click="activeTab = tab.id"
              >{{ t(tab.label) }}</UiButton
            >
          </nav>

          <main class="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 md:px-6 md:py-4">
            <UiSurface v-if="activeTab === 'ui'" class="min-w-0 p-4"
              ><BasicAppearancePanel ref="uiPanel" section="ui" :show-ui-actions="false"
            /></UiSurface>
            <div v-else-if="activeTab === 'terminal'" class="min-w-0 space-y-4">
              <UiSurface class="min-w-0 p-4"><BasicAppearancePanel section="terminal" /></UiSurface>
              <UiSurface class="min-w-0 p-4"><TerminalBackgroundSettingsPanel section="text-effects" /></UiSurface>
              <UiSurface class="min-w-0 p-4"><TerminalThemeSettingsPanel /></UiSurface>
            </div>
            <UiSurface v-else-if="activeTab === 'background'" class="min-w-0 p-4"
              ><TerminalBackgroundSettingsPanel section="background"
            /></UiSurface>
            <UiSurface v-else class="min-w-0 p-4"><BasicAppearancePanel section="other" /></UiSurface>
          </main>
        </div>

        <footer class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-footer p-3 md:p-4">
          <UiButton
            v-if="activeTab === 'ui'"
            type="button"
            appearance="soft"
            tone="neutral"
            @click="uiPanel?.resetUiTheme()"
          >
            {{ t('styleCustomizer.resetUiTheme') }}
          </UiButton>
          <UiButton
            v-if="activeTab === 'ui'"
            type="button"
            appearance="solid"
            tone="primary"
            @click="uiPanel?.saveUiTheme()"
          >
            {{ t('styleCustomizer.saveUiTheme') }}
          </UiButton>
          <UiButton type="button" appearance="soft" tone="neutral" @click="emit('close')">
            {{ t('common.close') }}
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
