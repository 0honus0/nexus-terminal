<script setup lang="ts">
  import type { UiAppearance, UiDensity, UiTone } from './uiTypes';

  const props = withDefaults(
    defineProps<{
      appearance?: UiAppearance;
      tone?: UiTone;
      density?: UiDensity;
      type?: 'button' | 'submit' | 'reset';
      disabled?: boolean;
      loading?: boolean;
      block?: boolean;
      iconOnly?: boolean;
    }>(),
    {
      appearance: 'soft',
      tone: 'neutral',
      density: 'default',
      type: 'button',
      disabled: false,
      loading: false,
      block: false,
      iconOnly: false,
    },
  );
</script>

<template>
  <button
    data-ui="button"
    data-ui-gen="2"
    :data-appearance="props.appearance"
    :data-tone="props.tone"
    :data-density="props.density"
    :type="props.type"
    :disabled="props.disabled || props.loading"
    :aria-busy="props.loading || undefined"
    class="ui-control ui-focusable ui-button"
    :class="[
      `ui-button--${props.appearance}`,
      props.appearance === 'glass' && 'glass-surface',
      props.block && 'ui-button--block',
      props.iconOnly && 'ui-button--icon-only',
    ]"
  >
    <span v-if="props.loading" class="ui-button__spinner" aria-hidden="true"></span>
    <slot v-else name="leading" />
    <slot />
    <slot name="trailing" />
  </button>
</template>
