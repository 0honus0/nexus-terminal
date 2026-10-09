import type { RemoteShellView, RemoteOpenShell } from '@nexus-terminal/shared/remote/model';
import type { RemoteClientEvent, RemoteServerEvent } from '@nexus-terminal/shared/remote/events';

const ROOT = '/__next/api/v1/remote';

function parseView(input: unknown): RemoteShellView {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('Invalid Remote response');
	}
	const row = input as Record<string, unknown>;
	if (
		typeof row.id !== 'string' ||
		typeof row.targetId !== 'number' ||
		typeof row.configurationFingerprint !== 'string' ||
		typeof row.startedAt !== 'number' ||
		row.status !== 'open'
	) {
		throw new Error('Invalid Remote response');
	}
	return {
		id: row.id,
		targetId: row.targetId,
		configurationFingerprint: row.configurationFingerprint,
		startedAt: row.startedAt,
		status: 'open',
	};
}

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
	const response = await fetch(ROOT + path, {
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
	const content: unknown = await response.json();
	if (!response.ok) {
		if (content && typeof content === 'object' && 'code' in content && typeof content.code === 'string') {
			throw new Error(content.code);
		}
		throw new Error('remote_unavailable');
	}
	return content;
}

function decodeEvent(input: unknown): RemoteServerEvent {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new Error('Invalid Remote event');
	}
	const row = input as Record<string, unknown>;
	switch (row.type) {
		case 'ready':
			if (typeof row.sessionId === 'string') {
				return { type: 'ready', sessionId: row.sessionId };
			}
			break;
		case 'data':
			if (typeof row.data === 'string' && (row.stream === 'stdout' || row.stream === 'stderr')) {
				return { type: 'data', data: row.data, stream: row.stream };
			}
			break;
		case 'drain':
			return { type: 'drain' };
		case 'blocked':
			return { type: 'blocked' };
		case 'closed':
			return { type: 'closed' };
		case 'error':
			if (
				typeof row.code === 'string' &&
				['invalid_input', 'unauthenticated', 'not_found', 'transport_overflow', 'remote_unavailable'].includes(
					row.code,
				)
			) {
				return {
					type: 'error',
					code: row.code as
						'invalid_input' | 'unauthenticated' | 'not_found' | 'transport_overflow' | 'remote_unavailable',
				};
			}
	}
	throw new Error('Invalid Remote event');
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
	const session = parseView(await request('POST', '/sessions', input, signal));
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
			await request('DELETE', '/sessions/' + encodeURIComponent(session.id));
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
			// Output that has already arrived must finish terminal.write before
			// notifying the component, including a normal server EOF.
			try {
				await pending.catch(() => listener.failure('remote_unavailable'));
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
					await request('DELETE', '/sessions/' + encodeURIComponent(session.id));
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
			if (bytes.length > 32 * 1024) {
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
					const message = decodeEvent(JSON.parse(event.data) as unknown);
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
