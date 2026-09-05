<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
      terminalSearchOpen?: boolean;
      terminalSearchTerm?: string;
      terminalCtrlActive?: boolean;
      terminalAltActive?: boolean;
      virtualKeyboardVisible?: boolean;
      dockerPaneActive?: boolean;
      nonTerminalPaneActive?: boolean;
      mobile?: boolean;
    }>(),
    {
      commandInputSyncTarget: 'none',
      quickCommandsGrouped: true,
      showFileManagerButton: false,
      ready: true,
      terminalSearchOpen: false,
      terminalSearchTerm: '',
      mobile: false,
    },
  );
  const emit = defineEmits<{
    'update:modelValue': [value: string];
    'update:terminalSearchOpen': [open: boolean];
    'update:terminalSearchTerm': [term: string];
    send: [command: string, allSessions: boolean];
    clear: [];
    openFileManager: [];
    openEditor: [];
    openQuickCommands: [];
    openStatusMonitor: [];
    openSuspended: [];
    toggleVirtualKeyboard: [];
    toggleDockerPane: [];
    returnToTerminal: [];
    findSearchNext: [];
    findSearchPrevious: [];
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
  const commandInput = ref<HTMLInputElement | null>(null);
  const root = ref<HTMLFormElement | null>(null);
  let unregisterCommandFocus: (() => void) | undefined;
  let unregisterSearchFocus: (() => void) | undefined;

  const activeInput = computed({
    get: () => (props.terminalSearchOpen ? props.terminalSearchTerm : command.value),
    set: (value: string) => {
      if (props.terminalSearchOpen) emit('update:terminalSearchTerm', value);
      else command.value = value;
    },
  });

  const resetTargetSelection = () => {
    if (props.commandInputSyncTarget === 'quickCommands') quickCommands.resetSelection();
    else if (props.commandInputSyncTarget === 'commandHistory') commandHistory.resetSelection();
  };
  const syncSearch = (value: string) => {
    if (props.commandInputSyncTarget === 'quickCommands') quickCommands.setSearch(value);
    else if (props.commandInputSyncTarget === 'commandHistory') commandHistory.setSearch(value);
  };
  const setTerminalSearchOpen = (open: boolean) => {
    emit('update:terminalSearchOpen', open);
    if (!open) emit('update:terminalSearchTerm', '');
    void nextTick(() => commandInput.value?.focus());
  };
  const toggleTerminalSearch = () => setTerminalSearchOpen(!props.terminalSearchOpen);
  const submit = () => {
    if (props.terminalSearchOpen) emit('findSearchNext');
    else send();
  };
  const send = (allSessions = false, value = command.value) => {
    if (props.terminalSearchOpen || !props.ready || (allSessions && !value)) return;
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
  const handleSearchKeydown = (event: KeyboardEvent): boolean => {
    if (!props.terminalSearchOpen) return false;
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      commandInput.value?.focus();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setTerminalSearchOpen(false);
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) emit('findSearchPrevious');
      else emit('findSearchNext');
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      emit('findSearchPrevious');
      return true;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      emit('findSearchNext');
      return true;
    }
    return false;
  };
  const handleKeydown = (event: KeyboardEvent) => {
    if (handleSearchKeydown(event)) return;
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setTerminalSearchOpen(true);
      return;
    }
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
    if (props.terminalSearchOpen || event.isComposing || event.inputType !== 'insertText' || !event.data) return;
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
  watch(
    () => props.terminalSearchOpen,
    (open) => {
      if (open) void nextTick(() => commandInput.value?.focus());
    },
  );
  onMounted(() => {
    const visible = () => Boolean(root.value?.getClientRects().length);
    unregisterCommandFocus = focusRegistry.register(
      'commandInput',
      () => {
        if (props.terminalSearchOpen) setTerminalSearchOpen(false);
        else commandInput.value?.focus();
        return true;
      },
      visible,
    );
    unregisterSearchFocus = focusRegistry.register(
      'terminalSearch',
      () => {
        if (!props.terminalSearchOpen) setTerminalSearchOpen(true);
        else commandInput.value?.focus();
        return true;
      },
      visible,
    );
  });
  onBeforeUnmount(() => {
    unregisterCommandFocus?.();
    unregisterSearchFocus?.();
  });
