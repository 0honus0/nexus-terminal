import Guacamole from 'guacamole-common-js';
import type { Client, Event as GuacamoleEvent } from 'guacamole-common-js';

import { scopedElement } from './guacamole-listeners';
import type { RemoteTouchMode } from '../model/remote-desktop-types';

export interface RemoteTouchInput {
	destroy(): void;
}

const events = ['mousedown', 'mouseup', 'mousemove'] as const;

export function attachRemoteTouchInput(
	element: HTMLElement,
	client: Pick<Client, 'getDisplay' | 'sendMouseState'>,
	mode: RemoteTouchMode,
	onFailure?: (cause: unknown) => void,
): RemoteTouchInput {
	const previousTouchAction = element.style.touchAction;
	let active = true;
	const listeners: Array<() => void> = [];
	const target = scopedElement(element, listeners);
	element.style.touchAction = 'none';
	const device = mode === 'touchpad' ? new Guacamole.Mouse.Touchpad(target) : new Guacamole.Mouse.Touchscreen(target);

	const forward = (event: GuacamoleEvent) => {
		if (!active || !(event instanceof Guacamole.Mouse.Event)) return;
		try {
			client.getDisplay().showCursor(true);
			client.sendMouseState(event.state, true);
		} catch (cause) {
			if (onFailure) onFailure(cause);
			else throw cause;
		}
	};

	device.onEach([...events], forward);

	return {
		destroy() {
			if (!active) return;
			const failures: unknown[] = [];
			const cleanups = [
				() => {
					if (!('cancelGesture' in device) || typeof device.cancelGesture !== 'function')
						throw new Error('Missing touch lifecycle patch');
					device.cancelGesture();
				},
				() => {
					active = false;
					device.offEach([...events], forward);
				},
				...listeners,
				() => {
					element.style.touchAction = previousTouchAction;
				},
			];
			for (const cleanup of cleanups) {
				try {
					cleanup();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Touch cleanup failed');
		},
	};
}
