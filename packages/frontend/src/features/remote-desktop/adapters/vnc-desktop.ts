import RFB from '@novnc/novnc';
import { createWebSocketUrl } from '@/client/websocket';
import { attachDesktopClipboard } from './desktop-clipboard';
import { attachDesktopTouch } from './desktop-touch';
import { RemoteDesktopFailure, type RemoteDesktopPeerFactory } from '../model/remote-desktop-types';

function keysym(character: string): number {
	if (character === '\n' || character === '\r') {
		return 0xff0d;
	}
	if (character === '\t') {
		return 0xff09;
	}
	const point = character.codePointAt(0) ?? 0;
	return point <= 0xff ? point : 0x01000000 | point;
}

export const createVncDesktop: RemoteDesktopPeerFactory = (options) => {
	const element = document.createElement('div');
	element.style.width = '100%';
	element.style.height = '100%';
	let client: RFB | null = null;
	let closed = false;
	let connected = false;
	let textInputActive = false;
	let touchMode = options.touchMode;
	let composedText = '';
	let compositionTime = 0;
	let touch: ReturnType<typeof attachDesktopTouch> | null = null;

	const fail = (cause?: unknown) => {
		if (!closed) {
			options.onFailure(new RemoteDesktopFailure('remote_unavailable', 'unknown', { cause }));
		}
	};

	const clipboard = attachDesktopClipboard(
		element,
		async (text) => {
			if (!closed && connected) {
				client?.clipboardPasteFrom(text);
			}
		},
		options.onFailure,
	);

	const sendText = (text: string) => {
		if (closed || !connected || !client) {
			return;
		}
		if (new TextEncoder().encode(text).byteLength > 65536) {
			throw new RemoteDesktopFailure('input_failed', 'not_dispatched');
		}
		for (const character of text) {
			client.sendKey(keysym(character), null);
		}
	};

	const input = (event: InputEvent) => {
		if (event.isComposing || textInputActive || closed) {
			return;
		}
		const duplicateComposition = event.data === composedText && performance.now() - compositionTime < 100;
		composedText = '';
		if (event.inputType === 'insertFromComposition' || duplicateComposition) {
			event.preventDefault();
			return;
		}
		if (event.data) {
			event.preventDefault();
			sendText(event.data);
		} else if (event.inputType === 'deleteContentBackward') {
			event.preventDefault();
			client?.sendKey(0xff08, 'Backspace');
		} else if (event.inputType === 'insertLineBreak') {
			event.preventDefault();
			client?.sendKey(0xff0d, 'Enter');
		}
	};

	const composition = (event: CompositionEvent) => {
		if (!textInputActive && !closed) {
			composedText = event.data;
			compositionTime = performance.now();
			sendText(event.data);
		}
	};

	const mobileKey = (event: KeyboardEvent) => {
		if (event.isComposing || textInputActive || closed) {
			return;
		}
		if (event.key === 'Enter' || event.key === 'Backspace') {
			event.preventDefault();
			client?.sendKey(event.key === 'Enter' ? 0xff0d : 0xff08, event.code);
		}
	};

	options.mobileInput?.addEventListener('beforeinput', input);
	options.mobileInput?.addEventListener('compositionend', composition);
	options.mobileInput?.addEventListener('keydown', mobileKey);
	const listeners: Array<() => void> = [];

	const listen = (rfb: RFB, event: string, handler: EventListener) => {
		rfb.addEventListener(event, handler);
		listeners.push(() => rfb.removeEventListener(event, handler));
	};

	return {
		element,

		connect(session) {
			if (closed || client || session.protocol !== 'VNC') {
				throw new RemoteDesktopFailure('conflict', 'not_dispatched');
			}
			const rfb = new RFB(
				element,
				createWebSocketUrl('/ws/remote-desktop?' + new URLSearchParams({ ticket: session.ticket })),
				{
					credentials: { username: session.username, password: session.password },
				},
			);
			client = rfb;
			rfb.scaleViewport = true;
			rfb.resizeSession = true;
			rfb.focusOnClick = !options.hasTouch;
			rfb.showDotCursor = options.hasTouch;
			listen(rfb, 'connect', () => {
				if (closed) {
					return;
				}
				connected = true;
				const canvas = element.querySelector('canvas');
				if (canvas && options.hasTouch) {
					touch = attachDesktopTouch(element, canvas, touchMode);
				}
				options.onState('connected');
			});
			listen(rfb, 'disconnect', (event) => {
				if (closed) {
					return;
				}
				connected = false;
				const detail: unknown = event instanceof CustomEvent ? event.detail : null;
				if (detail && typeof detail === 'object' && 'clean' in detail && detail.clean === true) {
					options.onState('disconnected');
				} else {
					fail();
				}
			});
			listen(rfb, 'securityfailure', () => fail());
			listen(rfb, 'credentialsrequired', () => fail());
			listen(rfb, 'clipboard', (event) => {
				const detail: unknown = event instanceof CustomEvent ? event.detail : null;
				if (detail && typeof detail === 'object' && 'text' in detail && typeof detail.text === 'string') {
					clipboard.receive(detail.text);
				}
			});
		},

		resize() {
			if (client && connected && !closed) {
				client.resizeSession = true;
			}
		},

		focus() {
			if (!closed && connected) {
				client?.focus();
			}
		},

		setTouchMode(mode) {
			touchMode = mode;
			touch?.setMode(mode);
		},

		setTextInputActive(active) {
			textInputActive = active;
			if (active) {
				client?.blur();
			}
		},

		syncClipboard: clipboard.sync,
		sendText,

		close() {
			if (closed) {
				return;
			}
			closed = true;
			connected = false;
			options.mobileInput?.removeEventListener('beforeinput', input);
			options.mobileInput?.removeEventListener('compositionend', composition);
			options.mobileInput?.removeEventListener('keydown', mobileKey);
			for (const remove of listeners) {
				remove();
			}
			clipboard.close();
			touch?.close();
			const original = client;
			client = null;
			try {
				original?.disconnect();
			} finally {
				element.remove();
			}
		},
	};
};
