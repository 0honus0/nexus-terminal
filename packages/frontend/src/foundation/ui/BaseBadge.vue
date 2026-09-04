<script setup lang="ts">
  withDefaults(defineProps<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' }>(), { tone: 'neutral' });
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
    :class="{
      'bg-header text-text-secondary': tone === 'neutral',
      'bg-success/15 text-success': tone === 'success',
      'bg-warning/20 text-warning': tone === 'warning',
      'bg-error/15 text-error': tone === 'danger',
    }"
  >
    <slot />
  </span>
</template>
