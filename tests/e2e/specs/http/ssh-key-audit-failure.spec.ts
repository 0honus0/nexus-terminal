import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

test('rejected SSH key edits preserve state and do not publish successful mutation audit records', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const name = `E2E rejected key ${randomUUID()}`;
	const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
		.privateKey.export({ type: 'pkcs1', format: 'pem' })
		.toString();
	const created = await request.post('/api/v1/ssh-keys', { data: { name, privateKey } });
	expect(created.status()).toBe(201);
	const key = (await created.json()).key;
	try {
		const rejected = await request.put(`/api/v1/ssh-keys/${key.id}`, {
			data: { name: `${name} changed`, privateKey: '' },
		});
		expect(rejected.status(), await rejected.text()).toBe(400);
		const listed = await request.get('/api/v1/ssh-keys');
		expect(listed.ok()).toBeTruthy();
		expect((await listed.json()).find((item: { id: number }) => item.id === key.id)).toEqual(key);
		const audited = await request.get('/api/v1/audit-logs?limit=100&offset=0');
		expect(audited.ok()).toBeTruthy();
		const text = await audited.text();
		expect(text).not.toContain(privateKey.split('\n')[1]);
		const logs = JSON.parse(text).logs as Array<{ actionType: string; details: { keyId?: number } }>;
		expect(logs.filter((log) => log.actionType === 'SSH_KEY_CREATED' && log.details.keyId === key.id)).toHaveLength(
			1,
		);
		expect(logs.filter((log) => log.actionType === 'SSH_KEY_UPDATED' && log.details.keyId === key.id)).toHaveLength(
			0,
		);
		const renamed = await request.put(`/api/v1/ssh-keys/${key.id}`, { data: { name: `${name} recovered` } });
		expect(renamed.ok(), await renamed.text()).toBeTruthy();
		await expect(renamed.json()).resolves.toMatchObject({ key: { id: key.id, name: `${name} recovered` } });
		const recoveredAudit = await request.get('/api/v1/audit-logs?limit=100&offset=0');
		expect(recoveredAudit.ok()).toBeTruthy();
		const recoveredText = await recoveredAudit.text();
		expect(recoveredText).not.toContain(privateKey.split('\n')[1]);
		const updates = (
			JSON.parse(recoveredText).logs as Array<{
				actionType: string;
				details: { keyId?: number; updatedFields?: string[] };
			}>
		).filter((log) => log.actionType === 'SSH_KEY_UPDATED' && log.details.keyId === key.id);
		expect(updates).toHaveLength(1);
		expect(updates[0].details.updatedFields).toEqual(['name']);
	} finally {
		expect((await request.delete(`/api/v1/ssh-keys/${key.id}`)).ok()).toBeTruthy();
	}
});
