<script lang="ts">
  let activePopoverCloser: ((restoreFocus?: boolean) => void) | null = null;
</script>

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
    if (activePopoverCloser === close) {
      activePopoverCloser = null;
    }
    if (restoreFocus) queueMicrotask(() => trigger.value?.focus());
  };

  const positionPanel = () => {
    const anchor = trigger.value?.getBoundingClientRect();
    const popup = panel.value;
    if (!anchor || !popup) return;
    const width = popup.getBoundingClientRect().width;
    const height = popup.getBoundingClientRect().height;

    // 水平居中：展开内容的中心点严格对齐点击项中心点
    const anchorCenter = anchor.left + anchor.width / 2;
    const targetLeft = anchorCenter - width / 2;

    // 边界安全 clamp（留 12px 边距）
    const minLeft = 12;
    const maxLeft = Math.max(minLeft, window.innerWidth - width - 12);
    const left = Math.max(minLeft, Math.min(targetLeft, maxLeft));

    // 纵向定位：优先向上展开
    const spaceAbove = anchor.top - 12;
    const spaceBelow = window.innerHeight - anchor.bottom - 12;
    let top: number;
    if (spaceAbove >= height || spaceAbove >= spaceBelow) {
      top = Math.max(12, anchor.top - height - 8);
    } else {
      top = Math.min(window.innerHeight - height - 12, anchor.bottom + 8);
    }

    position.value = {
      left: `${left}px`,
      top: `${top}px`,
      maxHeight: `${Math.max(120, window.innerHeight - 24)}px`,
    };
  };
  const toggle = async (): Promise<void> => {
    if (open.value) {
      close();
      return;
    }
    if (activePopoverCloser && activePopoverCloser !== close) {
      activePopoverCloser(false);
    }
    open.value = true;
    activePopoverCloser = close;
    await nextTick();
    positionPanel();
    panel.value?.focus();
  };

  const onPointerDown = (event: Event): void => {
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
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
  onBeforeUnmount(() => {
    if (activePopoverCloser === close) {
      activePopoverCloser = null;
    }
    window.removeEventListener('resize', positionPanel);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  });
</script>

<template>
  <div class="relative shrink-0">
    <button
      ref="trigger"
      type="button"
      class="agent-config-summary flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-all duration-150 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      :class="
        open
          ? 'border-primary/40 bg-primary/10 text-primary font-semibold shadow-2xs'
          : 'border-border/50 bg-header/40 text-text-secondary hover:border-border hover:bg-header/80 hover:text-foreground font-medium'
      "
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
        class="fixed z-[60] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-border/70 bg-card/95 backdrop-blur-md p-3 shadow-2xl ring-1 ring-border/20 outline-none"
        :class="props.panelClass"
      >
        <slot name="panel" :close="close" /></div
    ></Teleport>
  </div>
</template>
