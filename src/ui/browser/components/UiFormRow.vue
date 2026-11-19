<script setup lang="ts">
	import { useId } from 'vue';
	import type { UiFormRowProps } from '../ui-component-types.js';
	const props = defineProps<UiFormRowProps>();
	const generatedId = useId();
</script>

<template>
	<div class="ui-form-row" data-ui="form-row">
		<div class="ui-form-row__body">
			<label :for="props.id ?? generatedId"
				><component :is="icon" v-if="icon" :size="18" aria-hidden="true" />{{ label }}</label
			>
			<p v-if="description" :id="`${props.id ?? generatedId}-description`">{{ description }}</p>
		</div>
		<div class="ui-form-row__control">
			<slot
				:id="props.id ?? generatedId"
				:describedby="description ? `${props.id ?? generatedId}-description` : undefined"
			/>
		</div>
	</div>
</template>

<style scoped>
	.ui-form-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px var(--ui-layout-gap, 16px);
		min-width: 0;
	}
	.ui-form-row__body {
		flex: 1 1 12rem;
		min-width: 0;
	}
	label {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 14px;
		font-weight: 600;
		color: var(--ui-text);
	}
	p {
		margin: 8px 0 0;
		font-size: 12px;
		line-height: 1.7;
		color: var(--ui-muted);
	}
	.ui-form-row__control {
		display: flex;
		justify-content: flex-end;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		margin-inline-start: auto;
	}
	.ui-form-row__control :deep([data-ui='select']),
	.ui-form-row__control :deep([data-ui='input']) {
		width: var(--ui-form-control-width, 180px);
		max-width: 100%;
	}
</style>
