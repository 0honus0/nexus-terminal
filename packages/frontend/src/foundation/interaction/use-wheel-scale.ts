import { nextTick, onScopeDispose, watch } from 'vue';
import { clampScale, createWheelScaleResolver } from './wheelScale';
import type { WheelScaleBindingOptions } from './model/wheel-scale-types';

/** One capture-phase owner for scaling, local state and layout restoration. */
export function useWheelScale(options: WheelScaleBindingOptions) {
	const resolve = createWheelScaleResolver(options);
	let disposed = false;
	let generation = 0;
	let pendingRestore: (() => void) | undefined;
	let removeListener: (() => void) | undefined;

	const normalize = (value: number): number =>
		Number(clampScale(value, options.min, options.max).toFixed(options.precision ?? 2));

	options.scale.value = normalize(options.scale.value);

	const apply = (value: number, notify: boolean, event?: WheelEvent): void => {
		if (disposed || !Number.isFinite(value)) return;
		const next = normalize(value);
		if (Object.is(next, options.scale.value)) return;
		// A Vue render may still be pending during a burst. Keep the first snapshot of that layout.
		pendingRestore ??= options.captureViewport?.(event);
		options.scale.value = next;
		options.onApply?.(next);
		if (pendingRestore) {
			if (options.viewportFlush === 'sync') {
				const restore = pendingRestore;
				pendingRestore = undefined;
				restore();
			} else {
				const revision = ++generation;
				void nextTick(() => {
					if (disposed || revision !== generation) return;
					const restore = pendingRestore;
					pendingRestore = undefined;
					restore?.();
				});
			}
		}
		if (notify) options.onChange(next);
	};

	const handleWheel = (event: WheelEvent): void => {
		if (!event.ctrlKey) return;
		// Consume even subthreshold/disabled/bounded gestures before an embedded widget can scroll.
		event.preventDefault();
		event.stopImmediatePropagation();
		if (options.enabled && !options.enabled()) return;
		const change = resolve(event, options.scale.value);
		if (change) apply(change.next, true, event);
	};

	const stopTargetWatch = watch(
		options.target,
		(target) => {
			removeListener?.();
			removeListener = undefined;
			pendingRestore = undefined;
			generation++;
			if (!target) return;
			target.addEventListener('wheel', handleWheel, { capture: true, passive: false });
			removeListener = () => target.removeEventListener('wheel', handleWheel, true);
		},
		{ immediate: true, flush: 'post' },
	);
	const stopValueWatch = watch(options.value, (value) => apply(value, false), { flush: 'sync' });
	onScopeDispose(() => {
		disposed = true;
		generation++;
		pendingRestore = undefined;
		stopTargetWatch();
		stopValueWatch();
		removeListener?.();
	});
	return { setScale: (value: number): void => apply(value, true) };
}
