<script setup lang="ts">
  import { computed, useAttrs } from 'vue';
  import type { UiDensity } from './uiTypes';

  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();
  const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
  const textareaAttrs = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs;
    return rest;
  });
  const model = defineModel<string>({ default: '' });
  const props = withDefaults(
    defineProps<{
      density?: UiDensity;
      invalid?: boolean;
      disabled?: boolean;
      resize?: 'none' | 'vertical' | 'both';
      minRows?: number;
    }>(),
    {
      density: 'default',
      invalid: false,
      disabled: false,
      resize: 'vertical',
      minRows: 3,
    },
  );
</script>

<template>
  <div
    v-bind="rootAttrs"
    data-ui="textarea"
    data-ui-gen="2"
    :data-density="props.density"
    :data-resize="props.resize"
    :data-invalid="props.invalid || undefined"
    :data-disabled="props.disabled || undefined"
    class="ui-control ui-textarea"
    :class="{ 'ui-textarea--invalid': props.invalid, 'ui-textarea--disabled': props.disabled }"
  >
    <textarea
      v-model="model"
      v-bind="textareaAttrs"
      data-no-highlight=""
      :rows="props.minRows"
      :disabled="props.disabled"
      :aria-invalid="props.invalid || undefined"
      class="ui-textarea__control"
    />
  </div>
</template>
