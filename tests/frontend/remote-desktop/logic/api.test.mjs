// @vitest-environment jsdom
import { test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { remoteDesktopApi } from '../../../../packages/frontend/src/features/remote-desktop/api/remote-desktop-api.ts';

const server = setupServer();
const wire = {
	ticket: 'A'.repeat(43),
	protocol: 'VNC',
	host: '127.0.0.1',
	port: 5900,
	username: '',
	password: 'private-password',
};

const create = () =>
	remoteDesktopApi.create(1, 'VNC', { width: 800, height: 600, dpi: 96 }, new AbortController().signal);

const endpoint = 'http://localhost/api/v1/connections/1/vnc-session';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('desktop ticket response carries no attempted connection time', async () => {
	server.use(http.post(endpoint, () => HttpResponse.json(wire)));
	expect((await create()).ticket).toBe(wire.ticket);
});

test.each([
	[
		'status and error must agree',
		() => HttpResponse.json({ code: 'forbidden' }, { status: 503 }),
		{ code: 'protocol_failure', outcome: 'unknown' },
	],
	[
		'server unknown preserved',
		() => HttpResponse.json({ code: 'operation_unknown' }, { status: 503 }),
		{ code: 'operation_unknown', outcome: 'unknown' },
	],
	[
		'complete response budget enforced',
		() => new HttpResponse('x'.repeat(65537), { headers: { 'content-type': 'application/json' } }),
		{ code: 'protocol_failure' },
	],
	[
		'response stream failure retains unknown',
		() =>
			new HttpResponse(
				new ReadableStream({
					start(stream) {
						stream.error(new Error('private upstream'));
					},
				}),
				{ headers: { 'content-type': 'application/json' } },
			),
		{ outcome: 'unknown' },
	],
])('%s', async (_name, response, failure) => {
	const dispatch = vi.fn(response);
	server.use(http.post(endpoint, dispatch));
	await expect(create()).rejects.toMatchObject(failure);
	expect(dispatch).toHaveBeenCalledTimes(1);
});
