<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId, watch } from 'vue';
  import type { UiSize } from './types';

  defineOptions({ inheritAttrs: false });

  export interface BaseListboxOption {
    value: string | number;
    label: string;
    disabled?: boolean;
    description?: string;
  }

  const model = defineModel<string | number | null>({ default: null });
  const props = withDefaults(
    defineProps<{
      options: BaseListboxOption[];
      disabled?: boolean;
      placeholder?: string;
      panelTestId?: string;
      optionTestIdPrefix?: string;
      highlight?: boolean;
      size?: UiSize;
      align?: 'left' | 'center';
      triggerClass?: string;
      minWidth?: string;
    }>(),
    {
      disabled: false,
      placeholder: '',
      panelTestId: undefined,
      optionTestIdPrefix: undefined,
      highlight: false,
      size: 'md',
      align: 'left',
      triggerClass: '',
      minWidth: undefined,
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
  const selectedOption = computed(() => props.options[selectedIndex.value]);
  const selectedLabel = computed(() => {
    return selectedOption.value?.label ?? props.placeholder;
  });

  const activeOptionId = computed(() => {
    if (!visible.value || activeIndex.value < 0) return undefined;
    return `${listboxId}-option-${activeIndex.value}`;
  });

  const sizeStyles = computed(() => {
    if (props.size === 'sm') {
      return {
        trigger: 'h-8 px-2.5 text-xs rounded-lg gap-1.5',
        item: 'py-1.5 px-2 text-xs rounded-md',
        icon: 'text-[9px]',
      };
    }
    if (props.size === 'lg') {
      return {
        trigger: 'h-11 px-3.5 text-base rounded-xl gap-2',
        item: 'py-2.5 px-3 text-base rounded-lg',
        icon: 'text-xs',
      };
    }
    return {
      trigger: 'h-9.5 px-3 text-sm rounded-lg gap-2',
      item: 'py-2 px-2.5 text-sm rounded-lg',
      icon: 'text-[10px]',
    };
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
    const menuWidth = Math.max(rect.width, 140);
    width.value = menuWidth;
    left.value = Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin));

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
    const start =
      activeIndex.value < 0 ? (direction === 1 ? 0 : props.options.length - 1) : activeIndex.value + direction;
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
    :data-no-highlight="!props.highlight ? '' : undefined"
    class="group relative flex select-none items-center border bg-input text-foreground transition-all duration-150 outline-none disabled:cursor-not-allowed disabled:border-[var(--input-disabled-border-color)] disabled:bg-[var(--input-disabled-bg-color)] disabled:text-[var(--input-disabled-text-color)] disabled:opacity-100"
    :class="[
      sizeStyles.trigger,
      props.align === 'center' ? 'justify-center text-center' : 'justify-between text-left',
      props.highlight
        ? 'border-border focus:border-input-focus-border focus:ring-1 focus:ring-[var(--input-focus-glow)]'
        : 'border-border/80 hover:border-border hover:bg-input/90 focus:border-foreground/35 focus:ring-0 focus:shadow-none focus:outline-none',
      props.triggerClass,
    ]"
    :style="{ minWidth: props.minWidth }"
    @click="toggle"
    @keydown="handleKeydown"
  >
    <span class="min-w-0 flex-1 truncate leading-none" :class="props.align === 'center' ? 'text-center' : 'text-left'">
      {{ selectedLabel }}
    </span>
    <svg
      class="pointer-events-none shrink-0 text-text-secondary transition-transform duration-200"
      :class="[sizeStyles.icon, visible ? 'rotate-180 text-foreground' : 'group-hover:text-foreground']"
      viewBox="0 0 12 12"
      fill="none"
      width="11"
      height="11"
      aria-hidden="true"
    >
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
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
      class="fixed z-[180] max-h-[min(20rem,calc(100dvh-1rem))] overflow-y-auto rounded-xl border border-border/80 bg-input/95 p-1 text-foreground shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      :style="{ left: `${left}px`, top: `${top}px`, minWidth: `${width}px` }"
    >
      <button
        v-for="(option, index) in props.options"
        :id="`${listboxId}-option-${index}`"
        :key="`${typeof option.value}:${String(option.value)}`"
        type="button"
        role="option"
        :aria-selected="option.value === model"
        :disabled="option.disabled"
        :data-testid="
          props.optionTestIdPrefix
            ? `${props.optionTestIdPrefix}-${option.value === '' ? 'all' : String(option.value)}`
            : undefined
        "
        class="flex w-full select-none items-center justify-between outline-none transition-colors duration-100 disabled:cursor-default disabled:opacity-50"
        :class="[
          sizeStyles.item,
          option.value === model ? 'bg-primary/10 font-medium text-primary' : 'text-foreground hover:bg-header/80',
          index === activeIndex ? 'ring-1 ring-inset ring-foreground/20' : '',
        ]"
        @pointerenter="!option.disabled && (activeIndex = index)"
        @click="choose(index)"
      >
        <span class="truncate pr-2 text-left">{{ option.label }}</span>
        <svg
          v-if="option.value === model"
          class="shrink-0 text-primary"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M10 3L4.5 8.5L2 6"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </Teleport>
</template>
