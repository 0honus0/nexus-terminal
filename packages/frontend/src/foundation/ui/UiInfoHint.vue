<script setup lang="ts">
  import { TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
  import { computed, ref } from 'vue';

  const props = withDefaults(
    defineProps<{
      text?: string;
      tone?: 'info' | 'warning';
      label?: string;
      side?: 'top' | 'right' | 'bottom' | 'left';
      align?: 'start' | 'center' | 'end';
    }>(),
    { text: '', tone: 'info', label: '', side: 'top', align: 'center' },
  );

  const icon = computed(() =>
    props.tone === 'warning' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info',
  );

  const open = ref(false);

  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    open.value = !open.value;
  };
</script>

<template>
  <TooltipProvider :delay-duration="120">
    <TooltipRoot v-model:open="open">
      <TooltipTrigger as-child>
        <span
          data-ui="info-hint"
          data-ui-gen="2"
          class="ui-info-hint"
          :data-tone="props.tone"
          :aria-label="props.label || props.text"
          tabindex="0"
          role="button"
          @click="toggle"
          @keydown.enter.prevent="open = !open"
          @keydown.space.prevent="open = !open"
        >
          <i :class="icon" aria-hidden="true"></i>
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          v-if="props.text || $slots.default"
          data-ui="info-hint-panel"
          data-ui-gen="2"
          :side="props.side"
          :side-offset="6"
          :align="props.align"
          :avoid-collisions="true"
          :collision-padding="12"
          class="ui-info-hint__panel glass-surface"
        >
          <slot>{{ props.text }}</slot>
          <TooltipArrow class="ui-info-hint__arrow" :width="10" :height="5" />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
