<script setup lang="ts">
import { PropType } from 'vue';
import { useLayoutStore, type PaneName } from '../stores/layout.store';
import { log } from '@/utils/log';

// --- Props ---
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  paneName: {
    type: String as PropType<PaneName>,
    required: true,
  },
});

// --- Setup ---
const layoutStore = useLayoutStore();

// --- Methods ---
const closePane = () => {
  log.info(`[PaneTitleBar] Requesting to close pane: ${props.paneName}`);
};
</script>

<template>
  <div class="pane-title-bar">
    <span class="title">{{ title }}</span>
    <button class="close-button" @click="closePane" :title="`关闭 ${title}`">&times;</button>
  </div>
</template>

<style scoped>
.pane-title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px; /* 调整内边距使标题栏更紧凑 */
  background-color: var(--editor-header-bg-color); /* 标题栏背景色，使用编辑器主题变量 */
  border-bottom: 1px solid var(--editor-border-color); /* 底部边框 */
  height: 28px; /* 固定标题栏高度 */
  box-sizing: border-box;
  flex-shrink: 0; /* 防止标题栏被压缩 */
}

.title {
  font-size: 0.85em; /* 稍小字体 */
  font-weight: 600;
  color: var(--editor-text-color); /* 标题颜色 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.close-button {
  background: none;
  border: none;
  color: var(--editor-text-muted-color); /* 关闭按钮颜色 */
  cursor: pointer;
  font-size: 1.2em; /* 稍大图标 */
  line-height: 1;
  padding: 0 4px; /* 微调内边距 */
  border-radius: 3px;
}

.close-button:hover {
  background-color: var(--status-error); /* 悬停时背景变红 */
  color: var(--status-error-text); /* 悬停时图标变白 */
}
</style>
