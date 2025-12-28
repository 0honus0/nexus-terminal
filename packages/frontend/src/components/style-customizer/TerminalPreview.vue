<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue';
import { Terminal } from 'xterm';
import { useAppearanceStore } from '../../stores/appearance.store';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import 'xterm/css/xterm.css';

const props = defineProps<{
  width?: string;
  height?: string;
}>();

const { t } = useI18n();
const appearanceStore = useAppearanceStore();
const {
  effectiveTerminalTheme,
  currentTerminalFontFamily,
  currentTerminalFontSize,
  terminalTextStrokeEnabled,
  terminalTextStrokeWidth,
  terminalTextStrokeColor,
  terminalTextShadowEnabled,
  terminalTextShadowOffsetX,
  terminalTextShadowOffsetY,
  terminalTextShadowBlur,
  terminalTextShadowColor,
} = storeToRefs(appearanceStore);

const terminalRef = ref<HTMLElement | null>(null);
const terminalInstance = ref<Terminal | null>(null);
const currentPreviewMode = ref<'command' | 'code' | 'text'>('command');

// 预览内容模式
type PreviewMode = 'command' | 'code' | 'text';

const previewContents: Record<PreviewMode, string[]> = {
  command: [
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ ls -la',
    'total 48',
    'drwxr-xr-x  6 user  staff   192 Dec 28 10:30 \x1b[1;34m.\x1b[0m',
    'drwxr-xr-x  3 root  wheel    96 Dec 27 09:15 \x1b[1;34m..\x1b[0m',
    '-rw-r--r--  1 user  staff  2145 Dec 28 10:30 \x1b[0;32mpackage.json\x1b[0m',
    '-rw-r--r--  1 user  staff  5892 Dec 28 10:30 \x1b[0;32mREADME.md\x1b[0m',
    'drwxr-xr-x  8 user  staff   256 Dec 28 10:30 \x1b[1;34msrc\x1b[0m',
    '-rw-r--r--  1 user  staff  1024 Dec 28 10:30 \x1b[0;33mconfig.yml\x1b[0m',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ cat example.txt',
    '\x1b[1;33mHello, World!\x1b[0m',
    '\x1b[1;36mThis is a terminal preview.\x1b[0m',
    '\x1b[1;35mColors: \x1b[31mRed \x1b[32mGreen \x1b[33mYellow \x1b[34mBlue \x1b[35mMagenta \x1b[36mCyan\x1b[0m',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
  ],
  code: [
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~/project\x1b[0m$ cat app.js',
    "\x1b[0;33mconst\x1b[0m \x1b[0;36mexpress\x1b[0m = \x1b[0;35mrequire\x1b[0m(\x1b[0;32m'express'\x1b[0m);",
    '\x1b[0;33mconst\x1b[0m \x1b[0;36mapp\x1b[0m = \x1b[0;35mexpress\x1b[0m();',
    '',
    '\x1b[90m// 定义路由\x1b[0m',
    "app.\x1b[0;33mget\x1b[0m(\x1b[0;32m'/'\x1b[0m, (req, res) => {",
    "  res.\x1b[0;33msend\x1b[0m(\x1b[0;32m'Hello World!'\x1b[0m);",
    '});',
    '',
    '\x1b[90m// 启动服务器\x1b[0m',
    'app.\x1b[0;33mlisten\x1b[0m(\x1b[0;35m3000\x1b[0m, () => {',
    "  console.\x1b[0;33mlog\x1b[0m(\x1b[0;32m'Server running on port 3000'\x1b[0m);",
    '});',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~/project\x1b[0m$ ',
  ],
  text: [
    '\x1b[1;36m╔═══════════════════════════════════════╗\x1b[0m',
    '\x1b[1;36m║\x1b[0m   \x1b[1;33mNexus Terminal Preview\x1b[0m           \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╠═══════════════════════════════════════╣\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Font Family: \x1b[0;37mCustomizable\x1b[0m     \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Font Size: \x1b[0;37mAdjustable\x1b[0m         \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Text Stroke: \x1b[0;37mSupported\x1b[0m        \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Text Shadow: \x1b[0;37mSupported\x1b[0m        \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Color Themes: \x1b[0;37mMultiple\x1b[0m        \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╠═══════════════════════════════════════╣\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;35mSupported Colors:\x1b[0m                 \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m    \x1b[0;31m●\x1b[0m Red    \x1b[0;32m●\x1b[0m Green   \x1b[0;33m●\x1b[0m Yellow  \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m    \x1b[0;34m●\x1b[0m Blue   \x1b[0;35m●\x1b[0m Magenta \x1b[0;36m●\x1b[0m Cyan    \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╚═══════════════════════════════════════╝\x1b[0m',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
  ],
};

// 初始化终端实例
const initTerminal = async () => {
  if (!terminalRef.value || terminalInstance.value) return;

  await nextTick();

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: currentTerminalFontSize.value,
    fontFamily: currentTerminalFontFamily.value,
    theme: effectiveTerminalTheme.value,
    allowProposedApi: true,
    rows: 15,
    cols: 80,
    disableStdin: true,
  });

  terminal.open(terminalRef.value);
  terminalInstance.value = terminal;

  // 应用描边和阴影样式
  applyTextStyles();

  // 写入预览内容
  writePreviewContent();
};

