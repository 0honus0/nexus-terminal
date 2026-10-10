import { REMOTE_FRAME_DATA_BYTES } from '@nexus-terminal/shared/remote/sessions/values';
import {
	readRemoteShellView,
	readRemoteCloseSession,
	readRemoteFailureResponse,
	readRemoteOpenShell,
	type RemoteOpenShell,
} from '@nexus-terminal/shared/remote/sessions/http';
import { type RemoteShellView } from '@nexus-terminal/shared/remote/sessions/model';
import { readRemoteServerEvent, type RemoteClientEvent } from '@nexus-terminal/shared/remote/sessions/events';

const ROOT = '/__next/api/v1/remote';

function bytesFromBase64(data: string): Uint8Array {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)) {
		throw new Error('Invalid Remote bytes');
	}
	return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

function bytesToBase64(input: Uint8Array): string {
	let text = '';
	for (const byte of input) {
		text += String.fromCharCode(byte);
	}
	return btoa(text);
}

export interface RemoteTerminalHandle {
	readonly session: RemoteShellView;
	input(value: string): void;
	resize(columns: number, rows: number): void;
	close(): Promise<void>;
}

export interface RemoteTerminalListener {
	output(bytes: Uint8Array, stream: 'stdout' | 'stderr'): Promise<void>;
	closed(): void;
	failure(code: string): void;
}

async function request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
	let response: Response;
	try {
		response = await fetch(ROOT + path, {
			method,
			credentials: 'same-origin',
			cache: 'no-store',
			signal,
			...(body === undefined
				? {}
				: {
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(body),
					}),
		});
	} catch (error) {
		if (signal?.aborted) {
			throw error;
		}
		throw new Error('remote_unavailable');
	}
	let content: unknown;
	try {
		content = (await response.json()) as unknown;
	} catch {
		throw new Error('remote_unavailable');
	}
	if (!response.ok) {
		try {
			const failure = readRemoteFailureResponse(content);
			throw new Error(failure.code);
		} catch (error) {
			if (error instanceof Error && error.message === 'invalid_remote_payload') {
				throw new Error('remote_unavailable');
			}
			throw error;
		}
	}
	return content;
}

/** Owns a single ephemeral websocket; all close paths share one cleanup promise. */
export async function openRemoteTerminal(
	input: RemoteOpenShell,
	listener: RemoteTerminalListener,
	signal?: AbortSignal,
): Promise<RemoteTerminalHandle> {
	if (signal?.aborted) {
		throw new Error('remote_unavailable');
	}
	const session = readRemoteShellView(await request('POST', '/sessions', readRemoteOpenShell(input), signal));
	const wsUrl = new URL(ROOT + '/stream?sessionId=' + encodeURIComponent(session.id), window.location.href);
	wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
	let socket: WebSocket;
	try {
		if (signal?.aborted) {
			throw new Error('remote_unavailable');
		}
		socket = new WebSocket(wsUrl);
	} catch (error) {
		try {
			readRemoteCloseSession(await request('DELETE', '/sessions/' + encodeURIComponent(session.id)));
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'remote_unavailable');
		}
		throw error;
	}
	let open = false;
	let finished = false;
	let inputBlocked = false;
	let pending = Promise.resolve();
	let closePromise: Promise<void> | null = null;
	let normalEof = false;
	let onAbort: (() => void) | null = null;

	function send(event: RemoteClientEvent): void {
		if (!open || finished || socket.readyState !== WebSocket.OPEN) {
			throw new Error('remote_unavailable');
		}
		const encoded = JSON.stringify(event);
		if (socket.bufferedAmount + encoded.length > 1024 * 1024) {
			throw new Error('transport_overflow');
		}
		socket.send(encoded);
	}

	function close(): Promise<void> {
		if (closePromise) {
			return closePromise;
		}
		closePromise = (async () => {
			// A normal EOF must wait for rendered output. An abort/transport error
			// must close immediately, even if a renderer can no longer make progress.
			try {
				if (normalEof) {
					await pending.catch(() => listener.failure('remote_unavailable'));
				}
			} finally {
				finished = true;
				if (onAbort && signal) {
					signal.removeEventListener('abort', onAbort);
				}
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
			}
			try {
				if (!normalEof) {
					readRemoteCloseSession(await request('DELETE', '/sessions/' + encodeURIComponent(session.id)));
				}
			} finally {
				listener.closed();
			}
		})();
		return closePromise;
	}

	function report(code: string): void {
		listener.failure(code);
		void close().catch(() => listener.failure('remote_unavailable'));
	}

	const handle: RemoteTerminalHandle = {
		session,

		input(value) {
			if (inputBlocked) {
				throw new Error('transport_overflow');
			}
			const bytes = new TextEncoder().encode(value);
			if (bytes.length > REMOTE_FRAME_DATA_BYTES) {
				throw new Error('invalid_input');
			}
			send({ type: 'input', data: bytesToBase64(bytes) });
		},

		resize(columns, rows) {
			send({ type: 'resize', columns, rows });
		},

		close,
	};

	try {
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error('remote_unavailable')), 10000);
			let connected = false;

			const fail = (error: Error): void => {
				window.clearTimeout(timer);
				reject(error);
			};

			onAbort = () => {
				fail(new Error('remote_unavailable'));
				void close().catch(() => undefined);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			if (signal?.aborted) {
				onAbort();
				return;
			}
			socket.onerror = () => {
				if (connected) {
					report('remote_unavailable');
				} else {
					fail(new Error('remote_unavailable'));
				}
			};
			socket.onclose = () => {
				if (connected) {
					void close().catch(() => listener.failure('remote_unavailable'));
				} else {
					fail(new Error('remote_unavailable'));
				}
			};
			socket.onmessage = (event) => {
				try {
					if (typeof event.data !== 'string') {
						throw new Error('invalid_input');
					}
					const message = readRemoteServerEvent(JSON.parse(event.data) as unknown);
					if (message.type === 'ready') {
						if (connected || message.sessionId !== session.id) {
							throw new Error('invalid_input');
						}
						connected = true;
						open = true;
						window.clearTimeout(timer);
						resolve();
						return;
					}
					if (!connected) {
						throw new Error('invalid_input');
					}
					switch (message.type) {
						case 'data': {
							const bytes = bytesFromBase64(message.data);
							pending = pending.then(async () => {
								await listener.output(bytes, message.stream);
								// The server has not yet acknowledged delivery until
								// terminal.write has called back.
								if (!finished && socket.readyState === WebSocket.OPEN) {
									send({ type: 'consumed', bytes: bytes.length });
								}
							});
							void pending.catch(() => report('remote_unavailable'));
							break;
						}
						case 'drain':
							inputBlocked = false;
							break;
						case 'blocked':
							inputBlocked = true;
							break;
						case 'closed':
							normalEof = true;
							void close().catch(() => listener.failure('remote_unavailable'));
							break;
						case 'error':
							report(message.code);
							break;
					}
				} catch {
					if (!connected) {
						fail(new Error('invalid_input'));
					}
					report('invalid_input');
				}
			};
		});
		return handle;
	} catch (error) {
		try {
			await close();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'remote_unavailable');
		}
		throw error;
	}
}
