<script setup lang="ts">
	import { Primitive } from 'reka-ui';
	import type { UiScrollAreaProps } from '../ui-component-types.js';

	const props = withDefaults(defineProps<UiScrollAreaProps>(), {
		asChild: false,
		gutter: 'auto',
		overflow: 'auto',
		scrollbar: 'auto',
	});
</script>

<template>
	<Primitive
		:as-child="props.asChild"
		class="ui-scroll-area"
		:data-scrollbar-gutter="props.gutter"
		:data-scroll-overflow="props.overflow"
		:data-scrollbar="props.scrollbar"
		><slot
	/></Primitive>
</template>
