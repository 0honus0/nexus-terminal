<script setup lang="ts">

const emit = defineEmits<{
  (e: 'send-key', keySequence: string): void;
  (e: 'toggle-modifier', modifier: 'ctrl' | 'alt'): void;
}>();

const props = defineProps<{
  ctrlActive?: boolean;
  altActive?: boolean;
}>();

const sendKey = (keyDef: KeyDefinition) => {
  if (keyDef.type === 'modifier') {
    emit('toggle-modifier', keyDef.modifier);
    return;
  }
  console.log(`[VirtualKeyboard] Sending key: ${JSON.stringify(keyDef.sequence)}`);
  emit('send-key', keyDef.sequence);
};

// +++ Define key structure +++
type KeyDefinition = {
  label: string;
  sequence: string;
  type: 'control' | 'navigation' | 'special';
} | {
  label: 'Ctrl' | 'Alt';
  type: 'modifier';
  modifier: 'ctrl' | 'alt';
};

// 仅保留手机系统键盘通常没有的终端控制键。
const keys: KeyDefinition[] = [
  { label: 'Ctrl', type: 'modifier', modifier: 'ctrl' },
  { label: 'Alt', type: 'modifier', modifier: 'alt' },
  // Terminal controls
  { label: 'Tab', sequence: '\t', type: 'control' },
  { label: 'Esc', sequence: '\x1b', type: 'control' },
  { label: 'Ctrl+C', sequence: '\x03', type: 'control' },
  { label: 'Ctrl+D', sequence: '\x04', type: 'control' },
  { label: 'Ctrl+Z', sequence: '\x1a', type: 'control' },
  { label: 'Ctrl+L', sequence: '\x0c', type: 'control' },
  { label: 'Ctrl+R', sequence: '\x12', type: 'control' },
  // Navigation
  { label: '↑', sequence: '\x1b[A', type: 'navigation' },
  { label: '↓', sequence: '\x1b[B', type: 'navigation' },
  { label: '←', sequence: '\x1b[D', type: 'navigation' },
  { label: '→', sequence: '\x1b[C', type: 'navigation' },
  { label: 'Home', sequence: '\x1b[1~', type: 'navigation' },
  { label: 'End', sequence: '\x1b[4~', type: 'navigation' },
  { label: 'PgUp', sequence: '\x1b[5~', type: 'navigation' },
  { label: 'PgDn', sequence: '\x1b[6~', type: 'navigation' },
  { label: 'Ins', sequence: '\x1b[2~', type: 'navigation' },
  { label: 'Del', sequence: '\x1b[3~', type: 'navigation' },
  // Function keys
  { label: 'F1', sequence: '\x1b[11~', type: 'special' }, { label: 'F2', sequence: '\x1b[12~', type: 'special' },
  { label: 'F3', sequence: '\x1b[13~', type: 'special' }, { label: 'F4', sequence: '\x1b[14~', type: 'special' },
  { label: 'F5', sequence: '\x1b[15~', type: 'special' }, { label: 'F6', sequence: '\x1b[17~', type: 'special' },
  { label: 'F7', sequence: '\x1b[18~', type: 'special' }, { label: 'F8', sequence: '\x1b[19~', type: 'special' },
  { label: 'F9', sequence: '\x1b[20~', type: 'special' }, { label: 'F10', sequence: '\x1b[21~', type: 'special' },
  { label: 'F11', sequence: '\x1b[23~', type: 'special' }, { label: 'F12', sequence: '\x1b[24~', type: 'special' },
];
</script>

<template>
  <!-- +++ Updated template loop and bindings +++ -->
  <div class="virtual-keyboard-bar flex flex-wrap items-center justify-center gap-1 p-1 bg-background border-t border-border">
    <button
      v-for="keyDef in keys"
      :key="keyDef.label"
      @click="sendKey(keyDef)"
      class="px-2.5 py-1.5 rounded border border-border bg-input text-foreground text-xs hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary transition-colors duration-150"
      :class="{
        'bg-primary text-primary-foreground hover:bg-primary/90':
          (keyDef.type === 'modifier' && keyDef.modifier === 'ctrl' && props.ctrlActive) ||
          (keyDef.type === 'modifier' && keyDef.modifier === 'alt' && props.altActive)
      }"
      :title="keyDef.label"
    >
      {{ keyDef.label }}
    </button>
  </div>
</template>

<style scoped>
.virtual-keyboard-bar {
  max-height: 8rem;
  overflow-y: auto;
}

button {
  min-width: 40px; /* Ensure tappable area */
  text-align: center;
}

</style>
