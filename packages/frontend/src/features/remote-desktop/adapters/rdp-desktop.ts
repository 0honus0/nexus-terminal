import {
	Backend,
	init,
	displayControl,
	enableCredssp,
	outboundMessageSizeLimit,
} from '@devolutions/iron-remote-desktop-rdp';
import { REMOTE_DESKTOP_FRAME_MAX_BYTES } from '@nexus-terminal/shared/remote/desktop/values';
import { createWebSocketUrl } from '@/client/websocket';
import { logger } from '@/client/logging/logger';
import { attachDesktopClipboard, MAX_CLIPBOARD_BYTES } from './desktop-clipboard';
import { attachDesktopTouch } from './desktop-touch';
import { DESKTOP_SCANCODES } from './desktop-keyboard';
import {
	RemoteDesktopFailure,
	type RemoteDesktopPeerFactory,
	type RemoteDesktopSession,
	type RemoteDesktopDisplay,
} from '../model/remote-desktop-types';

type RdpSession = Awaited<ReturnType<InstanceType<typeof Backend.SessionBuilder>['connect']>>;

const POINTER_INTERVAL_MS = 16;
// Allow surrogate-pair press/releases and a pointer within Fast-Path's 255-event count.
const TEXT_BATCH_CHARACTERS = 32;

let initialization: Promise<void> | null = null;

function initialize(): Promise<void> {
	initialization ??= init('off').catch((error: unknown) => {
		initialization = null;
		throw error;
	});
	return initialization;
}

