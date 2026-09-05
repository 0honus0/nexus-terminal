<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { focusRegistry } from '@/shared/focus/public';
  import { useQuickCommandsStore } from '@/features/quick-commands/public';
  import { useCommandHistoryStore } from '@/features/command-history/public';
  import type { Preferences } from '@/features/preferences/public';
  import { applyTerminalModifiers } from '@/features/terminal/public';

  const props = withDefaults(
    defineProps<{
      commandInputSyncTarget?: Preferences['commandInputSyncTarget'];
      quickCommandsGrouped?: boolean;
      showFileManagerButton?: boolean;
      showEditorButton?: boolean;
      ready?: boolean;
      modelValue?: string;
      terminalCtrlActive?: boolean;
      terminalAltActive?: boolean;
      mobile?: boolean;
    }>(),
    {
      commandInputSyncTarget: 'none',
      quickCommandsGrouped: true,
      showFileManagerButton: false,
      ready: true,
      mobile: false,
    },
  );
  const emit = defineEmits<{
    'update:modelValue': [value: string];
    send: [command: string, allSessions: boolean];
    clear: [];
    openFileManager: [];
    openEditor: [];
    openSearch: [];
    interaction: [];
    terminalInput: [data: string];
  }>();
  const { t } = useI18n();
  const quickCommands = useQuickCommandsStore();
  const commandHistory = useCommandHistoryStore();
  // Keep an immediate local presentation value so Enter in the same input tick
  // cannot read the previous prop before Vue has rendered the v-model update back
  // down from the session-owned commandDraft.
  const command = ref(props.modelValue ?? '');
  const commandInput = ref<{ focus?: () => void } | null>(null);
  const root = ref<HTMLFormElement | null>(null);
  let unregisterFocus: (() => void) | undefined;

  const resetTargetSelection = () => {
    if (props.commandInputSyncTarget === 'quickCommands') quickCommands.resetSelection();
    else if (props.commandInputSyncTarget === 'commandHistory') commandHistory.resetSelection();
  };
  const syncSearch = (value: string) => {
    if (props.commandInputSyncTarget === 'quickCommands') quickCommands.setSearch(value);
    else if (props.commandInputSyncTarget === 'commandHistory') commandHistory.setSearch(value);
  };
  const send = (allSessions = false, value = command.value) => {
    if (!props.ready || (allSessions && !value)) return;
    emit('send', value, allSessions);
    command.value = '';
    resetTargetSelection();
  };
  const sendSelected = (): boolean => {
    if (props.commandInputSyncTarget === 'quickCommands' && quickCommands.selected) {
      send(false, quickCommands.selected.command);
      return true;
    }
    if (props.commandInputSyncTarget === 'commandHistory' && commandHistory.selected) {
      send(false, commandHistory.selected.command);
      return true;
    }
    return false;
  };
  const captureStickyTerminalInput = (input: string): boolean => {
    if (!props.terminalCtrlActive && !props.terminalAltActive) return false;
    if (
      applyTerminalModifiers(input, {
        ctrl: Boolean(props.terminalCtrlActive),
        alt: Boolean(props.terminalAltActive),
      }) === null
    )
      return false;
    emit('terminalInput', input);
    return true;
  };
  const handleKeydown = (event: KeyboardEvent) => {
    if (!event.isComposing && captureStickyTerminalInput(event.key)) {
      event.preventDefault();
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(event.key)) emit('interaction');
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && command.value === '') {
      event.preventDefault();
      emit('send', '\x03', false);
      return;
    }
    if (event.key === 'ArrowDown' && props.commandInputSyncTarget !== 'none') {
      event.preventDefault();
      if (props.commandInputSyncTarget === 'quickCommands') quickCommands.selectNext(props.quickCommandsGrouped);
      else commandHistory.selectNext();
      return;
    }
    if (event.key === 'ArrowUp' && props.commandInputSyncTarget !== 'none') {
      event.preventDefault();
      if (props.commandInputSyncTarget === 'quickCommands') quickCommands.selectPrevious(props.quickCommandsGrouped);
      else commandHistory.selectPrevious();
      return;
    }
    if (event.key === 'Enter' && !event.altKey && sendSelected()) {
      event.preventDefault();
      return;
    }
    if (!['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(event.key)) resetTargetSelection();
  };
  const handleBeforeInput = (event: InputEvent) => {
    if (event.isComposing || event.inputType !== 'insertText' || !event.data) return;
    if (!captureStickyTerminalInput(event.data)) return;
    event.preventDefault();
  };

  watch(
    () => props.modelValue,
    (value) => {
      const next = value ?? '';
      if (next !== command.value) command.value = next;
    },
  );
  watch(command, (value) => {
    if (value !== (props.modelValue ?? '')) emit('update:modelValue', value);
    syncSearch(value);
  });
  watch(
    () => props.commandInputSyncTarget,
    () => {
      quickCommands.resetSelection();
      commandHistory.resetSelection();
      syncSearch(command.value);
    },
  );
  onMounted(() => {
    unregisterFocus = focusRegistry.register(
      'commandInput',
      () => {
        commandInput.value?.focus?.();
        return true;
      },
      () => Boolean(root.value?.getClientRects().length),
    );
  });
  onBeforeUnmount(() => unregisterFocus?.());
</script>
<template>
  <form
    ref="root"
    data-testid="command-input-bar"
    class="command-bar-root flex w-full items-center overflow-hidden bg-background"
    :class="mobile ? 'h-auto min-h-[2.35rem]' : 'h-full min-h-0'"
    @submit.prevent="send()"
  >
    <div class="flex w-full min-w-0 flex-1 items-center gap-[0.3rem] bg-transparent px-2 py-[0.04rem]">
      <input
        ref="commandInput"
        v-model="command"
        data-testid="command-input"
        data-focus-id="commandInput"
        type="text"
        :placeholder="t('commandInputBar.placeholder')"
        :disabled="!ready"
        :aria-disabled="!ready"
        class="h-[1.85rem] min-h-[1.85rem] min-w-0 flex-1 rounded-lg border border-border/50 bg-input px-4 py-1.5 text-sm text-foreground shadow-sm transition-all duration-300 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        :class="mobile ? 'w-[7.25rem] flex-[0_0_7.25rem] px-2' : ''"
        @keydown="handleKeydown"
        @beforeinput="handleBeforeInput"
        @blur="resetTargetSelection"
      />

      <div class="flex min-w-max shrink-0 items-center gap-[0.3rem]">
        <button
          type="button"
          class="command-bar-button"
          :title="t('commandInputBar.clearTerminal')"
          :aria-label="t('commandInputBar.clearTerminal')"
          @click="emit('clear')"
        >
          <i class="fas fa-eraser" aria-hidden="true"></i>
        </button>
        <button
          v-if="!mobile"
          type="button"
          class="command-bar-button"
          :title="t('commandInputBar.openSearch')"
          :aria-label="t('commandInputBar.openSearch')"
          @click="emit('openSearch')"
        >
          <i class="fas fa-search" aria-hidden="true"></i>
        </button>
        <button
          v-if="showFileManagerButton"
          data-testid="open-file-manager-button"
          type="button"
          class="command-bar-button"
          :title="t('layout.pane.fileManager')"
          :aria-label="t('layout.pane.fileManager')"
          @click="emit('openFileManager')"
        >
          <i class="fas fa-folder" aria-hidden="true"></i>
        </button>
        <button
          v-if="showEditorButton"
          type="button"
          class="command-bar-button"
          :title="t('layout.pane.editor')"
          :aria-label="t('layout.pane.editor')"
          @click="emit('openEditor')"
        >
          <i class="fas fa-edit" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="command-bar-button"
          :disabled="!ready || !command"
          :title="t('common.all')"
          :aria-label="t('common.all')"
          @click="send(true)"
        >
          <i class="fas fa-share-alt" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </form>
</template>

<style scoped>
  .command-bar-button {
    display: flex;
    width: 1.85rem;
    height: 1.85rem;
    min-width: 1.85rem;
    min-height: 1.85rem;
    flex: 0 0 1.85rem;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--border-color) 50%, transparent);
    border-radius: 0.5rem;
    color: var(--text-secondary-color);
    transition:
      transform 0.12s ease,
      background-color 0.2s ease,
      color 0.2s ease,
      border-color 0.2s ease;
  }
  .command-bar-button:hover:not(:disabled) {
    background: var(--border-color);
    color: var(--text-color);
  }
  .command-bar-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 50%, transparent);
  }
  .command-bar-button:active:not(:disabled) {
    transform: scale(0.92);
  }
  .command-bar-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .command-bar-button i {
    font-size: 0.85rem;
    line-height: 1;
    pointer-events: none;
  }
</style>
