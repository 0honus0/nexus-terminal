import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { readMultipart } from '../../../packages/backend/dist/platform/http/http-body.js';

const requireBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const fastify = requireBackend('fastify');
const multipart = requireBackend('@fastify/multipart');

function payload(parts) {
	const chunks = [];
	for (const part of parts) {
		chunks.push(
			Buffer.from(
				'--test-boundary\r\nContent-Disposition: form-data; name="' +
					part.name +
					'"' +
					(part.filename === undefined ? '' : '; filename="' + part.filename + '"') +
					'\r\nContent-Type: ' +
					(part.contentType ?? 'application/octet-stream') +
					'\r\n\r\n',
			),
		);
		chunks.push(Buffer.from(part.bytes));
		chunks.push(Buffer.from('\r\n'));
	}
	chunks.push(Buffer.from('--test-boundary--\r\n'));
	return Buffer.concat(chunks);
}

async function withServer(limits, work, options = {}) {
	const app = fastify();
	await app.register(multipart, { attachFieldsToBody: false });
	let received;
	let failure;
	const observedChunks = [];
	let completed;
	const finished = new Promise((resolve) => {
		completed = resolve;
	});
	app.post('/upload', { bodyLimit: options.bodyLimit ?? 1024 * 1024 }, async (request, reply) => {
		const parts = request.parts.bind(request);
		request.parts = async function* (partOptions) {
			for await (const part of parts(partOptions)) {
				if (part.type === 'file') {
					part.file.on('data', (chunk) => {
						observedChunks.push(chunk);
						options.onChunk?.();
					});
				}
				yield part;
			}
		};
		try {
			received = await readMultipart(request, reply, limits, options.signal ?? new AbortController().signal);
			return { count: received.length };
		} catch (error) {
			failure = error;
			return reply.code(error.status ?? 500).send({ code: error.code });
		} finally {
			completed();
		}
	});
	try {
		await work(
			app,
			() => received,
			observedChunks,
			finished,
			() => failure,
		);
	} finally {
		for (const part of received ?? []) part.bytes.fill(0);
		await app.close();
	}
}

const limits = { maxParts: 2, maxFileBytes: 8, maxFieldBytes: 4 };
const headers = { 'content-type': 'multipart/form-data; boundary=test-boundary' };

test('multipart preserves exact file and field bytes, including malformed UTF-8 and JSON content type', async () => {
	await withServer(limits, async (app, received) => {
		const response = await app.inject({
			method: 'POST',
			url: '/upload',
			headers,
			payload: payload([
				{ name: 'file', filename: 'one.bin', bytes: [0, 255, 13, 10] },
				{ name: 'password', contentType: 'application/json', bytes: [255, 32, 0] },
			]),
		});
		assert.equal(response.statusCode, 200);
		assert.deepEqual(response.json(), { count: 2 });
		assert.equal(received()[0].filename, 'one.bin');
		assert.equal(received()[1].filename, null);
		assert.deepEqual([...received()[0].bytes], [0, 255, 13, 10]);
		assert.deepEqual([...received()[1].bytes], [255, 32, 0]);
	});
});

test('multipart accepts exact file and field limits', async () => {
	await withServer(limits, async (app) => {
		const response = await app.inject({
			method: 'POST',
			url: '/upload',
			headers,
			payload: payload([
				{ name: 'file', filename: 'one.bin', bytes: Buffer.alloc(8, 65) },
				{ name: 'password', bytes: Buffer.alloc(4, 66) },
			]),
		});
		assert.equal(response.statusCode, 200);
	});
});

for (const [name, parts, status] of [
	['file overflow', [{ name: 'file', filename: 'one.bin', bytes: Buffer.alloc(9) }], 413],
	['field overflow', [{ name: 'password', bytes: Buffer.alloc(5) }], 413],
	['part count overflow', Array.from({ length: 3 }, () => ({ name: 'field', bytes: [65] })), 400],
]) {
	test('multipart rejects ' + name, async () => {
		await withServer(limits, async (app, received, observedChunks) => {
			const response = await app.inject({ method: 'POST', url: '/upload', headers, payload: payload(parts) });
			assert.equal(response.statusCode, status);
			assert.equal(received(), undefined);
			assert.ok(
				observedChunks.every((chunk) => chunk.every((value) => value === 0)),
				'failed ingress clears consumed secret chunks',
			);
		});
	});
}

test('invalid metadata drains remaining bounded parts and clears their secrets', async () => {
	await withServer(limits, async (app, received, observedChunks) => {
		const response = await app.inject({
			method: 'POST',
			url: '/upload',
			headers,
			payload: payload([
				{ name: 'x'.repeat(129), filename: 'one.bin', bytes: [65] },
				{ name: 'password', bytes: [66, 67] },
			]),
		});
		assert.equal(response.statusCode, 400);
		assert.equal(received(), undefined);
		assert.ok(observedChunks.length >= 2);
		assert.ok(observedChunks.every((chunk) => chunk.every((value) => value === 0)));
	});
});

