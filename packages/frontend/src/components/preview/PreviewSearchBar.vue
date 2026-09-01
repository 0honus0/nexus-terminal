<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(defineProps<{
  open: boolean;
  query: string;
  current: number;
  total: number;
  active?: boolean;
  busy?: boolean;
}>(), {
  active: true,
  busy: false,
});

const emit = defineEmits<{
  open: [];
  close: [];
  'update:query': [value: string];
  previous: [];
  next: [];
}>();

const { t } = useI18n();
const inputRef = ref<HTMLInputElement | null>(null);

const focus = () => {
  void nextTick(() => {
    inputRef.value?.focus({ preventScroll: true });
    inputRef.value?.select();
  });
};

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (!props.active) return;

  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    emit('open');
    focus();
    return;
  }

  if (props.open && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  }
};

const handleInputKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) emit('previous');
    else emit('next');
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
  }
};

watch(() => props.open, (open) => {
  if (open && props.active) focus();
});

watch(() => props.active, (active) => {
  if (active && props.open) focus();
});

onMounted(() => document.addEventListener('keydown', handleDocumentKeydown, true));
onBeforeUnmount(() => document.removeEventListener('keydown', handleDocumentKeydown, true));

defineExpose({ focus });
</script>

<template>
  <button
    v-if="!props.open"
    type="button"
    data-testid="preview-search-toggle"
    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border text-sm text-text-secondary transition hover:bg-border hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:h-8 sm:w-8"
    :aria-label="t('fileManager.preview.search', 'Search in document')"
    :title="t('fileManager.preview.search', 'Search in document')"
    @click="emit('open')"
  >
    <i class="fas fa-search" aria-hidden="true"></i>
  </button>

  <div
    v-else
    data-testid="preview-search-bar"
    class="flex h-9 min-w-0 max-w-[min(72vw,22rem)] items-center gap-1 rounded-md border border-border bg-background px-1.5 shadow-sm sm:h-8"
  >
    <i class="fas fa-search shrink-0 px-1 text-xs text-text-alt" aria-hidden="true"></i>
    <input
      ref="inputRef"
      data-testid="preview-search-input"
      type="search"
      :value="props.query"
      :placeholder="t('fileManager.preview.searchPlaceholder', 'Search document...')"
      class="h-full min-w-20 flex-1 bg-transparent px-1 text-sm text-foreground outline-none"
      @input="emit('update:query', ($event.currentTarget as HTMLInputElement).value)"
      @keydown="handleInputKeydown"
    />
    <span
      data-testid="preview-search-count"
      class="min-w-10 shrink-0 text-center text-[11px] tabular-nums text-text-alt"
      aria-live="polite"
    >
      <template v-if="props.busy">…</template>
      <template v-else-if="props.query.trim()">{{ props.total > 0 ? Math.max(1, props.current) : 0 }}/{{ props.total }}</template>
    </span>
    <button
      type="button"
      data-testid="preview-search-previous"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
      :disabled="props.busy || props.total === 0"
      :aria-label="t('fileManager.preview.searchPrevious', 'Previous match')"
      :title="t('fileManager.preview.searchPrevious', 'Previous match')"
      @click="emit('previous')"
    >
      <i class="fas fa-chevron-up" aria-hidden="true"></i>
    </button>
    <button
      type="button"
      data-testid="preview-search-next"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs text-text-secondary hover:bg-border hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
      :disabled="props.busy || props.total === 0"
      :aria-label="t('fileManager.preview.searchNext', 'Next match')"
      :title="t('fileManager.preview.searchNext', 'Next match')"
      @click="emit('next')"
    >
      <i class="fas fa-chevron-down" aria-hidden="true"></i>
    </button>
    <button
      type="button"
      data-testid="preview-search-close"
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-base text-text-secondary hover:bg-border hover:text-foreground"
      :aria-label="t('fileManager.preview.searchClose', 'Close search')"
      :title="t('fileManager.preview.searchClose', 'Close search')"
      @click="emit('close')"
    >
      ×
    </button>
  </div>
</template>
