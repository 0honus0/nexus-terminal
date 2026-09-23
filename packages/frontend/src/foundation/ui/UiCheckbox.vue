<script setup lang="ts">
  import { CheckboxIndicator, CheckboxRoot } from 'reka-ui';
  import { useAttrs } from 'vue';
  import type { UiDensity, UiTone } from './uiTypes';

  // CheckboxRoot is the public root, so caller class/style merge with the Gen 2
  // classes bound below and every other attribute (aria-label, id, listeners)
  // lands on the interactive control itself rather than a wrapper.
  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();

  const model = defineModel<boolean>({ default: false });
  const props = withDefaults(
    defineProps<{
      density?: UiDensity;
      tone?: UiTone;
      disabled?: boolean;
      name?: string;
      id?: string;
      value?: string | number;
    }>(),
    {
      density: 'default',
      tone: 'primary',
      disabled: false,
    },
  );

  // Reka models a tri-state checkbox; this wrapper owns a plain boolean, so it
  // collapses `indeterminate` back to unchecked instead of widening the API.
  const onUpdateModelValue = (value: boolean | 'indeterminate'): void => {
    model.value = value === true;
  };
</script>

<template>
  <CheckboxRoot
    v-bind="attrs"
    :model-value="model"
    data-ui="checkbox"
    data-ui-gen="2"
    :data-tone="props.tone"
    :data-density="props.density"
    :disabled="props.disabled"
    :name="props.name"
    :id="props.id"
    :value="props.value"
    class="ui-focusable ui-checkbox"
    @update:model-value="onUpdateModelValue"
  >
    <CheckboxIndicator class="ui-checkbox__indicator">
      <svg class="ui-checkbox__check" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M2.6 6.3L4.9 8.6L9.4 3.6"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
