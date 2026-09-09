<script setup lang="ts">
  import { formControlBaseClass } from './formControlClasses';

  defineOptions({ inheritAttrs: false });

  const model = defineModel<string>({ default: '' });
  const props = withDefaults(defineProps<{ invalid?: boolean; disabled?: boolean }>(), {
    invalid: false,
    disabled: false,
  });
</script>

<template>
  <textarea
    v-model="model"
    v-bind="$attrs"
    :disabled="props.disabled"
    :class="[formControlBaseClass, 'bg-input px-3 py-2 text-sm', props.invalid ? 'border-error' : 'border-border']"
    :aria-invalid="props.invalid || undefined"
  />
</template>
