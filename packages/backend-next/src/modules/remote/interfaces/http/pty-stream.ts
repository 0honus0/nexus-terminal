import type { IncomingMessage } from 'node:http';
import type { HttpWebSocketRoute, HttpWebSocketChannel } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { REMOTE_FRAME_DATA_BYTES, REMOTE_OUTPUT_WINDOW_BYTES } from '@nexus-terminal/shared/remote/sessions/values';
import { readRemoteClientEvent, type RemoteServerEvent } from '@nexus-terminal/shared/remote/sessions/events';
import { isRemoteSessionId } from '@nexus-terminal/shared/remote/sessions/model';
import type { RemoteSessionOperations } from '../../sessions/model/session-types.js';
import type { RemoteSessionOwner } from '../../sessions/service/session-owner.js';

class RemoteStreamInputError extends Error {}

interface Chunk {
	stream: 'stdout' | 'stderr';
	bytes: Uint8Array;
}
const MAX_QUEUED = 128 * 1024;

function wireEvent(channel: HttpWebSocketChannel, event: RemoteServerEvent): boolean {
	return channel.send(JSON.stringify(event));
}

/**
 * Exactly one websocket may own a PTY. Acks represent terminal-rendered bytes,
 * not merely received websocket frames. When credit is exhausted we pause SSH.
 */