export const createRdpDesktop: RemoteDesktopPeerFactory = (options) => {
	const element = document.createElement('div');
	element.style.width = '100%';
	element.style.height = '100%';
	element.style.display = 'flex';
	element.style.alignItems = 'center';
	element.style.justifyContent = 'center';
	const canvas = document.createElement('canvas');
	canvas.style.maxWidth = '100%';
	canvas.style.maxHeight = '100%';
	canvas.style.objectFit = 'contain';
	element.append(canvas);
	const keyboard = options.mobileInput ?? document.createElement('textarea');
	if (!options.mobileInput) {
		keyboard.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
		keyboard.setAttribute('aria-hidden', 'true');
		keyboard.tabIndex = -1;
		element.append(keyboard);
	}
	let session: RdpSession | null = null;
	let closed = false;
	let started = false;
	let textInputActive = false;
	let touchMode = options.touchMode;
	let latestDisplay: RemoteDesktopDisplay | null = null;
	const clipboardTasks = new Set<Promise<void>>();
	const pressedKeys = new Set<number>();
	const pressedButtons = new Set<number>();
	let composedText = '';
	let compositionTime = 0;
	let touch: ReturnType<typeof attachDesktopTouch> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pointerTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingPointer: { x: number; y: number } | null = null;

	const fail = (cause: unknown) => {
		if (!closed) {
			options.onFailure(new RemoteDesktopFailure('remote_unavailable', 'unknown', { cause }));
		}
	};

	const inputFailure = (cause: unknown) => {
		if (!closed) {
			options.onFailure(new RemoteDesktopFailure('input_failed', 'unknown', { cause }));
		}
	};

	const apply = (create: () => ReturnType<typeof Backend.DeviceEvent.keyPressed>[]): boolean => {
		if (pointerTimer !== null) {
			clearTimeout(pointerTimer);
			pointerTimer = null;
		}
		const pointer = pendingPointer;
		pendingPointer = null;
		if (closed || !session) {
			return false;
		}
		try {
			const transaction = new Backend.InputTransaction();
			if (pointer) {
				transaction.addEvent(Backend.DeviceEvent.mouseMove(pointer.x, pointer.y));
			}
			for (const event of create()) {
				transaction.addEvent(event);
			}
			session.applyInputs(transaction);
			return true;
		} catch (cause) {
			inputFailure(cause);
			return false;
		}
	};

	const flushPointer = () => {
		if (pendingPointer) {
			apply(() => []);
		}
	};

	const sendText = (text: string) => {
		if (closed || !session) {
			return;
		}
		if (new TextEncoder().encode(text).byteLength > 65536) {
			throw new RemoteDesktopFailure('input_failed', 'not_dispatched');
		}
		let batch: string[] = [];

		const submit = () => {
			const characters = batch;
			batch = [];
			return apply(() =>
				characters.flatMap((character) => {
					if (character === '\n' || character === '\r' || character === '\t') {
						const code = character === '\t' ? 0x0f : 0x1c;
						return [Backend.DeviceEvent.keyPressed(code), Backend.DeviceEvent.keyReleased(code)];
					}
					return [
						Backend.DeviceEvent.unicodePressed(character),
						Backend.DeviceEvent.unicodeReleased(character),
					];
				}),
			);
		};

		for (const character of text) {
			batch.push(character);
			if (batch.length === TEXT_BATCH_CHARACTERS) {
				if (!submit()) {
					return;
				}
			}
		}
		if (batch.length) {
			submit();
		}
	};

	const clipboard = attachDesktopClipboard(
		element,
		async (text) => {
			const original = session;
			if (closed || !original) {
				return;
			}
			const content = new Backend.ClipboardData();
			try {
				content.addText('text/plain', text);
				const task = original.onClipboardPaste(content);
				clipboardTasks.add(task);
				try {
					await task;
				} finally {
					clipboardTasks.delete(task);
				}
			} finally {
				content.free();
			}
		},
		inputFailure,
	);

	const key = (event: KeyboardEvent) => {
		if (closed || !session || textInputActive || event.isComposing || event.key === 'Process') {
			return;
		}
		const scancode = DESKTOP_SCANCODES[event.code];
		if (!scancode && event.key.length !== 1) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.type === 'keyup' && scancode && pressedKeys.delete(scancode)) {
			apply(() => [Backend.DeviceEvent.keyReleased(scancode)]);
			return;
		}
		if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
			if (event.type === 'keydown') {
				sendText(event.key);
			}
		} else if (scancode && event.type === 'keydown') {
			pressedKeys.add(scancode);
			apply(() => [Backend.DeviceEvent.keyPressed(scancode)]);
		}
	};

	const beforeInput = (event: InputEvent) => {
		if (closed || textInputActive || event.isComposing) {
			return;
		}
		event.preventDefault();
		const duplicateComposition = event.data === composedText && performance.now() - compositionTime < 100;
		composedText = '';
		if (event.inputType === 'insertFromComposition' || duplicateComposition) {
			return;
		}
		if (event.data) {
			sendText(event.data);
		} else if (event.inputType === 'deleteContentBackward') {
			apply(() => [Backend.DeviceEvent.keyPressed(0x0e), Backend.DeviceEvent.keyReleased(0x0e)]);
		} else if (event.inputType === 'insertLineBreak') {
			sendText('\n');
		}
	};

	const composition = (event: CompositionEvent) => {
		if (!closed && !textInputActive) {
			composedText = event.data;
			compositionTime = performance.now();
			sendText(event.data);
		}
		keyboard.value = '';
	};

	const release = () => {
		flushPointer();
		pressedKeys.clear();
		pressedButtons.clear();
		try {
			if (!closed) {
				session?.releaseAllInputs();
			}
		} catch (cause) {
			inputFailure(cause);
		}
	};

	const focus = () => {
		if (!closed && session && !options.hasTouch) {
			keyboard.focus({ preventScroll: true });
		}
	};

	const releaseButton = (event: MouseEvent) => {
		if (pressedButtons.delete(event.button)) {
			apply(() => [Backend.DeviceEvent.mouseButtonReleased(event.button)]);
		}
	};

	const mouse = (event: MouseEvent) => {
		if (closed || !session) {
			return;
		}
		event.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const pointerX = Math.max(
			0,
			Math.min(
				canvas.width - 1,
				Math.round(((event.clientX - rect.left) * canvas.width) / Math.max(1, rect.width)),
			),
		);
		const pointerY = Math.max(
			0,
			Math.min(
				canvas.height - 1,
				Math.round(((event.clientY - rect.top) * canvas.height) / Math.max(1, rect.height)),
			),
		);
		pendingPointer = { x: pointerX, y: pointerY };
		if (event.type === 'mousemove') {
			// Retain the latest position; keys/buttons flush it first without waiting for this timer.
			pointerTimer ??= setTimeout(flushPointer, POINTER_INTERVAL_MS);
			return;
		}
		if (event.type === 'mousedown') {
			focus();
			pressedButtons.add(event.button);
			apply(() => [Backend.DeviceEvent.mouseButtonPressed(event.button)]);
		}
		if (event.type === 'mouseup') {
			releaseButton(event);
			flushPointer();
		}
	};

	const wheel = (event: WheelEvent) => {
		event.preventDefault();
		const unit = event.deltaMode === 1 ? 1 : event.deltaMode === 2 ? 2 : 0;
		apply(() => [
			Backend.DeviceEvent.wheelRotations(true, -event.deltaY, unit),
			Backend.DeviceEvent.wheelRotations(false, -event.deltaX, unit),
		]);
	};

	const context = (event: Event) => event.preventDefault();

	const resize = (display: RemoteDesktopDisplay) => {
		latestDisplay = display;
		if (closed || !session) {
			return;
		}
		flushPointer();
		try {
			session.resize(
				display.width,
				display.height,
				Math.min(500, Math.max(100, Math.round((display.dpi / 96) * 100))),
			);
		} catch (cause) {
			inputFailure(cause);
		}
	};

	keyboard.addEventListener('keydown', key);
	keyboard.addEventListener('keyup', key);
	keyboard.addEventListener('beforeinput', beforeInput);
	keyboard.addEventListener('compositionend', composition);
	keyboard.addEventListener('blur', release);
	canvas.addEventListener('mousedown', mouse);
	canvas.addEventListener('mouseup', mouse);
	canvas.addEventListener('mousemove', mouse);
	canvas.addEventListener('wheel', wheel, { passive: false });
	canvas.addEventListener('contextmenu', context);
	window.addEventListener('mouseup', releaseButton);
	window.addEventListener('blur', release);

	const connect = async (connection: RemoteDesktopSession, display: RemoteDesktopDisplay) => {
		await initialize();
		if (closed) {
			return;
		}
		const builder = new Backend.SessionBuilder();
		let connected: RdpSession;
		try {
			const separator = connection.username.indexOf('\\');
			const domain = separator >= 0 ? connection.username.slice(0, separator) : '';
			const username = separator >= 0 ? connection.username.slice(separator + 1) : connection.username;
			builder.username(username).free();
			builder.password(connection.password).free();
			builder.serverDomain(domain).free();
			builder
				.destination(
					(connection.host.includes(':') ? '[' + connection.host + ']' : connection.host) +
						':' +
						connection.port,
				)
				.free();
			builder
				.proxyAddress(
					createWebSocketUrl('/ws/remote-desktop?' + new URLSearchParams({ ticket: connection.ticket })),
				)
				.free();
			builder.authToken('').free();
			builder.renderCanvas(canvas).free();
			builder.desktopSize(new Backend.DesktopSize(display.width, display.height)).free();
			builder.extension(displayControl(true)).free();
			builder.extension(enableCredssp(true)).free();
			builder.extension(outboundMessageSizeLimit(REMOTE_DESKTOP_FRAME_MAX_BYTES)).free();
			builder.setCursorStyleCallbackContext(null).free();
			builder
				.setCursorStyleCallback((kind: unknown, data: unknown, hotspotX: unknown, hotspotY: unknown) => {
					if (closed) {
						return;
					}
					if (kind === 'hidden') {
						canvas.style.cursor = 'none';
					} else if (kind === 'default') {
						canvas.style.cursor = 'default';
					} else if (
						kind === 'url' &&
						typeof data === 'string' &&
						data.startsWith('data:image/png;base64,') &&
						data.length <= 128 * 1024 &&
						typeof hotspotX === 'number' &&
						typeof hotspotY === 'number' &&
						Number.isFinite(hotspotX) &&
						Number.isFinite(hotspotY)
					) {
						canvas.style.cursor = `url(${data}) ${Math.max(0, Math.round(hotspotX))} ${Math.max(0, Math.round(hotspotY))}, default`;
					}
				})
				.free();
			builder
				.remoteClipboardChangedCallback((data: unknown) => {
					if (!(data instanceof Backend.ClipboardData)) {
						return;
					}
					try {
						for (const item of data.items()) {
							try {
								if (item.mimeType() !== 'text/plain') {
									continue;
								}
								const value: unknown = item.value();
								if (typeof value === 'string') {
									clipboard.receive(value);
								} else if (value instanceof Uint8Array && value.byteLength <= MAX_CLIPBOARD_BYTES) {
									clipboard.receive(new TextDecoder().decode(value));
								}
							} finally {
								item.free();
							}
						}
					} catch (cause) {
						inputFailure(cause);
					} finally {
						data.free();
					}
				})
				.free();
			builder
				.forceClipboardUpdateCallback(() => {
					if (!closed) {
						void clipboard.sync();
					}
				})
				.free();
			connected = await builder.connect();
		} finally {
			builder.free();
		}
		session = connected;
		if (timer) {
			clearTimeout(timer);
		}
		timer = null;
		try {
			if (closed) {
				connected.shutdown();
			} else {
				if (options.hasTouch) {
					touch = attachDesktopTouch(element, canvas, touchMode);
				}
				resize(latestDisplay ?? display);
				options.onState('connected');
				focus();
			}
			const termination = await connected.run();
			termination.free();
			if (!closed) {
				options.onState('disconnected');
			}
		} finally {
			if (session === connected) {
				session = null;
			}
			await Promise.allSettled([...clipboardTasks]);
			connected.free();
		}
	};

	return {
		element,

		connect(connection, display) {
			if (closed || started || connection.protocol !== 'RDP') {
				throw new RemoteDesktopFailure('conflict', 'not_dispatched');
			}
			started = true;
			timer = setTimeout(() => fail(new RemoteDesktopFailure('remote_unavailable', 'unknown')), 30_000);
			void connect(connection, display).catch((cause: unknown) => {
				if (timer) {
					clearTimeout(timer);
				}
				timer = null;
				if (closed) {
					logger.error({ code: 'remote_desktop_closed_task_failed' }, 'Remote desktop cleanup failed');
				} else {
					fail(cause);
				}
			});
		},

		resize,

		focus,

		setTouchMode(mode) {
			touchMode = mode;
			touch?.setMode(mode);
		},

		setTextInputActive(active) {
			release();
			textInputActive = active;
		},

		syncClipboard: clipboard.sync,
		sendText,

		close() {
			if (closed) {
				return;
			}
			release();
			closed = true;
			if (timer) {
				clearTimeout(timer);
			}
			timer = null;
			clipboard.close();
			touch?.close();
			keyboard.removeEventListener('keydown', key);
			keyboard.removeEventListener('keyup', key);
			keyboard.removeEventListener('beforeinput', beforeInput);
			keyboard.removeEventListener('compositionend', composition);
			keyboard.removeEventListener('blur', release);
			canvas.removeEventListener('mousedown', mouse);
			canvas.removeEventListener('mouseup', mouse);
			canvas.removeEventListener('mousemove', mouse);
			canvas.removeEventListener('wheel', wheel);
			canvas.removeEventListener('contextmenu', context);
			window.removeEventListener('blur', release);
			window.removeEventListener('mouseup', releaseButton);
			try {
				session?.shutdown();
			} finally {
				if (!options.mobileInput) {
					keyboard.remove();
				}
				element.remove();
			}
		},
	};
};
