import type { RemoteShellView, RemoteOpenShell } from '@nexus-terminal/shared/remote/model';
import type { RemoteClientEvent, RemoteServerEvent } from '@nexus-terminal/shared/remote/events';

const ROOT = '/__next/api/v1/remote';

function parseView(input: unknown): RemoteShellView {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Remote response');
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
	for (const byte of input) text += String.fromCharCode(byte);
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

async function request(method: string, path: string, body?: unknown): Promise<unknown> {
	const response = await fetch(ROOT + path, {
		method,
		credentials: 'same-origin',
		cache: 'no-store',
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
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Remote event');
	const row = input as Record<string, unknown>;
	switch (row.type) {
		case 'ready':
			if (typeof row.sessionId === 'string') return { type: 'ready', sessionId: row.sessionId };
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

/** A single-instance, non-resumable terminal channel. Never use the legacy Workspace socket. */
export async function openRemoteTerminal(
	input: RemoteOpenShell,
	listener: RemoteTerminalListener,
): Promise<RemoteTerminalHandle> {
	const session = parseView(await request('POST', '/sessions', input));
	const wsUrl = new URL(ROOT + '/stream?sessionId=' + encodeURIComponent(session.id), window.location.href);
	wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
	const socket = new WebSocket(wsUrl);
	let finished = false;
	let open = false;
	let inputBlocked = false;
	let pending = Promise.resolve();
	let handle: RemoteTerminalHandle;

	const close = async (): Promise<void> => {
		if (finished) return;
		finished = true;
		socket.close();
		await request('DELETE', '/sessions/' + encodeURIComponent(session.id)).catch(() => undefined);
		listener.closed();
	};

	function send(event: RemoteClientEvent): void {
		if (!open || finished || socket.readyState !== WebSocket.OPEN) throw new Error('Remote transport not ready');
		const encoded = JSON.stringify(event);
		if (socket.bufferedAmount + encoded.length > 1024 * 1024) throw new Error('Remote input buffer full');
		socket.send(encoded);
	}

	handle = {
		session,

		input(value) {
			if (inputBlocked) throw new Error('Remote input backpressure');
			const bytes = new TextEncoder().encode(value);
			if (bytes.length > 32 * 1024) throw new Error('Remote input too large');
			send({ type: 'input', data: bytesToBase64(bytes) });
		},

		resize(columns, rows) {
			send({ type: 'resize', columns, rows });
		},

		close,
	};
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error('Remote websocket deadline exceeded')), 10000);

			const fail = (error: Error) => {
				window.clearTimeout(timer);
				reject(error);
			};

			socket.onerror = () => {
				if (open) {
					listener.failure('remote_unavailable');
					void close();
				} else {
					fail(new Error('Remote websocket failed'));
				}
			};
			socket.onclose = () => {
				if (!open) fail(new Error('Remote websocket closed'));
				else void close();
			};
			socket.onmessage = (event) => {
				try {
					if (typeof event.data !== 'string') throw new Error('Unsupported remote frame');
					const message = decodeEvent(JSON.parse(event.data) as unknown);
					if (message.type === 'ready') {
						if (message.sessionId !== session.id) throw new Error('Remote session mismatch');
						open = true;
						window.clearTimeout(timer);
						resolve();
						return;
					}
					if (!open) throw new Error('Remote protocol not ready');
					switch (message.type) {
						case 'data': {
							const bytes = bytesFromBase64(message.data);
							pending = pending.then(async () => {
								await listener.output(bytes, message.stream);
								if (!finished) send({ type: 'consumed', bytes: bytes.length });
							});
							void pending.catch((error: unknown) => {
								listener.failure(error instanceof Error ? error.message : 'remote_unavailable');
								void close();
							});
							break;
						}
						case 'drain':
							inputBlocked = false;
							break;
						case 'blocked':
							inputBlocked = true;
							break;
						case 'closed':
							void close();
							break;
						case 'error':
							listener.failure(message.code);
							void close();
							break;
					}
				} catch (error) {
					listener.failure(error instanceof Error ? error.message : 'remote_unavailable');
					if (!open) fail(new Error('Remote protocol failure'));
					void close();
				}
			};
		});
		return handle;
	} catch (error) {
		await close();
		throw error;
	}
}
