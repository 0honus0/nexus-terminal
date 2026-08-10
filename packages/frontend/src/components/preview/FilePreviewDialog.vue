<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FileListItem } from '../../types/sftp.types';

const props = defineProps<{
  file: FileListItem;
  subtitle?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useI18n();
const dialogRef = ref<HTMLElement | null>(null);
let previouslyFocusedElement: HTMLElement | null = null;

const close = () => emit('close');

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
};

onMounted(() => {
  previouslyFocusedElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  document.addEventListener('keydown', handleKeydown);
  void nextTick(() => dialogRef.value?.focus());
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
  previouslyFocusedElement?.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="dialogRef"
      class="fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 p-3 md:p-6 outline-none"
      role="dialog"
      aria-modal="true"
      :aria-label="props.file.filename"
      tabindex="-1"
      @click.self="close"
    >
      <section class="flex h-full max-h-[94vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-border bg-header px-4 py-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium" :title="props.file.filename">{{ props.file.filename }}</div>
            <div v-if="props.subtitle" class="truncate text-xs text-text-secondary">{{ props.subtitle }}</div>
          </div>
          <slot name="toolbar" />
          <button
            type="button"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-xl leading-none text-text-secondary hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            :aria-label="t('fileManager.preview.close', 'Close preview')"
            @click="close"
          >
            ×
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-auto">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>
