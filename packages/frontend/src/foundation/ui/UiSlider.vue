<script setup lang="ts">
  import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from 'reka-ui';
  import { computed } from 'vue';
  import type { UiDensity, UiTone } from './uiTypes';

  // Arbitrary attrs (notably `aria-label`) belong on the thumb: that is the
  // element Reka renders with role="slider".
  defineOptions({ inheritAttrs: false });

  const model = defineModel<number>({ default: 0 });
  const props = withDefaults(
    defineProps<{
      min?: number;
      max?: number;
      step?: number;
      density?: UiDensity;
      tone?: UiTone;
      disabled?: boolean;
    }>(),
    {
      min: 0,
      max: 100,
      step: 1,
      density: 'default',
      tone: 'primary',
      disabled: false,
    },
  );

  // Reka models a slider as an array of thumb values. This wrapper owns exactly
  // one value, so it normalises both directions at the primitive boundary.
  const rekaValue = computed<number[]>(() => [model.value]);

  const onValueChange = (value: number[] | undefined): void => {
    const next = value?.[0];
    if (typeof next === 'number') model.value = next;
  };
</script>

<template>
  <div
    data-ui="slider"
    data-ui-gen="2"
    :data-tone="props.tone"
    :data-density="props.density"
    :data-disabled="props.disabled || undefined"
    class="ui-slider"
  >
    <div v-if="$slots.label || $slots.value" class="ui-slider__meta">
      <span><slot name="label" /></span>
      <span class="ui-slider__value"
        ><slot name="value" :value="model">{{ model }}</slot></span
      >
    </div>
    <!-- The Reka root only wraps track + thumb so percentage maths and the thumb
         offset stay relative to the track, not to the optional meta row. -->
    <SliderRoot
      :model-value="rekaValue"
      :min="props.min"
      :max="props.max"
      :step="props.step"
      :disabled="props.disabled"
      class="ui-slider__root"
      @update:model-value="onValueChange"
    >
      <SliderTrack class="ui-slider__track">
        <SliderRange class="ui-slider__range" />
      </SliderTrack>
      <SliderThumb v-bind="$attrs" class="ui-slider__thumb" />
    </SliderRoot>
  </div>
</template>
