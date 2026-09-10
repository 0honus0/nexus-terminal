<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue';

  defineOptions({ inheritAttrs: false });

  interface BaseListboxOption {
    value: string | number;
    label: string;
    disabled?: boolean;
  }

  const model = defineModel<string | number | null>({ default: null });
  const props = withDefaults(
    defineProps<{
      options: BaseListboxOption[];
      disabled?: boolean;
      placeholder?: string;
      panelTestId?: string;
      optionTestIdPrefix?: string;
    }>(),
    {
      disabled: false,
      placeholder: '',
      panelTestId: undefined,
      optionTestIdPrefix: undefined,
    },
  );

  const attrs = useAttrs();
  const trigger = ref<HTMLButtonElement | null>(null);
  const panel = ref<HTMLElement | null>(null);
  const visible = ref(false);
  const activeIndex = ref(-1);
  const left = ref(0);
  const top = ref(0);
  const width = ref(0);
  const listboxId = `base-listbox-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const selectedIndex = computed(() => props.options.findIndex((option) => option.value === model.value));
  const selectedLabel = computed(() => {
    const option = props.options[selectedIndex.value];
    return option?.label ?? props.placeholder;
  });
  const activeOptionId = computed(() => {
    if (!visible.value || activeIndex.value < 0) return undefined;
    return `${listboxId}-option-${activeIndex.value}`;
  });

  const enabledIndexFrom = (start: number, direction: 1 | -1): number => {
    if (!props.options.length) return -1;
    let index = Math.max(0, Math.min(props.options.length - 1, start));
    for (let checked = 0; checked < props.options.length; checked += 1) {
      const option = props.options[index];
      if (option && !option.disabled) return index;
      index = (index + direction + props.options.length) % props.options.length;
    }
    return -1;
  };

  const place = async (): Promise<void> => {
    if (!visible.value) return;
    await nextTick();
    const button = trigger.value;
    const menu = panel.value;
    if (!button || !menu) return;

    const rect = button.getBoundingClientRect();
    const margin = 8;
    width.value = rect.width;
    left.value = Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin));

    const below = rect.bottom + 4;
    const above = rect.top - menu.offsetHeight - 4;
    top.value = below + menu.offsetHeight <= window.innerHeight - margin ? below : Math.max(margin, above);
  };

  const open = async (): Promise<void> => {
    if (props.disabled || visible.value) return;
    visible.value = true;
    activeIndex.value = enabledIndexFrom(selectedIndex.value >= 0 ? selectedIndex.value : 0, 1);
    await place();
  };

  const close = (restoreFocus = false): void => {
    if (!visible.value) return;
    visible.value = false;
    activeIndex.value = -1;
    if (restoreFocus) void nextTick(() => trigger.value?.focus());
  };

  const toggle = (): void => {
    if (visible.value) close();
    else void open();
  };

  const moveActive = (direction: 1 | -1): void => {
    const start = activeIndex.value < 0 ? (direction === 1 ? 0 : props.options.length - 1) : activeIndex.value + direction;
    activeIndex.value = enabledIndexFrom((start + props.options.length) % Math.max(1, props.options.length), direction);
  };

  const choose = (index: number): void => {
    const option = props.options[index];
    if (!option || option.disabled) return;
    model.value = option.value;
    close(true);
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    if (props.disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!visible.value) void open();
      else moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visible.value) void open();
      else moveActive(-1);
      return;
    }
    if (event.key === 'Home' && visible.value) {
      event.preventDefault();
      activeIndex.value = enabledIndexFrom(0, 1);
      return;
    }
    if (event.key === 'End' && visible.value) {
      event.preventDefault();
      activeIndex.value = enabledIndexFrom(props.options.length - 1, -1);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && visible.value) {
      event.preventDefault();
      if (activeIndex.value >= 0) choose(activeIndex.value);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !visible.value) {
      event.preventDefault();
      void open();
      return;
    }
    if (event.key === 'Escape' && visible.value) {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'Tab') close();
  };

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!visible.value) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (trigger.value?.contains(target) || panel.value?.contains(target)) return;
    close();
  };

  const handleViewportChange = (): void => {
    if (visible.value) void place();
  };

  watch(
    () => props.disabled,
    (disabled) => {
      if (disabled) close();
    },
  );

  onMounted(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange, true);
  });
</script>

<template>
  <button
    ref="trigger"
    v-bind="attrs"
    type="button"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="visible"
    :aria-controls="listboxId"
    :aria-activedescendant="activeOptionId"
    :disabled="props.disabled"
    :data-value="model == null ? '' : String(model)"
    class="relative flex h-10 min-w-0 w-full select-none items-center justify-center rounded-md border border-border bg-input px-8 text-center text-sm text-[var(--input-text-color)] outline-none transition focus:border-input-focus-border focus:ring-1 focus:ring-[var(--input-focus-glow)] disabled:cursor-not-allowed disabled:border-[var(--input-disabled-border-color)] disabled:bg-[var(--input-disabled-bg-color)] disabled:text-[var(--input-disabled-text-color)] disabled:opacity-100"
    @click="toggle"
    @keydown="handleKeydown"
  >
    <span class="min-w-0 truncate text-center leading-none">{{ selectedLabel }}</span>
    <svg
      class="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-text-secondary"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.25 4.25 6 8l3.75-3.75"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  <Teleport to="body">
    <div
      v-if="visible"
      :id="listboxId"
      ref="panel"
      :data-testid="props.panelTestId"
      role="listbox"
      class="fixed z-[170] max-h-[min(20rem,calc(100dvh-1rem))] overflow-y-auto rounded-md border border-border bg-input p-1 text-sm text-[var(--input-text-color)] shadow-xl"
      :style="{ left: `${left}px`, top: `${top}px`, width: `${width}px` }"
    >
      <button
        v-for="(option, index) in props.options"
        :id="`${listboxId}-option-${index}`"
        :key="`${typeof option.value}:${String(option.value)}`"
        type="button"
        role="option"
        :aria-selected="option.value === model"
        :disabled="option.disabled"
        :data-testid="props.optionTestIdPrefix ? `${props.optionTestIdPrefix}-${option.value === '' ? 'all' : String(option.value)}` : undefined"
        class="flex min-h-9 w-full select-none items-center justify-center rounded px-3 py-2 text-center leading-5 outline-none transition disabled:cursor-default disabled:opacity-50"
        :class="[
          option.value === model
            ? 'bg-primary/15 font-semibold text-primary'
            : 'text-[var(--input-text-color)] hover:bg-header',
          index === activeIndex ? 'ring-1 ring-inset ring-primary/50' : '',
        ]"
        @pointerenter="!option.disabled && (activeIndex = index)"
        @click="choose(index)"
      >
        <span class="w-full text-center">{{ option.label }}</span>
      </button>
    </div>
  </Teleport>
</template>
