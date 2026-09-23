<script setup lang="ts">
  import type { UiTone } from './uiTypes';

  const props = withDefaults(
    defineProps<{
      tone?: UiTone;
      appearance?: 'soft' | 'ghost';
      density?: 'compact' | 'default';
    }>(),
    {
      tone: 'neutral',
      appearance: 'soft',
      density: 'default',
    },
  );
</script>

<template>
  <span
    data-ui="badge"
    data-ui-gen="2"
    :data-tone="props.tone"
    :data-density="props.density"
    :data-appearance="props.appearance"
    class="ui-badge"
    :class="`ui-badge--${props.appearance}`"
  >
    <slot />
  </span>
</template>
