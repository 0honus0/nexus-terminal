<script setup lang="ts">
	import { useId } from 'vue';
	import type { UiInputProps } from '../ui-component-types.js';
	defineOptions({ inheritAttrs: false });
	withDefaults(defineProps<UiInputProps>(), { type: 'text', density: 'default' });
	const model = defineModel<string>({ default: '' });
	const inputId = useId();
</script>
<template>
	<div
		class="ui-input"
		data-ui="input"
		:data-density="density"
		:data-invalid="invalid || undefined"
		:data-disabled="disabled || undefined"
	>
		<span v-if="$slots.leading" class="ui-input__accessory"><slot name="leading" /></span>
		<input
			v-bind="{ ...$attrs, ...(invalid ? { 'aria-invalid': true } : {}) }"
			:id="typeof $attrs.id === 'string' && $attrs.id ? $attrs.id : inputId"
			v-model="model"
			:type="type"
			:disabled="disabled"
		/>
		<span v-if="$slots.trailing" class="ui-input__accessory"><slot name="trailing" /></span>
	</div>
</template>
<style scoped>
	.ui-input {
		display: flex;
		align-items: center;
		gap: var(--ui-control-gap, var(--_ui-control-gap, 8px));
		min-width: 0;
		height: var(--ui-input-height, var(--ui-control-height, var(--_ui-control-height, 36px)));
		padding: 0 var(--ui-control-padding-inline, var(--_ui-control-padding-inline, 11px));
		border: 1px solid var(--ui-border);
		border-radius: var(--ui-control-radius, 9px);
		background: var(--ui-surface);
		color: var(--ui-muted);
	}
	.ui-input:focus-within {
		border-color: var(--ui-primary);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-primary) 10%, transparent);
	}
	.ui-input[data-disabled] {
		opacity: 0.6;
	}
	.ui-input[data-invalid] {
		border-color: var(--ui-danger);
	}
	.ui-input input {
		min-width: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ui-text);
		font: inherit;
		font-size: var(--ui-input-font-size, 16px);
		user-select: text;
	}
	.ui-input input[type='password'] {
		/* Keep native masking glyph metrics stable while web fonts finish loading. */
		font-family: var(--ui-input-password-font-family, system-ui, sans-serif);
		letter-spacing: 0;
	}
	.ui-input input::placeholder {
		color: var(--ui-muted);
		font-size: 13px;
	}
	.ui-input__accessory {
		display: flex;
		align-items: center;
		flex: none;
	}
</style>
