<script setup lang="ts">
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<{
  visible?: boolean;
  keepMounted?: boolean;
  teleport?: boolean;
  overlay?: boolean;
  zIndex?: number;
  closeOnBackdrop?: boolean;
  backdropTrigger?: 'click' | 'mousedown';
  overlayClass?: string;
  panelClass?: string;
  panelTestId?: string;
  surface?: boolean;
  role?: string;
  ariaModal?: boolean;
  ariaLabel?: string;
  ariaLabelledby?: string;
}>(), {
  visible: true,
  keepMounted: false,
  teleport: false,
  overlay: true,
  zIndex: 50,
  closeOnBackdrop: true,
  backdropTrigger: 'click',
  overlayClass: '',
  panelClass: '',
  panelTestId: undefined,
  surface: true,
  role: undefined,
  ariaModal: undefined,
});

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const handleBackdropClick = () => {
  if (props.closeOnBackdrop && props.backdropTrigger === 'click') emit('close');
};

const handleBackdropMouseDown = () => {
  if (props.closeOnBackdrop && props.backdropTrigger === 'mousedown') emit('close');
};
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
      @click.self="handleBackdropClick"
      @mousedown.self="handleBackdropMouseDown"
    >
      <div
        v-if="props.surface"
        :data-testid="props.panelTestId"
        class="relative w-full rounded-lg border border-border bg-background text-foreground shadow-xl"
        :class="props.panelClass"
        :role="props.role"
        :aria-modal="props.ariaModal"
        :aria-label="props.ariaLabel"
        :aria-labelledby="props.ariaLabelledby"
      >
        <slot />
      </div>
      <slot v-else />
    </div>
  </Teleport>
</template>
