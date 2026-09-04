<script setup lang="ts">
  import { computed, ref } from 'vue';
  import BaseButton from './BaseButton.vue';
  import BaseInput from './BaseInput.vue';

  export interface TokenOption {
    value: string | number;
    label: string;
  }

  const model = defineModel<Array<string | number>>({ default: () => [] });
  const props = withDefaults(
    defineProps<{
      options?: readonly TokenOption[];
      placeholder?: string;
      disabled?: boolean;
      allowCustom?: boolean;
      allowOptionDelete?: boolean;
      removeTokenLabel?: string;
      deleteOptionLabel?: string;
      inputTestId?: string;
      tokenTestId?: string;
    }>(),
    {
      options: () => [],
      placeholder: '',
      disabled: false,
      allowCustom: false,
      allowOptionDelete: false,
      removeTokenLabel: '',
      deleteOptionLabel: '',
    },
  );
  const emit = defineEmits<{ create: [label: string]; deleteOption: [option: TokenOption] }>();
  const query = ref('');
  const focused = ref(false);

  const optionFor = (value: string | number) => props.options.find((option) => option.value === value);
  const labelFor = (value: string | number) => optionFor(value)?.label ?? String(value);
  const filteredOptions = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return props.options.filter(
      (option) => !model.value.includes(option.value) && (!needle || option.label.toLowerCase().includes(needle)),
    );
  });
  const suggestionsVisible = computed(() => focused.value && filteredOptions.value.length > 0);

  const add = (value: string | number) => {
    if (!model.value.includes(value)) model.value = [...model.value, value];
    query.value = '';
  };
  const remove = (value: string | number) => {
    model.value = model.value.filter((item) => item !== value);
  };
  const create = () => {
    const label = query.value.trim();
    if (!label) return;
    emit('create', label);
    query.value = '';
  };
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      const label = query.value.trim();
      if (!label) return;
      event.preventDefault();
      const exact = props.options.find(
        (option) => !model.value.includes(option.value) && option.label.toLowerCase() === label.toLowerCase(),
      );
      if (exact) add(exact.value);
      else if (props.allowCustom) create();
      return;
    }
    if (event.key === 'Backspace' && !query.value && model.value.length > 0) {
      event.preventDefault();
      remove(model.value.at(-1)!);
      return;
    }
    if (event.key === 'Escape') focused.value = false;
  };
</script>

<template>
  <div class="rounded-md border border-border bg-input p-2">
    <div v-if="model.length" class="mb-2 flex flex-wrap gap-1.5">
      <span
        v-for="value in model"
        :key="String(value)"
        :data-testid="props.tokenTestId"
        class="inline-flex items-center gap-1 rounded-full bg-nav-active-bg px-2 py-1 text-xs text-foreground"
      >
        {{ labelFor(value) }}
        <button
          type="button"
          class="text-text-secondary hover:text-error"
          :disabled="disabled"
          :aria-label="removeTokenLabel || undefined"
          :title="removeTokenLabel || undefined"
          @click="remove(value)"
        >
          ×
        </button>
        <button
          v-if="allowOptionDelete && optionFor(value)"
          type="button"
          class="text-text-secondary hover:text-error"
          :disabled="disabled"
          :aria-label="deleteOptionLabel || undefined"
          :title="deleteOptionLabel || undefined"
          @click="emit('deleteOption', optionFor(value)!)"
        >
          ⌫
        </button>
      </span>
    </div>
    <div class="flex gap-2">
      <BaseInput
        v-model="query"
        :data-testid="props.inputTestId"
        :placeholder="placeholder"
        :disabled="disabled"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="handleKeydown"
      />
      <BaseButton v-if="allowCustom" size="sm" :disabled="disabled || !query.trim()" @click="create">+</BaseButton>
    </div>
    <div v-if="suggestionsVisible" class="mt-2 max-h-40 overflow-auto rounded border border-border bg-background">
      <button
        v-for="option in filteredOptions"
        :key="String(option.value)"
        type="button"
        class="block w-full px-3 py-2 text-left text-sm hover:bg-header"
        @mousedown.prevent="add(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
