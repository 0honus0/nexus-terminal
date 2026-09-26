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

  const props = withDefaults(
    defineProps<{
      // Accepts a nullable value so a caller can start empty and let the trigger
      // show its placeholder, but every update hands back a real option value.
      modelValue?: UiSelectValue | null;
      options: UiSelectOption[];
      placeholder?: string;
      density?: UiDensity;
      disabled?: boolean;
      invalid?: boolean;
      align?: 'start' | 'center' | 'end';
      panelClass?: string;
      name?: string;
      hideIndicator?: boolean;
      triggerClass?: string;
      panelTestId?: string;
      optionTestIdPrefix?: string;
    }>(),
    {
      modelValue: null,
      placeholder: '',
      density: 'default',
      disabled: false,
      invalid: false,
      align: 'start',
      panelClass: '',
      hideIndicator: true,
      triggerClass: '',
      panelTestId: undefined,
      optionTestIdPrefix: undefined,
    },
  );

  const emit = defineEmits<{ 'update:modelValue': [value: UiSelectValue] }>();

  const emptyValueSentinel = computed(() => {
    let candidate = '__nexus_ui_select_empty__';
    const used = new Set(props.options.map((option) => option.value));
    while (used.has(candidate)) candidate += '_';
    return candidate;
  });
  const internalModelValue = computed(() => (props.modelValue === '' ? emptyValueSentinel.value : props.modelValue));
  const internalOptionValue = (value: UiSelectValue): UiSelectValue =>
    value === '' ? emptyValueSentinel.value : value;

  const selectedLabel = computed(() => {
    const selected = props.options.find((option) => option.value === props.modelValue);
    return selected?.triggerLabel ?? selected?.label ?? props.placeholder;
  });

  // Reka types the model as `AcceptableValue | AcceptableValue[]`; this wrapper
  // narrows it to a single string | number value.
  const onUpdateModelValue = (value: unknown): void => {
    const resolved = Array.isArray(value) ? value[0] : value;
    if (resolved === emptyValueSentinel.value) {
      emit('update:modelValue', '');
      return;
    }
    if (typeof resolved === 'string' || typeof resolved === 'number') emit('update:modelValue', resolved);
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
      :model-value="internalModelValue"
      :disabled="props.disabled"
      :name="props.name"
      @update:model-value="onUpdateModelValue"
    >
      <SelectTrigger
        v-bind="triggerAttrs"
        data-no-highlight=""
        :data-value="props.modelValue == null ? '' : String(props.modelValue)"
        :aria-invalid="props.invalid || undefined"
        class="ui-control ui-focusable ui-select__trigger"
        :class="[
          { 'ui-select__trigger--invalid': props.invalid, 'ui-select__trigger--disabled': props.disabled },
          props.triggerClass,
        ]"
      >
        <span class="ui-select__value">{{ selectedLabel }}</span>
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
          :data-testid="props.panelTestId"
          :data-density="props.density"
          :data-hide-indicator="props.hideIndicator || undefined"
          position="popper"
          :align="props.align"
          :side-offset="6"
          :collision-padding="12"
          :avoid-collisions="true"
          class="ui-surface ui-radius--panel ui-select__panel glass-surface"
          :class="[{ 'ui-select__panel--no-indicator': props.hideIndicator }, props.panelClass]"
        >
          <SelectViewport class="ui-select__viewport">
            <SelectItem
              v-for="(option, index) in props.options"
              :key="index"
              :data-testid="
                props.optionTestIdPrefix
                  ? `${props.optionTestIdPrefix}-${option.value === '' ? 'all' : String(option.value)}`
                  : undefined
              "
              :value="internalOptionValue(option.value)"
              :disabled="option.disabled"
              :text-value="option.label"
              class="ui-select__item ui-focusable"
            >
              <span v-if="!props.hideIndicator" class="ui-select__item-indicator">
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
