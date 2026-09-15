<script setup lang="ts">
  import { computed, ref } from 'vue';
  import type { UiSize } from './types';
  import { getFormControlClass } from './formControlClasses';

  defineOptions({ inheritAttrs: false });

  const input = ref<HTMLInputElement | null>(null);
  const model = defineModel<string | number | null>({ default: '' });
  const props = withDefaults(
    defineProps<{
      type?: string;
      size?: UiSize;
      invalid?: boolean;
      disabled?: boolean;
      highlight?: boolean;
    }>(),
    { type: 'text', size: 'md', invalid: false, disabled: false, highlight: false },
  );

  const sizeClass = computed(() => {
    if (props.size === 'sm') return 'px-2.5 py-1.5 text-xs';
    if (props.size === 'lg') return 'px-4 py-2.5 text-base';
    return 'px-3 py-2 text-sm';
  });
  defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select() });
</script>

<template>
  <input
    ref="input"
    v-model="model"
    v-bind="$attrs"
    :type="props.type"
    :disabled="props.disabled"
    :data-no-highlight="!props.highlight ? '' : undefined"
    :class="[
      getFormControlClass({ highlight: props.highlight, invalid: props.invalid }),
      'bg-input',
      sizeClass,
      !props.highlight && 'focus:border-foreground/30 focus:ring-0 focus:shadow-none',
    ]"
    :aria-invalid="props.invalid || undefined"
  />
</template>
