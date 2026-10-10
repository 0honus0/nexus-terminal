import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import WebSocket from '../../../packages/backend-next/node_modules/ws/index.js';
import { openHttpListener } from '../../../packages/backend-next/dist/platform/http/http-server.js';
import { RemoteSessionOwner } from '../../../packages/backend-next/dist/modules/remote/sessions/service/session-owner.js';
import { createRemoteWebSocketRoute } from '../../../packages/backend-next/dist/modules/remote/interfaces/http/remote-http.js';

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

async function within(value, context, ms = 5000) {
	let timer;
	try {
		return await Promise.race([
			value,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Timed out: ' + context)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function listen(webSockets) {
	return openHttpListener({
		port: 0,
		bindHost: '127.0.0.1',
		publicOrigin: 'http://127.0.0.1:0',
		trustedProxies: [],
		routes: [],
		webSockets,
	});
}

async function client(listener, path, extraHeaders = {}) {
	const socket = new WebSocket('ws://' + listener.address + path, {
		origin: 'http://127.0.0.1:0',
		headers: { Host: '127.0.0.1:0', 'Sec-Fetch-Site': 'same-origin', ...extraHeaders },
	});
	await within(once(socket, 'open'), 'websocket open');
	return socket;
}

async function inboundQueueBudget() {
	const entered = deferred();
	const release = deferred();
	let processed = 0;
	const server = await listen([
		{
			path: '/budget',

			authorize: async () => true,

			connected(channel) {
				channel.onMessage(async () => {
					processed += 1;
					entered.resolve();
					await release.promise;
				});
				channel.onClose(async () => undefined);
			},
		},
	]);
	let socket;
	try {
		socket = await client(server, '/budget');
		const closed = once(socket, 'close');
		socket.send('first');
		await within(entered.promise, 'message handler admitted');
		for (let i = 0; i < 80; i++) {
			socket.send('x');
		}
		await within(closed, 'queue overflow terminates connection');
		assert.equal(processed, 1, 'slow handler must not allow queued work to run after disconnect');
		release.resolve();
	} finally {
		release.resolve();
		socket?.terminate();
		await within(server.close(), 'listener drain');
	}
}

async function gracefulSendOrder() {
	const server = await listen([
		{
			path: '/graceful',

			authorize: async () => true,

			connected(channel) {
				channel.onClose(async () => undefined);
				channel.onMessage(async () => {
					assert.equal(channel.send('final output'), true);
					assert.equal(channel.send('closed event'), true);
					await channel.finish();
				});
			},
		},
	]);
	let socket;
	try {
		socket = await client(server, '/graceful');
		const frames = [];
		socket.on('message', (body) => frames.push(body.toString()));
		const closed = once(socket, 'close');
		socket.send('finish');
		const [code] = await within(closed, 'normal closing handshake');
		assert.equal(code, 1000);
		assert.deepEqual(frames, ['final output', 'closed event']);
	} finally {
		socket?.terminate();
		await within(server.close(), 'graceful listener close');
	}
}

function remoteFixture(closeSession) {
	const id = randomUUID();
	const view = { id, targetId: 7, fingerprint: 'fixture', startedAt: Date.now(), status: 'open' };
	let active = true;
	const dataListeners = new Set();
	const closedListeners = new Set();
	return {
		id,

		emitData(data) {
			for (const listener of dataListeners) {
				listener(data);
			}
		},

		emitEof() {
			active = false;
			for (const listener of closedListeners) {
				listener();
			}
		},

		remote: {
			open: async () => view,

			get: () => (active ? view : null),

			list: () => (active ? [view] : []),

			write: () => true,

			resize: () => undefined,

			onData: (_, listener) => {
				dataListeners.add(listener);
				return () => dataListeners.delete(listener);
			},

			onStderr: () => () => undefined,

			onDrain: () => () => undefined,

			onClosed: (_, listener) => {
				closedListeners.add(listener);
				return () => closedListeners.delete(listener);
			},

			pauseOutput: () => undefined,

			resumeOutput: () => undefined,

			closeSession: async () => {
				active = false;
				return closeSession();
			},
		},
	};
}

const access = {
	authenticate: async (token) => (token === 'good' ? { userId: 1 } : null),
};

async function terminalEofAndConsumerAck() {
	let closures = 0;
	const fixture = remoteFixture(async () => {
		closures += 1;
	});
	const owner = new RemoteSessionOwner(access, fixture.remote);
	const session = await owner.open('good', { targetId: 7, columns: 80, rows: 25, timeoutMs: 1000 });
	const server = await listen([createRemoteWebSocketRoute(owner, fixture.remote)]);
	let socket;
	try {
		socket = new WebSocket('ws://' + server.address + '/api/v1/remote/stream?sessionId=' + session.id, {
			origin: 'http://127.0.0.1:0',
			headers: {
				Host: '127.0.0.1:0',
				'Sec-Fetch-Site': 'same-origin',
				Cookie: 'nexus_session=good',
			},
		});
		const frames = [];
		const ready = deferred();
		const gotData = deferred();
		const gotClosed = deferred();
		const disconnected = once(socket, 'close');
		socket.on('message', (frame) => {
			const event = JSON.parse(frame.toString());
			frames.push(event);
			if (event.type === 'ready') {
				ready.resolve();
			}
			if (event.type === 'data') {
				gotData.resolve(event);
			}
			if (event.type === 'closed') {
				gotClosed.resolve();
			}
		});
		await within(once(socket, 'open'), 'remote socket opened');
		await within(ready.promise, 'remote ready');
		const tail = Buffer.from('PTY last bytes: ✓', 'utf8');
		fixture.emitData(tail);
		fixture.emitEof();
		const data = await within(gotData.promise, 'PTY final data');
		assert.equal(Buffer.from(data.data, 'base64').toString(), tail.toString());
		// The final terminal state must wait until the receiver has actually
		// consumed its bytes, even after the underlying PTY has gone away.
		assert.equal(
			frames.some((event) => event.type === 'closed'),
			false,
		);
		socket.send(JSON.stringify({ type: 'consumed', bytes: tail.length }));
		await within(gotClosed.promise, 'PTY final event after ACK');
		const [code] = await within(disconnected, 'remote EOF handshake');
		assert.equal(code, 1000);
		assert.deepEqual(
			frames.map((event) => event.type),
			['ready', 'data', 'closed'],
		);
	} finally {
		socket?.terminate();
		await within(server.close(), 'remote listener close');
		await within(owner.close(), 'remote owner close');
	}
	assert.equal(closures, 1);
}

async function sharedCleanupFailure() {
	const release = deferred();
	let closeCount = 0;
	const fixture = remoteFixture(async () => {
		closeCount += 1;
		return release.promise;
	});
	const owner = new RemoteSessionOwner(access, fixture.remote);
	const session = await owner.open('good', { targetId: 7, columns: 80, rows: 25, timeoutMs: 1000 });
	const first = owner.release(session.id);
	const second = owner.release(session.id);
	assert.strictEqual(first, second, 'duplicate release must share completion and failure');
	const shutdown = owner.close();
	let settled = false;
	void shutdown
		.finally(() => {
			settled = true;
		})
		.catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false, 'shutdown must await previously started cleanup');
	const reason = new Error('fixture close failed');
	release.reject(reason);
	await assert.rejects(within(first, 'first release'), (error) => error === reason);
	await assert.rejects(within(second, 'repeat release'), (error) => error === reason);
	await assert.rejects(
		within(shutdown, 'shutdown failure'),
		(error) => error instanceof AggregateError && error.errors.includes(reason),
	);
	assert.equal(closeCount, 1);
	await assert.rejects(owner.release(session.id), (error) => error === reason);
}

await inboundQueueBudget();
console.log('WS bounded inbound queue PASS');
await gracefulSendOrder();
console.log('WS ordered graceful close PASS');
await terminalEofAndConsumerAck();
console.log('Remote PTY EOF/ACK over real WebSocket PASS');
await sharedCleanupFailure();
console.log('Remote concurrent release/shutdown error propagation PASS');
