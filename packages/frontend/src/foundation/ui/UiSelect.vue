<script setup lang="ts">
  import {
    SelectContent,
    SelectIcon,
    SelectItem,
    SelectItemIndicator,
    SelectItemText,
    SelectPortal,
    SelectRoot,
    SelectTrigger,
    SelectValue,
    SelectViewport,
  } from 'reka-ui';
  import { computed, useAttrs } from 'vue';
  import type { UiDensity, UiSelectOption, UiSelectValue } from './uiTypes';

  // The wrapper div only owns layout classes; every other attribute (notably
  // `aria-label`) belongs on the trigger, which is the real combobox control.
  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();
  const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
  const triggerAttrs = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs;
    return rest;
  });

  const model = defineModel<UiSelectValue | null>({ default: null });
  const props = withDefaults(
    defineProps<{
      options: UiSelectOption[];
      placeholder?: string;
      density?: UiDensity;
      disabled?: boolean;
      invalid?: boolean;
      align?: 'start' | 'center' | 'end';
      panelClass?: string;
      name?: string;
    }>(),
    {
      placeholder: '',
      density: 'default',
      disabled: false,
      invalid: false,
      align: 'start',
      panelClass: '',
    },
  );

  // Reka types the model as `AcceptableValue | AcceptableValue[]`; this wrapper
  // narrows both directions to a single string | number | null value.
  const onUpdateModelValue = (value: unknown): void => {
    const resolved = Array.isArray(value) ? value[0] : value;
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      model.value = resolved;
      return;
    }
    model.value = null;
  };
</script>

<template>
  <div
    v-bind="rootAttrs"
    data-ui="select"
    data-ui-gen="2"
    :data-density="props.density"
    :data-invalid="props.invalid || undefined"
    :data-disabled="props.disabled || undefined"
    class="ui-select"
  >
    <SelectRoot
      :model-value="model"
      :disabled="props.disabled"
      :name="props.name"
      @update:model-value="onUpdateModelValue"
    >
      <SelectTrigger
        v-bind="triggerAttrs"
        data-no-highlight=""
        :aria-invalid="props.invalid || undefined"
        class="ui-control ui-focusable ui-select__trigger"
        :class="{ 'ui-select__trigger--invalid': props.invalid, 'ui-select__trigger--disabled': props.disabled }"
      >
        <SelectValue :placeholder="props.placeholder" class="ui-select__value" />
        <SelectIcon class="ui-select__icon">
          <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2.6 4.6L6 8L9.4 4.6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </SelectIcon>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent
          data-ui="select-panel"
          data-ui-gen="2"
          :data-density="props.density"
          position="popper"
          :align="props.align"
          :side-offset="6"
          :collision-padding="12"
          :avoid-collisions="true"
          class="ui-surface ui-radius--panel ui-select__panel glass-surface"
          :class="props.panelClass"
        >
          <SelectViewport class="ui-select__viewport">
            <SelectItem
              v-for="(option, index) in props.options"
              :key="index"
              :value="option.value"
              :disabled="option.disabled"
              :text-value="option.label"
              class="ui-select__item ui-focusable"
            >
              <span class="ui-select__item-indicator">
                <SelectItemIndicator>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2.6 6.3L4.9 8.6L9.4 3.6"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </SelectItemIndicator>
              </span>
              <span class="ui-select__item-body">
                <SelectItemText class="ui-select__item-label">{{ option.label }}</SelectItemText>
                <span v-if="option.description" class="ui-select__item-description">{{ option.description }}</span>
              </span>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
