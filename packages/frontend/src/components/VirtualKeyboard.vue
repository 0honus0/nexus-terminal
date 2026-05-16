<template>
  <div class="virtual-keyboard-sticky bg-background border-t border-border p-1 pb-2 select-none">
    <!-- Row 1: 修饰键 + 功能键 -->
    <div class="flex flex-wrap gap-1 px-2 pb-1.5 items-center">
      <button
        v-for="key in row1Keys"
        :key="key.label"
        @click="handleKeyClick(key)"
        class="min-w-[2.75rem] h-9 px-1.5 rounded font-medium text-xs border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
        :class="{ 'bg-primary text-white': isActiveModifier(key.label) }"
      >
        {{ key.label }}
      </button>
    </div>
    <!-- Row 2: 导航键 + F1-F3 -->
    <div class="flex flex-wrap gap-1 px-2 pb-1.5 items-center">
      <button
        v-for="key in row2Keys"
        :key="key.label"
        @click="handleKeyClick(key)"
        class="min-w-[2.75rem] h-9 px-1.5 rounded font-medium text-xs border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
      >
        {{ key.label }}
      </button>
    </div>
    <!-- Row 3: F4-F11 -->
    <div class="flex flex-wrap gap-1 px-2 pb-1.5 items-center">
      <button
        v-for="key in row3Keys"
        :key="key.label"
        @click="handleKeyClick(key)"
        class="min-w-[2.75rem] h-9 px-1.5 rounded font-medium text-xs border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
      >
        {{ key.label }}
      </button>
    </div>
    <!-- Row 4: F12 + A-H -->
    <div class="flex flex-wrap gap-1 px-2 pb-1 items-center">
      <button
        v-for="letter in row4Keys"
        :key="letter"
        @click="handleLetterClick(letter)"
        class="w-8 h-8 rounded font-medium text-xs border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
        :class="{
          'bg-primary text-white': isCtrlActive || isAltActive,
          'border-primary/50': isCtrlActive || isAltActive,
        }"
      >
        {{ letter }}
      </button>
    </div>
    <!-- Row 5: I-Q -->
    <div class="flex flex-wrap gap-1 px-2 pb-1 items-center">
      <button
        v-for="letter in row5Letters"
        :key="letter"
        @click="handleLetterClick(letter)"
        class="w-8 h-8 rounded font-medium text-xs border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
        :class="{
          'bg-primary text-white': isCtrlActive || isAltActive,
          'border-primary/50': isCtrlActive || isAltActive,
        }"
      >
        {{ letter }}
      </button>
    </div>
    <!-- Row 6: R-Z -->
    <div class="flex flex-wrap gap-1 px-2 items-center">
      <button
        v-for="letter in row6Letters"
        :key="letter"
        @click="handleLetterClick(letter)"
        class="w-8 h-8 rounded font-medium text-xs border border-border bg-input text-foreground active:bg-primary active:text-white transition-colors select-none flex items-center justify-center touch-manipulation"
        :class="{
          'bg-primary text-white': isCtrlActive || isAltActive,
          'border-primary/50': isCtrlActive || isAltActive,
        }"
      >
        {{ letter }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'send-key', sequence: string): void;
}>();

const isCtrlActive = ref(false);
const isAltActive = ref(false);

interface KeyDef {
  label: string;
  sequence?: string;
  isModifier?: boolean;
}

// Row 1: Ctrl, Alt, Tab, Esc, ↑, ↓, ←, →
const row1Keys: KeyDef[] = [
  { label: 'Ctrl', isModifier: true },
  { label: 'Alt', isModifier: true },
  { label: 'Tab', sequence: '\t' },
  { label: 'Esc', sequence: '\x1b' },
  { label: '↑', sequence: '\x1b[A' },
  { label: '↓', sequence: '\x1b[B' },
  { label: '←', sequence: '\x1b[D' },
  { label: '→', sequence: '\x1b[C' },
];

// Row 2: Home, End, PgUp, PgDn, F1, F2, F3
const row2Keys: KeyDef[] = [
  { label: 'Home', sequence: '\x1b[H' },
  { label: 'End', sequence: '\x1b[F' },
  { label: 'PgUp', sequence: '\x1b[5~' },
  { label: 'PgDn', sequence: '\x1b[6~' },
  { label: 'F1', sequence: '\x1bOP' },
  { label: 'F2', sequence: '\x1bOQ' },
  { label: 'F3', sequence: '\x1bOR' },
];

// Row 3: F4-F11
const row3Keys: KeyDef[] = [
  { label: 'F4', sequence: '\x1bOS' },
  { label: 'F5', sequence: '\x1b[15~' },
  { label: 'F6', sequence: '\x1b[17~' },
  { label: 'F7', sequence: '\x1b[18~' },
  { label: 'F8', sequence: '\x1b[19~' },
  { label: 'F9', sequence: '\x1b[20~' },
  { label: 'F10', sequence: '\x1b[21~' },
  { label: 'F11', sequence: '\x1b[23~' },
];

// Row 4: F12 + A-H (F12 是功能键，其余是字母键)
const row4Keys = ['F12', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const F12_SEQUENCE = '\x1b[24~';

// Row 5: I-Q
const row5Letters = ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];

// Row 6: R-Z
const row6Letters = ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const isActiveModifier = (label: string) => {
  if (label === 'Ctrl') return isCtrlActive.value;
  if (label === 'Alt') return isAltActive.value;
  return false;
};

/**
 * 处理功能键点击
 */
const handleKeyClick = (key: KeyDef) => {
  if (key.isModifier) {
    if (key.label === 'Ctrl') isCtrlActive.value = !isCtrlActive.value;
    if (key.label === 'Alt') isAltActive.value = !isAltActive.value;
    return;
  }

  let sequence = key.sequence || key.label;

  // 应用 Alt 修饰符
  if (isAltActive.value) {
    sequence = '\x1b' + sequence;
  }

  emit('send-key', sequence);

  // 自动释放修饰键
  isCtrlActive.value = false;
  isAltActive.value = false;
};

/**
 * 处理字母键 / F12 点击
 */
const handleLetterClick = (letter: string) => {
  let sequence: string;

  if (letter === 'F12') {
    sequence = F12_SEQUENCE;
  } else if (isCtrlActive.value) {
    // Ctrl+字母：发送 ASCII 控制字符（Ctrl+A=0x01, Ctrl+C=0x03, ..., Ctrl+Z=0x1A）
    sequence = getCtrlSequence(letter);
  } else if (isAltActive.value) {
    // Alt+字母：发送 ESC + 字母
    sequence = '\x1b' + letter.toLowerCase();
  } else {
    // 普通字母：直接发送小写
    sequence = letter.toLowerCase();
  }

  emit('send-key', sequence);

  // 自动释放修饰键
  isCtrlActive.value = false;
  isAltActive.value = false;
};

/**
 * 获取 Ctrl+字符的控制序列
 * Ctrl+A=0x01, Ctrl+B=0x02, ..., Ctrl+Z=0x1A
 */
const getCtrlSequence = (char: string): string => {
  const upper = char.toUpperCase();
  const code = upper.charCodeAt(0);
  // A=65 -> 1, B=66 -> 2, ..., Z=90 -> 26
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(code - 64);
  }
  // 非字母字符原样返回
  return char;
};
</script>

<style scoped>
.touch-manipulation {
  touch-action: manipulation;
}
</style>
