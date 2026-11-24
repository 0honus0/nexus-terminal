<script setup lang="ts">
	import type { UiTransitionProps } from '../ui-component-types.js';
	import { useUiMotion } from '../ui-motion-api.js';
	const props = withDefaults(defineProps<UiTransitionProps>(), { preset: 'panel', appear: true });
	const { play } = useUiMotion();
	const hidden = new WeakMap<HTMLElement, string | null>();

	function frames(leaving = false): Keyframe[] {
		if (props.preset === 'drop') {
			const visible = { opacity: 1, clipPath: 'inset(-16px)' };
			return leaving
				? [visible, { opacity: 0, clipPath: 'inset(100% -16px -16px)' }]
				: [{ opacity: 0, clipPath: 'inset(-16px -16px 100%)' }, visible];
		}
		const entering: Keyframe[] =
			props.preset === 'panel'
				? [
						{ opacity: 0, scale: '.98' },
						{ opacity: 1, scale: '1' },
					]
				: [{ opacity: 0 }, { opacity: 1 }];
		return leaving ? entering.reverse() : entering;
	}

	function enter(target: Element, done: () => void) {
		const element = target as HTMLElement;
		element.inert = false;
		if (hidden.has(element)) {
			const previous = hidden.get(element);
			if (previous === null) element.removeAttribute('aria-hidden');
			else element.setAttribute('aria-hidden', previous!);
			hidden.delete(element);
		}
		if (props.preset === 'none') {
			done();
			return;
		}
		play(element, frames(), props.preset === 'context-menu' ? 90 : 200, done);
	}

	function leave(target: Element, done: () => void) {
		const element = target as HTMLElement;
		// Closing DOM may remain for the animation, but must no longer accept input.
		element.inert = true;
		if (!hidden.has(element)) hidden.set(element, element.getAttribute('aria-hidden'));
		element.setAttribute('aria-hidden', 'true');
		if (props.preset === 'none') {
			done();
			return;
		}
		play(element, frames(true), props.preset === 'context-menu' ? 60 : 140, done);
	}
</script>

<template>
	<Transition :css="false" :appear="appear" @enter="enter" @leave="leave"><slot /></Transition>
</template>
