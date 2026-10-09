<script setup lang="ts">
	import { computed, provide } from 'vue';
	import { actionLayoutKey, type UiActionLayout } from './actionLayout';

	const props = defineProps<{ layout: UiActionLayout }>();
	provide(
		actionLayoutKey,
		computed(() => props.layout),
	);
</script>

<template>
	<div class="ui-action-group" :data-layout="props.layout"><slot /></div>
</template>
