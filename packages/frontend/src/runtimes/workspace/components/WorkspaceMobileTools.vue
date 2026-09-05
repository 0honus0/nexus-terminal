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
    findNext?: () => void;
    findPrevious?: () => void;
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
    terminalSearchOpen?: boolean;
    terminalSearchTerm?: string;
    ctrlActive?: boolean;
    altActive?: boolean;
  }>();

  const emit = defineEmits<{
    'update:pane': [pane: WorkspacePaneName];
    'update:commandDraft': [value: string];
    'update:terminalSearchOpen': [open: boolean];
    'update:terminalSearchTerm': [term: string];
    openFileManager: [];
    openEditor: [];
    openSuspended: [];
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
  const toggleDockerPane = () => {
    selectPane(props.pane === 'dockerManager' ? 'terminal' : 'dockerManager');
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
      :terminal-search-open="terminalSearchOpen"
      :terminal-search-term="terminalSearchTerm"
      :mobile="true"
      :terminal-ctrl-active="ctrlActive"
      :terminal-alt-active="altActive"
      :virtual-keyboard-visible="keyboardVisible"
      :docker-pane-active="pane === 'dockerManager'"
      :non-terminal-pane-active="pane !== 'terminal'"
      @update:model-value="emit('update:commandDraft', $event)"
      @update:terminal-search-open="emit('update:terminalSearchOpen', $event)"
      @update:terminal-search-term="emit('update:terminalSearchTerm', $event)"
      @find-search-next="terminalApi?.findNext?.()"
      @find-search-previous="terminalApi?.findPrevious?.()"
      @open-file-manager="emit('openFileManager')"
      @open-editor="emit('openEditor')"
      @open-quick-commands="quickCommandsVisible = true"
      @open-status-monitor="statusVisible = true"
      @open-suspended="emit('openSuspended')"
      @toggle-virtual-keyboard="toggleKeyboard"
      @toggle-docker-pane="toggleDockerPane"
      @return-to-terminal="selectPane('terminal')"
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
  </div>

  <BaseModal
    :visible="quickCommandsVisible"
    :close-on-escape="true"
    :title="t('layout.pane.quickCommands')"
    overlay-class="!p-2"
    panel-class="h-[min(82dvh,720px)] w-[min(96vw,620px)]"
    content-class="!overflow-hidden !py-0"
    @close="quickCommandsVisible = false"
  >
    <template #header>
      <h3 class="flex-1 pl-8 text-center text-lg font-semibold">{{ t('layout.pane.quickCommands') }}</h3>
    </template>
    <template #header-actions>
      <button
        type="button"
        class="grid h-8 w-8 place-items-center text-text-secondary hover:text-foreground"
        :title="t('common.close')"
        :aria-label="t('common.close')"
        @click="quickCommandsVisible = false"
      >
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </template>
    <div class="h-full min-h-0 overflow-hidden rounded border border-border">
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
    </div>
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
