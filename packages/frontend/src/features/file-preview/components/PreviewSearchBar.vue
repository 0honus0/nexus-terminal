<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput } from '@/foundation/ui';

  const props = withDefaults(
    defineProps<{
      open: boolean;
      query: string;
      current: number;
      total: number;
      active?: boolean;
      busy?: boolean;
    }>(),
    { active: true, busy: false },
  );
  const emit = defineEmits<{
    open: [];
    close: [];
    'update:query': [value: string];
    previous: [];
    next: [];
  }>();
  const { t } = useI18n();
  const input = ref<{ focus?: () => void } | null>(null);

  const focus = () => void nextTick(() => input.value?.focus?.());
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
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      emit('close');
    }
  };

  watch(
    () => props.open,
    (open) => {
      if (open && props.active) focus();
    },
  );
  watch(
    () => props.active,
    (active) => {
      if (active && props.open) focus();
    },
  );
  onMounted(() => document.addEventListener('keydown', handleDocumentKeydown, true));
  onBeforeUnmount(() => document.removeEventListener('keydown', handleDocumentKeydown, true));
</script>

<template>
  <BaseButton
    v-if="!open"
    class="min-h-11 min-w-11 shrink-0 sm:min-h-0 sm:min-w-0"
    size="sm"
    variant="ghost"
    :title="t('fileManager.preview.search')"
    @click="emit('open')"
  >
    ⌕
  </BaseButton>
  <div
    v-else
    class="flex min-w-0 max-w-[min(72vw,22rem)] items-center gap-1 rounded border border-border bg-background px-1"
  >
    <BaseInput
      ref="input"
      class="min-w-20 flex-1 border-0 px-1 py-1"
      type="search"
      :model-value="query"
      :placeholder="t('fileManager.preview.searchPlaceholder')"
      @update:model-value="emit('update:query', String($event ?? ''))"
      @keydown="handleInputKeydown"
    />
    <span class="min-w-10 text-center text-[11px] tabular-nums text-text-secondary">
      <template v-if="busy">…</template>
      <template v-else-if="query.trim()">{{ total > 0 ? Math.max(1, current) : 0 }}/{{ total }}</template>
    </span>
    <BaseButton size="sm" variant="ghost" :disabled="busy || total === 0" @click="emit('previous')">↑</BaseButton>
    <BaseButton size="sm" variant="ghost" :disabled="busy || total === 0" @click="emit('next')">↓</BaseButton>
    <BaseButton size="sm" variant="ghost" :title="t('fileManager.preview.searchClose')" @click="emit('close')"
      >×</BaseButton
    >
  </div>
</template>
