import { onBeforeUnmount } from 'vue';

export interface LongPressPoint {
  x: number;
  y: number;
}

export interface LongPressGestureOptions<T> {
  enabled?: () => boolean;
  delayMs?: number;
  moveTolerance?: number;
  vibrateMs?: number;
  onTrigger: (target: T, point: LongPressPoint) => void;
}

/** Business-neutral touch/pen long-press mechanics with click suppression and pointer cleanup. */
export function useLongPressGesture<T>({
  enabled = () => true,
  delayMs = 550,
  moveTolerance = 12,
  vibrateMs = 0,
  onTrigger,
}: LongPressGestureOptions<T>) {
  let timer: number | undefined;
  let pointerId: number | null = null;
  let captureElement: Element | null = null;
  let startPoint: LongPressPoint | null = null;
  let triggered = false;
  let suppressClickUntil = 0;

  const clearTimer = (): void => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  };

  const releasePointerCapture = (): void => {
    if (!captureElement || pointerId === null) return;
    try {
      if (captureElement.hasPointerCapture(pointerId)) captureElement.releasePointerCapture(pointerId);
    } catch {
      // Native scrolling can release capture before the gesture finishes.
    }
  };

  const reset = (): void => {
    clearTimer();
    releasePointerCapture();
    pointerId = null;
    captureElement = null;
    startPoint = null;
    triggered = false;
  };

  const suppressClick = (durationMs = 800): void => {
    suppressClickUntil = Math.max(suppressClickUntil, Date.now() + durationMs);
  };

  const consumeClick = (event?: Event): boolean => {
    if (Date.now() >= suppressClickUntil) return false;
    event?.preventDefault();
    event?.stopPropagation();
    return true;
  };

  const start = (event: PointerEvent, target: T): void => {
    if (!enabled() || !event.isPrimary || !['touch', 'pen'].includes(event.pointerType)) return;
    reset();
    pointerId = event.pointerId;
    captureElement = event.currentTarget instanceof Element ? event.currentTarget : null;
    startPoint = { x: event.clientX, y: event.clientY };
    try {
      captureElement?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be rejected while a native gesture takes ownership.
    }
    const point = { ...startPoint };
    timer = window.setTimeout(() => {
      timer = undefined;
      triggered = true;
      suppressClick();
      onTrigger(target, point);
      if (vibrateMs > 0) navigator.vibrate?.(vibrateMs);
    }, delayMs);
  };

  const move = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId || !startPoint) return;
    const moved = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
    if (moved <= moveTolerance) return;
    reset();
  };

  const end = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    if (triggered) {
      event.preventDefault();
      suppressClick(500);
    }
    reset();
  };

  const cancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    reset();
  };

  onBeforeUnmount(reset);

  return { start, move, end, cancel, suppressClick, consumeClick };
}
