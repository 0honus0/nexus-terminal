<script setup lang="ts">
  withDefaults(defineProps<{ size?: 'sm' | 'md' | 'lg'; label?: string }>(), {
    size: 'md',
    label: undefined,
  });
</script>

<template>
  <span
    class="inline-block animate-spin rounded-full border-2 border-current border-r-transparent"
    :class="{ 'h-3 w-3': size === 'sm', 'h-4 w-4': size === 'md', 'h-5 w-5': size === 'lg' }"
    role="status"
    :aria-label="label"
  />
</template>
