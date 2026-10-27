<script setup lang="ts">
	import { TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';

	withDefaults(
		defineProps<{
			text: string;
			side?: 'top' | 'right' | 'bottom' | 'left';
		}>(),
		{ side: 'top' },
	);
</script>

<template>
	<TooltipProvider :delay-duration="250">
		<TooltipRoot :disable-hoverable-content="true">
			<TooltipTrigger as-child><slot /></TooltipTrigger>
			<TooltipPortal>
				<TooltipContent
					v-if="text"
					data-ui="tooltip-panel"
					data-ui-gen="2"
					:side="side"
					:side-offset="6"
					:collision-padding="12"
					class="ui-info-hint__panel ui-glass-panel"
				>
					{{ text }}
					<TooltipArrow class="ui-info-hint__arrow" :width="10" :height="5" />
				</TooltipContent>
			</TooltipPortal>
		</TooltipRoot>
	</TooltipProvider>
</template>
