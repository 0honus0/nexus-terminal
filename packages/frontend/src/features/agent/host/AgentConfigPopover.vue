<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, useId, nextTick } from 'vue';

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
  const position = ref({ left: '0px', top: '0px', maxHeight: '300px' });
  const trigger = ref<HTMLButtonElement | null>(null);
  const panel = ref<HTMLElement | null>(null);
  const panelId = `agent-config-popover-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const close = (restoreFocus = true): void => {
    if (!open.value) return;
    open.value = false;
    if (restoreFocus) queueMicrotask(() => trigger.value?.focus());
  };

  const positionPanel = () => {
    const anchor = trigger.value?.getBoundingClientRect();
    const popup = panel.value;
    if (!anchor || !popup) return;
    const width = popup.getBoundingClientRect().width;
    const left = Math.max(
      12,
      Math.min(props.align === 'right' ? anchor.right - width : anchor.left, window.innerWidth - width - 12),
    );
    const below = window.innerHeight - anchor.bottom - 18;
    const top = below >= 180 ? anchor.bottom + 6 : Math.max(12, anchor.top - popup.getBoundingClientRect().height - 6);
    position.value = {
      left: `${left}px`,
      top: `${top}px`,
      maxHeight: `${Math.max(120, window.innerHeight - top - 12)}px`,
    };
  };
  const toggle = async (): Promise<void> => {
    if (open.value) {
      close();
      return;
    }
    open.value = true;
    await nextTick();
    positionPanel();
    panel.value?.focus();
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
    window.addEventListener('resize', positionPanel);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', positionPanel);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  });
</script>

<template>
  <div class="relative shrink-0">
    <button
      ref="trigger"
      type="button"
      class="agent-config-summary flex items-center gap-1.5 rounded-xl bg-background/70 px-2.5 py-1.5 text-xs transition-colors hover:bg-header focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20"
      :aria-label="props.ariaLabel"
      :title="props.title || undefined"
      :aria-expanded="open"
      :aria-controls="panelId"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <slot name="trigger" :open="open" />
    </button>
    <Teleport to="body"
      ><div
        v-if="open"
        tabindex="-1"
        :style="position"
        :id="panelId"
        ref="panel"
        role="dialog"
        aria-modal="false"
        :aria-label="props.ariaLabel"
        class="fixed z-[60] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-border/70 bg-background p-3 shadow-xl outline-none"
        :class="props.panelClass"
      >
        <slot name="panel" :close="close" /></div
    ></Teleport>
  </div>
</template>
