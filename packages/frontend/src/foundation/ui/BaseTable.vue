<script setup lang="ts">
  defineProps<{
    empty?: boolean;
    emptyText?: string;
  }>();
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-border">
    <table v-if="!empty" class="min-w-full border-collapse text-sm">
      <thead class="bg-header/70 text-left text-text-secondary">
        <slot name="head" />
      </thead>
      <tbody class="divide-y divide-border bg-background">
        <slot />
      </tbody>
    </table>
    <div v-else class="px-4 py-10 text-center text-sm text-text-secondary">
      <slot name="empty">{{ emptyText }}</slot>
    </div>
  </div>
</template>
