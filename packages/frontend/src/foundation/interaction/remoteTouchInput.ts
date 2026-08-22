import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent } from 'guacamole-common-js';

const REMOTE_MOUSE_EVENTS = ['mousedown', 'mouseup', 'mousemove'] as const;

type RemotePointerClient = Pick<Client, 'getDisplay' | 'sendMouseState'>;

export type RemoteTouchMode = 'direct' | 'touchpad';

export interface RemoteTouchInput {
  mode: RemoteTouchMode;
  destroy: () => void;
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

  touchDevice.onEach([...REMOTE_MOUSE_EVENTS], forwardTouchEvent);

  return {
    mode,
    destroy: () => {
      touchDevice.offEach([...REMOTE_MOUSE_EVENTS], forwardTouchEvent);
      element.style.touchAction = previousTouchAction;
    },
  };
}
