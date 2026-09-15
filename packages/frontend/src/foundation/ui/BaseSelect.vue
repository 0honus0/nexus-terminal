<script setup lang="ts">
  import { computed } from 'vue';
  import type { UiSize } from './types';
  import { getFormControlClass } from './formControlClasses';

  defineOptions({ inheritAttrs: false });

  const model = defineModel<string | number | null>({ default: null });
  const props = withDefaults(
    defineProps<{
      invalid?: boolean;
      disabled?: boolean;
      highlight?: boolean;
      size?: UiSize;
    }>(),
    {
      invalid: false,
      disabled: false,
      highlight: false,
      size: 'md',
    },
  );

  const sizeClass = computed(() => {
    if (props.size === 'sm') return 'h-8.5 py-1 pl-2.5 pr-7 text-xs leading-normal rounded-lg';
    if (props.size === 'lg') return 'h-11 py-2 pl-4 pr-9 text-base leading-normal rounded-xl';
    return 'h-10 py-1.5 pl-3 pr-8 text-sm leading-normal rounded-lg';
  });
</script>

<template>
  <div class="relative block w-full min-w-0">
    <select
      v-model="model"
      v-bind="$attrs"
      :disabled="props.disabled"
      :data-no-highlight="!props.highlight ? '' : undefined"
      :class="[
        getFormControlClass({ highlight: props.highlight, invalid: props.invalid }),
        'appearance-none -webkit-appearance-none bg-input cursor-pointer',
        sizeClass,
        props.invalid ? 'border-error' : 'border-border/80 hover:border-border',
        !props.highlight && 'focus:border-foreground/35 focus:ring-0 focus:shadow-none focus:outline-none',
      ]"
      :aria-invalid="props.invalid || undefined"
    >
      <slot />
    </select>
    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-text-secondary">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" class="text-text-secondary">
        <path
          d="M2.5 4.5L6 8L9.5 4.5"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
  </div>
</template>
