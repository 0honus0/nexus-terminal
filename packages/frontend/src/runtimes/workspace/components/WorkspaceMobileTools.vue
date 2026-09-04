<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseModal } from '@/foundation/ui';
  import { VirtualKeyboard, type TerminalChannel } from '@/features/terminal/public';
  import { QuickCommandsPanel, type ExecuteCommandIntent } from '@/features/quick-commands/public';
  import { StatusMonitor, type StatusMonitorSessionController } from '@/features/status-monitor/public';
  import type { Preferences } from '@/features/preferences/public';
  import type { WorkspacePaneName } from '../layout/workspaceLayout';
  import WorkspaceCommandBar from './WorkspaceCommandBar.vue';

  export interface MobileTerminalApi {
    copySelection?: () => Promise<void>;
    paste?: () => Promise<void>;
    selectAll?: () => void;
    openSearch?: () => void;
    clear?: () => void;
  }

  const props = defineProps<{
    pane: WorkspacePaneName;
    terminalApi: MobileTerminalApi | null;
    terminalChannel: TerminalChannel;
    statusSession: StatusMonitorSessionController;
    statusIntervalSeconds?: number;
    statusScale?: number;
    statusShowIp?: boolean;
    statusHost?: string;
    quickCommandsCompactMode?: boolean;
    showQuickCommandTags?: boolean;
    quickCommandRowScale?: number;
    commandDraft: string;
    commandInputSyncTarget?: Preferences['commandInputSyncTarget'];
    quickCommandsGrouped?: boolean;
    commandReady?: boolean;
    ctrlActive?: boolean;
    altActive?: boolean;
  }>();

  const emit = defineEmits<{
    'update:pane': [pane: WorkspacePaneName];
    'update:commandDraft': [value: string];
    openFileManager: [];
    openEditor: [];
    command: [command: string, allSessions: boolean];
    statusScale: [scale: number];
    quickCommandRowScale: [scale: number];
    quickCommandCompactMode: [compact: boolean];
    interaction: [];
    toggleModifier: [modifier: 'ctrl' | 'alt'];
    clearModifiers: [];
  }>();

  const { t } = useI18n();
  const keyboardVisible = ref(false);
  const quickCommandsVisible = ref(false);
  const statusVisible = ref(false);
  const panes: WorkspacePaneName[] = ['terminal', 'fileManager', 'editor', 'statusMonitor', 'dockerManager'];
  const paneLabel = (pane: WorkspacePaneName) => t(`layout.pane.${pane}`);
  const executeQuickCommand = (intent: ExecuteCommandIntent) => {
    emit('command', intent.command, Boolean(intent.allSessions));
    quickCommandsVisible.value = false;
  };
  const sendTerminalInput = (value: string) => {
    emit('interaction');
    void props.terminalChannel.sendInput(value);
  };
  const toggleKeyboard = () => {
    keyboardVisible.value = !keyboardVisible.value;
    if (!keyboardVisible.value) emit('clearModifiers');
  };
  const selectPane = (pane: WorkspacePaneName) => {
    if (pane !== 'terminal' && keyboardVisible.value) {
      keyboardVisible.value = false;
      emit('clearModifiers');
    }
    emit('update:pane', pane);
  };
  watch(
    () => props.pane,
    (pane) => {
      if (pane === 'terminal' || !keyboardVisible.value) return;
      keyboardVisible.value = false;
      emit('clearModifiers');
    },
  );
</script>

<template>
  <div class="z-20 shrink-0 border-t border-border bg-header/95">
    <WorkspaceCommandBar
      class="!h-auto border-b border-border"
      :model-value="commandDraft"
      :command-input-sync-target="commandInputSyncTarget"
      :quick-commands-grouped="quickCommandsGrouped"
      :show-file-manager-button="true"
      :show-editor-button="true"
      :ready="commandReady"
      :terminal-ctrl-active="ctrlActive"
      :terminal-alt-active="altActive"
      @update:model-value="emit('update:commandDraft', $event)"
      @open-file-manager="emit('openFileManager')"
      @open-editor="emit('openEditor')"
      @send="(command, all) => emit('command', command, all)"
      @clear="terminalApi?.clear?.()"
      @interaction="emit('interaction')"
      @terminal-input="sendTerminalInput"
    />
    <VirtualKeyboard
      v-if="keyboardVisible && pane === 'terminal'"
      :ctrl-active="ctrlActive"
      :alt-active="altActive"
      @toggle-modifier="emit('toggleModifier', $event)"
      @input="sendTerminalInput"
    />
    <div class="flex items-center gap-1 overflow-x-auto p-1">
      <BaseButton
        v-for="item in panes"
        :key="item"
        size="sm"
        :variant="pane === item ? 'primary' : 'ghost'"
        @click="selectPane(item)"
        >{{ paneLabel(item) }}</BaseButton
      >
      <template v-if="pane === 'terminal'">
        <BaseButton size="sm" variant="ghost" @click="terminalApi?.copySelection?.()">{{
          t('terminal.mobile.copy')
        }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="terminalApi?.paste?.()">{{
          t('terminal.mobile.paste')
        }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="terminalApi?.selectAll?.()">{{
          t('terminal.mobile.selectAll')
        }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="terminalApi?.openSearch?.()">⌕</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="quickCommandsVisible = true">{{
          t('layout.pane.quickCommands')
        }}</BaseButton>
        <BaseButton class="min-h-11" size="sm" variant="ghost" @click="statusVisible = true">{{
          t('layout.pane.statusMonitor')
        }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="toggleKeyboard">⌨</BaseButton>
      </template>
    </div>
  </div>

  <BaseModal
    :visible="quickCommandsVisible"
    :close-on-escape="true"
    :title="t('layout.pane.quickCommands')"
    overlay-class="!p-2"
    panel-class="h-[min(82dvh,720px)] w-[min(96vw,620px)]"
    @close="quickCommandsVisible = false"
  >
    <QuickCommandsPanel
      class="h-full min-h-0"
      :collapsible-search="false"
      :compact="quickCommandsCompactMode"
      :show-tags="showQuickCommandTags"
      :row-scale="quickCommandRowScale"
      @row-scale="emit('quickCommandRowScale', $event)"
      @compact-mode="emit('quickCommandCompactMode', $event)"
      @execute="executeQuickCommand"
    />
  </BaseModal>

  <BaseModal
    :visible="statusVisible"
    :title="t('layout.pane.statusMonitor')"
    overlay-class="!p-2"
    panel-class="h-[min(82dvh,720px)] w-[min(96vw,680px)]"
    @close="statusVisible = false"
  >
    <template #header-actions>
      <BaseButton
        class="min-h-11 min-w-11 px-3"
        size="sm"
        variant="ghost"
        :aria-label="t('common.close')"
        @click="statusVisible = false"
        >×</BaseButton
      >
    </template>
    <StatusMonitor
      class="h-full min-h-0 overflow-auto p-2"
      :session="statusSession"
      :interval-seconds="statusIntervalSeconds"
      :scale="statusScale"
      :show-ip="statusShowIp"
      :host="statusHost"
      @update:scale="emit('statusScale', $event)"
    />
  </BaseModal>
</template>
