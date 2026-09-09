<script setup lang="ts">
  import { nextTick, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu } from '@/foundation/ui';
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
  const itemRefs = ref<HTMLElement[]>([]);
  const context = ref<{ item: PathHistoryEntry; x: number; y: number } | null>(null);

  const openContext = (event: MouseEvent, item: PathHistoryEntry) => {
    context.value = { item, x: event.clientX, y: event.clientY };
  };
  const copyContextPath = () => {
    if (!context.value) return;
    const path = context.value.item.path;
    context.value = null;
    emit('copy', path);
  };
  const removeContextPath = () => {
    if (!context.value) return;
    const id = context.value.item.id;
    context.value = null;
    emit('remove', id);
  };

  watch(
    () => [props.visible, props.selectedIndex] as const,
    async ([visible, selectedIndex]) => {
      if (!visible) {
        context.value = null;
        return;
      }
      if (selectedIndex < 0) return;
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
        @contextmenu.prevent.stop="openContext($event, item)"
      >
        <span class="path-history-path min-w-0 flex-grow font-mono text-sm text-foreground">{{ item.path }}</span>
      </li>
    </ul>

    <BaseContextMenu
      v-if="context"
      :visible="true"
      :x="context.x"
      :y="context.y"
      :width="190"
      panel-test-id="path-history-context-menu"
      @close="context = null"
    >
      <button class="context-item" @mousedown.prevent @click="copyContextPath">
        <i class="fas fa-copy" aria-hidden="true"></i>
        <span>{{ t('pathHistory.copy') }}</span>
      </button>
      <button class="context-item text-error" @mousedown.prevent @click="removeContextPath">
        <i class="fas fa-trash-alt" aria-hidden="true"></i>
        <span>{{ t('pathHistory.delete') }}</span>
      </button>
    </BaseContextMenu>
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

  .context-item {
    display: flex;
    width: calc(100% - 0.5rem);
    margin-inline: 0.25rem;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.75rem;
    border-radius: 0.375rem;
    text-align: left;
    font-size: 0.875rem;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }

  .context-item:hover,
  .context-item:focus-visible {
    background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
    color: var(--link-active-color);
    outline: none;
  }

  .context-item i {
    width: 1rem;
    text-align: center;
  }

  .context-item.text-error:hover,
  .context-item.text-error:focus-visible {
    color: var(--color-error);
  }
</style>
