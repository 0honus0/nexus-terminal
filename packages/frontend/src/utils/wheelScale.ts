export interface WheelStepAccumulatorOptions {
  thresholdPx?: number;
  resetAfterMs?: number;
}

export interface WheelScaleResolverOptions extends WheelStepAccumulatorOptions {
  min: number;
  max: number;
  step: number;
  precision?: number;
  requireCtrlKey?: boolean;
  stopPropagation?: boolean;
  stopImmediatePropagation?: boolean;
}

export interface WheelScaleChange {
  previous: number;
  next: number;
  wheelSteps: number;
}

const wheelDeltaToPixels = (event: WheelEvent): number => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(320, window.innerHeight);
  return event.deltaY;
};

/**
 * Converts noisy mouse/trackpad wheel deltas into stable discrete zoom steps.
 * Tiny trackpad deltas accumulate; a normal mouse-wheel notch produces about one step.
 */
export const createWheelStepAccumulator = ({
  thresholdPx = 72,
  resetAfterMs = 220,
}: WheelStepAccumulatorOptions = {}) => {
  let accumulated = 0;
  let lastEventAt = 0;

  return (event: WheelEvent): number => {
    const now = performance.now();
    const delta = wheelDeltaToPixels(event);
    if (!Number.isFinite(delta) || delta === 0) return 0;

    if (now - lastEventAt > resetAfterMs || (accumulated !== 0 && Math.sign(accumulated) !== Math.sign(delta))) {
      accumulated = 0;
    }
    lastEventAt = now;
    accumulated += delta;

    const direction = Math.sign(accumulated);
    const steps = Math.floor(Math.abs(accumulated) / thresholdPx);
    if (steps === 0) return 0;

    const boundedSteps = Math.min(3, steps);
    accumulated -= direction * boundedSteps * thresholdPx;
    return direction * boundedSteps;
  };
};

export const clampScale = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

/**
 * Shared Ctrl+wheel scaling policy used by terminals, editors and scalable panels.
 * It owns modifier filtering, native-scroll suppression, noisy-delta accumulation,
 * direction, bounds and rounding. Callers only apply the returned value and run
 * component-specific side effects such as fitting, persistence or scroll anchoring.
 */
export const createWheelScaleResolver = ({
  min,
  max,
  step,
  precision = 2,
  thresholdPx = 72,
  resetAfterMs = 220,
  requireCtrlKey = true,
  stopPropagation = false,
  stopImmediatePropagation = false,
}: WheelScaleResolverOptions) => {
  const consumeWheelSteps = createWheelStepAccumulator({ thresholdPx, resetAfterMs });

  return (event: WheelEvent, current: number): WheelScaleChange | null => {
    if (requireCtrlKey && !event.ctrlKey) return null;

    // Suppress browser/page zoom or scrolling for every handled Ctrl+wheel event,
    // including tiny deltas that have not accumulated into a full scale step yet.
    event.preventDefault();
    if (stopImmediatePropagation) event.stopImmediatePropagation();
    else if (stopPropagation) event.stopPropagation();

    const wheelSteps = consumeWheelSteps(event);
    if (wheelSteps === 0) return null;

    const bounded = clampScale(current - wheelSteps * step, min, max);
    const next = Number(bounded.toFixed(precision));
    if (Object.is(next, current)) return null;

    return { previous: current, next, wheelSteps };
  };
};
