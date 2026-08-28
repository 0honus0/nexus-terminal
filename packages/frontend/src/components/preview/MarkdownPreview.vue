<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';
import FilePreviewDialog from './FilePreviewDialog.vue';

const props = withDefaults(defineProps<{
  file: FileListItem;
  html: string;
  active?: boolean;
}>(), {
  active: true,
});

const emit = defineEmits<{
  close: [];
  edit: [];
}>();

const { t } = useI18n();
</script>

<template>
  <FilePreviewDialog
    :file="props.file"
    :subtitle="t('fileManager.preview.markdown', 'Markdown')"
    :active="props.active"
    @close="emit('close')"
  >
    <template #toolbar>
      <button
        type="button"
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        @click="emit('edit')"
      >
        <i class="fas fa-pen" aria-hidden="true"></i>
        <span>{{ t('fileManager.actions.edit', 'Edit') }}</span>
      </button>
    </template>
    <article class="markdown-preview mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-8" v-html="props.html"></article>
  </FilePreviewDialog>
</template>

<style scoped>
.markdown-preview {
  line-height: 1.72;
  overflow-wrap: anywhere;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  margin-top: 1.4em;
  margin-bottom: 0.65em;
  font-weight: 650;
  line-height: 1.25;
}

.markdown-preview :deep(h1) { font-size: 2rem; }
.markdown-preview :deep(h2) { font-size: 1.55rem; border-bottom: 1px solid var(--color-border); padding-bottom: 0.35rem; }
.markdown-preview :deep(h3) { font-size: 1.25rem; }
.markdown-preview :deep(p),
.markdown-preview :deep(ul),
.markdown-preview :deep(ol),
.markdown-preview :deep(blockquote),
.markdown-preview :deep(pre),
.markdown-preview :deep(table) {
  margin: 0.85rem 0;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  padding-left: 1.65rem;
}

.markdown-preview :deep(a) {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-preview :deep(code) {
  border-radius: 0.3rem;
  background: color-mix(in srgb, var(--color-foreground) 8%, transparent);
  padding: 0.12rem 0.3rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
}

.markdown-preview :deep(pre) {
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--color-foreground) 6%, transparent);
  padding: 1rem;
}

.markdown-preview :deep(pre code) {
  background: transparent;
  padding: 0;
}

.markdown-preview :deep(blockquote) {
  border-left: 3px solid var(--color-border);
  padding-left: 1rem;
  color: var(--color-text-secondary);
}

.markdown-preview :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.45rem 0.7rem;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: var(--color-header);
}

.markdown-preview :deep(hr) {
  margin: 1.5rem 0;
  border: 0;
  border-top: 1px solid var(--color-border);
}
</style>