</script>
<template>
  <form
    ref="root"
    data-testid="command-input-bar"
    class="command-bar-root flex w-full items-center overflow-hidden bg-background"
    :class="mobile ? 'command-bar-root--mobile h-auto min-h-[2.35rem]' : 'h-full min-h-0'"
    @submit.prevent="submit"
  >
    <div
      class="command-bar-inner flex w-full min-w-0 flex-1 items-center gap-[0.3rem] bg-transparent px-2 py-[0.04rem]"
    >
      <input
        ref="commandInput"
        v-model="activeInput"
        data-testid="command-input"
        :data-focus-id="terminalSearchOpen ? 'terminalSearch' : 'commandInput'"
        type="text"
        :placeholder="t(terminalSearchOpen ? 'commandInputBar.searchPlaceholder' : 'commandInputBar.placeholder')"
        :disabled="!ready && !terminalSearchOpen"
        :aria-disabled="!ready && !terminalSearchOpen"
        class="h-[1.85rem] min-h-[1.85rem] min-w-0 flex-1 rounded-lg border border-border/50 bg-input px-4 py-1.5 text-sm text-foreground shadow-sm transition-all duration-300 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        :class="[mobile ? 'w-[7.25rem] flex-[0_0_7.25rem] px-2' : '', terminalSearchOpen ? 'border-primary/70' : '']"
        @keydown="handleKeydown"
        @beforeinput="handleBeforeInput"
        @blur="resetTargetSelection"
      />

      <div
        class="flex items-center gap-[0.3rem]"
        :class="mobile ? 'mobile-command-controls min-w-0 flex-1 overflow-x-auto' : 'min-w-max shrink-0'"
      >
        <button
          type="button"
          class="command-bar-button"
          :title="t('commandInputBar.clearTerminal')"
          :aria-label="t('commandInputBar.clearTerminal')"
          @click="emit('clear')"
        >
          <i class="fas fa-eraser" aria-hidden="true"></i>
        </button>
        <template v-if="mobile">
          <button
            type="button"
            class="command-bar-button"
            :title="t('layout.pane.quickCommands')"
            :aria-label="t('layout.pane.quickCommands')"
            @click="emit('openQuickCommands')"
          >
            <i class="fas fa-bolt" aria-hidden="true"></i>
          </button>
          <button
            data-testid="open-status-monitor-button"
            type="button"
            class="command-bar-button"
            :title="t('layout.pane.statusMonitor')"
            :aria-label="t('layout.pane.statusMonitor')"
            @click="emit('openStatusMonitor')"
          >
            <i class="fas fa-tachometer-alt" aria-hidden="true"></i>
          </button>
          <button
            data-testid="open-suspended-sessions-button"
            type="button"
            class="command-bar-button"
            :title="t('suspendedSshSessions.modalTitle')"
            :aria-label="t('suspendedSshSessions.modalTitle')"
            @click="emit('openSuspended')"
          >
            <i class="fas fa-pause-circle" aria-hidden="true"></i>
          </button>
          <button
            data-testid="toggle-virtual-keyboard"
            type="button"
            class="command-bar-button"
            :class="{ 'is-active': virtualKeyboardVisible }"
            :title="t(virtualKeyboardVisible ? 'commandInputBar.hideKeyboard' : 'commandInputBar.showKeyboard')"
            :aria-label="t(virtualKeyboardVisible ? 'commandInputBar.hideKeyboard' : 'commandInputBar.showKeyboard')"
            :aria-pressed="Boolean(virtualKeyboardVisible)"
            @click="emit('toggleVirtualKeyboard')"
          >
            <i class="fas fa-keyboard" aria-hidden="true"></i>
          </button>
        </template>
        <button
          type="button"
          class="command-bar-button"
          :title="t(terminalSearchOpen ? 'commandInputBar.closeSearch' : 'commandInputBar.openSearch')"
          :aria-label="t(terminalSearchOpen ? 'commandInputBar.closeSearch' : 'commandInputBar.openSearch')"
          @click="toggleTerminalSearch"
        >
          <i :class="terminalSearchOpen ? 'fas fa-times' : 'fas fa-search'" aria-hidden="true"></i>
        </button>
        <template v-if="terminalSearchOpen">
          <button
            type="button"
            class="command-bar-button"
            :title="t('commandInputBar.findPrevious')"
            :aria-label="t('commandInputBar.findPrevious')"
            @click="emit('findSearchPrevious')"
          >
            <i class="fas fa-arrow-up" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="command-bar-button"
            :title="t('commandInputBar.findNext')"
            :aria-label="t('commandInputBar.findNext')"
            @click="emit('findSearchNext')"
          >
            <i class="fas fa-arrow-down" aria-hidden="true"></i>
          </button>
        </template>
        <template v-if="mobile">
          <button
            data-testid="mobile-docker-pane-toggle"
            type="button"
            class="command-bar-button"
            :class="{ 'is-active': dockerPaneActive }"
            :title="t('layout.pane.dockerManager')"
            :aria-label="t('layout.pane.dockerManager')"
            :aria-pressed="Boolean(dockerPaneActive)"
            @click="emit('toggleDockerPane')"
          >
            <i class="fab fa-docker" aria-hidden="true"></i>
          </button>
          <button
            v-if="nonTerminalPaneActive && !dockerPaneActive"
            data-testid="mobile-terminal-pane-return"
            type="button"
            class="command-bar-button"
            :title="t('layout.pane.terminal')"
            :aria-label="t('layout.pane.terminal')"
            @click="emit('returnToTerminal')"
          >
            <i class="fas fa-terminal" aria-hidden="true"></i>
          </button>
        </template>
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
          v-if="!terminalSearchOpen"
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
  .command-bar-root--mobile {
    flex: 0 0 auto;
    overflow-y: hidden;
  }
  .command-bar-root--mobile .command-bar-inner {
    padding-block: 0.25rem;
  }
  .command-bar-root--mobile .command-bar-button {
    width: 2rem;
    height: 2rem;
    min-width: 2rem;
    min-height: 2rem;
    flex-basis: 2rem;
  }

  .mobile-command-controls {
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .mobile-command-controls::-webkit-scrollbar {
    display: none;
  }

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
  .command-bar-button.is-active {
    border-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color));
    background: color-mix(in srgb, var(--primary-color) 20%, transparent);
    color: var(--primary-color);
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
