<script setup lang="ts">
  import { getFormControlClass } from './formControlClasses';

  defineOptions({ inheritAttrs: false });

  const model = defineModel<string>({ default: '' });
  const props = withDefaults(
    defineProps<{
      invalid?: boolean;
      disabled?: boolean;
      highlight?: boolean;
    }>(),
    {
      invalid: false,
      disabled: false,
      highlight: false,
    },
  );
</script>

<template>
  <textarea
    v-model="model"
    v-bind="$attrs"
    :disabled="props.disabled"
    :data-no-highlight="!props.highlight ? '' : undefined"
    :class="[
      getFormControlClass({ highlight: props.highlight, invalid: props.invalid }),
      'bg-input px-3 py-2 text-sm',
      !props.highlight && 'focus:border-foreground/30 focus:ring-0 focus:shadow-none',
    ]"
    :aria-invalid="props.invalid || undefined"
  />
</template>
