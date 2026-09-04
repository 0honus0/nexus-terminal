<script setup lang="ts">
  import { formControlBaseClass } from './formControlClasses';

  defineOptions({ inheritAttrs: false });

  const model = defineModel<string | number | null>({ default: null });
  const props = withDefaults(defineProps<{ invalid?: boolean; disabled?: boolean }>(), {
    invalid: false,
    disabled: false,
  });
</script>

<template>
  <select
    v-model="model"
    v-bind="$attrs"
    :disabled="props.disabled"
    :class="[formControlBaseClass, 'bg-background px-3 py-2 text-sm', props.invalid ? 'border-error' : 'border-border']"
    :aria-invalid="props.invalid || undefined"
  >
    <slot />
  </select>
</template>
