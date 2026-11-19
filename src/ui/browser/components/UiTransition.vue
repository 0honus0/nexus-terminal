<script setup lang="ts">
	import type { UiTransitionProps } from '../ui-component-types.js';
	import { useUiMotion } from '../ui-motion-api.js';
	const props = withDefaults(defineProps<UiTransitionProps>(), { preset: 'panel', appear: true });
	const { play } = useUiMotion();
	const hidden = new WeakMap<HTMLElement, string | null>();

	function enter(target: Element, done: () => void) {
		const element = target as HTMLElement;
		element.inert = false;
		if (hidden.has(element)) {
			const previous = hidden.get(element);
			if (previous === null) element.removeAttribute('aria-hidden');
			else element.setAttribute('aria-hidden', previous!);
			hidden.delete(element);
		}
		play(
			element,
			[
				{ opacity: 0, scale: props.preset === 'fade' ? '1' : '.98' },
				{ opacity: 1, scale: '1' },
			],
			200,
			done,
		);
	}

	function leave(target: Element, done: () => void) {
		const element = target as HTMLElement;
		// Closing DOM may remain for the animation, but must no longer accept input.
		element.inert = true;
		if (!hidden.has(element)) hidden.set(element, element.getAttribute('aria-hidden'));
		element.setAttribute('aria-hidden', 'true');
		play(
			element,
			[
				{ opacity: 1, scale: '1' },
				{ opacity: 0, scale: props.preset === 'fade' ? '1' : '.98' },
			],
			140,
			done,
		);
	}
</script>

<template>
	<Transition :css="false" :appear="appear" @enter="enter" @leave="leave"><slot /></Transition>
</template>
