<script setup lang="ts">
export interface PdfOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url: string | null;
  items: PdfOutlineItem[];
}

const props = defineProps<{
  items: PdfOutlineItem[];
  depth?: number;
}>();

const emit = defineEmits<{
  navigate: [item: PdfOutlineItem];
}>();
</script>

<template>
  <ul class="space-y-0.5" :class="(props.depth ?? 0) > 0 ? 'ml-3 border-l border-border/70 pl-2' : ''">
    <li v-for="(item, index) in props.items" :key="`${item.title}-${index}`">
      <button
        v-if="item.dest"
        type="button"
        class="w-full rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary"
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
        class="block w-full rounded px-2 py-1.5 text-left text-xs text-primary hover:bg-border focus:outline-none focus:ring-1 focus:ring-primary"
        :title="item.title"
      >
        {{ item.title }}
      </a>
      <div v-else class="px-2 py-1.5 text-xs text-text-secondary" :title="item.title">
        {{ item.title }}
      </div>

      <PdfOutlineItems
        v-if="item.items?.length"
        :items="item.items"
        :depth="(props.depth ?? 0) + 1"
        @navigate="emit('navigate', $event)"
      />
    </li>
  </ul>
</template>
