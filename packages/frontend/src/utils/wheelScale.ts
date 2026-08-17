export interface WheelStepAccumulatorOptions {
  thresholdPx?: number;
  resetAfterMs?: number;
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
