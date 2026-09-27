<script setup lang="ts">
  defineProps<{
    empty?: boolean;
    emptyText?: string;
  }>();
</script>

<template>
  <div data-ui="table" data-ui-gen="2" class="ui-table glass-surface overflow-x-auto rounded-lg">
    <table v-if="!empty" class="min-w-full border-collapse text-sm">
      <thead class="ui-table__head text-left text-text-secondary">
        <slot name="head" />
      </thead>
      <tbody class="ui-table__body divide-y divide-border">
        <slot />
      </tbody>
    </table>
    <div v-else class="ui-table__empty px-4 py-10 text-center text-sm text-text-secondary">
      <slot name="empty">{{ emptyText }}</slot>
    </div>
  </div>
</template>
