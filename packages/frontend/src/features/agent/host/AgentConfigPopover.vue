<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, useId } from 'vue';

  const props = withDefaults(
    defineProps<{
      ariaLabel: string;
      title?: string;
      align?: 'left' | 'right';
      panelClass?: string;
    }>(),
    { title: '', align: 'left', panelClass: '' },
  );

  const open = ref(false);
  const trigger = ref<HTMLButtonElement | null>(null);
  const panel = ref<HTMLElement | null>(null);
  const panelId = `agent-config-popover-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const close = (restoreFocus = true): void => {
    if (!open.value) return;
    open.value = false;
    if (restoreFocus) queueMicrotask(() => trigger.value?.focus());
  };

  const toggle = (): void => {
    open.value = !open.value;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!open.value || !(event.target instanceof Node)) return;
    if (trigger.value?.contains(event.target) || panel.value?.contains(event.target)) return;
    close(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!open.value || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  });
</script>

<template>
  <div class="relative shrink-0">
    <button
      ref="trigger"
      type="button"
      class="agent-config-summary flex items-center gap-1.5 rounded-lg bg-background/70 px-2 py-1.5 text-[10px] hover:bg-header focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      :aria-label="props.ariaLabel"
      :title="props.title || undefined"
      :aria-expanded="open"
      :aria-controls="panelId"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <slot name="trigger" :open="open" />
    </button>
    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      role="dialog"
      aria-modal="false"
      :aria-label="props.ariaLabel"
      class="absolute top-[calc(100%+6px)] z-40 max-w-[min(80vw,360px)] rounded-xl border border-border/70 bg-background p-3 shadow-xl"
      :class="[props.align === 'right' ? 'right-0' : 'left-0', props.panelClass]"
    >
      <slot name="panel" :close="close" />
    </div>
  </div>
</template>
