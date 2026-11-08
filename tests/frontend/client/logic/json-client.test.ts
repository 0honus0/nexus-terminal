// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { requestJson } from '../../../../packages/frontend/src/client/http/json-client';
import { HttpRequestFailure } from '../../../../packages/frontend/src/client/http/request-failure';

const server = setupServer();
const input = {
	method: 'POST',
	url: '/api/test',
	body: { command: '保存' },
	maxRequestBytes: 1024,
	maxResponseBytes: 1024,
} satisfies Parameters<typeof requestJson>[0];

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('the real JSON client sends its original intent once and consumes the HTTP receipt', async () => {
	let writes = 0;
	server.use(
		http.post('http://localhost/api/test', async ({ request }) => {
			writes++;
			expect(await request.json()).toEqual(input.body);
			expect(request.headers.get('content-type')).toBe('application/json');
			return HttpResponse.json({ version: 2 }, { status: 201 });
		}),
	);
	await expect(requestJson(input)).resolves.toEqual({ status: 201, body: { version: 2 } });
	expect(writes).toBe(1);
});

test('a lost write receipt remains unknown and is never automatically replayed', async () => {
	let writes = 0;
	server.use(
		http.post('http://localhost/api/test', () => {
			writes++;
			return HttpResponse.error();
		}),
	);
	await expect(requestJson(input)).rejects.toMatchObject({ code: 'request_failed', outcome: 'unknown' });
	expect(writes).toBe(1);
});

test('cancellation before dispatch does not send a write', async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(requestJson({ ...input, signal: controller.signal })).rejects.toMatchObject({
		code: 'cancelled',
		outcome: 'not_dispatched',
	});
});

test.each([
	[
		'unexpected content type',
		() => new HttpResponse('<html>Gateway error</html>', { headers: { 'Content-Type': 'text/html' } }),
	],
	['malformed JSON', () => new HttpResponse('{', { headers: { 'Content-Type': 'application/json' } })],
	['oversize receipt', () => HttpResponse.json({ text: '界'.repeat(1024) })],
] as const)('%s cannot become a successful write acknowledgement', async (_name, respond) => {
	let writes = 0;
	server.use(
		http.post('http://localhost/api/test', () => {
			writes++;
			return respond();
		}),
	);
	await expect(requestJson(input)).rejects.toBeInstanceOf(HttpRequestFailure);
	expect(writes).toBe(1);
});
