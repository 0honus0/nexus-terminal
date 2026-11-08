import { randomUUID } from 'node:crypto';
import { expect, test, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../support/http/protocol-fixture.mjs';
import { readTagView, readTagConnectionsResponse } from '../../../../packages/shared/src/targets/tags/http-codec.ts';
import { readConnectionView } from '../../../../packages/shared/src/targets/connections/http-codec.ts';
import { readTargetError } from '../../../../packages/shared/src/targets/http.ts';
const headers = { Origin: HTTP_TEST_ORIGIN };
const targets = '/api/v1/targets';
const query = { sortBy: 'usageCount', limit: 50, offset: 0 };

async function createConnection(request, name) {
	const created = await request.post('/api/v1/targets/connections', {
		data: {
			name,
			type: 'SSH',
			host: '127.0.0.1',
			port: 22,
			username: 'fixture',
			route: 'direct',
			proxyId: null,
			notes: null,
			tagIds: [],
			jumpIds: [],
		},
	});
	expect(created.status()).toBe(201);
	const connection = readConnectionView(await created.json());
	const credential = await request.put('/api/v1/targets/connections/' + connection.id + '/credential', {
		data: { version: connection.version, credential: { kind: 'password', password: 'isolated-unused-credential' } },
	});
	expect(credential.status()).toBe(200);
	return connection.id;
}

test('connection tag replacement deduplicates and rejects invalid batches atomically', async ({ request }) => {
	await loginAsAdmin(request);
	const createdTag = await request.post(targets + '/tags', {
		headers,
		data: { name: 'E2E bounded tag ' + randomUUID() },
	});
	expect(createdTag.status()).toBe(201);
	const tag = readTagView(await createdTag.json());
	const id = await createConnection(request, 'E2E tag connection ' + randomUUID());

	const replace = (connectionIds) =>
		request.put(targets + '/tags/' + tag.id + '/connections', { headers, data: { connectionIds } });

	const readTags = async () => {
		const response = await request.get(targets + '/connections/' + id);
		expect(response.ok()).toBe(true);
		return readConnectionView(await response.json()).tagIds;
	};

	try {
		const assigned = await replace([id, id]);
		expect(assigned.ok()).toBe(true);
		readTagConnectionsResponse(await assigned.json());
		expect(await readTags()).toEqual([tag.id]);
		for (const ids of [[0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
			const response = await replace(ids);
			expect(response.status()).toBe(400);
			expect(readTargetError(await response.json()).code).toBe('invalid_input');
			expect(await readTags()).toEqual([tag.id]);
		}
		expect((await replace([id, Number.MAX_SAFE_INTEGER])).status()).toBe(404);
		expect(await readTags()).toEqual([tag.id]);
		expect(
			(
				await request.put(targets + '/tags/9007199254740991/connections', {
					headers,
					data: { connectionIds: [] },
				})
			).status(),
		).toBe(404);
		const repeated = await replace(Array(10001).fill(id));
		expect(repeated.status()).toBe(200);
		readTagConnectionsResponse(await repeated.json());
		expect(await readTags()).toEqual([tag.id]);
		const cleared = await replace([]);
		expect(cleared.ok()).toBe(true);
		readTagConnectionsResponse(await cleared.json());
		expect(await readTags()).toEqual([]);
	} finally {
		const results = await Promise.allSettled([
			request.delete(targets + '/connections/' + id, { headers }),
			request.delete(targets + '/tags/' + tag.id, { headers }),
		]);
		for (const result of results) {
			if (result.status === 'rejected') throw result.reason;
			expect(result.value.ok()).toBe(true);
		}
	}
});
