<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { BaseButton } from '@/foundation/ui';
  import type { PathHistoryEntry } from '../model/catalog';

  defineProps<{
    visible: boolean;
    loading: boolean;
    items: PathHistoryEntry[];
    selectedIndex: number;
  }>();

  const emit = defineEmits<{
    select: [path: string];
    copy: [path: string];
    remove: [id: number];
  }>();

  const { t } = useI18n();
</script>

<template>
  <div
    v-if="visible"
    class="absolute inset-x-0 top-full z-40 mt-1 max-h-60 overflow-auto rounded border border-border bg-background p-1 shadow-xl"
    @mousedown.prevent
  >
    <p v-if="loading" class="p-2 text-center text-xs text-text-secondary">
      {{ t('pathHistory.loading') }}
    </p>
    <p v-else-if="!items.length" class="p-2 text-center text-xs text-text-secondary">
      {{ t('pathHistory.empty') }}
    </p>
    <div
      v-for="(item, index) in items"
      v-else
      :key="item.id"
      class="flex items-center gap-1 rounded px-2 py-1"
      :class="index === selectedIndex ? 'bg-primary/15' : 'hover:bg-header'"
    >
      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left font-mono text-sm"
        :title="item.path"
        @click="emit('select', item.path)"
      >
        {{ item.path }}
      </button>
      <BaseButton size="sm" variant="ghost" @click="emit('copy', item.path)">{{ t('pathHistory.copy') }}</BaseButton>
      <BaseButton size="sm" variant="ghost" @click="emit('remove', item.id)">{{ t('pathHistory.delete') }}</BaseButton>
    </div>
  </div>
</template>
