// @vitest-environment jsdom
import { beforeAll, afterAll, afterEach, test, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { connectionsApi } from '../../../../packages/frontend/src/features/connections/api/connections-api.ts';
import { connectionTestApi } from '../../../../packages/frontend/src/features/connections/api/connection-test-api.ts';
import { TargetRequestFailure } from '../../../../packages/frontend/src/client/targets/target-types.ts';
import { ConnectionTestFailure } from '../../../../packages/frontend/src/features/connections/model/connection-errors.ts';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const item = {
	id: 1,
	version: 1,
	createdAt: 10,
	updatedAt: 10,
	lastConnectedAt: null,
	name: 'connection',
	type: 'SSH',
	host: 'localhost',
	port: 22,
	username: 'user',
	route: 'direct',
	proxyId: null,
	notes: null,
	tagIds: [],
	jumpIds: [],
};

const collection = (items) =>
	server.use(http.get('http://localhost/api/v1/targets/connections', () => HttpResponse.json(items)));

test('the current safe connection collection decodes before testing invalid mutations', async () => {
	collection([item]);
	expect(await connectionsApi.list()).toEqual([item]);
});

test.each([
	['duplicate identity', [item, item]],
	['private credential', [{ ...item, password: 'must not leak' }]],
	['reversed timestamps', [{ ...item, updatedAt: item.createdAt - 1 }]],
])('connection collection rejects %s', async (_name, values) => {
	collection(values);
	const failure = await connectionsApi.list().catch((cause) => cause);
	expect(failure).toBeInstanceOf(TargetRequestFailure);
	expect(failure).toMatchObject({ code: 'protocol_failure', outcome: 'unknown' });
});

test('a credential response must belong to the requested connection', async () => {
	server.use(
		http.get('http://localhost/api/v1/targets/connections/1/credential', () =>
			HttpResponse.json({
				connectionId: 1001,
				version: 1,
				credential: { kind: 'none' },
			}),
		),
	);
	const failure = await connectionsApi.credential(item.id).catch((cause) => cause);
	expect(failure).toBeInstanceOf(TargetRequestFailure);
	expect(failure.code).toBe('protocol_failure');
});

test('SSH test rejects an error whose HTTP status disagrees with its safe failure code', async () => {
	server.use(
		http.post('http://localhost/api/v1/targets/connections/1/test', () =>
			HttpResponse.json(
				{
					code: 'host_key_untrusted',
					hostKey: {
						host: '127.0.0.1',
						port: 22,
						fingerprint: 'SHA256:' + 'A'.repeat(43),
						expectedFingerprint: null,
					},
				},
				{ status: 500 },
			),
		),
	);
	const failure = await connectionTestApi.saved(item.id).catch((cause) => cause);
	expect(failure).toBeInstanceOf(ConnectionTestFailure);
	expect(failure.code).toBe('protocol_failure');
});
