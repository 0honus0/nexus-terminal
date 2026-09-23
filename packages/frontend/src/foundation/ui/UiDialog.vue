<script setup lang="ts">
  import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
  } from 'reka-ui';
  import { computed, useAttrs } from 'vue';
  import UiButton from './UiButton.vue';
  import type { UiDensity, UiSurfaceKind } from './uiTypes';

  // The host is a `display: contents` marker so the portaled panel can live in
  // the accessibility dialog tree without adding a layout box at the call site.
  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();
  const model = defineModel<boolean>('open', { default: false });
  const emit = defineEmits<{ 'open-change': [open: boolean] }>();

  const props = withDefaults(
    defineProps<{
      title?: string;
      description?: string;
      density?: UiDensity;
      surface?: UiSurfaceKind;
      closeOnEscape?: boolean;
      closeOnInteractOutside?: boolean;
      showClose?: boolean;
      closeLabel?: string;
      panelClass?: string;
      contentClass?: string;
    }>(),
    {
      density: 'default',
      surface: 'raised',
      closeOnEscape: true,
      closeOnInteractOutside: true,
      showClose: true,
      closeLabel: 'Close',
      panelClass: '',
      contentClass: '',
    },
  );

  // Glass is delegated to the shared `.glass-surface` recipe; every other kind
  // reuses the Gen 2 surface tokens so the panel matches the rest of the system.
  const surfaceClass = computed(() => (props.surface === 'glass' ? 'glass-surface' : `ui-surface--${props.surface}`));

  // Reka still owns focus trap, restore, and dismiss timing. Every open-state
  // transition — Reka's `update:open`, the close button, and the slot-exposed
  // `close()` — flows through this guarded helper so `open-change` fires once
  // per real transition and never for a controlled prop update.
  const applyOpen = (open: boolean): void => {
    if (open === model.value) return;
    model.value = open;
    emit('open-change', open);
  };

  // DialogContent requires a semantic title even when the caller supplies a
  // custom header or no visible title at all, so fall back to a hidden one.
  const fallbackTitle = computed(() => {
    const ariaLabel = attrs['aria-label'];
    return typeof ariaLabel === 'string' && ariaLabel.length > 0 ? ariaLabel : 'Dialog';
  });

  const onEscapeKeyDown = (event: KeyboardEvent): void => {
    if (!props.closeOnEscape) event.preventDefault();
  };

  const onInteractOutside = (event: Event): void => {
    if (!props.closeOnInteractOutside) event.preventDefault();
  };

  const close = (): void => {
    applyOpen(false);
  };

  defineExpose({ close });
</script>

<template>
  <span data-ui="dialog" data-ui-gen="2" :data-density="props.density" class="ui-dialog-host">
    <DialogRoot :open="model" @update:open="applyOpen">
      <DialogPortal>
        <DialogOverlay data-ui="dialog-overlay" data-ui-gen="2" class="ui-dialog__overlay" />
        <DialogContent
          v-bind="$attrs"
          data-ui="dialog-panel"
          data-ui-gen="2"
          :data-density="props.density"
          :data-surface="props.surface"
          class="ui-surface ui-radius--panel ui-dialog__panel"
          :class="[surfaceClass, props.panelClass]"
          @escape-key-down="onEscapeKeyDown"
          @interact-outside="onInteractOutside"
        >
          <DialogTitle v-if="!props.title" class="ui-visually-hidden">{{ fallbackTitle }}</DialogTitle>
          <header v-if="props.title || props.description || $slots.header || props.showClose" class="ui-dialog__header">
            <div class="ui-dialog__heading">
              <slot name="header">
                <DialogTitle v-if="props.title" class="ui-dialog__title">{{ props.title }}</DialogTitle>
                <DialogDescription v-if="props.description" class="ui-dialog__description">
                  {{ props.description }}
                </DialogDescription>
              </slot>
            </div>
            <DialogClose v-if="props.showClose" as-child>
              <UiButton
                appearance="ghost"
                tone="neutral"
                icon-only
                :aria-label="props.closeLabel"
                :title="props.closeLabel"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </UiButton>
            </DialogClose>
          </header>
          <div class="ui-dialog__content" :class="props.contentClass">
            <slot :close="close" />
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__footer">
            <slot name="footer" :close="close" />
          </footer>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </span>
</template>
