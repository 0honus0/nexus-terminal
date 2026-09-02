import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent } from 'guacamole-common-js';

const REMOTE_MOUSE_EVENTS = ['mousedown', 'mouseup', 'mousemove'] as const;
const TAP_MAX_DURATION_MS = 300;
const TAP_MOVE_TOLERANCE_PX = 12;

type RemotePointerClient = Pick<Client, 'getDisplay' | 'sendMouseState'>;

export type RemoteTouchMode = 'direct' | 'touchpad';

export interface RemoteTouchInputOptions {
  /**
   * Called synchronously from the single-finger touchend event. This makes it
   * possible for mobile browsers to open their system keyboard from the same
   * user gesture.
   */
  onTap?: () => void;
}

export interface RemoteTouchInput {
  mode: RemoteTouchMode;
  destroy: () => void;
}

interface TapCandidate {
  identifier: number;
  startedAt: number;
  startX: number;
  startY: number;
}

/**
 * Translates touch gestures into Guacamole mouse input.
 *
 * Direct mode behaves like a touchscreen. Touchpad mode moves the existing
 * pointer and adds two-finger right-click and scrolling gestures.
 */
export function attachRemoteTouchInput(
  element: HTMLElement,
  client: RemotePointerClient,
  mode: RemoteTouchMode = 'direct',
  options: RemoteTouchInputOptions = {},
): RemoteTouchInput {
  const previousTouchAction = element.style.touchAction;
  element.style.touchAction = 'none';

  const touchDevice =
    mode === 'touchpad' ? new Guacamole.Mouse.Touchpad(element) : new Guacamole.Mouse.Touchscreen(element);
  const forwardTouchEvent = (event: GuacamoleEvent) => {
    if (!(event instanceof Guacamole.Mouse.Event)) return;
    client.getDisplay().showCursor(true);
    client.sendMouseState(event.state, true);
  };

  let tapCandidate: TapCandidate | null = null;
  const clearTapCandidate = () => {
    tapCandidate = null;
  };
  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      clearTapCandidate();
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) return;
    tapCandidate = {
      identifier: touch.identifier,
      startedAt: performance.now(),
      startX: touch.clientX,
      startY: touch.clientY,
    };
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (!tapCandidate) return;
    const touch = Array.from(event.touches).find((item) => item.identifier === tapCandidate?.identifier);
    if (!touch) {
      clearTapCandidate();
      return;
    }

    const distance = Math.hypot(touch.clientX - tapCandidate.startX, touch.clientY - tapCandidate.startY);
    if (distance > TAP_MOVE_TOLERANCE_PX) clearTapCandidate();
  };
  const handleTouchEnd = (event: TouchEvent) => {
    if (!tapCandidate || event.touches.length !== 0) {
      if (event.touches.length === 0) clearTapCandidate();
      return;
    }

    const endedTouch = Array.from(event.changedTouches).find((touch) => touch.identifier === tapCandidate?.identifier);
    const endDistance = endedTouch
      ? Math.hypot(endedTouch.clientX - tapCandidate.startX, endedTouch.clientY - tapCandidate.startY)
      : Number.POSITIVE_INFINITY;
    const shouldSignalTap =
      endDistance <= TAP_MOVE_TOLERANCE_PX && performance.now() - tapCandidate.startedAt <= TAP_MAX_DURATION_MS;
    clearTapCandidate();
    if (shouldSignalTap) options.onTap?.();
  };

  touchDevice.onEach([...REMOTE_MOUSE_EVENTS], forwardTouchEvent);
  element.addEventListener('touchstart', handleTouchStart);
  element.addEventListener('touchmove', handleTouchMove);
  element.addEventListener('touchend', handleTouchEnd);
  element.addEventListener('touchcancel', clearTapCandidate);

  return {
    mode,
    destroy: () => {
      touchDevice.offEach([...REMOTE_MOUSE_EVENTS], forwardTouchEvent);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', clearTapCandidate);
      element.style.touchAction = previousTouchAction;
    },
  };
}
