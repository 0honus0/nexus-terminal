<script setup lang="ts">
  import { computed, useAttrs } from 'vue';
  import type { UiDensity } from './uiTypes';

  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();
  const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
  const inputAttrs = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs;
    return rest;
  });
  const model = defineModel<string | number | null>({ default: '' });
  const props = withDefaults(
    defineProps<{
      type?: string;
      density?: UiDensity;
      invalid?: boolean;
      disabled?: boolean;
    }>(),
    {
      type: 'text',
      density: 'default',
      invalid: false,
      disabled: false,
    },
  );
</script>

<template>
  <div
    v-bind="rootAttrs"
    data-ui="input"
    data-ui-gen="2"
    :data-density="props.density"
    :data-invalid="props.invalid || undefined"
    :data-disabled="props.disabled || undefined"
    class="ui-control ui-input"
    :class="{ 'ui-input--invalid': props.invalid, 'ui-input--disabled': props.disabled }"
  >
    <span v-if="$slots.leading" class="ui-input__adornment" aria-hidden="true">
      <slot name="leading" />
    </span>
    <input
      v-model="model"
      v-bind="inputAttrs"
      data-no-highlight=""
      :type="props.type"
      :disabled="props.disabled"
      :aria-invalid="props.invalid || undefined"
      class="ui-input__control"
    />
    <span v-if="$slots.trailing" class="ui-input__adornment" aria-hidden="true">
      <slot name="trailing" />
    </span>
  </div>
</template>