function connectStream(
	channel: HttpWebSocketChannel,
	token: string,
	id: string,
	owner: RemoteSessionOwner,
	remote: RemoteSessionOperations,
): void {
	if (!owner.attach(token, id)) {
		channel.close();
		return;
	}
	let state: 'active' | 'eof' | 'finishing' | 'ended' = 'active';
	let eofDeadline: ReturnType<typeof setTimeout> | null = null;
	let inputBlocked = false;
	let outstanding = 0;
	let queuedBytes = 0;
	const queued: Chunk[] = [];
	let draining = false;
	let flushRequested = false;
	const subscriptions: Array<() => void> = [];
	let rechecking = false;
	const identityTimer = setInterval(() => {
		if (state === 'ended' || rechecking) {
			return;
		}
		rechecking = true;
		void ((state === 'eof' || state === 'finishing') ? owner.allowedOutput(token, id) : owner.allowed(token, id))
			.then((allowed) => {
				if (state === 'ended') return;
				if (!allowed) {
					terminate('unauthenticated');
				}
			})
			.catch(() => terminate('unauthenticated'))
			.finally(() => {
				rechecking = false;
			});
	}, 15_000);
	identityTimer.unref();
	// Register cleanup before touching the PTY. An exception while attaching a
	// listener must not leave an attached session without an onClose owner.
	channel.onClose(async () => {
		state = 'ended';
		clearInterval(identityTimer);
		if (eofDeadline) {
			clearTimeout(eofDeadline);
		}
		for (const unsubscribe of subscriptions) {
			try {
				unsubscribe();
			} catch {
				/* PTY release still owns the final cleanup */
			}
		}
		await owner.release(id);
	});

	function terminate(code: 'unauthenticated' | 'transport_overflow' | 'remote_unavailable'): void {
		if (state === 'ended') {
			return;
		}
		state = 'ended';
		wireEvent(channel, { type: 'error', code });
		channel.close();
	}

	function finishEof(): void {
		if (state !== 'eof' || draining || queued.length || outstanding) {
			return;
		}
		state = 'finishing';
		void owner
			.allowedOutput(token, id)
			.then((allowed) => {
				if (state === 'ended') return;
				if (!allowed) {
					terminate('unauthenticated');
					return;
				}
				if (!wireEvent(channel, { type: 'closed' })) {
					terminate('transport_overflow');
					return;
				}
				void channel.finish().catch(() => channel.close());
			})
			.catch(() => terminate('unauthenticated'));
	}

	async function flush(): Promise<void> {
		if (state === 'ended') {
			return;
		}
		if (draining) {
			flushRequested = true;
			return;
		}
		draining = true;
		try {
			while (state !== 'ended' && queued.length && outstanding + queued[0].bytes.length <= REMOTE_OUTPUT_WINDOW_BYTES) {
				const allowed = await owner.allowedOutput(token, id);
				if (state === 'ended') return;
				if (!allowed) {
					terminate('unauthenticated');
					return;
				}
				const part = queued.shift();
				if (!part) {
					break;
				}
				queuedBytes -= part.bytes.length;
				const ok = wireEvent(channel, {
					type: 'data',
					stream: part.stream,
					data: Buffer.from(part.bytes).toString('base64'),
				});
				if (!ok) {
					terminate('transport_overflow');
					return;
				}
				outstanding += part.bytes.length;
			}
			// The PTY may leave the active map while an earlier authorization
			// await is in flight, before its onClosed callback sets eof.
			// Its buffered output is still deliverable, but the SSH flow-control
			// methods must never be invoked on that retired session.
			if (state === 'active' && remote.get(id) !== null) {
				if (queued.length || outstanding >= REMOTE_OUTPUT_WINDOW_BYTES) {
					remote.pauseOutput(id);
				} else {
					remote.resumeOutput(id);
				}
			}
		} catch {
			terminate('remote_unavailable');
		} finally {
			draining = false;
			if (flushRequested && state !== 'ended') {
				flushRequested = false;
				void flush();
			}
			finishEof();
		}
	}

	function enqueue(stream: 'stdout' | 'stderr', bytes: Uint8Array): void {
		if (state === 'ended') {
			return;
		}
		for (let offset = 0; offset < bytes.length; offset += 8192) {
			const part = Uint8Array.from(bytes.subarray(offset, offset + 8192));
			queued.push({ stream, bytes: part });
			queuedBytes += part.length;
		}
		if (queuedBytes > MAX_QUEUED) {
			terminate('transport_overflow');
			return;
		}
		if (state === 'active' && remote.get(id) !== null && queuedBytes + outstanding >= REMOTE_OUTPUT_WINDOW_BYTES) {
			remote.pauseOutput(id);
		}
		void flush();
	}

	remote.pauseOutput(id);
	subscriptions.push(remote.onData(id, (bytes) => enqueue('stdout', bytes)));
	subscriptions.push(remote.onStderr(id, (bytes) => enqueue('stderr', bytes)));
	subscriptions.push(
		remote.onDrain(id, () => {
			inputBlocked = false;
			wireEvent(channel, { type: 'drain' });
		}),
	);
	subscriptions.push(
		remote.onClosed(id, (reason) => {
			if (state === 'ended') {
				return;
			}
			if (reason !== 'normal') {
				if (reason === 'closed_by_owner') {
					state = 'ended';
					channel.close();
				} else {
					terminate('remote_unavailable');
				}
				return;
			}
			state = 'eof';
			inputBlocked = true;
			eofDeadline = setTimeout(() => terminate('transport_overflow'), 10000);
			eofDeadline.unref();
			void flush();
			finishEof();
		}),
	);
	channel.onMessage(async (message) => {
		if (state === 'ended') {
			return;
		}
		// A terminal-rendered ACK may arrive after the session left the live
		// map but before onClosed has published EOF. Check ownership independently
		// of liveness, then require a live PTY for commands that change it.
		if (!(await owner.allowedOutput(token, id))) {
			terminate('unauthenticated');
			return;
		}
		if (state === 'ended') return;
		let value;
		try {
			if (Buffer.byteLength(message) > 64 * 1024) {
				throw new RemoteStreamInputError();
			}
			value = readRemoteClientEvent(JSON.parse(message) as unknown);
		} catch {
			wireEvent(channel, { type: 'error', code: 'invalid_input' });
			channel.close();
			return;
		}

		try {
			if (value.type !== 'consumed' && !(await owner.allowed(token, id))) {
				terminate('unauthenticated');
				return;
			}
			if (state === 'ended') return;
			if (state !== 'active' && value.type !== 'consumed') {
				throw new RemoteStreamInputError();
			}
			switch (value.type) {
				case 'input': {
					if (inputBlocked) {
						terminate('transport_overflow');
						return;
					}
					const bytes = Buffer.from(value.data, 'base64');
					if (bytes.length > REMOTE_FRAME_DATA_BYTES) {
						throw new RemoteStreamInputError();
					}
					if (!remote.write(id, bytes)) {
						inputBlocked = true;
						wireEvent(channel, { type: 'blocked' });
					}
					break;
				}
				case 'resize':
					remote.resize(id, value.columns, value.rows);
					break;
				case 'consumed':
					if (value.bytes > outstanding) {
						throw new RemoteStreamInputError();
					}
					outstanding -= value.bytes;
					await flush();
					break;
				case 'close':
					channel.close();
					break;
			}
		} catch (error) {
			terminate(error instanceof RemoteStreamInputError ? 'transport_overflow' : 'remote_unavailable');
		}
	});
	if (!wireEvent(channel, { type: 'ready', sessionId: id })) {
		terminate('transport_overflow');
		return;
	}
	remote.resumeOutput(id);
}

export function createRemoteWebSocketRoute(owner: RemoteSessionOwner, remote: RemoteSessionOperations): HttpWebSocketRoute {
	function parse(url: URL): string | null {
		if (url.searchParams.size !== 1) {
			return null;
		}
		const id = url.searchParams.get('sessionId');
		return id && isRemoteSessionId(id) ? id : null;
	}

	function token(req: IncomingMessage): string | null {
		return readRequestCookie(req, 'nexus_session');
	}

	return {
		path: '/api/v1/remote/stream',

		async authorize(req, url) {
			const id = parse(url);
			return id !== null && (await owner.allowed(token(req), id));
		},

		connected(channel, req, url) {
			const id = parse(url);
			const sessionToken = token(req);
			if (!id || !sessionToken) {
				channel.close();
				return;
			}
			connectStream(channel, sessionToken, id, owner, remote);
		},
	};
}