test('multipart rejects an incomplete closing boundary', async () => {
	await withServer(limits, async (app) => {
		const body = payload([{ name: 'file', filename: 'one.bin', bytes: [65] }]);
		const response = await app.inject({ method: 'POST', url: '/upload', headers, payload: body.subarray(0, -24) });
		assert.equal(response.statusCode, 400);
	});
});

test('multipart streams a body above 64 KiB without a second payload pipe', async () => {
	await withServer({ maxParts: 1, maxFileBytes: 128 * 1024, maxFieldBytes: 4 }, async (app, received) => {
		const response = await app.inject({
			method: 'POST',
			url: '/upload',
			headers,
			payload: payload([{ name: 'file', filename: 'large.bin', bytes: Buffer.alloc(96 * 1024, 65) }]),
		});
		assert.equal(response.statusCode, 200);
		assert.equal(received()[0].bytes.length, 96 * 1024);
	});
});

test('multipart checks the complete encoded Content-Length, including envelope bytes', async () => {
	await withServer(
		limits,
		async (app) => {
			const response = await app.inject({
				method: 'POST',
				url: '/upload',
				headers,
				payload: payload([{ name: 'file', filename: 'one.bin', bytes: [65] }]),
			});
			assert.equal(response.statusCode, 413);
			assert.equal(response.json().code, 'body_too_large');
		},
		{ bodyLimit: 64 },
	);
});

async function sendChunked(app, body, onWritten) {
	await app.listen({ host: '127.0.0.1', port: 0 });
	const address = app.server.address();
	return new Promise((resolve) => {
		const request = httpRequest(
			{
				host: '127.0.0.1',
				port: address.port,
				path: '/upload',
				method: 'POST',
				headers: { ...headers, 'transfer-encoding': 'chunked' },
			},
			(response) => {
				response.resume();
				response.on('end', () => resolve({ status: response.statusCode }));
			},
		);
		request.on('error', (error) => resolve({ code: error.code }));
		request.setTimeout(5000, () =>
			request.destroy(Object.assign(new Error('Upload did not settle'), { code: 'TEST_TIMEOUT' })),
		);
		request.write(body);
		if (onWritten) onWritten(request);
		else request.end();
	});
}

test('chunked multipart total overflow closes the transport and settles the reader', async () => {
	await withServer(
		{ maxParts: 1, maxFileBytes: 128 * 1024, maxFieldBytes: 4 },
		async (app, received, chunks, finished, failure) => {
			const result = await sendChunked(
				app,
				payload([{ name: 'file', filename: 'large.bin', bytes: Buffer.alloc(96 * 1024, 65) }]),
			);
			await finished;
			assert.equal(result.code, 'ECONNRESET');
			assert.equal(failure().status, 413);
			assert.equal(failure().code, 'body_too_large');
			assert.equal(received(), undefined);
			assert.ok(chunks.every((chunk) => chunk.every((value) => value === 0)));
		},
		{ bodyLimit: 64 * 1024 },
	);
});

test('cancelling partial chunked multipart settles the reader and clears partial secrets', async () => {
	const controller = new AbortController();
	await withServer(
		{ maxParts: 1, maxFileBytes: 128 * 1024, maxFieldBytes: 4 },
		async (app, received, chunks, finished) => {
			const body = payload([{ name: 'file', filename: 'partial.bin', bytes: Buffer.alloc(32 * 1024, 65) }]);
			const response = sendChunked(app, body.subarray(0, -24), () => undefined);
			assert.equal((await response).code, 'ECONNRESET');
			await finished;
			assert.equal(received(), undefined);
			assert.ok(chunks.every((chunk) => chunk.every((value) => value === 0)));
		},
		{
			signal: controller.signal,

			onChunk: () => setImmediate(() => controller.abort()),
		},
	);
});

test('rejecting an oversized part stops an unfinished chunked upload', async () => {
	await withServer(
		{ maxParts: 1, maxFileBytes: 8, maxFieldBytes: 4 },
		async (app, received, chunks, finished, failure) => {
			const body = payload([{ name: 'file', filename: 'partial.bin', bytes: Buffer.alloc(32 * 1024, 65) }]);
			const response = sendChunked(app, body.subarray(0, -24), () => undefined);
			assert.equal((await response).status, 413);
			await finished;
			assert.equal(failure().status, 413);
			assert.equal(failure().code, 'body_too_large');
			assert.equal(received(), undefined);
			assert.ok(chunks.every((chunk) => chunk.every((value) => value === 0)));
		},
	);
});
