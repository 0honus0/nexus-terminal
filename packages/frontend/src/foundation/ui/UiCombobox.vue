<script setup lang="ts">
  import {
    ComboboxAnchor,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxItemIndicator,
    ComboboxPortal,
    ComboboxRoot,
    ComboboxTrigger,
    ComboboxViewport,
  } from 'reka-ui';
  import { computed, ref, useAttrs } from 'vue';
  import type { UiComboboxOption, UiDensity, UiSelectValue } from './uiTypes';

  // Layout attrs stay on the wrapper; accessibility attrs belong on the real
  // combobox input so the closed control always has a keyboard/focus entry.
  defineOptions({ inheritAttrs: false });

  const attrs = useAttrs();
  const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
  const inputAttrs = computed(() => {
    const { class: _class, style: _style, ...rest } = attrs;
    return rest;
  });

  const model = defineModel<UiSelectValue | null>({ default: null });

  const props = withDefaults(
    defineProps<{
      options: UiComboboxOption[];
      placeholder?: string;
      searchPlaceholder?: string;
      emptyText?: string;
      density?: UiDensity;
      disabled?: boolean;
      invalid?: boolean;
      align?: 'start' | 'center' | 'end';
      panelClass?: string;
      inputClass?: string;
      name?: string;
      /** Allow text search once the option count grows past this size. */
      searchThreshold?: number;
    }>(),
    {
      placeholder: '',
      searchPlaceholder: '',
      emptyText: '',
      density: 'default',
      disabled: false,
      invalid: false,
      align: 'start',
      panelClass: '',
      inputClass: '',
      name: undefined,
      searchThreshold: 3,
    },
  );

  defineSlots<{
    meta?: (props: { open: boolean; selected: UiComboboxOption | null }) => unknown;
    option?: (props: { option: UiComboboxOption; selected: boolean }) => unknown;
  }>();

  const open = ref(false);

  const selectedOption = computed<UiComboboxOption | null>(
    () => props.options.find((option) => option.value === model.value) ?? null,
  );

  const showSearch = computed(() => props.options.length > props.searchThreshold);

  // Reka filters items by their registered text value; folding label, description
  // and keywords together lets the query match either the model id or the provider.
  const filterText = (option: UiComboboxOption): string =>
    [option.label, option.description, option.keywords].filter(Boolean).join(' ');

  // Reka types the model as `AcceptableValue | AcceptableValue[]`; this wrapper
  // narrows both directions to a single string | number | null value like UiSelect.
  const onUpdateModelValue = (value: unknown): void => {
    const resolved = Array.isArray(value) ? value[0] : value;
    if (typeof resolved === 'string' || typeof resolved === 'number') {
      model.value = resolved;
      return;
    }
    model.value = null;
  };

  const displayValue = (value: unknown): string => {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return props.options.find((option) => option.value === value)?.label ?? '';
  };

  const selectInputText = (event: FocusEvent): void => {
    if (!showSearch.value) return;
    const input = event.target;
    if (input instanceof HTMLInputElement) input.select();
  };
</script>

<template>
  <ComboboxRoot
    v-model:open="open"
    :model-value="model"
    :disabled="props.disabled"
    :name="props.name"
    :open-on-click="true"
    :reset-search-term-on-blur="true"
    :reset-search-term-on-select="true"
    @update:model-value="onUpdateModelValue"
  >
    <ComboboxAnchor
      v-bind="rootAttrs"
      data-ui="combobox"
      data-ui-gen="2"
      :data-density="props.density"
      :data-invalid="props.invalid || undefined"
      :data-disabled="props.disabled || undefined"
      :data-state="open ? 'open' : 'closed'"
      class="ui-combobox"
    >
      <div
        class="ui-control ui-combobox__anchor"
        :class="{
          'ui-combobox__anchor--invalid': props.invalid,
          'ui-combobox__anchor--disabled': props.disabled,
        }"
      >
        <span v-if="showSearch" class="ui-combobox__search-icon" aria-hidden="true">
          <svg viewBox="0 0 12 12" fill="none">
            <circle cx="5.2" cy="5.2" r="3.4" stroke="currentColor" stroke-width="1.4" />
            <path d="M7.8 7.8L10.4 10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </span>
        <ComboboxInput
          v-bind="inputAttrs"
          data-no-highlight=""
          :disabled="props.disabled"
          :readonly="!showSearch"
          :display-value="displayValue"
          :aria-invalid="props.invalid || undefined"
          :placeholder="open && showSearch ? props.searchPlaceholder || props.placeholder : props.placeholder"
          class="ui-combobox__input"
          :class="props.inputClass"
          @focus="selectInputText"
        />
        <span v-if="$slots.meta" class="ui-combobox__meta">
          <slot name="meta" :open="open" :selected="selectedOption" />
        </span>
        <ComboboxTrigger class="ui-combobox__trigger" :disabled="props.disabled">
          <span class="ui-select__icon ui-combobox__icon" aria-hidden="true">
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
        </ComboboxTrigger>
      </div>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        data-ui="combobox-panel"
        data-ui-gen="2"
        :data-density="props.density"
        position="popper"
        :align="props.align"
        :side-offset="0"
        :collision-padding="12"
        :avoid-collisions="true"
        class="ui-surface ui-radius--panel ui-combobox__panel glass-surface"
        :class="props.panelClass"
      >
        <ComboboxViewport class="ui-select__viewport ui-combobox__viewport">
          <ComboboxItem
            v-for="option in props.options"
            :key="option.value"
            :value="option.value"
            :text-value="filterText(option)"
            :disabled="option.disabled"
            class="ui-select__item ui-combobox__item ui-focusable"
          >
            <span class="ui-select__item-indicator">
              <ComboboxItemIndicator>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M2.6 6.3L4.9 8.6L9.4 3.6"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </ComboboxItemIndicator>
            </span>
            <span class="ui-select__item-body ui-combobox__item-body">
              <slot name="option" :option="option" :selected="option.value === model">
                <span class="ui-select__item-label">{{ option.label }}</span>
                <span v-if="option.description" class="ui-select__item-description">{{ option.description }}</span>
              </slot>
            </span>
          </ComboboxItem>
          <ComboboxEmpty class="ui-combobox__empty">{{ props.emptyText }}</ComboboxEmpty>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
