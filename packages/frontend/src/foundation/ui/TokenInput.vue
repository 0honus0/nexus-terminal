<script setup lang="ts">
  import { computed, ref } from 'vue';
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
  const tokenInput = ref<HTMLInputElement | null>(null);

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
  <div class="relative w-full">
    <div
      class="flex min-h-10 cursor-text flex-wrap items-center gap-1 rounded border border-border bg-background p-1.5"
      @click="tokenInput?.focus()"
    >
      <span
        v-for="value in model"
        :key="String(value)"
        :data-testid="props.tokenTestId"
        class="inline-flex items-center whitespace-nowrap rounded border border-border bg-header/50 px-2 py-0.5 text-sm text-foreground"
      >
        {{ labelFor(value) }}
        <button
          type="button"
          class="ml-1.5 border-0 bg-transparent p-0 text-lg leading-none text-text-secondary hover:text-foreground"
          :disabled="disabled"
          :aria-label="removeTokenLabel || undefined"
          :title="removeTokenLabel || undefined"
          @click.stop="remove(value)"
        >
          ×
        </button>
        <button
          v-if="allowOptionDelete && optionFor(value)"
          type="button"
          class="ml-1 border-0 bg-transparent p-0 text-xs leading-none text-text-secondary hover:text-error"
          :disabled="disabled"
          :aria-label="deleteOptionLabel || undefined"
          :title="deleteOptionLabel || undefined"
          @click.stop="emit('deleteOption', optionFor(value)!)"
        >
          <i class="fas fa-trash-alt" aria-hidden="true" />
        </button>
      </span>
      <input
        ref="tokenInput"
        v-model="query"
        :data-testid="props.inputTestId"
        type="text"
        class="min-w-[100px] flex-grow border-none bg-transparent p-0.5 text-sm outline-none"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        @focus="focused = true"
        @blur="focused = false"
        @keydown="handleKeydown"
      />
    </div>
    <ul
      v-if="suggestionsVisible"
      class="absolute left-0 right-0 top-full z-10 m-0 mt-0.5 max-h-[150px] list-none overflow-y-auto rounded-b border border-border bg-background p-0 shadow-md"
    >
      <li
        v-for="option in filteredOptions"
        :key="String(option.value)"
        class="cursor-pointer px-3 py-1.5 text-sm hover:bg-header"
        @mousedown.prevent="add(option.value)"
      >
        {{ option.label }}
      </li>
    </ul>
  </div>
</template>
