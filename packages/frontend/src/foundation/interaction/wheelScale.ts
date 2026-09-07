export interface WheelStepAccumulatorOptions {
  thresholdPx?: number;
  resetAfterMs?: number;
  maxStepsPerEvent?: number;
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

const deltaToPixels = (event: WheelEvent): number => {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * Math.max(320, window.innerHeight);
  return event.deltaY;
};

/** Convert noisy mouse/trackpad deltas into bounded discrete steps without leaking large-delta backlog. */
export function createWheelStepAccumulator({
  thresholdPx = 72,
  resetAfterMs = 220,
  maxStepsPerEvent = 3,
}: WheelStepAccumulatorOptions = {}) {
  let accumulatedPx = 0;
  let lastEventAt = 0;

  return (event: WheelEvent): number => {
    const deltaPx = deltaToPixels(event);
    if (!Number.isFinite(deltaPx) || deltaPx === 0) return 0;

    const now = performance.now();
    const directionChanged = accumulatedPx !== 0 && Math.sign(accumulatedPx) !== Math.sign(deltaPx);
    if (now - lastEventAt > resetAfterMs || directionChanged) accumulatedPx = 0;

    lastEventAt = now;
    accumulatedPx += deltaPx;

    const completeSteps = Math.floor(Math.abs(accumulatedPx) / thresholdPx);
    if (completeSteps === 0) return 0;

    const direction = Math.sign(accumulatedPx);
    accumulatedPx -= direction * completeSteps * thresholdPx;
    return direction * Math.min(Math.max(1, maxStepsPerEvent), completeSteps);
  };
}

export const clampScale = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Shared Ctrl+wheel scaling policy for terminals, editors and scalable panels. */
export function createWheelScaleResolver({
  min,
  max,
  step,
  precision = 2,
  thresholdPx = 72,
  resetAfterMs = 220,
  maxStepsPerEvent = 3,
  requireCtrlKey = true,
  stopPropagation = false,
  stopImmediatePropagation = false,
}: WheelScaleResolverOptions) {
  const consumeSteps = createWheelStepAccumulator({ thresholdPx, resetAfterMs, maxStepsPerEvent });

  return (event: WheelEvent, current: number): WheelScaleChange | null => {
    if (requireCtrlKey && !event.ctrlKey) return null;

    event.preventDefault();
    if (stopImmediatePropagation) event.stopImmediatePropagation();
    else if (stopPropagation) event.stopPropagation();

    const wheelSteps = consumeSteps(event);
    if (wheelSteps === 0) return null;

    const bounded = clampScale(current - wheelSteps * step, min, max);
    const next = Number(bounded.toFixed(precision));
    if (Object.is(next, current)) return null;

    return { previous: current, next, wheelSteps };
  };
}
