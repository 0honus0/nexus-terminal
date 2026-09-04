<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

  const props = withDefaults(
    defineProps<{
      visible: boolean;
      x: number;
      y: number;
      width?: number;
      margin?: number;
      zIndex?: number;
      panelTestId?: string;
    }>(),
    { width: 220, margin: 8, zIndex: 80 },
  );
  const emit = defineEmits<{ close: [] }>();
  const root = ref<HTMLElement | null>(null);
  const left = ref(0);
  const top = ref(0);

  const place = async (): Promise<void> => {
    if (!props.visible) return;
    await nextTick();
    const element = root.value;
    if (!element) return;
    const maxLeft = Math.max(props.margin, window.innerWidth - element.offsetWidth - props.margin);
    const maxTop = Math.max(props.margin, window.innerHeight - element.offsetHeight - props.margin);
    left.value = Math.max(props.margin, Math.min(props.x, maxLeft));
    top.value = Math.max(props.margin, Math.min(props.y, maxTop));
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (props.visible && event.key === 'Escape') emit('close');
  };
  const handleResize = (): void => void place();

  watch(() => [props.visible, props.x, props.y] as const, place);
  onMounted(() => {
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('resize', handleResize);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('resize', handleResize);
  });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0"
      :style="{ zIndex }"
      @pointerdown.self="emit('close')"
      @contextmenu.prevent
    >
      <div
        ref="root"
        :data-testid="props.panelTestId"
        class="fixed max-h-[calc(100dvh-1rem)] overflow-y-auto rounded border border-border bg-background p-1 text-sm text-foreground shadow-xl"
        :style="{ left: `${left}px`, top: `${top}px`, width: `${width}px` }"
        role="menu"
        @pointerdown.stop
        @click.stop
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
