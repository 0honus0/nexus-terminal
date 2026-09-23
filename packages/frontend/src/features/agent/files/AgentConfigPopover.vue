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
      triggerClass?: string;
      triggerVariant?: 'default' | 'square';
      disabled?: boolean;
    }>(),
    { title: '', align: 'left', panelClass: '', triggerClass: '', triggerVariant: 'default', disabled: false },
  );
  const emit = defineEmits<{ 'open-change': [open: boolean] }>();

  const open = ref(false);
  const position = ref({ left: '0px', top: '0px', maxWidth: '0px', maxHeight: '300px' });
  const trigger = ref<HTMLButtonElement | null>(null);
  const panel = ref<HTMLElement | null>(null);
  const panelId = `agent-config-popover-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  let panelResizeObserver: ResizeObserver | null = null;

  // Teleported panel bounds: stay inside the owning Agent Hub window when the
  // trigger lives inside one, otherwise fall back to the viewport.
  const HUB_SELECTOR = '.agent-hub-window';
  const EDGE_INSET = 12;

  const getHubElement = (): HTMLElement | null => {
    const hub = trigger.value?.closest(HUB_SELECTOR);
    return hub instanceof HTMLElement ? hub : null;
  };

  const resolveBounds = () => {
    const hub = getHubElement();
    if (hub) {
      const rect = hub.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height };
    }
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, height: window.innerHeight };
  };

  const close = (restoreFocus = true): void => {
    if (!open.value) return;
    open.value = false;
    emit('open-change', false);
    if (activePopoverCloser === close) {
      activePopoverCloser = null;
    }
    panelResizeObserver?.disconnect();
    if (restoreFocus) queueMicrotask(() => trigger.value?.focus());
  };

  const positionPanel = () => {
    const anchor = trigger.value?.getBoundingClientRect();
    const popup = panel.value;
    if (!anchor || !popup) return;
    const bounds = resolveBounds();
    const availableWidth = Math.max(0, bounds.right - bounds.left - EDGE_INSET * 2);
    const width = Math.min(popup.getBoundingClientRect().width, availableWidth);
    const height = popup.getBoundingClientRect().height;

    // 水平居中：展开内容的中心点严格对齐点击项中心点
    const anchorCenter = anchor.left + anchor.width / 2;
    const targetLeft = anchorCenter - width / 2;

    // 边界安全 clamp（贴合 Hub 或视口，留 12px 边距）
    const minLeft = bounds.left + EDGE_INSET;
    const maxLeft = Math.max(minLeft, bounds.right - width - EDGE_INSET);
    const left = Math.max(minLeft, Math.min(targetLeft, maxLeft));

    // 纵向定位：优先向上展开
    const spaceAbove = anchor.top - bounds.top - EDGE_INSET;
    const spaceBelow = bounds.bottom - anchor.bottom - EDGE_INSET;
    const minTop = bounds.top + EDGE_INSET;
    const maxTop = Math.max(minTop, bounds.bottom - height - EDGE_INSET);
    let top: number;
    if (spaceAbove >= height || spaceAbove >= spaceBelow) {
      top = anchor.top - height - 8;
    } else {
      top = anchor.bottom + 8;
    }
    top = Math.max(minTop, Math.min(top, maxTop));

    position.value = {
      left: `${left}px`,
      top: `${top}px`,
      maxWidth: `${availableWidth}px`,
      maxHeight: `${Math.max(120, bounds.height - EDGE_INSET * 2)}px`,
    };
  };

  const observeSizing = (): void => {
    if (typeof ResizeObserver === 'undefined') return;
    panelResizeObserver?.disconnect();
    panelResizeObserver = new ResizeObserver(() => positionPanel());
    if (panel.value) panelResizeObserver.observe(panel.value);
    const hub = getHubElement();
    if (hub) panelResizeObserver.observe(hub);
  };

  const toggle = async (): Promise<void> => {
    if (props.disabled) return;
    if (open.value) {
      close();
      return;
    }
    if (activePopoverCloser && activePopoverCloser !== close) {
      activePopoverCloser(false);
    }
    open.value = true;
    emit('open-change', true);
    activePopoverCloser = close;
    await nextTick();
    positionPanel();
    observeSizing();
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
    panelResizeObserver?.disconnect();
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
      class="agent-config-summary flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors duration-150 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      :class="[
        props.triggerVariant === 'square' ? 'agent-config-trigger-square' : '',
        open
          ? 'border-border/70 bg-header/90 text-foreground shadow-xs'
          : 'border-transparent bg-transparent text-text-secondary hover:border-border/50 hover:bg-header/70 hover:text-foreground',
        props.triggerClass,
      ]"
      :disabled="props.disabled"
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
        data-agent-hub-portal
        tabindex="-1"
        :style="position"
        :id="panelId"
        ref="panel"
        role="dialog"
        aria-modal="false"
        :aria-label="props.ariaLabel"
        class="fixed z-[60] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border border-border/70 backdrop-blur-[6px] p-3 shadow-2xl ring-1 ring-border/20 outline-none"
        :class="props.panelClass"
      >
        <slot name="panel" :close="close" /></div
    ></Teleport>
  </div>
</template>

<style scoped>
  .agent-config-summary {
    font-size: 11px;
    line-height: 1.25;
  }

  /*
   * Square trigger variant (e.g. the compact composer attachment "+").
   * Declared here so it keeps winning over the container-query density rules
   * below, which live in the same unlayered scoped stylesheet.
   */
  .agent-config-summary.agent-config-trigger-square {
    width: 28px;
    min-width: 28px;
    height: 28px;
    padding-inline: 0;
    justify-content: center;
    gap: 0;
  }

  @container agent-hub-window (max-width: 1040px) {
    .agent-config-summary {
      height: 28px;
      gap: 4px;
      padding-inline: 6px;
      font-size: 11px;
      line-height: 1.25;
    }
  }

  @container agent-hub-window (max-width: 760px) {
    .agent-config-summary {
      min-width: 28px;
      height: 28px;
      gap: 3px;
      padding-inline: 6px;
      font-size: 11px;
      line-height: 1.25;
    }
  }
</style>
