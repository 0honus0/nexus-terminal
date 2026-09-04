<script setup lang="ts">
  import { BaseButton } from '@/foundation/ui';

  const props = withDefaults(defineProps<{ ctrlActive?: boolean; altActive?: boolean }>(), {
    ctrlActive: false,
    altActive: false,
  });
  const emit = defineEmits<{ input: [value: string]; toggleModifier: [modifier: 'ctrl' | 'alt'] }>();

  type KeyDefinition =
    | { label: string; sequence: string; modifiedSequence?: string }
    | { label: 'Ctrl' | 'Alt'; modifier: 'ctrl' | 'alt' };

  const send = (key: KeyDefinition) => {
    if ('modifier' in key) {
      emit('toggleModifier', key.modifier);
      return;
    }
    const base = (props.ctrlActive || props.altActive) && key.modifiedSequence ? key.modifiedSequence : key.sequence;
    emit('input', base);
  };

  const primary: KeyDefinition[] = [
    { label: 'Ctrl', modifier: 'ctrl' },
    { label: 'Alt', modifier: 'alt' },
    { label: 'Tab', sequence: '\t' },
    { label: 'Esc', sequence: '\x1b' },
    { label: 'Del', sequence: '\x7f', modifiedSequence: '\x1b[3~' },
  ];
  const rows: KeyDefinition[][] = [
    [
      { label: 'Home', sequence: '\x1b[1~' },
      { label: 'End', sequence: '\x1b[4~' },
      { label: 'PgUp', sequence: '\x1b[5~' },
      { label: 'PgDn', sequence: '\x1b[6~' },
      { label: 'Ins', sequence: '\x1b[2~' },
      { label: '↑', sequence: '\x1b[A' },
      { label: 'F1', sequence: '\x1b[11~' },
    ],
    [
      { label: 'F2', sequence: '\x1b[12~' },
      { label: 'F3', sequence: '\x1b[13~' },
      { label: 'F4', sequence: '\x1b[14~' },
      { label: 'F5', sequence: '\x1b[15~' },
      { label: '←', sequence: '\x1b[D' },
      { label: '↓', sequence: '\x1b[B' },
      { label: '→', sequence: '\x1b[C' },
    ],
    [
      { label: 'F6', sequence: '\x1b[17~' },
      { label: 'F7', sequence: '\x1b[18~' },
      { label: 'F8', sequence: '\x1b[19~' },
      { label: 'F9', sequence: '\x1b[20~' },
      { label: 'F10', sequence: '\x1b[21~' },
      { label: 'F11', sequence: '\x1b[23~' },
      { label: 'F12', sequence: '\x1b[24~' },
    ],
  ];
</script>

<template>
  <div class="mobile-virtual-keyboard virtual-keyboard-bar border-t border-border bg-background">
    <div class="primary-row">
      <BaseButton
        v-for="key in primary"
        :key="key.label"
        size="sm"
        :variant="
          'modifier' in key &&
          ((key.modifier === 'ctrl' && props.ctrlActive) || (key.modifier === 'alt' && props.altActive))
            ? 'primary'
            : 'ghost'
        "
        @pointerdown.prevent
        @click="send(key)"
        >{{ key.label }}</BaseButton
      >
    </div>
    <div v-for="(row, index) in rows" :key="index" class="secondary-row">
      <BaseButton
        v-for="key in row"
        :key="key.label"
        size="sm"
        variant="ghost"
        @pointerdown.prevent
        @click="send(key)"
        >{{ key.label }}</BaseButton
      >
    </div>
  </div>
</template>

<style scoped>
  .virtual-keyboard-bar {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.25rem;
    padding-bottom: max(0.25rem, env(safe-area-inset-bottom));
  }
  .primary-row,
  .secondary-row {
    display: grid;
    gap: 2px;
  }
  .primary-row {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .secondary-row {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
  :deep(button) {
    min-width: 0;
    min-height: 1.8rem;
    padding-inline: 0.15rem;
    font-size: clamp(0.55rem, 2.5vw, 0.75rem);
    touch-action: manipulation;
  }
</style>
