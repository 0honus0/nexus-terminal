<script setup lang="ts">
  import { computed, useAttrs } from 'vue';
  import type { UiDensity } from './uiTypes';

  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();
  const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
  const selectAttrs = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs;
    return rest;
  });
  const model = defineModel<string | number | null>({ default: null });
  const props = withDefaults(
    defineProps<{
      invalid?: boolean;
      disabled?: boolean;
      density?: UiDensity;
    }>(),
    {
      invalid: false,
      disabled: false,
      density: 'default',
    },
  );
</script>

<template>
  <div
    v-bind="rootAttrs"
    data-ui="native-select"
    data-ui-gen="2"
    :data-density="props.density"
    :data-invalid="props.invalid || undefined"
    :data-disabled="props.disabled || undefined"
    class="ui-native-select"
  >
    <select
      v-model="model"
      v-bind="selectAttrs"
      data-no-highlight=""
      :disabled="props.disabled"
      :aria-invalid="props.invalid || undefined"
      class="ui-control ui-focusable ui-native-select__control"
    >
      <slot />
    </select>
    <span class="ui-native-select__icon" aria-hidden="true">
      <svg viewBox="0 0 12 12" fill="none">
        <path
          d="M2.6 4.6L6 8L9.4 4.6"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  </div>
</template>
