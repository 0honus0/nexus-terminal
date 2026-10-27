import type { Ref } from 'vue';

export interface WheelStepAccumulatorOptions {
	thresholdPx?: number;
	resetAfterMs?: number;
	maxStepsPerEvent?: number;
}

export interface WheelScaleOptions extends WheelStepAccumulatorOptions {
	min: number;
	max: number;
	step: number;
	precision?: number;
}

export interface WheelScaleChange {
	previous: number;
	next: number;
	wheelSteps: number;
}

export interface WheelScaleBindingOptions extends WheelScaleOptions {
	target: () => HTMLElement | null;
	value: () => number;
	scale: Ref<number>;
	enabled?: () => boolean;
	onApply?: (scale: number) => void;
	onChange: (scale: number) => void;
	/** Capture before layout changes; the returned function restores against the new layout. */
	captureViewport?: (event?: WheelEvent) => (() => void) | undefined;
	viewportFlush?: 'sync' | 'post';
}
