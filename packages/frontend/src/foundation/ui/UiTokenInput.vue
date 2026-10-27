<script setup lang="ts">
	import { computed, ref, useId } from 'vue';

	export interface UiTokenOption {
		value: string | number;
		label: string;
	}

	const model = defineModel<Array<string | number>>({ default: () => [] });
	const props = withDefaults(
		defineProps<{
			options?: readonly UiTokenOption[];
			placeholder?: string;
			disabled?: boolean;
			allowCustom?: boolean;
			allowOptionDelete?: boolean;
			removeTokenLabel?: string;
			deleteOptionLabel?: string;
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
	const emit = defineEmits<{ create: [label: string]; deleteOption: [option: UiTokenOption] }>();
	const query = ref('');
	const focused = ref(false);
	const suggestionsOpen = ref(false);
	const activeIndex = ref(-1);
	const keyboardNavigating = ref(false);
	const listId = useId();
	const tokenInput = ref<HTMLInputElement | null>(null);

	const optionFor = (value: string | number) => props.options.find((option) => option.value === value);

	const labelFor = (value: string | number) => optionFor(value)?.label ?? String(value);

	const filteredOptions = computed(() => {
		const needle = query.value.trim().toLowerCase();
		return props.options.filter(
			(option) => !model.value.includes(option.value) && (!needle || option.label.toLowerCase().includes(needle)),
		);
	});
	const suggestionsVisible = computed(
		() => focused.value && suggestionsOpen.value && filteredOptions.value.length > 0,
	);

	const add = (value: string | number) => {
		if (!model.value.includes(value)) model.value = [...model.value, value];
		query.value = '';
		suggestionsOpen.value = false;
		keyboardNavigating.value = false;
		activeIndex.value = -1;
		tokenInput.value?.focus();
	};

	const remove = (value: string | number) => {
		model.value = model.value.filter((item) => item !== value);
	};

	const create = () => {
		const label = query.value.trim();
		if (!label) return;
		emit('create', label);
		query.value = '';
		suggestionsOpen.value = false;
	};

	const handleFocus = () => {
		focused.value = true;
		suggestionsOpen.value = true;
		activeIndex.value = -1;
	};

	const handleBlur = () => {
		focused.value = false;
		suggestionsOpen.value = false;
	};

	const handleInput = () => {
		suggestionsOpen.value = true;
		keyboardNavigating.value = false;
		activeIndex.value = -1;
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && filteredOptions.value.length > 0) {
			event.preventDefault();
			suggestionsOpen.value = true;
			keyboardNavigating.value = true;
			const optionCount = filteredOptions.value.length;
			if (activeIndex.value < 0) activeIndex.value = event.key === 'ArrowDown' ? 0 : optionCount - 1;
			else
				activeIndex.value =
					(activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount;
			return;
		}
		if (event.key === 'Enter') {
			if (keyboardNavigating.value && suggestionsVisible.value) {
				event.preventDefault();
				const option = filteredOptions.value[activeIndex.value];
				if (option) add(option.value);
				return;
			}
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
		if (event.key === 'Escape') {
			suggestionsOpen.value = false;
			keyboardNavigating.value = false;
		}
	};
</script>

<template>
	<div
		data-ui="token-input"
		data-ui-gen="2"
		:data-disabled="props.disabled || undefined"
		class="ui-token-input relative w-full"
	>
		<div
			class="ui-token-input__control flex min-h-10 cursor-text flex-wrap items-center gap-1 rounded p-1.5"
			@click="tokenInput?.focus()"
		>
			<span
				v-for="value in model"
				:key="String(value)"
				class="ui-token-input__token inline-flex items-center whitespace-nowrap rounded px-2 py-0.5 text-sm"
			>
				{{ labelFor(value) }}
				<button
					type="button"
					class="ui-token-input__action ml-1.5 border-0 bg-transparent p-0 text-lg leading-none text-text-secondary hover:text-foreground"
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
					class="ui-token-input__action ml-1 border-0 bg-transparent p-0 text-xs leading-none text-text-secondary hover:text-error"
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
				type="text"
				class="ui-token-input__input min-w-[100px] flex-grow border-none bg-transparent p-0.5 text-sm outline-none"
				:placeholder="placeholder"
				:disabled="disabled"
				data-no-highlight=""
				role="combobox"
				aria-autocomplete="list"
				:aria-label="placeholder || undefined"
				:aria-expanded="suggestionsVisible"
				:aria-controls="suggestionsVisible ? listId : undefined"
				:aria-activedescendant="
					keyboardNavigating && suggestionsVisible ? `${listId}-${activeIndex}` : undefined
				"
				autocomplete="off"
				@focus="handleFocus"
				@blur="handleBlur"
				@input="handleInput"
				@keydown="handleKeydown"
			/>
		</div>
		<ul
			v-if="suggestionsVisible"
			:id="listId"
			role="listbox"
			class="ui-token-input__list ui-glass-panel absolute left-0 right-0 top-full z-10 m-0 mt-0.5 max-h-[150px] list-none overflow-y-auto rounded-b p-0"
		>
			<li
				v-for="(option, index) in filteredOptions"
				:id="`${listId}-${index}`"
				:key="String(option.value)"
				role="option"
				:aria-selected="keyboardNavigating && activeIndex === index"
				class="ui-token-input__option cursor-pointer px-3 py-1.5 text-sm"
				:class="{ 'ui-token-input__option--active': keyboardNavigating && activeIndex === index }"
				@pointerdown.prevent
				@click="add(option.value)"
			>
				{{ option.label }}
			</li>
		</ul>
	</div>
</template>
