import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent } from 'guacamole-common-js';

export type RemoteTouchMode = 'direct' | 'touchpad';
export interface RemoteTouchInput {
	destroy(): void;
}

const events = ['mousedown', 'mouseup', 'mousemove'] as const;

export function attachRemoteTouchInput(
	element: HTMLElement,
	client: Pick<Client, 'getDisplay' | 'sendMouseState'>,
	mode: RemoteTouchMode,
): RemoteTouchInput {
	const previousTouchAction = element.style.touchAction;
	element.style.touchAction = 'none';
	const device =
		mode === 'touchpad' ? new Guacamole.Mouse.Touchpad(element) : new Guacamole.Mouse.Touchscreen(element);

	const forward = (event: GuacamoleEvent) => {
		if (!(event instanceof Guacamole.Mouse.Event)) return;
		client.getDisplay().showCursor(true);
		client.sendMouseState(event.state, true);
	};

	device.onEach([...events], forward);

	return {
		destroy() {
			device.offEach([...events], forward);
			element.style.touchAction = previousTouchAction;
		},
	};
}
