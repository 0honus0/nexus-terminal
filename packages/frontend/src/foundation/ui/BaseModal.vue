<script setup lang="ts">
  import type { StyleValue } from 'vue';
  import OverlayPanel from './OverlayPanel.vue';

  const props = withDefaults(
    defineProps<{
      visible: boolean;
      title?: string;
      closeOnBackdrop?: boolean;
      closeOnEscape?: boolean;
      focusOnOpen?: boolean;
      restoreFocus?: boolean;
      keepMounted?: boolean;
      zIndex?: number;
      panelClass?: string;
      panelStyle?: StyleValue;
      overlayClass?: string;
      contentClass?: string;
      ariaLabel?: string;
    }>(),
    {
      title: '',
      closeOnBackdrop: true,
      closeOnEscape: false,
      focusOnOpen: false,
      restoreFocus: false,
      keepMounted: false,
      zIndex: 50,
      panelClass: '',
      panelStyle: undefined,
      overlayClass: '',
      contentClass: '',
      ariaLabel: undefined,
    },
  );

  const emit = defineEmits<{ (event: 'close'): void }>();
</script>

<template>
  <OverlayPanel
    :visible="props.visible"
    teleport
    preset="standard-modal"
    :z-index="props.zIndex"
    :keep-mounted="props.keepMounted"
    :close-on-backdrop="props.closeOnBackdrop"
    :close-on-escape="props.closeOnEscape"
    :focus-on-open="props.focusOnOpen"
    :restore-focus="props.restoreFocus"
    :panel-class="props.panelClass"
    :panel-style="props.panelStyle"
    :overlay-class="props.overlayClass"
    role="dialog"
    :aria-modal="true"
    :aria-label="props.ariaLabel || props.title || undefined"
    @close="emit('close')"
  >
    <header
      v-if="props.title || $slots.header"
      class="flex items-center justify-between gap-4 border-b border-border pb-3"
    >
      <slot name="header">
        <h2 class="text-lg font-semibold">{{ props.title }}</h2>
      </slot>
      <slot name="header-actions" />
    </header>

    <div class="min-h-0 flex-1 overflow-auto py-4" :class="props.contentClass">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="border-t border-border pt-3">
      <slot name="footer" />
    </footer>
  </OverlayPanel>
</template>
