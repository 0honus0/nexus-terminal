import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';
import { E2E_URLS } from '../../support/test-env';
import {
	readCommandList,
	readCommandMutation,
	readCommandDelete,
} from '../../../../packages/shared/src/preferences/commands/http-codec';
import { readAuditResponse } from '../../../../packages/shared/src/operations/http-codec';

const headers = { Origin: E2E_URLS.frontendOrigin };
const query = { sortBy: 'usageCount', offset: 0, limit: 50 } as const;

test('quick command CRUD and audit logs remain functional', async ({ request }) => {
	await loginAsInitialAdmin(request);
	let current = await step('create a quick command with variables', async () => {
		const response = await request.post('/api/v1/quick-commands', {
			headers,
			data: {
				name: 'E2E Quick Command',
				command: 'echo ${TARGET}',
				tagIds: [],
				variables: { TARGET: 'nexus-e2e' },
			},
		});
		expect(response.status()).toBe(201);
		const command = readCommandMutation(await response.json()).command;
		expect(command).toMatchObject({
			name: 'E2E Quick Command',
			command: 'echo ${TARGET}',
			variables: { TARGET: 'nexus-e2e' },
		});
		return command;
	});
	await step('update and increment quick command usage', async () => {
		const update = await request.put(`/api/v1/quick-commands/${current.id}`, {
			headers,
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
		const usage = await request.post(`/api/v1/quick-commands/${current.id}/increment-usage`, {
			headers,
			data: { expectedVersion: current.version },
		});
		expect(usage.status()).toBe(200);
		current = readCommandMutation(await usage.json()).command;
		const list = await request.get('/api/v1/quick-commands?sortBy=usageCount&limit=50&offset=0');
		expect(list.status()).toBe(200);
		expect(readCommandList(await list.json(), query).entries.find((item) => item.id === current.id)).toMatchObject({
			name: 'E2E Quick Command Updated',
			usageCount: 1,
			variables: { TARGET: 'updated' },
		});
	});
	await step('delete the quick command', async () => {
		const response = await request.delete(`/api/v1/quick-commands/${current.id}`, {
			headers,
			data: { expectedVersion: current.version },
		});
		expect(response.status()).toBe(200);
		expect(readCommandDelete(await response.json())).toEqual({ deleted: true });
		const list = await request.get('/api/v1/quick-commands?sortBy=usageCount&limit=50&offset=0');
		expect(list.status()).toBe(200);
		expect(readCommandList(await list.json(), query).entries.some((item) => item.id === current.id)).toBe(false);
	});
	await step('audit log records security and connection activity without private details', async () => {
		const response = await request.get('/api/v1/settings/audit-logs?event=LOGIN_SUCCESS&limit=100&offset=0');
		expect(response.status()).toBe(200);
		const body = readAuditResponse(await response.json());
		expect(body.items).toEqual(
			expect.arrayContaining([expect.objectContaining({ event: 'LOGIN_SUCCESS', userId: 1 })]),
		);
		expect(body.items.every((entry) => entry.event === 'LOGIN_SUCCESS')).toBe(true);
	});
});
