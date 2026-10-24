import type { Logger } from '../logging/logger.js';
import { bindDiagnosticContext, logDiagnostic } from '../logging/diagnostic-log.js';
import {
	MAX_WEBSOCKET_INPUT_MESSAGES,
	MAX_WEBSOCKET_INPUT_BYTES,
	MAX_WEBSOCKET_BUFFER_BYTES,
	MAX_WEBSOCKET_FRAME_BYTES,
} from './http-limits.js';
import { WebSocket } from 'ws';
import type { HttpWebSocketChannel } from './http-types.js';

interface WebSocketChannelOptions {
	logger?: Logger;
	isAccepting(): boolean;
	maxBinaryMessageBytes?: number;
	maxTextMessageBytes?: number;
	maxBufferedTextBytes?: number;
	trackTask(task: Promise<unknown>, observeFailure?: boolean): void;
	onClosed(): void;
}

/** One socket owns its queue, callbacks, flow control and graceful completion. */
export function createWebSocketChannel(ws: WebSocket, options: WebSocketChannelOptions): HttpWebSocketChannel {
	const textSendBudget = Math.min(
		MAX_WEBSOCKET_FRAME_BYTES,
		Math.max(MAX_WEBSOCKET_BUFFER_BYTES, options.maxBufferedTextBytes ?? MAX_WEBSOCKET_BUFFER_BYTES),
	);
	let listener: ((value: string) => Promise<void>) | null = null;
	let binaryListener: ((value: Uint8Array) => Promise<void>) | null = null;
	let closing: (() => Promise<void>) | null = null;
	let incoming = Promise.resolve();
	let queuedMessages = 0;
	let queuedBytes = 0;
	let finishing: Promise<void> | null = null;
	let outputRejected = false;

	const recordOutputRejected = () => {
		if (!outputRejected) {
			outputRejected = true;
			logDiagnostic(options.logger, 'warn', 'WS_OUTPUT_REJECTED', {
				bufferedBytes: ws.bufferedAmount,
				readyState: ws.readyState,
			});
		}
	};

	// Protocol and transport errors belong to this socket, not the process.
	ws.on('error', () => ws.terminate());
	ws.on(
		'message',
		bindDiagnosticContext((data, isBinary) => {
			const binaryLimit = options.maxBinaryMessageBytes;
			if (
				finishing ||
				!options.isAccepting() ||
				(isBinary ? !binaryListener || binaryLimit === undefined : !listener)
			) {
				ws.terminate();
				return;
			}
			const binary = isBinary
				? Buffer.isBuffer(data)
					? data
					: Array.isArray(data)
						? Buffer.concat(data)
						: Buffer.from(data)
				: null;
			const bytes = binary?.byteLength ?? Buffer.byteLength(data.toString());
			if (isBinary && binaryLimit !== undefined && bytes > binaryLimit) {
				logDiagnostic(options.logger, 'warn', 'WS_INPUT_LIMIT_EXCEEDED', { binary: true, bytes });
				ws.close(1009, 'Binary frame exceeds route limit');
				return;
			}
			if (!isBinary && options.maxTextMessageBytes !== undefined && bytes > options.maxTextMessageBytes) {
				logDiagnostic(options.logger, 'warn', 'WS_INPUT_LIMIT_EXCEEDED', { binary: false, bytes });
				ws.close(1009, 'Text frame exceeds route limit');
				return;
			}
			const inputBudget = Math.max(MAX_WEBSOCKET_INPUT_BYTES, options.maxTextMessageBytes ?? 0, binaryLimit ?? 0);
			if (queuedMessages >= MAX_WEBSOCKET_INPUT_MESSAGES || queuedBytes + bytes > inputBudget) {
				logDiagnostic(options.logger, 'warn', 'WS_INPUT_QUEUE_EXCEEDED', { queuedMessages, queuedBytes });
				ws.terminate();
				return;
			}
			queuedMessages += 1;
			queuedBytes += bytes;
			// Old upload transport started each append independently. Serialize binary
			// receives and pause the socket at high water so final-chunk ACK cannot
			// overtake an earlier write or accumulate unbounded queued chunks.
			if (binaryListener && queuedBytes >= MAX_WEBSOCKET_INPUT_BYTES / 2) {
				ws.pause();
			}
			const current = incoming.then(async () => {
				try {
					if (!finishing && options.isAccepting() && ws.readyState === WebSocket.OPEN) {
						if (binary !== null) {
							await binaryListener?.(Uint8Array.from(binary));
						} else {
							await listener?.(data.toString());
						}
					}
				} finally {
					queuedMessages -= 1;
					queuedBytes -= bytes;
					// A successful final upload chunk may close the socket *inside* its
					// append callback while the ingress reader remains paused at high
					// water. A paused WebSocket cannot consume the peer's Close frame,
					// so resume in CLOSING too; otherwise a completed upload can hang
					// until the close watchdog times out despite committed file bytes.
					if (
						binaryListener &&
						queuedBytes < MAX_WEBSOCKET_INPUT_BYTES / 4 &&
						ws.readyState !== WebSocket.CLOSED
					) {
						ws.resume();
					}
				}
			});
			incoming = current.catch((error: unknown) => {
				logDiagnostic(options.logger, 'error', 'WS_MESSAGE_HANDLER_FAILED', {}, error);
				ws.terminate();
			});
			// One chain per socket, rather than tracking every ancestor Promise.
			options.trackTask(current.catch(() => undefined));
		}),
	);
	ws.on(
		'close',
		bindDiagnosticContext(() => {
			options.onClosed();
			if (closing) {
				options.trackTask(Promise.resolve().then(closing), true);
			}
		}),
	);
	const channel: HttpWebSocketChannel = {
		send(value) {
			if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount + Buffer.byteLength(value) > textSendBudget) {
				recordOutputRejected();
				return false;
			}
			ws.send(value, (error) => {
				if (error) {
					ws.terminate();
				}
			});
			return true;
		},

		sendBinary(value) {
			if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount + value.byteLength > MAX_WEBSOCKET_BUFFER_BYTES) {
				recordOutputRejected();
				return false;
			}
			ws.send(value, { binary: true }, (error) => {
				if (error) {
					ws.terminate();
				}
			});
			return true;
		},

		onMessage(callback) {
			listener = callback;
		},

		onBinary(callback) {
			if (options.maxBinaryMessageBytes === undefined) {
				throw new Error('Binary ingress is not enabled for this WebSocket route');
			}
			binaryListener = callback;
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
					logDiagnostic(options.logger, 'warn', 'WS_CLOSE_TIMEOUT');
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

		close(code, reason) {
			if (code !== undefined && ws.readyState === WebSocket.OPEN) {
				ws.close(code, reason);
				return;
			}
			ws.terminate();
		},
	};
	return channel;
}
