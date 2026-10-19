import Guacamole from 'guacamole-common-js';
import type { Event as GuacamoleEvent } from 'guacamole-common-js';
import { createWebSocketUrl } from '@/client/websocket';
import { attachRemoteClipboard } from './remote-clipboard';
import { scopedElement } from './guacamole-listeners';
import { attachRemoteTouchInput } from './remote-touch-input';
import {
	RemoteDesktopFailure,
	type RemoteDesktopPeerFactory,
	type RemoteDesktopState,
} from '../model/remote-desktop-types';

function stateOf(value: number): RemoteDesktopState {
	switch (value) {
		case 1:
		case 2:
			return 'connecting';
		case 3:
			return 'connected';
		case 4:
			return 'disconnecting';
		default:
			return 'disconnected';
	}
}

function unicodeKeysym(character: string): number {
	if (character === '\n' || character === '\r') return 0xff0d;
	if (character === '\t') return 0xff09;
	const point = character.codePointAt(0) ?? 0;
	return (point >= 0x20 && point <= 0x7e) || (point >= 0xa0 && point <= 0xff) ? point : 0x01000000 | point;
}

export const createGuacamoleDesktop: RemoteDesktopPeerFactory = (options) => {
	const tunnel = new Guacamole.WebSocketTunnel(createWebSocketUrl('/ws/remote-desktop'));
	const client = new Guacamole.Client(tunnel);
	const element = client.getDisplay().getElement();
	element.tabIndex = 0;
	let closed = false;
	let textInputActive = false;
	let connected = false;
	let started = false;

	const listeners: Array<() => void> = [];
	const inputElement = scopedElement(element, listeners);
	const keyboard = new Guacamole.Keyboard(inputElement);
	if (options.mobileInput) keyboard.listenTo(scopedElement(options.mobileInput, listeners));
	const mouse = new Guacamole.Mouse(inputElement);
	const clipboard = attachRemoteClipboard(element, client, (failure) => options.onFailure(failure));
	let touchInput: ReturnType<typeof attachRemoteTouchInput> | undefined;

	const fail = (cause: unknown): void => {
		if (!closed) options.onFailure(new RemoteDesktopFailure('remote_unavailable', 'unknown', { cause }));
	};

	const sendInput = (send: () => void): void => {
		if (closed || !connected) return;
		try {
			send();
		} catch (cause) {
			options.onFailure(new RemoteDesktopFailure('input_failed', 'unknown', { cause }));
		}
	};

	keyboard.onkeydown = (keysym) => {
		if (!textInputActive) sendInput(() => client.sendKeyEvent(1, keysym));
	};
	keyboard.onkeyup = (keysym) => {
		if (!textInputActive) sendInput(() => client.sendKeyEvent(0, keysym));
	};

	const forwardMouse = (event: GuacamoleEvent): void => {
		if (event instanceof Guacamole.Mouse.Event) sendInput(() => client.sendMouseState(event.state, true));
	};

	mouse.onEach(['mousedown', 'mousemove', 'mouseup'], forwardMouse);
	inputElement.addEventListener('click', () => {
		if (!options.hasTouch && connected && !closed) element.focus();
	});
	inputElement.addEventListener('mouseenter', () => {
		element.style.cursor = 'none';
	});
	inputElement.addEventListener('mouseleave', () => {
		element.style.cursor = 'default';
	});
	tunnel.onerror = (status) => fail(status);
	client.onerror = (status) => fail(status);
	client.onstatechange = (value) => {
		if (closed) return;
		const state = stateOf(value);
		connected = state === 'connected';
		if (connected) {
			client.getDisplay().showCursor(true);
			const cursor = client.getDisplay().getCursorLayer()?.getElement();
			if (cursor) cursor.style.zIndex = '1000';
			if (!options.hasTouch) element.focus();
		}
		options.onState(state);
	};

	return {
		element,

		connect(ticket) {
			if (closed || started) throw new RemoteDesktopFailure('conflict', 'not_dispatched');
			started = true;
			try {
				client.connect(new URLSearchParams({ ticket }).toString());
			} catch (cause) {
				throw new RemoteDesktopFailure('remote_unavailable', 'unknown', { cause });
			}
		},

		resize(display) {
			if (closed || !connected) return;
			try {
				client.sendSize(display.width, display.height);
			} catch (cause) {
				fail(cause);
			}
		},

		focus() {
			if (!closed && connected) element.focus();
		},

		setTouchMode(mode) {
			if (!options.hasTouch || closed) return;
			touchInput?.destroy();
			touchInput = attachRemoteTouchInput(element, client, mode, (cause) =>
				sendInput(() => {
					throw cause;
				}),
			);
		},

		setTextInputActive(active) {
			sendInput(() => keyboard.reset());
			textInputActive = active;
		},

		syncClipboard() {
			return clipboard.syncHostToRemote();
		},

		sendText(text) {
			if (closed || !connected) return;
			if (new TextEncoder().encode(text).byteLength > 65536)
				throw new RemoteDesktopFailure('input_failed', 'not_dispatched');
			try {
				for (const character of text) {
					const keysym = unicodeKeysym(character);
					client.sendKeyEvent(1, keysym);
					client.sendKeyEvent(0, keysym);
				}
			} catch (cause) {
				throw new RemoteDesktopFailure('input_failed', 'unknown', { cause });
			}
		},

		close() {
			if (closed) return;
			closed = true;
			connected = false;
			client.onstatechange = null;
			client.onerror = null;
			tunnel.onerror = null;
			const failures: unknown[] = [];
			const cleanups = [
				() => keyboard.reset(),
				() => {
					keyboard.onkeydown = null;
					keyboard.onkeyup = null;
				},
				() => mouse.offEach(['mousedown', 'mousemove', 'mouseup'], forwardMouse),
				() => clipboard.destroy(),
				() => touchInput?.destroy(),
				...listeners,
				// Display.retire is installed by the package-manager lifecycle patch.
				() => client.disconnect(),
				() => {
					const display = client.getDisplay();
					if (!('retire' in display) || typeof display.retire !== 'function')
						throw new Error('Missing display lifecycle patch');
					display.retire();
				},
				() => element.remove(),
			];
			for (const cleanup of cleanups) {
				try {
					cleanup();
				} catch (cause) {
					failures.push(cause);
				}
			}
			if (failures.length)
				throw new RemoteDesktopFailure('cleanup_failed', 'unknown', {
					cause: new AggregateError(failures, 'Desktop cleanup failed'),
				});
		},
	};
};
