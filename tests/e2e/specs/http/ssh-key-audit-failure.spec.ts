import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';
import {
	readSshKeyView,
	readSshKeyList,
	readSshKeyMutation,
} from '../../../../packages/shared/src/targets/ssh-keys/http-codec';
import { readAuditResponse } from '../../../../packages/shared/src/operations/http-codec';
import { readTargetError } from '../../../../packages/shared/src/targets/http';

const headers = { Origin: E2E_URLS.frontendOrigin };
const root = '/api/v1/targets/ssh-keys';

test('rejected SSH key edits preserve state and do not publish successful mutation audit records', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const name = `E2E rejected key ${randomUUID()}`;
	const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
		.privateKey.export({ type: 'pkcs1', format: 'pem' })
		.toString();
	const created = await request.post(root, { headers, data: { name, privateKey } });
	expect(created.status()).toBe(201);
	const key = readSshKeyView(await created.json());

	const readAudit = async () => {
		const response = await request.get('/api/v1/settings/audit-logs?limit=100&offset=0');
		expect(response.ok()).toBe(true);
		const text = await response.text();
		expect(text).not.toContain(privateKey.split('\n')[1]);
		expect(text).not.toContain('updatedFields');
		return readAuditResponse(JSON.parse(text)).items;
	};

	try {
		const rejected = await request.put(root + '/' + key.id, {
			headers,
			data: { version: key.version, changes: { name: name + ' changed', privateKey: '' } },
		});
		expect(rejected.status()).toBe(400);
		expect(readTargetError(await rejected.json())).toEqual({ code: 'invalid_input' });
		const listed = await request.get(root);
		expect(listed.ok()).toBe(true);
		expect(readSshKeyList(await listed.json()).find((item) => item.id === key.id)).toEqual(key);
		await expect
			.poll(
				async () =>
					(await readAudit()).filter(
						(log) =>
							log.event === 'HTTP_MUTATION_FAILED' &&
							log.subjectId === String(key.id) &&
							log.route === root + '/:id',
					).length,
			)
			.toBe(1);
		const logs = await readAudit();
		expect(logs.filter((log) => log.event === 'SSH_KEY_CREATED' && log.route === root)).toHaveLength(1);
		expect(logs.filter((log) => log.event === 'SSH_KEY_UPDATED' && log.subjectId === String(key.id))).toHaveLength(
			0,
		);
		const renamed = await request.put(root + '/' + key.id, {
			headers,
			data: { version: key.version, changes: { name: name + ' recovered' } },
		});
		expect(renamed.ok()).toBe(true);
		expect(readSshKeyMutation(await renamed.json())).toMatchObject({
			status: 'updated',
			value: { id: key.id, name: name + ' recovered', version: key.version + 1 },
		});
		await expect
			.poll(
				async () =>
					(await readAudit()).filter(
						(log) => log.event === 'SSH_KEY_UPDATED' && log.subjectId === String(key.id),
					).length,
			)
			.toBe(1);
	} finally {
		expect((await request.delete(root + '/' + key.id, { headers })).ok()).toBe(true);
	}
});