// 应用文字描边和阴影样式
const applyTextStyles = () => {
  if (!terminalRef.value) return;

  const canvas = terminalRef.value.querySelector('canvas');
  if (!canvas) return;

  // 直接设置样式属性，避免累积
  if (terminalTextStrokeEnabled.value) {
    canvas.style.webkitTextStroke = `${terminalTextStrokeWidth.value}px ${terminalTextStrokeColor.value}`;
  } else {
    canvas.style.webkitTextStroke = '';
  }

  if (terminalTextShadowEnabled.value) {
    canvas.style.textShadow = `${terminalTextShadowOffsetX.value}px ${terminalTextShadowOffsetY.value}px ${terminalTextShadowBlur.value}px ${terminalTextShadowColor.value}`;
  } else {
    canvas.style.textShadow = '';
  }
};

// 写入预览内容
const writePreviewContent = () => {
  if (!terminalInstance.value) return;

  terminalInstance.value.clear();
  const content = previewContents[currentPreviewMode.value];
  content.forEach((line) => {
    terminalInstance.value?.writeln(line);
  });
};

// 切换预览模式
const switchPreviewMode = (mode: PreviewMode) => {
  currentPreviewMode.value = mode;
  writePreviewContent();
};

// 性能优化：防抖更新终端配置
let updateTimeoutId: number | null = null;
const debouncedUpdateTerminal = () => {
  if (updateTimeoutId !== null) {
    clearTimeout(updateTimeoutId);
  }

  updateTimeoutId = window.setTimeout(() => {
    updateTerminalOptions();
    updateTimeoutId = null;
  }, 150); // 150ms 防抖
};

// 更新终端配置
const updateTerminalOptions = () => {
  if (!terminalInstance.value) return;

  // 使用 requestAnimationFrame 优化渲染性能
  requestAnimationFrame(() => {
    if (!terminalInstance.value) return;

    terminalInstance.value.options.fontSize = currentTerminalFontSize.value;
    terminalInstance.value.options.fontFamily = currentTerminalFontFamily.value;
    terminalInstance.value.options.theme = effectiveTerminalTheme.value;

    applyTextStyles();
  });
};

// 监听配置变化（使用防抖优化）
watch(
  [
    currentTerminalFontFamily,
    currentTerminalFontSize,
    effectiveTerminalTheme,
    terminalTextStrokeEnabled,
    terminalTextStrokeWidth,
    terminalTextStrokeColor,
    terminalTextShadowEnabled,
    terminalTextShadowOffsetX,
    terminalTextShadowOffsetY,
    terminalTextShadowBlur,
    terminalTextShadowColor,
  ],
  () => {
    debouncedUpdateTerminal();
  },
  { deep: true }
);

