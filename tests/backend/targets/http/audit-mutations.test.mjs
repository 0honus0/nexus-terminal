import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, test, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../support/http/protocol-fixture.mjs';
import { readProxyView, readProxyMutation } from '../../../../packages/shared/src/targets/proxies/http-codec.ts';
import { readSshKeyView, readSshKeyMutation } from '../../../../packages/shared/src/targets/ssh-keys/http-codec.ts';
import { readTargetError } from '../../../../packages/shared/src/targets/http.ts';
import { readAuditResponse } from '../../../../packages/shared/src/operations/http-codec.ts';
const headers = { Origin: HTTP_TEST_ORIGIN };
const targets = '/api/v1/targets';
const query = { sortBy: 'usageCount', limit: 50, offset: 0 };
test('proxy invalid credentials cannot partially rename metadata and secret values never enter the view', async ({
	request,
}) => {
	await loginAsAdmin(request);
	const name = 'E2E proxy invariant ' + randomUUID();
	const created = await request.post(targets + '/proxies', {
		headers,
		data: { name, type: 'SOCKS5', host: '127.0.0.1', port: 1080, username: 'e2e', password: 'e2e-proxy-secret' },
	});
	expect(created.status()).toBe(201);
	const proxy = readProxyView(await created.json());
	try {
		for (const changes of [
			{ name: name + ' rejected', password: '' },
			{ name: name + ' rejected', password: 123 },
			{ name: name + ' rejected', privateKey: 'unsupported' },
		]) {
			const rejected = await request.put(targets + '/proxies/' + proxy.id, {
				headers,
				data: { version: proxy.version, changes },
			});
			expect(rejected.status()).toBe(400);
			expect(readTargetError(await rejected.json()).code).toBe('invalid_input');
			const response = await request.get(targets + '/proxies/' + proxy.id);
			expect(response.ok()).toBe(true);
			expect(readProxyView(await response.json())).toEqual(proxy);
		}
		const renamed = await request.put(targets + '/proxies/' + proxy.id, {
			headers,
			data: { version: proxy.version, changes: { name: name + ' preserved' } },
		});
		expect(renamed.ok()).toBe(true);
		const mutation = readProxyMutation(await renamed.json());
		if (mutation.status !== 'updated') throw new Error('Proxy rename rejected');
		expect(mutation.value.version).toBe(proxy.version + 1);
		const cleared = await request.put(targets + '/proxies/' + proxy.id, {
			headers,
			data: { version: mutation.value.version, changes: { username: null, password: null } },
		});
		expect(cleared.ok()).toBe(true);
		expect(readProxyMutation(await cleared.json())).toMatchObject({ status: 'updated', value: { username: null } });
		expect(JSON.stringify(mutation)).not.toContain('e2e-proxy-secret');
	} finally {
		expect((await request.delete(targets + '/proxies/' + proxy.id, { headers })).ok()).toBe(true);
	}
});
test('SSH key mutations publish safe audit events without private key or passphrase content', async ({ request }) => {
	await loginAsAdmin(request);
	const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
		.privateKey.export({ type: 'pkcs1', format: 'pem' })
		.toString();
	const passphrase = 'e2e-secret-' + randomUUID();
	const path = targets + '/ssh-keys';
	const created = await request.post(path, {
		headers,
		data: { name: 'E2E audit ' + randomUUID(), privateKey, passphrase },
	});
	expect(created.status()).toBe(201);
	const key = readSshKeyView(await created.json());
	let deleted = false;
	try {
		const update = await request.put(path + '/' + key.id, {
			headers,
			data: { version: key.version, changes: { name: 'E2E audited rename', passphrase: null } },
		});
		expect(update.ok()).toBe(true);
		expect(readSshKeyMutation(await update.json()).status).toBe('updated');
		const removed = await request.delete(path + '/' + key.id, { headers });
		expect(removed.ok()).toBe(true);
		deleted = true;
		await expect
			.poll(async () => {
				const response = await request.get('/api/v1/settings/audit-logs?limit=100&offset=0');
				expect(response.ok()).toBe(true);
				const body = await response.json();
				const text = JSON.stringify(body);
				for (const secret of [passphrase, 'PRIVATE KEY', privateKey.split('\n')[1], 'updatedFields'])
					expect(text).not.toContain(secret);
				const logs = readAuditResponse(body).items;
				return ['SSH_KEY_CREATED', 'SSH_KEY_UPDATED', 'SSH_KEY_DELETED'].filter((event) =>
					logs.some(
						(log) =>
							log.event === event &&
							log.userId === 1 &&
							log.route === (event === 'SSH_KEY_CREATED' ? path : path + '/:id') &&
							(event === 'SSH_KEY_CREATED' || log.subjectId === String(key.id)),
					),
				).length;
			})
			.toBe(3);
	} finally {
		if (!deleted) expect((await request.delete(path + '/' + key.id, { headers })).ok()).toBe(true);
	}
});
