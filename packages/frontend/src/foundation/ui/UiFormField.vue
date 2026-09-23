<script setup lang="ts">
  import type { UiDensity } from './uiTypes';

  const props = withDefaults(
    defineProps<{
      label?: string;
      description?: string;
      error?: string;
      required?: boolean;
      forId?: string;
      density?: UiDensity;
    }>(),
    {
      label: undefined,
      description: undefined,
      error: undefined,
      required: false,
      forId: undefined,
      density: 'default',
    },
  );
</script>

<template>
  <div data-ui="form-field" data-ui-gen="2" :data-density="props.density" class="ui-form-field">
    <label v-if="props.label || $slots.label" :for="props.forId" class="ui-form-field__label">
      <slot name="label">{{ props.label }}</slot>
      <span v-if="props.required" aria-hidden="true" class="ui-form-field__required">*</span>
    </label>
    <slot />
    <p v-if="props.error" class="ui-form-field__error" role="alert">{{ props.error }}</p>
    <p v-else-if="props.description" class="ui-form-field__description">{{ props.description }}</p>
  </div>
</template>
