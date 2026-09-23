<script setup lang="ts">
  import { computed } from 'vue';

  const props = withDefaults(
    defineProps<{
      text: string;
      tone?: 'info' | 'warning';
      label?: string;
    }>(),
    { tone: 'info', label: '' },
  );

  const icon = computed(() =>
    props.tone === 'warning' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info',
  );
</script>

<template>
  <span
    data-ui="info-hint"
    data-ui-gen="2"
    class="ui-info-hint"
    :data-tone="props.tone"
    :title="props.text"
    :aria-label="props.label || props.text"
    tabindex="0"
    role="note"
  >
    <i :class="icon" aria-hidden="true"></i>
  </span>
</template>
