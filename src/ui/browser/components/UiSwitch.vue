<script setup lang="ts">
	import type { UiSwitchProps } from '../ui-component-types.js';
	import { SwitchRoot, SwitchThumb } from 'reka-ui';
	defineProps<UiSwitchProps>();
	const model = defineModel<boolean>({ default: false });
</script>
<template>
	<SwitchRoot
		v-model="model"
		class="ui-switch"
		data-ui="switch"
		:disabled="disabled"
		:name="name"
		:required="required"
		><SwitchThumb class="ui-switch__thumb"
	/></SwitchRoot>
</template>
<style scoped>
	.ui-switch {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		width: 44px;
		height: 26px;
		padding: 3px;
		border: 1px solid var(--ui-border);
		border-radius: 999px;
		background: var(--ui-background);
		cursor: pointer;
	}
	.ui-switch[data-state='checked'] {
		background: var(--ui-primary);
		border-color: var(--ui-primary);
	}
	.ui-switch__thumb {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--ui-muted);
	}
	.ui-switch[data-state='checked'] .ui-switch__thumb {
		transform: translateX(18px);
		background: var(--ui-primary-text);
	}
	.ui-switch:focus-visible {
		outline: 2px solid var(--ui-primary);
		outline-offset: 3px;
	}
	.ui-switch[data-disabled] {
		opacity: 0.5;
		cursor: default;
	}
</style>
