import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { OpenAiCompatibleAdapter } from '../../../../../packages/backend/dist/platform/ai/adapters/openai-compatible.js';
import { ModelNetworkFailure } from '../../../../../packages/backend/dist/platform/ai/model-port.js';

await test('Actual Provider refusals, uncertain responses and recovery use the SDK transport', async (t) => {
	let program;
	const calls = [];
	const server = createServer((request, response) => {
		request.resume();
		calls.push({ path: request.url, authorization: request.headers.authorization });
		program(response);
	});
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const adapter = new OpenAiCompatibleAdapter();
	const input = {
		baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
		credential: 'isolated-secret',
		modelId: 'fixture',
		protocol: 'chat-completions',
		maxOutputTokens: 256,
		usesReasoning: false,
		messages: [{ role: 'user', content: 'Reply.' }],
		tools: [],
	};

	const stream = async () => {
		const events = [];
		for await (const event of adapter.stream(input, new AbortController().signal)) {
			events.push(event);
		}
		return events;
	};

	function refuse(response, status) {
		response.writeHead(status, {
			'Content-Type': 'application/json',
			'Retry-After': '0.01',
			'x-should-retry': 'true',
		});
		response.end(JSON.stringify({ error: { message: 'Controlled provider refusal', code: 'controlled' } }));
	}

	for (const status of [400, 401, 403, 404, 405, 413, 415, 422, 429, 408, 409, 500, 502, 503, 504]) {
		await t.test('HTTP ' + status + ' preserves its certainty and allowed retry policy', async () => {
			const before = calls.length;
			program = (response) => refuse(response, status);
			await assert.rejects(stream, (error) => {
				assert.ok(error instanceof ModelNetworkFailure);
				assert.equal(error.kind, 'http');
				assert.equal(error.httpStatus, status);
				assert.equal(error.outcome, [408, 409, 500, 502, 503, 504].includes(status) ? 'unknown' : 'rejected');
				return true;
			});
			assert.equal(calls.length - before, status === 429 ? 3 : 1);
			assert.ok(
				calls
					.slice(before)
					.every(
						(call) =>
							call.path === '/v1/chat/completions' && call.authorization === 'Bearer isolated-secret',
					),
			);
		});
	}
	await t.test('socket loss is unknown and is not automatically replayed', async () => {
		const before = calls.length;
		program = (response) => response.destroy();
		await assert.rejects(stream, (error) => {
			assert.ok(error instanceof ModelNetworkFailure);
			assert.equal(error.outcome, 'unknown');
			return true;
		});
		assert.equal(calls.length - before, 1);
	});
	await t.test('one definite 429 can recover within the original request', async () => {
		const before = calls.length;
		program = (response) => {
			if (calls.length - before === 1) {
				return refuse(response, 429);
			}
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.end(
				'data: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: { content: 'recovered🙂' }, finish_reason: null }],
					}) +
					'\n\ndata: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
						usage: { prompt_tokens: 100, completion_tokens: 32 },
					}) +
					'\n\ndata: [DONE]\n\n',
			);
		};
		const events = await stream();
		assert.equal(calls.length - before, 2);
		assert.equal(
			events
				.filter((event) => event.type === 'text_delta')
				.map((event) => event.text)
				.join(''),
			'recovered🙂',
		);
		assert.deepEqual(
			events.find((event) => event.type === 'completed'),
			{ type: 'completed', finishReason: 'stop', reasoning: [] },
		);
	});
});
