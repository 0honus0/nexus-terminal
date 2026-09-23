<script setup lang="ts">
  import { computed } from 'vue';
  import type { UiSurfaceKind } from './uiTypes';

  const props = withDefaults(
    defineProps<{
      surface?: UiSurfaceKind;
      radius?: 'control' | 'panel' | 'pill';
    }>(),
    {
      surface: 'raised',
      radius: 'panel',
    },
  );

  const surfaceClass = computed(() => (props.surface === 'glass' ? 'glass-surface' : `ui-surface--${props.surface}`));
</script>

<template>
  <div
    data-ui="surface"
    data-ui-gen="2"
    :data-surface="props.surface"
    class="ui-surface"
    :class="[surfaceClass, `ui-radius--${props.radius}`]"
  >
    <slot />
  </div>
</template>
