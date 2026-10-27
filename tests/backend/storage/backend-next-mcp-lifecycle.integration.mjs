import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from '../../../packages/backend/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import { NativeMcpClient } from '../../../packages/backend/dist/platform/mcp/adapters/native-mcp-client.js';
import { McpFetch } from '../../../packages/backend/dist/platform/mcp/adapters/mcp-fetch.js';
import { McpFailure } from '../../../packages/backend/dist/platform/mcp/mcp-client.js';
import { until } from '../remote/openssh-fixture.mjs';

function contains(error, expected) {
	return (
		error === expected ||
		(error instanceof AggregateError && error.errors.some((value) => contains(value, expected))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, expected))
	);
}

async function endpoint(t, respond) {
	const sockets = new Set();
	const requests = [];
	const server = createServer((request, response) => {
		requests.push(request.method);
		request.resume();
		respond(request, response);
	});
	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	const authority = '127.0.0.1:' + server.address().port;
	return {
		sockets,
		requests,
		options: {
			key: 'controlled-mcp',
			generation: 1,
			url: 'http://' + authority + '/mcp',
			credential: null,
			privateAuthorities: [authority],
			protocolVersion: '2026-07-28',
			client: { name: 'B10 lifecycle', version: '1' },
		},
	};
}

await test('MCP real SDK construction, cancellation and independent cleanup failures', async (t) => {
	await t.test('MCP fetch preserves its named request rejection and dispatches no invalid body', async (t) => {
		const external = await endpoint(t, (_request, response) => response.end());
		const fetcher = new McpFetch(
			new URL(external.options.url).origin,
			external.options.privateAuthorities,
			new AbortController().signal,
		);
		t.after(() => fetcher.close());
		await assert.rejects(
			fetcher.fetch(external.options.url, { method: 'POST', body: new Uint8Array([1]) }),
			(error) => error instanceof McpFailure && error.kind === 'invalid_response',
		);
		assert.deepEqual(external.requests, [], 'body validation precedes actual network dispatch');
		await fetcher.close();
		assert.equal(external.sockets.size, 0);
	});

	await t.test(
		'MCP actual response overflow retains its named stream failure and closes its real dispatcher',
		async (t) => {
			const external = await endpoint(t, (_request, response) =>
				response.end(Buffer.alloc(13 * 1024 * 1024, 65)),
			);
			const fetcher = new McpFetch(
				new URL(external.options.url).origin,
				external.options.privateAuthorities,
				new AbortController().signal,
			);
			t.after(() => fetcher.close());
			const response = await fetcher.fetch(external.options.url);
			await assert.rejects(
				response.arrayBuffer(),
				(error) => error instanceof McpFailure && error.kind === 'limit_exceeded',
			);
			assert.equal(external.requests.length, 1);
			await fetcher.close();
			await until(
				() => external.sockets.size,
				(count) => count === 0,
				'Actual overflow response dispatcher drained',
			);
		},
	);

	await t.test('global close interrupts an actual pending handshake and drains its HTTP dispatcher', async (t) => {
		const external = await endpoint(t, () => undefined);
		const client = new NativeMcpClient();
		const opening = client.discover(external.options, new AbortController().signal);
		const observed = opening.then(
			(value) => ({ value }),
			(error) => ({ error }),
		);
		await until(
			() => external.requests.length,
			(count) => count > 0,
			'Actual MCP handshake request',
		);
		const closing = client.closeAll();
		assert.strictEqual(client.closeAll(), closing);
		const result = await observed;
		assert.ok(result.error instanceof McpFailure);
		assert.equal(result.error.kind, 'unavailable');
		await closing;
		await until(
			() => external.sockets.size,
			(count) => count === 0,
			'MCP HTTP pool drained',
		);
		await assert.rejects(
			client.discover(external.options, new AbortController().signal),
			(error) => error instanceof McpFailure && error.kind === 'unavailable',
		);
	});

	await t.test('128 pending real handshakes share the owner budget and last-slot admission is atomic', async (t) => {
		const external = await endpoint(t, () => undefined);
		const client = new NativeMcpClient();
		t.after(() => client.closeAll());
		let settled = 0;

		const observe = (key) => {
			const request = client.discover({ ...external.options, key }, new AbortController().signal).then(
				(value) => ({ value }),
				(error) => ({ error }),
			);
			return request.then((result) => {
				settled += 1;
				return result;
			});
		};

		const pending = Array.from({ length: 127 }, (_, index) => observe('pending-' + index));
		await until(
			() => external.requests.length,
			(count) => count === 127,
			'127 actual MCP handshake requests',
		);
		const last = observe('last');
		const refused = await observe('overflow');
		assert.ok(refused.error instanceof McpFailure);
		assert.equal(refused.error.kind, 'limit_exceeded');
		const shared = observe('pending-0');
		await until(
			() => external.requests.length,
			(count) => count === 128,
			'Exactly one final slot is dispatched',
		);
		assert.equal(settled, 1, 'only the refused overflow has settled; all admitted handshakes remain pending');
		const closing = client.closeAll();
		const results = await Promise.all([...pending, last, shared]);
		for (const result of results) {
			assert.ok(result.error instanceof McpFailure);
			assert.equal(result.error.kind, 'unavailable');
		}
		await closing;
		await until(
			() => external.sockets.size,
			(count) => count === 0,
			'All 128 pending MCP pools are drained',
		);
	});

	for (const failureSide of ['sdk', 'dispatcher', 'both']) {
		await t.test(
			failureSide + ' cleanup failure preserves connect rejection and every cleanup cause',
			async (t) => {
				const external = await endpoint(t, (_request, response) => {
					response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"malformed":true}');
				});
				const sdkError = new Error('controlled synchronous SDK close failure');
				const dispatcherError = new Error('controlled dispatcher close confirmation failure');
				const closed = [];
				const clients = new Set();
				const originalSdkClose = Client.prototype.close;
				const originalFetchClose = McpFetch.prototype.close;
				t.mock.method(Client.prototype, 'close', function () {
					closed.push('sdk');
					clients.add(this);
					if (failureSide !== 'dispatcher') {
						throw sdkError;
					}
					return originalSdkClose.call(this);
				});
				t.mock.method(McpFetch.prototype, 'close', async function () {
					closed.push('dispatcher');
					await originalFetchClose.call(this);
					if (failureSide !== 'sdk') {
						throw dispatcherError;
					}
				});
				t.after(async () => {
					for (const client of clients) {
						await originalSdkClose.call(client);
					}
				});
				const client = new NativeMcpClient();
				const result = await client.discover(external.options, new AbortController().signal).then(
					(value) => ({ value }),
					(error) => ({ error }),
				);
				const failure = result.error;
				assert.ok(failure instanceof McpFailure);
				assert.equal(failure.kind, 'cleanup_failed');
				assert.ok(external.requests.length > 0);
				assert.deepEqual(closed.slice(-2), ['sdk', 'dispatcher']);
				assert.ok(failure.cause instanceof AggregateError);
				assert.ok(failure.cause.errors.length >= 2, 'the original negotiation failure is retained');
				if (failureSide !== 'dispatcher') {
					assert.ok(contains(failure, sdkError));
				}
				if (failureSide !== 'sdk') {
					assert.ok(contains(failure, dispatcherError));
				}
				const count = external.requests.length;
				await assert.rejects(
					client.discover(external.options, new AbortController().signal),
					(error) => error === failure,
				);
				assert.equal(external.requests.length, count, 'failed generation cannot be silently reconstructed');
				await assert.rejects(
					client.closeAll(),
					(error) =>
						error instanceof McpFailure && error.kind === 'cleanup_failed' && contains(error, failure),
				);
				await until(
					() => external.sockets.size,
					(count) => count === 0,
					'Underlying MCP transport actually closed',
				);
			},
		);
	}
});
