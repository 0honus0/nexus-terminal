import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { NativeSafeHttpConnection } from '../../../packages/backend/dist/platform/network/adapters/native-safe-http-stream.js';
import { SafeHttpRequestRefusal } from '../../../packages/backend/dist/platform/network/safe-http-stream.js';
import { FetchFailure } from '../../../packages/backend/dist/platform/network/bounded-fetch.js';
import { until } from '../remote/openssh-fixture.mjs';

const requireBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const { Agent } = requireBackend('undici');
const request = { method: 'POST', headers: [], bodyUtf8: '{}' };

function contains(error, expected) {
	return (
		error === expected ||
		(error instanceof AggregateError && error.errors.some((value) => contains(value, expected))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, expected))
	);
}

async function endpoint(t, respond, maxResponseBytes = 12 * 1024 * 1024) {
	const sockets = new Set();
	const requests = [];
	const server = createServer((req, res) => {
		requests.push(req);
		req.resume();
		respond(req, res);
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
	const connection = new NativeSafeHttpConnection({
		url: 'http://' + authority + '/mcp',
		headers: [{ name: 'authorization', value: 'fixture-owner-secret' }],
		privateAuthorities: [authority],
		maxResponseBytes,
		signal: new AbortController().signal,
	});
	t.after(() => connection.close().catch(() => undefined));
	return { connection, sockets, requests };
}

await test('MCP managed HTTP lifecycle: invalid protocol headers refuse before any network dispatch', async (t) => {
	const f = await endpoint(t, (_req, res) => res.end());
	for (const name of ['authorization', 'cookie', 'proxy-authorization', 'host', 'x-forwarded-for']) {
		await assert.rejects(
			f.connection.request({ ...request, headers: [{ name, value: 'forged' }] }),
			SafeHttpRequestRefusal,
		);
	}
	assert.equal(f.requests.length, 0);
	await f.connection.close();
	assert.equal(f.sockets.size, 0);
});

await test('MCP managed HTTP lifecycle: actual response overflow retains its named failure and drains sockets', async (t) => {
	const f = await endpoint(t, (_req, res) => res.end(Buffer.alloc(13 * 1024 * 1024, 65)));
	const response = await f.connection.request(request);
	await assert.rejects(
		async () => {
			while (!(await response.read(65536)).eof) {
				/* Consume actual bounded chunks. */
			}
		},
		(error) => error instanceof FetchFailure && error.kind === 'limit_exceeded',
	);
	assert.equal(f.requests.length, 1);
	await f.connection.close();
	await until(
		() => f.sockets.size,
		(count) => count === 0,
		'Overflow response dispatcher drains',
	);
});

await test('MCP managed HTTP lifecycle: concurrent close cancels original pending requests and keeps late calls closed', async (t) => {
	const f = await endpoint(t, () => undefined);
	let settled = 0;
	const pending = Array.from({ length: 6 }, () =>
		f.connection
			.request(request)
			.then(
				(value) => ({ value }),
				(error) => ({ error }),
			)
			.finally(() => settled++),
	);
	await until(
		() => f.requests.length,
		(count) => count === 4,
		'Actual dispatcher has four active requests and two queued',
	);
	assert.equal(settled, 0);
	const closing = f.connection.close();
	assert.strictEqual(f.connection.close(), closing);
	const results = await Promise.all(pending);
	assert.ok(results.every((result) => result.error instanceof Error));
	await closing;
	await assert.rejects(f.connection.request(request), SafeHttpRequestRefusal);
	await until(
		() => f.sockets.size,
		(count) => count === 0,
		'Pending request sockets drain',
	);
});

await test('MCP managed HTTP lifecycle: completed responses release ownership while the fixed connection remains reusable', async (t) => {
	const f = await endpoint(t, (req, res) => {
		assert.equal(req.headers.authorization, 'fixture-owner-secret');
		res.setHeader('set-cookie', 'private=response-secret');
		res.end('complete payload');
	});
	for (let index = 0; index < 130; index++) {
		const response = await f.connection.request(request);
		const chunks = [];
		let value;
		do {
			value = await response.read(3);
			assert.ok(value.bytes.byteLength <= 3);
			chunks.push(value.bytes);
		} while (!value.eof);
		assert.equal(Buffer.concat(chunks).toString(), 'complete payload');
		assert.ok(response.headers.every((header) => header.name !== 'set-cookie'));
		const closing = response.close();
		assert.strictEqual(response.close(), closing);
		await closing;
		assert.equal(f.connection.responses.size, 0, 'The connection retains only live or failed response resources');
	}
	assert.equal(f.requests.length, 130, 'The former per-owner total count is not a protocol limit');
	await f.connection.close();
	await until(
		() => f.sockets.size,
		(count) => count === 0,
		'Reusable connection drains',
	);
});

for (const side of ['response', 'dispatcher', 'both']) {
	await test(
		'MCP managed HTTP lifecycle: independent ' + side + ' cleanup failures preserve every cause',
		async (t) => {
			const f = await endpoint(t, (_req, res) => res.end('payload'));
			const response = await f.connection.request(request);
			const responseError = new Error('Controlled response cleanup failure');
			const dispatcherError = new Error('Controlled dispatcher cleanup failure');
			const attempts = [];
			const closeResponse = response.close.bind(response);
			t.mock.method(response, 'close', async () => {
				attempts.push('response');
				await closeResponse();
				if (side !== 'dispatcher') throw responseError;
			});
			const destroy = Agent.prototype.destroy;
			t.mock.method(Agent.prototype, 'destroy', async function () {
				attempts.push('dispatcher');
				await new Promise((resolve, reject) =>
					destroy.call(this, undefined, (error) => (error ? reject(error) : resolve())),
				);
				if (side !== 'response') throw dispatcherError;
			});
			await assert.rejects(f.connection.close(), (error) => {
				assert.ok(error instanceof FetchFailure && error.kind === 'cleanup_failed');
				if (side !== 'response') assert.ok(contains(error, dispatcherError));
				if (side !== 'dispatcher') assert.ok(contains(error, responseError));
				return true;
			});
			assert.ok(attempts.includes('dispatcher'));
			assert.ok(attempts.includes('response'));
			await assert.rejects(f.connection.request(request), SafeHttpRequestRefusal);
			await until(
				() => f.sockets.size,
				(count) => count === 0,
				'Underlying sockets actually close despite confirmation errors',
			);
		},
	);
}
