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
  const sequence = applyVirtualKeyModifiers(keyDef.sequence);
  console.log(`[VirtualKeyboard] Sending key: ${JSON.stringify(sequence)}`);
  emit('send-key', sequence);
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

const modifierParameter = (): number => (
  1 + (props.altActive ? 2 : 0) + (props.ctrlActive ? 4 : 0)
);

// 为虚拟特殊键补充 xterm 修饰参数，支持 Ctrl、Alt 以及 Ctrl+Alt 组合。
const applyVirtualKeyModifiers = (sequence: string): string => {
  if (!props.ctrlActive && !props.altActive) return sequence;

  const modifier = modifierParameter();
  const tildeMatch = sequence.match(/^\x1b\[([0-9]+)~$/);
  if (tildeMatch) return `\x1b[${tildeMatch[1]};${modifier}~`;

  const cursorMatch = sequence.match(/^\x1b\[([ABCD])$/);
  if (cursorMatch) return `\x1b[1;${modifier}${cursorMatch[1]}`;

  // Ctrl+Tab 与 Ctrl+Esc 本身就是对应控制字符；Alt 再添加 ESC 前缀。
  if (sequence === '\t' || sequence === '\x1b') {
    return props.altActive ? `\x1b${sequence}` : sequence;
  }

  return props.altActive ? `\x1b${sequence}` : sequence;
};

// 第一排固定为常用修饰与控制键。
const primaryKeys: KeyDefinition[] = [
  { label: 'Ctrl', type: 'modifier', modifier: 'ctrl' },
  { label: 'Alt', type: 'modifier', modifier: 'alt' },
  { label: 'Tab', sequence: '\t', type: 'control' },
  { label: 'Esc', sequence: '\x1b', type: 'control' },
  { label: 'Del', sequence: '\x1b[3~', type: 'navigation' },
];

const navigationKeys: KeyDefinition[] = [
  { label: '↑', sequence: '\x1b[A', type: 'navigation' },
  { label: '↓', sequence: '\x1b[B', type: 'navigation' },
  { label: '←', sequence: '\x1b[D', type: 'navigation' },
  { label: '→', sequence: '\x1b[C', type: 'navigation' },
  { label: 'Home', sequence: '\x1b[1~', type: 'navigation' },
  { label: 'End', sequence: '\x1b[4~', type: 'navigation' },
  { label: 'PgUp', sequence: '\x1b[5~', type: 'navigation' },
  { label: 'PgDn', sequence: '\x1b[6~', type: 'navigation' },
  { label: 'Ins', sequence: '\x1b[2~', type: 'navigation' },
];

const functionKeys: KeyDefinition[] = [
  { label: 'F1', sequence: '\x1b[11~', type: 'special' }, { label: 'F2', sequence: '\x1b[12~', type: 'special' },
  { label: 'F3', sequence: '\x1b[13~', type: 'special' }, { label: 'F4', sequence: '\x1b[14~', type: 'special' },
  { label: 'F5', sequence: '\x1b[15~', type: 'special' }, { label: 'F6', sequence: '\x1b[17~', type: 'special' },
  { label: 'F7', sequence: '\x1b[18~', type: 'special' }, { label: 'F8', sequence: '\x1b[19~', type: 'special' },
  { label: 'F9', sequence: '\x1b[20~', type: 'special' }, { label: 'F10', sequence: '\x1b[21~', type: 'special' },
  { label: 'F11', sequence: '\x1b[23~', type: 'special' }, { label: 'F12', sequence: '\x1b[24~', type: 'special' },
];
</script>

<template>
  <div class="virtual-keyboard-bar bg-background border-t border-border">
    <div class="primary-key-row">
      <button
        v-for="keyDef in primaryKeys"
        :key="keyDef.label"
        type="button"
        class="virtual-key primary-key rounded border border-border bg-input text-foreground hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary transition-colors duration-150"
        :class="{
          'bg-primary text-primary-foreground hover:bg-primary/90':
            (keyDef.type === 'modifier' && keyDef.modifier === 'ctrl' && props.ctrlActive) ||
            (keyDef.type === 'modifier' && keyDef.modifier === 'alt' && props.altActive)
        }"
        :title="keyDef.label"
        @pointerdown.prevent
        @click="sendKey(keyDef)"
      >
        {{ keyDef.label }}
      </button>
    </div>

    <div class="navigation-key-row">
      <button
        v-for="keyDef in navigationKeys"
        :key="keyDef.label"
        type="button"
        class="virtual-key compact-key rounded border border-border bg-input text-foreground hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary transition-colors duration-150"
        :title="keyDef.label"
        @pointerdown.prevent
        @click="sendKey(keyDef)"
      >
        {{ keyDef.label }}
      </button>
    </div>

    <div class="function-key-row">
      <button
        v-for="keyDef in functionKeys"
        :key="keyDef.label"
        type="button"
        class="virtual-key function-key rounded border border-border bg-input text-foreground hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary transition-colors duration-150"
        :title="keyDef.label"
        @pointerdown.prevent
        @click="sendKey(keyDef)"
      >
        {{ keyDef.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.virtual-keyboard-bar {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.25rem;
  padding-bottom: max(0.25rem, env(safe-area-inset-bottom));
  overflow: hidden;
}

.primary-key-row,
.navigation-key-row,
.function-key-row {
  display: grid;
  gap: 2px;
  width: 100%;
}

.primary-key-row {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.navigation-key-row {
  grid-template-columns: repeat(9, minmax(0, 1fr));
}

.function-key-row {
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.virtual-key {
  text-align: center;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.primary-key,
.compact-key,
.function-key {
  min-width: 0;
  height: 1.8rem;
  padding: 0;
  line-height: 1;
}

.primary-key {
  font-size: 0.75rem;
}

.compact-key,
.function-key {
  font-size: clamp(0.55rem, 2.5vw, 0.7rem);
}

</style>
