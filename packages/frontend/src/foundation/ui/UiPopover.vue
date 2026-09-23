<script setup lang="ts">
  import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
  import { computed, ref, watch } from 'vue';
  import UiButton from './UiButton.vue';
  import type { UiAppearance, UiDensity, UiTone } from './uiTypes';

  type PopoverPlacement = 'top' | 'bottom';
  type PopoverAlign = 'start' | 'center' | 'end';

  const props = withDefaults(
    defineProps<{
      ariaLabel: string;
      title?: string;
      placement?: PopoverPlacement;
      align?: PopoverAlign;
      offset?: number;
      boundarySelector?: string;
      panelClass?: string;
      disabled?: boolean;
      triggerAppearance?: UiAppearance;
      triggerTone?: UiTone;
      density?: UiDensity;
      iconOnly?: boolean;
      wrapperClass?: string;
      triggerClass?: string;
    }>(),
    {
      title: '',
      placement: 'bottom',
      align: 'center',
      offset: 8,
      boundarySelector: '',
      panelClass: '',
      disabled: false,
      triggerAppearance: 'soft',
      triggerTone: 'neutral',
      density: 'default',
      iconOnly: false,
      wrapperClass: '',
      triggerClass: '',
    },
  );

  const model = defineModel<boolean>('open', { default: false });
  const emit = defineEmits<{ 'open-change': [open: boolean] }>();

  const wrapper = ref<HTMLElement | null>(null);

  const collisionBoundary = computed<HTMLElement | undefined>(() => {
    if (!props.boundarySelector) return undefined;
    const element = wrapper.value?.closest(props.boundarySelector) ?? null;
    return element instanceof HTMLElement ? element : undefined;
  });

  // Single guarded entry point for every open-state transition. Reka's
  // `update:open` and the slot-exposed `close()` both flow through here, so
  // `open-change` fires exactly once per real transition and never for a
  // controlled prop update that matches the current model.
  const applyOpen = (open: boolean): void => {
    const next = props.disabled ? false : open;
    if (next === model.value) return;
    model.value = next;
    emit('open-change', next);
  };

  const close = (): void => {
    applyOpen(false);
  };

  // `disabled` must also resolve an already-open popover. Funnelling the
  // transition through `applyOpen(false)` keeps the model and `open-change`
  // in sync and preserves the duplicate-emit guard. Enabling never reopens.
  watch(
    () => props.disabled,
    (disabled) => {
      if (disabled) close();
    },
  );
</script>

<template>
  <span ref="wrapper" data-ui="popover" data-ui-gen="2" class="ui-popover" :class="props.wrapperClass">
    <PopoverRoot :open="model" :modal="false" @update:open="applyOpen">
      <PopoverTrigger as-child>
        <UiButton
          :appearance="props.triggerAppearance"
          :tone="props.triggerTone"
          :density="props.density"
          :icon-only="props.iconOnly"
          :disabled="props.disabled"
          :aria-label="props.ariaLabel"
          :title="props.title || undefined"
          :class="props.triggerClass"
        >
          <slot name="trigger" :open="model" />
        </UiButton>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          data-ui="popover-panel"
          data-ui-gen="2"
          data-surface="glass"
          :side="props.placement"
          :side-offset="props.offset"
          :align="props.align"
          :avoid-collisions="true"
          :side-flip="true"
          :collision-boundary="collisionBoundary"
          :collision-padding="12"
          sticky="always"
          position-strategy="fixed"
          :aria-label="props.ariaLabel"
          class="ui-surface ui-radius--panel ui-popover__panel glass-surface"
          :class="props.panelClass"
        >
          <slot name="panel" :close="close" />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </span>
</template>
