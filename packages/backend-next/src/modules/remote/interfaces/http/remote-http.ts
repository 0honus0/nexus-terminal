import type { IncomingMessage } from 'node:http';
import type {
	HttpRoute,
	HttpRouteContext,
	HttpWebSocketRoute,
	HttpWebSocketChannel,
} from '../../../../platform/http/http-server.js';
import { readRequestCookie, HttpInputFailure } from '../../../../platform/http/http-server.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { RemoteSessions, SessionView } from '../../public.js';
import { RemotePermissionError, RemoteSessionOwner } from '../../sessions/service/session-owner.js';
import type { RemoteShellView } from '@nexus-terminal/shared/remote/model';
import type { RemoteServerEvent, RemoteClientEvent } from '@nexus-terminal/shared/remote/events';

const ROOT = '/api/v1/remote';
const SESSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

class RemoteInputError extends Error {}

function positive(value: unknown, max: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
		throw new RemoteInputError();
	}
	return value;
}

function record(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new RemoteInputError();
	}
	const data = value as Record<string, unknown>;
	if (Object.keys(data).some((key) => !allowed.includes(key)) || required.some((key) => !(key in data))) {
		throw new RemoteInputError();
	}
	return data;
}

function toShellView(value: SessionView): RemoteShellView {
	return {
		id: value.id,
		targetId: value.targetId,
		configurationFingerprint: value.fingerprint,
		startedAt: value.startedAt,
		status: 'open',
	};
}

async function identity(access: AccessPublicApi, token: string | null): Promise<void> {
	if (!token) {
		throw new RemotePermissionError('unauthenticated');
	}
	const user = await access.authenticate(token);
	if (!user) {
		throw new RemotePermissionError('unauthenticated');
	}
	if (user.userId !== 1) {
		throw new RemotePermissionError('forbidden');
	}
}

function handleError(ctx: HttpRouteContext, error: unknown): void {
	if (error instanceof HttpInputFailure) {
		throw error;
	}
	if (error instanceof RemoteInputError) {
		ctx.send(400, { code: 'invalid_input' });
		return;
	}
	if (error instanceof RemotePermissionError) {
		const status = remotePermissionStatus(error.code);
		ctx.send(status, { code: error.code });
		return;
	}
	// No machine/SSH error, private credential or destination leaks to HTTP.
	ctx.send(503, { code: 'remote_unavailable' });
}

function remotePermissionStatus(code: RemotePermissionError['code']): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'remote_unavailable':
			return 503;
	}
}

function route(
	method: HttpRoute['method'],
	path: string,
	handler: (ctx: HttpRouteContext) => Promise<void>,
): HttpRoute {
	return {
		method,
		path: ROOT + path,

		async handle(ctx) {
			try {
				if (ctx.query.size) {
					throw new RemoteInputError();
				}
				await handler(ctx);
			} catch (error) {
				handleError(ctx, error);
			}
		},
	};
}

export function createRemoteHttpRoutes(owner: RemoteSessionOwner, access: AccessPublicApi): HttpRoute[] {
	return [
		route('POST', '/sessions', async (ctx) => {
			const token = ctx.cookie('nexus_session');
			await identity(access, token);
			const v = record(
				await ctx.json(),
				['targetId', 'columns', 'rows', 'term'],
				['targetId', 'columns', 'rows'],
			);
			const term = v.term === undefined ? undefined : v.term;
			if (term !== undefined && (typeof term !== 'string' || term.length > 48 || !/^[-\w.]+$/u.test(term))) {
				throw new RemoteInputError();
			}
			const controller = new AbortController();

			const aborted = () => controller.abort(new Error('HTTP client disconnected'));

			ctx.request.once('aborted', aborted);

			const disconnected = () => {
				if (!ctx.response.writableEnded) {
					aborted();
				}
			};

			ctx.response.once('close', disconnected);
			try {
				const opened = await owner.open(token, {
					targetId: positive(v.targetId, Number.MAX_SAFE_INTEGER),
					columns: positive(v.columns, 500),
					rows: positive(v.rows, 300),
					term,
					timeoutMs: 20000,
					signal: controller.signal,
				});
				if (controller.signal.aborted) {
					await owner.release(opened.id);
					return;
				}
				ctx.send(201, toShellView(opened));
			} finally {
				ctx.request.off('aborted', aborted);
				ctx.response.off('close', disconnected);
			}
		}),
		route('GET', '/sessions/:id', async (ctx) => {
			await identity(access, ctx.cookie('nexus_session'));
			const id = ctx.params.id;
			if (!id || !SESSION_PATTERN.test(id)) {
				throw new RemoteInputError();
			}
			const session = await owner.get(ctx.cookie('nexus_session'), id);
			ctx.send(session ? 200 : 404, session ? toShellView(session) : { code: 'not_found' });
		}),
		route('DELETE', '/sessions/:id', async (ctx) => {
			await identity(access, ctx.cookie('nexus_session'));
			const id = ctx.params.id;
			if (!id || !SESSION_PATTERN.test(id)) {
				throw new RemoteInputError();
			}
			const deleted = await owner.closeSession(ctx.cookie('nexus_session'), id);
			ctx.send(deleted ? 200 : 404, deleted ? { closed: true } : { code: 'not_found' });
		}),
	];
}

