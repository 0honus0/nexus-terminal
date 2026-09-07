<script setup lang="ts">
  import { nextTick, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useDeviceCapabilities } from '@/foundation/browser/useDeviceCapabilities';
  import type { PathHistoryEntry } from '../model/catalog';

  const props = defineProps<{
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
  const device = useDeviceCapabilities();
  const itemRefs = ref<HTMLElement[]>([]);

  watch(
    () => [props.visible, props.selectedIndex] as const,
    async ([visible, selectedIndex]) => {
      if (!visible || selectedIndex < 0) return;
      await nextTick();
      itemRefs.value[selectedIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
  );
</script>

<template>
  <div
    v-if="visible"
    data-testid="path-history-dropdown"
    class="path-history-dropdown absolute right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border/50 bg-background text-sm shadow-lg"
    @mousedown.prevent
  >
    <div v-if="loading && !items.length" class="p-3 text-center text-text-secondary">
      <i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
      {{ t('pathHistory.loading') }}
    </div>
    <div v-else-if="!items.length" class="p-3 text-center text-text-secondary">
      <i class="fas fa-history mr-2" aria-hidden="true"></i>
      {{ t('pathHistory.empty') }}
    </div>
    <ul v-else class="m-0 list-none p-1">
      <li
        v-for="(item, index) in items"
        :key="item.id"
        :ref="(element) => element && (itemRefs[index] = element as HTMLElement)"
        class="group flex cursor-pointer items-start justify-between rounded-md px-3 py-1.5 transition-colors duration-150 hover:bg-primary/10"
        :class="index === selectedIndex ? 'bg-primary/20 font-medium' : ''"
        :title="item.path"
        @click="emit('select', item.path)"
      >
        <span class="path-history-path mr-2 min-w-0 flex-grow font-mono text-sm text-foreground">{{ item.path }}</span>
        <div
          class="flex shrink-0 items-center transition-opacity duration-150"
          :class="
            device.hasTouch.value ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          "
        >
          <button
            type="button"
            class="rounded p-1.5 text-text-secondary transition-colors duration-150 hover:bg-black/10 hover:text-primary"
            :title="t('pathHistory.copy')"
            :aria-label="t('pathHistory.copy')"
            @click.stop="emit('copy', item.path)"
          >
            <i class="fas fa-copy text-xs" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="ml-1 rounded p-1.5 text-text-secondary transition-colors duration-150 hover:bg-black/10 hover:text-error"
            :title="t('pathHistory.delete')"
            :aria-label="t('pathHistory.delete')"
            @click.stop="emit('remove', item.id)"
          >
            <i class="fas fa-times text-xs" aria-hidden="true"></i>
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
  .path-history-dropdown {
    width: min(34rem, calc(100cqw - 0.75rem));
    max-width: calc(100cqw - 0.75rem);
  }

  .path-history-path {
    overflow-wrap: anywhere;
    line-height: 1.35;
    white-space: normal;
  }
</style>
