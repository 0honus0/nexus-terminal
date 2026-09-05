<script setup lang="ts">
  import type { PdfOutlineItem } from '../model/pdf';

  const props = withDefaults(defineProps<{ items: PdfOutlineItem[]; depth?: number }>(), { depth: 0 });
  const emit = defineEmits<{ navigate: [item: PdfOutlineItem] }>();
</script>

<template>
  <ul class="space-y-0.5" :class="props.depth > 0 ? 'ml-3 border-l border-border/70 pl-2' : ''">
    <li v-for="(item, index) in props.items" :key="`${item.title}-${index}`">
      <button
        v-if="item.dest"
        type="button"
        class="min-h-11 w-full rounded px-2 py-2 text-left text-sm text-foreground hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary sm:min-h-0 sm:py-1.5 sm:text-xs"
        :title="item.title"
        @click="emit('navigate', item)"
      >
        {{ item.title }}
      </button>
      <a
        v-else-if="item.url"
        :href="item.url"
        target="_blank"
        rel="noopener noreferrer"
        class="flex min-h-11 w-full items-center rounded px-2 py-2 text-left text-sm text-primary hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary sm:min-h-0 sm:py-1.5 sm:text-xs"
        :title="item.title"
      >
        {{ item.title }}
      </a>
      <div v-else class="px-2 py-1.5 text-xs text-text-secondary" :title="item.title">{{ item.title }}</div>

      <PdfOutlineItems
        v-if="item.items.length"
        :items="item.items"
        :depth="props.depth + 1"
        @navigate="emit('navigate', $event)"
      />
    </li>
  </ul>
</template>
