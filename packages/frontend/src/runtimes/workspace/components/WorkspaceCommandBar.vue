<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput } from '@/foundation/ui';
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
    }>(),
    { commandInputSyncTarget: 'none', quickCommandsGrouped: true, showFileManagerButton: false, ready: true },
  );
  const emit = defineEmits<{
    'update:modelValue': [value: string];
    send: [command: string, allSessions: boolean];
    clear: [];
    openFileManager: [];
    openEditor: [];
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
    class="flex h-full min-h-10 items-center gap-2 bg-background px-2"
    @submit.prevent="send()"
  >
    <BaseInput
      ref="commandInput"
      v-model="command"
      data-testid="command-input"
      class="min-w-0 flex-1"
      :placeholder="t('commandInputBar.placeholder')"
      :disabled="!ready"
      @keydown="handleKeydown"
      @beforeinput="handleBeforeInput"
      @blur="resetTargetSelection"
    />
    <BaseButton type="submit" size="sm" variant="primary" :disabled="!ready">{{ t('common.send') }}</BaseButton>
    <BaseButton type="button" size="sm" :disabled="!ready" @click="send(true)">{{ t('common.all') }}</BaseButton>
    <BaseButton
      v-if="showFileManagerButton"
      data-testid="open-file-manager-button"
      type="button"
      size="sm"
      variant="ghost"
      :title="t('layout.pane.fileManager')"
      @click="emit('openFileManager')"
      >📁</BaseButton
    >
    <BaseButton
      v-if="showEditorButton"
      type="button"
      size="sm"
      variant="ghost"
      :title="t('layout.pane.editor')"
      @click="emit('openEditor')"
      >✎</BaseButton
    >
    <BaseButton
      type="button"
      size="sm"
      variant="ghost"
      :title="t('commandInputBar.clearTerminal')"
      @click="emit('clear')"
      >⌫</BaseButton
    >
  </form>
</template>
