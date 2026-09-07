<script setup lang="ts">
  defineOptions({ inheritAttrs: false });

  const model = defineModel<boolean>({ default: false });
  const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });
</script>

<template>
  <input
    v-model="model"
    v-bind="$attrs"
    type="checkbox"
    :disabled="props.disabled"
    class="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
  />
</template>