onMounted(() => {
  initTerminal();
});

onBeforeUnmount(() => {
  if (updateTimeoutId !== null) {
    clearTimeout(updateTimeoutId);
  }
  if (terminalInstance.value) {
    terminalInstance.value.dispose();
    terminalInstance.value = null;
  }
});

const containerStyle = computed(() => ({
  width: props.width || '100%',
  height: props.height || '400px',
}));

const previewModeButtons = computed(() => [
  { key: 'command' as PreviewMode, label: t('styleCustomizer.previewModeCommand', '命令输出') },
  { key: 'code' as PreviewMode, label: t('styleCustomizer.previewModeCode', '代码高亮') },
  { key: 'text' as PreviewMode, label: t('styleCustomizer.previewModeText', '文本样式') },
]);
</script>

<template>
  <div class="terminal-preview-wrapper" :style="containerStyle">
    <div class="terminal-preview-header">
      <span class="terminal-preview-title">{{ $t('styleCustomizer.preview') || '预览' }}</span>
      <div class="terminal-preview-controls">
        <span class="terminal-preview-dot terminal-preview-dot-red"></span>
        <span class="terminal-preview-dot terminal-preview-dot-yellow"></span>
        <span class="terminal-preview-dot terminal-preview-dot-green"></span>
      </div>
    </div>

    <!-- 预览模式切换按钮 -->
    <div class="terminal-preview-mode-switcher">
      <button
        v-for="mode in previewModeButtons"
        :key="mode.key"
        @click="switchPreviewMode(mode.key)"
        :class="['preview-mode-btn', { active: currentPreviewMode === mode.key }]"
        :title="mode.label"
      >
        {{ mode.label }}
      </button>
    </div>

    <div ref="terminalRef" class="terminal-preview-content"></div>
  </div>
</template>

<style scoped>
.terminal-preview-wrapper {
  border: 1px solid var(--terminal-border-color, #374151);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--terminal-preview-bg, #1a1b1e);
}

.terminal-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background-color: var(--terminal-header-bg, #2d2e33);
  border-bottom: 1px solid var(--terminal-border-color, #374151);
}

.terminal-preview-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--terminal-header-text, #e5e7eb);
}

.terminal-preview-controls {
  display: flex;
  gap: 6px;
}

.terminal-preview-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.terminal-preview-dot-red {
  background-color: #ef4444;
}

.terminal-preview-dot-yellow {
  background-color: #f59e0b;
}

.terminal-preview-dot-green {
  background-color: #10b981;
}

.terminal-preview-mode-switcher {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  background-color: var(--terminal-mode-switcher-bg, #25262b);
  border-bottom: 1px solid var(--terminal-border-color, #374151);
  overflow-x: auto;
}

.preview-mode-btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--terminal-border-color, #374151);
  border-radius: 4px;
  background-color: var(--terminal-btn-bg, #2d2e33);
  color: var(--terminal-btn-text, #9ca3af);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.preview-mode-btn:hover {
  background-color: var(--terminal-btn-hover-bg, #3d3e43);
  border-color: var(--terminal-btn-hover-border, #4b5563);
}

.preview-mode-btn.active {
  background-color: var(--primary, #6366f1);
  border-color: var(--primary, #6366f1);
  color: #ffffff;
  font-weight: 500;
}

.terminal-preview-content {
  height: calc(100% - 37px - 41px);
  padding: 8px;
  overflow: hidden;
}

.terminal-preview-content :deep(.xterm) {
  height: 100%;
}

.terminal-preview-content :deep(.xterm .xterm-viewport) {
  overflow-y: auto !important;
}

/* 移动端优化 */
@media (max-width: 768px) {
  .terminal-preview-mode-switcher {
    padding: 6px 8px;
  }

  .preview-mode-btn {
    padding: 3px 8px;
    font-size: 11px;
  }
}
</style>
