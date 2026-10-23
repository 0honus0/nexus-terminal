<script setup lang="ts">
	import type { UiTone } from './uiTypes';

	const props = withDefaults(
		defineProps<{
			tone?: UiTone;
			appearance?: 'soft' | 'ghost';
			density?: 'compact' | 'default';
			dot?: boolean;
			dotPulse?: boolean;
		}>(),
		{
			tone: 'neutral',
			appearance: 'soft',
			density: 'default',
			dot: false,
			dotPulse: false,
		},
	);
</script>

<template>
	<span
		data-ui="badge"
		data-ui-gen="2"
		:data-tone="props.tone"
		:data-density="props.density"
		:data-appearance="props.appearance"
		:data-dot="props.dot || undefined"
		:data-dot-pulse="props.dotPulse || undefined"
		class="ui-badge"
		:class="`ui-badge--${props.appearance}`"
	>
		<span v-if="props.dot" class="ui-badge__dot" aria-hidden="true"></span>
		<slot />
	</span>
</template>
