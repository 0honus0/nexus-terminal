<script setup lang="ts">
	import { computed } from 'vue';
	import type { UiSurfaceKind } from './uiTypes';

	const props = withDefaults(
		defineProps<{
			surface?: UiSurfaceKind;
			radius?: 'control' | 'panel';
		}>(),
		{
			surface: 'raised',
			radius: 'panel',
		},
	);

	const surfaceClass = computed(() => {
		if (props.surface === 'glass') return 'ui-glass-panel';
		if (props.surface === 'glass-chrome') return 'ui-glass-chrome';
		return `ui-surface--${props.surface}`;
	});
</script>

<template>
	<div
		data-ui="surface"
		data-ui-gen="2"
		:data-surface="props.surface"
		class="ui-surface"
		:class="[surfaceClass, `ui-radius--${props.radius}`]"
	>
		<slot />
	</div>
</template>
