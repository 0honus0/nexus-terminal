import { test, expect, loginAsAdmin } from '../../../../support/http/protocol-fixture.mjs';
import {
	readCommandList,
	readCommandMutation,
	readCommandDelete,
} from '../../../../../packages/shared/src/preferences/commands/http-codec.ts';
import { readAuditResponse } from '../../../../../packages/shared/src/operations/http-codec.ts';

const query = { sortBy: 'usageCount', offset: 0, limit: 50 };

test('quick command CRUD and audit logs remain functional', async ({ request }) => {
	await loginAsAdmin(request);
	const created = await request.post('/api/v1/quick-commands', {
		data: { name: 'E2E Quick Command', command: 'echo ${TARGET}', tagIds: [], variables: { TARGET: 'nexus-e2e' } },
	});
	expect(created.status()).toBe(201);
	let current = readCommandMutation(await created.json()).command;
	expect(current).toMatchObject({
		name: 'E2E Quick Command',
		command: 'echo ${TARGET}',
		variables: { TARGET: 'nexus-e2e' },
	});
	const update = await request.put('/api/v1/quick-commands/' + current.id, {
		data: {
			expectedVersion: current.version,
			name: 'E2E Quick Command Updated',
			command: 'printf "%s\\n" "${TARGET}"',
			tagIds: [],
			variables: { TARGET: 'updated' },
		},
	});
	expect(update.status()).toBe(200);
	current = readCommandMutation(await update.json()).command;
	const usage = await request.post('/api/v1/quick-commands/' + current.id + '/increment-usage', {
		data: { expectedVersion: current.version },
	});
	expect(usage.status()).toBe(200);
	current = readCommandMutation(await usage.json()).command;
	let list = await request.get('/api/v1/quick-commands?sortBy=usageCount&limit=50&offset=0');
	expect(list.status()).toBe(200);
	expect(readCommandList(await list.json(), query).entries.find((item) => item.id === current.id)).toMatchObject({
		name: 'E2E Quick Command Updated',
		usageCount: 1,
		variables: { TARGET: 'updated' },
	});
	const removed = await request.delete('/api/v1/quick-commands/' + current.id, {
		data: { expectedVersion: current.version },
	});
	expect(removed.status()).toBe(200);
	expect(readCommandDelete(await removed.json())).toEqual({ deleted: true });
	list = await request.get('/api/v1/quick-commands?sortBy=usageCount&limit=50&offset=0');
	expect(list.status()).toBe(200);
	expect(readCommandList(await list.json(), query).entries.some((item) => item.id === current.id)).toBe(false);
	const audit = await request.get('/api/v1/settings/audit-logs?event=LOGIN_SUCCESS&limit=100&offset=0');
	expect(audit.status()).toBe(200);
	const body = readAuditResponse(await audit.json());
	expect(body.items).toEqual(
		expect.arrayContaining([expect.objectContaining({ event: 'LOGIN_SUCCESS', userId: 1 })]),
	);
	expect(body.items.every((entry) => entry.event === 'LOGIN_SUCCESS')).toBe(true);
});
