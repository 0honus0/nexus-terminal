<script setup lang="ts">
	import type { UiFieldProps } from '../ui-component-types.js';
	import { useId } from 'vue';
	const props = defineProps<UiFieldProps>();
	const generatedId = useId();
</script>
<template>
	<div class="ui-field" data-ui="field">
		<label :for="props.id ?? generatedId">{{ label }}</label>
		<slot :id="props.id ?? generatedId" :describedby="hint ? `${props.id ?? generatedId}-hint` : undefined" />
		<p v-if="hint" :id="`${props.id ?? generatedId}-hint`">{{ hint }}</p>
	</div>
</template>
<style scoped>
	.ui-field {
		display: grid;
		gap: 9px;
		min-width: 0;
	}
	.ui-field label {
		font-size: 13px;
		font-weight: 450;
		color: var(--ui-text);
	}
	.ui-field p {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--ui-muted);
	}
</style>