interface Chunk {
	stream: 'stdout' | 'stderr';
	bytes: Uint8Array;
}
const OUTPUT_WINDOW = 128 * 1024;
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
	remote: RemoteSessions,
): void {
	if (!owner.attach(token, id)) {
		channel.close();
		return;
	}
	let ended = false;
	let eof = false;
	let completing = false;
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
		if (ended || rechecking) {
			return;
		}
		rechecking = true;
		void (eof ? owner.allowedOutput(token, id) : owner.allowed(token, id))
			.then((allowed) => {
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
		ended = true;
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
		if (ended) {
			return;
		}
		ended = true;
		wireEvent(channel, { type: 'error', code });
		channel.close();
	}

	function finishEof(): void {
		if (!eof || ended || completing || draining || queued.length || outstanding) {
			return;
		}
		completing = true;
		void owner
			.allowedOutput(token, id)
			.then((allowed) => {
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
		if (ended) {
			return;
		}
		if (draining) {
			flushRequested = true;
			return;
		}
		draining = true;
		try {
			while (!ended && queued.length && outstanding + queued[0].bytes.length <= OUTPUT_WINDOW) {
				const allowed = await owner.allowedOutput(token, id);
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
			if (!ended && !eof) {
				if (queued.length || outstanding >= OUTPUT_WINDOW) {
					remote.pauseOutput(id);
				} else {
					remote.resumeOutput(id);
				}
			}
		} catch {
			terminate('remote_unavailable');
		} finally {
			draining = false;
			if (flushRequested && !ended) {
				flushRequested = false;
				void flush();
			}
			finishEof();
		}
	}

	function enqueue(stream: 'stdout' | 'stderr', bytes: Uint8Array): void {
		if (ended) {
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
		if (queuedBytes + outstanding >= OUTPUT_WINDOW) {
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
		remote.onClosed(id, () => {
			eof = true;
			inputBlocked = true;
			eofDeadline = setTimeout(() => terminate('transport_overflow'), 10000);
			eofDeadline.unref();
			void flush();
			finishEof();
		}),
	);
	channel.onMessage(async (message) => {
		if (ended) {
			return;
		}
		if (!(await (eof ? owner.allowedOutput(token, id) : owner.allowed(token, id)))) {
			terminate('unauthenticated');
			return;
		}
		let value: RemoteClientEvent;
		try {
			if (Buffer.byteLength(message) > 64 * 1024) {
				throw new RemoteInputError();
			}
			const incoming: unknown = JSON.parse(message);
			const object = record(incoming, ['type', 'data', 'columns', 'rows', 'bytes'], ['type']);
			if (object.type === 'input') {
				record(object, ['type', 'data'], ['type', 'data']);
				if (
					typeof object.data !== 'string' ||
					object.data.length > 48 * 1024 ||
					!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(object.data)
				) {
					throw new RemoteInputError();
				}
				value = { type: 'input', data: object.data };
			} else if (object.type === 'resize') {
				record(object, ['type', 'columns', 'rows'], ['type', 'columns', 'rows']);
				value = { type: 'resize', columns: positive(object.columns, 500), rows: positive(object.rows, 300) };
			} else if (object.type === 'consumed') {
				record(object, ['type', 'bytes'], ['type', 'bytes']);
				value = { type: 'consumed', bytes: positive(object.bytes, OUTPUT_WINDOW) };
			} else if (object.type === 'close') {
				record(object, ['type'], ['type']);
				value = { type: 'close' };
			} else {
				throw new RemoteInputError();
			}
		} catch {
			wireEvent(channel, { type: 'error', code: 'invalid_input' });
			channel.close();
			return;
		}
		try {
			if (eof && value.type !== 'consumed') {
				throw new RemoteInputError();
			}
			switch (value.type) {
				case 'input': {
					if (inputBlocked) {
						terminate('transport_overflow');
						return;
					}
					const bytes = Buffer.from(value.data, 'base64');
					if (bytes.length > 32 * 1024) {
						throw new RemoteInputError();
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
						throw new RemoteInputError();
					}
					outstanding -= value.bytes;
					await flush();
					break;
				case 'close':
					channel.close();
					break;
			}
		} catch (error) {
			terminate(error instanceof RemoteInputError ? 'transport_overflow' : 'remote_unavailable');
		}
	});
	if (!wireEvent(channel, { type: 'ready', sessionId: id })) {
		terminate('transport_overflow');
		return;
	}
	remote.resumeOutput(id);
}

export function createRemoteWebSocketRoute(owner: RemoteSessionOwner, remote: RemoteSessions): HttpWebSocketRoute {
	function parse(url: URL): string | null {
		if (url.searchParams.size !== 1) {
			return null;
		}
		const id = url.searchParams.get('sessionId');
		return id && SESSION_PATTERN.test(id) ? id : null;
	}

	function token(req: IncomingMessage): string | null {
		return readRequestCookie(req, 'nexus_session');
	}

	return {
		path: ROOT + '/stream',

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
