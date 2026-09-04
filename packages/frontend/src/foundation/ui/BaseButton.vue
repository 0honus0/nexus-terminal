<script setup lang="ts">
  import { computed } from 'vue';
  import type { ButtonVariant, UiSize } from './types';

  defineOptions({ inheritAttrs: false });

  const props = withDefaults(
    defineProps<{
      variant?: ButtonVariant;
      size?: UiSize;
      type?: 'button' | 'submit' | 'reset';
      disabled?: boolean;
      loading?: boolean;
      block?: boolean;
    }>(),
    {
      variant: 'secondary',
      size: 'md',
      type: 'button',
      disabled: false,
      loading: false,
      block: false,
    },
  );

  const sizeClass = computed(() => {
    if (props.size === 'sm') return 'px-3 py-1.5 text-xs';
    if (props.size === 'lg') return 'px-5 py-2.5 text-base';
    return 'px-4 py-2 text-sm';
  });

  const variantClass = computed(() => {
    if (props.variant === 'primary') {
      return 'border border-transparent bg-button text-button-text hover:bg-button-hover focus-visible:ring-primary';
    }
    if (props.variant === 'danger') {
      return 'border border-transparent bg-error text-error-text hover:opacity-90 focus-visible:ring-error';
    }
    if (props.variant === 'ghost') {
      return 'border border-transparent bg-transparent text-text-secondary hover:bg-header hover:text-foreground focus-visible:ring-primary';
    }
    return 'border border-border bg-background text-text-secondary hover:bg-header hover:text-foreground focus-visible:ring-primary';
  });
</script>

<template>
  <button
    v-bind="$attrs"
    :type="props.type"
    :disabled="props.disabled || props.loading"
    class="inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    :class="[sizeClass, variantClass, { 'w-full': props.block }]"
    :aria-busy="props.loading || undefined"
  >
    <slot name="leading" :loading="props.loading" />
    <slot />
    <slot name="trailing" :loading="props.loading" />
  </button>
</template>
