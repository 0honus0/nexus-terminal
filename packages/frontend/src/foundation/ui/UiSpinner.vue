<script setup lang="ts">
  import type { UiDensity, UiTone } from './uiTypes';

  const props = withDefaults(
    defineProps<{
      density?: UiDensity;
      tone?: UiTone;
      label?: string;
    }>(),
    {
      density: 'default',
      tone: 'neutral',
      label: undefined,
    },
  );
</script>

<template>
  <span
    data-ui="spinner"
    data-ui-gen="2"
    :data-density="props.density"
    :data-tone="props.tone"
    role="status"
    :aria-label="props.label || undefined"
    :aria-hidden="props.label ? undefined : 'true'"
    class="ui-spinner"
  />
</template>
