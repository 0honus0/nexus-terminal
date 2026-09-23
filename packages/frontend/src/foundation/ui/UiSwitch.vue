<script setup lang="ts">
  import { SwitchRoot, SwitchThumb } from 'reka-ui';
  import type { UiDensity, UiTone } from './uiTypes';

  const model = defineModel<boolean>({ default: false });
  const props = withDefaults(
    defineProps<{
      density?: UiDensity;
      tone?: UiTone;
      disabled?: boolean;
      name?: string;
      id?: string;
    }>(),
    {
      density: 'default',
      tone: 'primary',
      disabled: false,
    },
  );
</script>

<template>
  <SwitchRoot
    v-model="model"
    data-ui="switch"
    data-ui-gen="2"
    :data-tone="props.tone"
    :data-density="props.density"
    :disabled="props.disabled"
    :name="props.name"
    :id="props.id"
    class="ui-focusable ui-switch"
  >
    <SwitchThumb class="ui-switch__thumb" />
  </SwitchRoot>
</template>
