import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent } from 'guacamole-common-js';

export type RemoteTouchMode = 'direct' | 'touchpad';
export interface RemoteTouchInput {
  destroy(): void;
}

const events = ['mousedown', 'mouseup', 'mousemove'] as const;
const TAP_MAX_MS = 300;
const TAP_MOVE_PX = 12;

export function attachRemoteTouchInput(
  element: HTMLElement,
  client: Pick<Client, 'getDisplay' | 'sendMouseState'>,
  mode: RemoteTouchMode,
  onTap?: () => void,
): RemoteTouchInput {
  const previousTouchAction = element.style.touchAction;
  element.style.touchAction = 'none';
  const device = mode === 'touchpad' ? new Guacamole.Mouse.Touchpad(element) : new Guacamole.Mouse.Touchscreen(element);
  const forward = (event: GuacamoleEvent) => {
    if (!(event instanceof Guacamole.Mouse.Event)) return;
    client.getDisplay().showCursor(true);
    client.sendMouseState(event.state, true);
  };
  device.onEach([...events], forward);

  let candidate: { id: number; at: number; x: number; y: number } | null = null;
  const clear = () => {
    candidate = null;
  };
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      clear();
      return;
    }
    const touch = event.changedTouches[0];
    if (touch) candidate = { id: touch.identifier, at: performance.now(), x: touch.clientX, y: touch.clientY };
  };
  const touchMove = (event: TouchEvent) => {
    if (!candidate) return;
    const touch = [...event.touches].find((item) => item.identifier === candidate?.id);
    if (!touch || Math.hypot(touch.clientX - candidate.x, touch.clientY - candidate.y) > TAP_MOVE_PX) clear();
  };
  const touchEnd = (event: TouchEvent) => {
    if (!candidate || event.touches.length) {
      if (!event.touches.length) clear();
      return;
    }
    const touch = [...event.changedTouches].find((item) => item.identifier === candidate?.id);
    const distance = touch
      ? Math.hypot(touch.clientX - candidate.x, touch.clientY - candidate.y)
      : Number.POSITIVE_INFINITY;
    const tapped = distance <= TAP_MOVE_PX && performance.now() - candidate.at <= TAP_MAX_MS;
    clear();
    if (tapped) onTap?.();
  };
  element.addEventListener('touchstart', touchStart, { passive: true });
  element.addEventListener('touchmove', touchMove, { passive: true });
  element.addEventListener('touchend', touchEnd, { passive: true });
  element.addEventListener('touchcancel', clear, { passive: true });

  return {
    destroy() {
      device.offEach([...events], forward);
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchend', touchEnd);
      element.removeEventListener('touchcancel', clear);
      element.style.touchAction = previousTouchAction;
    },
  };
}
