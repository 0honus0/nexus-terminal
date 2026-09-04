<script setup lang="ts">
  import { computed } from 'vue';
  import type { SurfaceVariant } from './types';

  defineOptions({ inheritAttrs: false });

  const props = withDefaults(
    defineProps<{
      variant?: SurfaceVariant;
      padding?: 'none' | 'sm' | 'md' | 'lg';
      rounded?: boolean;
    }>(),
    { variant: 'default', padding: 'md', rounded: true },
  );

  const surfaceClass = computed(() => {
    if (props.variant === 'subtle') return 'border border-border bg-header/30 text-foreground';
    if (props.variant === 'transparent') return 'bg-transparent text-foreground';
    return 'border border-border bg-background text-foreground';
  });

  const paddingClass = computed(() => {
    if (props.padding === 'none') return '';
    if (props.padding === 'sm') return 'p-2';
    if (props.padding === 'lg') return 'p-6';
    return 'p-4';
  });
</script>

<template>
  <div v-bind="$attrs" :class="[surfaceClass, paddingClass, { 'rounded-lg': props.rounded }]">
    <slot />
  </div>
</template>
