import { MAX_WEBSOCKET_INPUT_MESSAGES, MAX_WEBSOCKET_INPUT_BYTES, MAX_WEBSOCKET_BUFFER_BYTES } from './http-limits.js';
import { WebSocket } from 'ws';
import type { HttpWebSocketChannel } from './http-types.js';

interface WebSocketChannelOptions {
	isAccepting(): boolean;
	trackTask(task: Promise<unknown>, observeFailure?: boolean): void;
	onClosed(): void;
}

/** One socket owns its queue, callbacks, flow control and graceful completion. */
export function createWebSocketChannel(ws: WebSocket, options: WebSocketChannelOptions): HttpWebSocketChannel {
	let listener: ((value: string) => Promise<void>) | null = null;
	let closing: (() => Promise<void>) | null = null;
	let incoming = Promise.resolve();
	let queuedMessages = 0;
	let queuedBytes = 0;
	let finishing: Promise<void> | null = null;
	ws.on('message', (data, isBinary) => {
		if (isBinary || !listener || finishing || !options.isAccepting()) {
			ws.terminate();
			return;
		}
		const message = data.toString();
		const bytes = Buffer.byteLength(message);
		if (queuedMessages >= MAX_WEBSOCKET_INPUT_MESSAGES || queuedBytes + bytes > MAX_WEBSOCKET_INPUT_BYTES) {
			ws.terminate();
			return;
		}
		queuedMessages += 1;
		queuedBytes += bytes;
		const current = incoming.then(async () => {
			try {
				if (ws.readyState === WebSocket.OPEN && listener) {
					await listener(message);
				}
			} finally {
				queuedMessages -= 1;
				queuedBytes -= bytes;
			}
		});
		incoming = current.catch(() => ws.terminate());
		// One chain per socket, rather than tracking every ancestor Promise.
		options.trackTask(current.catch(() => undefined));
	});
	ws.on('close', () => {
		options.onClosed();
		if (closing) {
			options.trackTask(Promise.resolve().then(closing), true);
		}
	});
	const channel: HttpWebSocketChannel = {
		send(value) {
			if (
				ws.readyState !== WebSocket.OPEN ||
				ws.bufferedAmount + Buffer.byteLength(value) > MAX_WEBSOCKET_BUFFER_BYTES
			) {
				return false;
			}
			ws.send(value, (error) => {
				if (error) {
					ws.terminate();
				}
			});
			return true;
		},

		onMessage(callback) {
			listener = callback;
		},

		onClose(callback) {
			closing = callback;
		},

		finish() {
			if (finishing) {
				return finishing;
			}
			finishing = new Promise<void>((resolve, reject) => {
				if (ws.readyState === WebSocket.CLOSED) {
					resolve();
					return;
				}
				let timedOut = false;
				const deadline = setTimeout(() => {
					timedOut = true;
					ws.terminate();
				}, 5000);
				deadline.unref();
				ws.once('close', (code) => {
					clearTimeout(deadline);
					if (timedOut || code !== 1000) {
						reject(new Error('WebSocket graceful close not confirmed'));
					} else {
						resolve();
					}
				});
				if (ws.readyState === WebSocket.OPEN) {
					ws.close(1000);
				} else {
					ws.terminate();
				}
			});
			return finishing;
		},

		close() {
			ws.terminate();
		},
	};
	return channel;
}
