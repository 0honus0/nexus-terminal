import { animateMini, type AnimationPlaybackControls, type DOMKeyframesDefinition } from 'motion-v';
import { computed, inject, onScopeDispose, provide, watch, type InjectionKey, type Ref } from 'vue';
import { usePreferredReducedMotion } from '@vueuse/core';

interface MotionSettings {
	readonly enabled: Readonly<Ref<boolean>>;
	readonly speed: Readonly<Ref<number>>;
}

const settingsKey: InjectionKey<MotionSettings> = Symbol('ui.motion');
const playing = new WeakMap<HTMLElement, { finish: () => void; properties: string[] }>();

/** UI owns the driver; the host supplies preferences without a UI → App dependency. */
export function provideUiMotion(settings: MotionSettings) {
	provide(settingsKey, settings);
}

/** Motion's native driver handles playback; Vue/REKA retain ownership of DOM and focus. */
export function useUiMotion() {
	const reduced = usePreferredReducedMotion();
	const settings = inject(settingsKey, {
		enabled: computed(() => reduced.value !== 'reduce'),
		speed: computed(() => 1),
	});
	const active = new Map<AnimationPlaybackControls, () => void>();

	function play(element: HTMLElement, frames: Keyframe[], duration: number, done: () => void = () => {}) {
		const properties = Object.keys(frames.at(-1) ?? {}).filter(
			(key) => !['offset', 'easing', 'composite'].includes(key),
		);
		const previous = playing.get(element);
		const current = previous ? getComputedStyle(element) : undefined;
		const sampled = new Map(previous?.properties.map((key) => [key, current!.getPropertyValue(key)]));
		previous?.finish();
		if (!settings.enabled.value || !element.animate) {
			done();
			return () => {};
		}
		// Vue owns the final styles. Release Motion's committed values before painting,
		// so percentages, drag positioning and theme tokens remain authoritative.
		const baseline = new Map(properties.map((key) => [key, element.style.getPropertyValue(key)]));
		const keyframes = Object.fromEntries(
			properties.map((key) => [
				key,
				frames.map((frame, index) => (index === 0 && sampled.has(key) ? sampled.get(key) : frame[key])),
			]),
		) as DOMKeyframesDefinition;
		const animation = animateMini(element, keyframes, {
			duration: duration / 1000,
			// Avoid spending a large fraction of the distance in the first 60 Hz frame.
			ease: [0.25, 0.1, 0.25, 1],
		});
		animation.speed = settings.speed.value;
		let finished = false;

		function finish() {
			if (finished) return;
			finished = true;
			active.delete(animation);
			if (playing.get(element)?.finish === finish) playing.delete(element);
			animation.cancel();
			for (const [key, value] of baseline) {
				if (value) element.style.setProperty(key, value);
				else element.style.removeProperty(key);
			}
			done();
		}

		playing.set(element, { finish, properties });
		active.set(animation, finish);
		void animation.finished.then(finish, finish);
		return finish;
	}

	watch(
		settings.enabled,
		(enabled) => {
			if (!enabled) for (const finish of [...active.values()]) finish();
		},
		{ flush: 'sync' },
	);
	watch(
		settings.speed,
		(speed) => {
			for (const animation of active.keys()) animation.speed = speed;
		},
		{ flush: 'sync' },
	);
	onScopeDispose(() => {
		for (const finish of [...active.values()]) finish();
	});
	return { play, enabled: settings.enabled };
}
