<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type StyleValue } from 'vue';

  defineOptions({ inheritAttrs: false });

  const props = withDefaults(
    defineProps<{
      visible?: boolean;
      keepMounted?: boolean;
      teleport?: boolean;
      overlay?: boolean;
      zIndex?: number;
      closeOnBackdrop?: boolean;
      closeOnEscape?: boolean;
      focusOnOpen?: boolean;
      restoreFocus?: boolean;
      backdropTrigger?: 'click' | 'mousedown';
      overlayClass?: string;
      panelClass?: string;
      panelStyle?: StyleValue;
      panelTestId?: string;
      preset?: 'default' | 'standard-modal';
      surface?: boolean;
      role?: string;
      ariaModal?: boolean;
      ariaLabel?: string;
      ariaLabelledby?: string;
    }>(),
    {
      visible: true,
      keepMounted: false,
      teleport: false,
      overlay: true,
      zIndex: 50,
      closeOnBackdrop: true,
      closeOnEscape: false,
      focusOnOpen: false,
      restoreFocus: false,
      backdropTrigger: 'click',
      overlayClass: '',
      panelClass: '',
      panelTestId: undefined,
      preset: 'default',
      surface: true,
      role: undefined,
      ariaModal: undefined,
    },
  );

  const emit = defineEmits<{ (event: 'close'): void }>();
  const panelRef = ref<HTMLElement | null>(null);
  let previouslyFocused: HTMLElement | null = null;
  let backdropPointerStarted = false;
  const panelPresetClass = computed(() =>
    props.preset === 'standard-modal' ? 'max-h-[85dvh] min-h-0 max-w-lg flex flex-col overflow-hidden p-4' : '',
  );

  const handleOverlayPointerDown = (event: PointerEvent) => {
    backdropPointerStarted = event.target === event.currentTarget;
  };
  const handleBackdropClick = () => {
    const startedOnBackdrop = backdropPointerStarted;
    backdropPointerStarted = false;
    if (startedOnBackdrop && props.closeOnBackdrop && props.backdropTrigger === 'click') emit('close');
  };
  const handleBackdropMouseDown = () => {
    if (props.closeOnBackdrop && props.backdropTrigger === 'mousedown') emit('close');
  };
  const restorePreviousFocus = () => {
    const target = previouslyFocused;
    previouslyFocused = null;
    if (props.restoreFocus && target?.isConnected) void nextTick(() => target.focus({ preventScroll: true }));
  };
  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (!props.visible || !props.closeOnEscape || event.defaultPrevented || event.key !== 'Escape') return;
    event.preventDefault();
    emit('close');
  };

  watch(
    () => props.visible,
    (visible, wasVisible) => {
      if (visible && !wasVisible) {
        if (props.restoreFocus) {
          const active = document.activeElement;
          previouslyFocused = active instanceof HTMLElement && !panelRef.value?.contains(active) ? active : null;
        }
        if (props.focusOnOpen) void nextTick(() => panelRef.value?.focus({ preventScroll: true }));
      } else if (!visible && wasVisible) {
        restorePreviousFocus();
      }
    },
  );

  onMounted(() => document.addEventListener('keydown', handleDocumentKeydown, true));
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleDocumentKeydown, true);
    if (props.visible) restorePreviousFocus();
  });
</script>

<template>
  <slot v-if="!props.overlay" />

  <Teleport v-else to="body" :disabled="!props.teleport">
    <div
      v-if="props.keepMounted || props.visible"
      v-show="props.visible"
      v-bind="$attrs"
      class="fixed inset-0 flex items-center justify-center bg-overlay p-4"
      :class="props.overlayClass"
      :style="{ zIndex: props.zIndex }"
      @pointerdown="handleOverlayPointerDown"
      @click.self="handleBackdropClick"
      @mousedown.self="handleBackdropMouseDown"
    >
      <div
        v-if="props.surface"
        ref="panelRef"
        :data-testid="props.panelTestId"
        :data-overlay-panel-preset="props.preset"
        class="relative w-full rounded-lg border border-border bg-background text-foreground shadow-xl"
        :class="[panelPresetClass, props.panelClass]"
        :style="props.panelStyle"
        :role="props.role"
        :aria-modal="props.ariaModal"
        :aria-label="props.ariaLabel"
        :aria-labelledby="props.ariaLabelledby"
        :tabindex="props.focusOnOpen ? -1 : undefined"
      >
        <slot />
      </div>
      <slot v-else />
    </div>
  </Teleport>
</template>
