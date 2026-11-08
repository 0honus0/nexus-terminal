import { randomUUID } from 'node:crypto';
import { expect, test, loginAsAdmin, HTTP_TEST_ORIGIN } from '../../../support/http/ssh-protocol-fixture.mjs';
import {
	readConnectionImportResponse,
	readConnectionList,
	readConnectionMutation,
	readCredentialView,
} from '../../../../packages/shared/src/targets/connections/http-codec.ts';
import { readConnectionTestResponse } from '../../../../packages/shared/src/targets/connections/test-codec.ts';
import { readProxyList } from '../../../../packages/shared/src/targets/proxies/http-codec.ts';
import { readTagList } from '../../../../packages/shared/src/targets/tags/http-codec.ts';
const headers = { Origin: HTTP_TEST_ORIGIN };
const root = '/api/v1/targets';

function connectionInput(ssh, name) {
	return {
		name,
		type: 'SSH',
		host: ssh.host,
		port: ssh.port,
		username: ssh.username,
		route: 'direct',
		proxyId: null,
		notes: null,
		tagIds: [],
		jumpIds: [],
	};
}

test('Shared JSON and multipart imports commit credentials, inline proxy and tags without legacy conversion', async ({
	request,
	ssh,
}) => {
	await loginAsAdmin(request);
	expect(
		(
			await request.post(root + '/host-keys/confirm', {
				data: { host: ssh.host, port: ssh.port, fingerprint: ssh.fingerprint },
			})
		).status(),
	).toBe(201);
	const suffix = randomUUID();
	const directName = 'E2E JSON Import ' + suffix;
	const proxyName = 'E2E Inline Proxy ' + suffix;
	const proxiedName = 'E2E Multipart Import ' + suffix;
	const tagName = 'E2E Import Tag ' + suffix;
	const direct = {
		connection: connectionInput(ssh, directName),
		credential: { kind: 'password', password: ssh.password },
		tagNames: [tagName],
	};
	const proxied = {
		connection: connectionInput(ssh, proxiedName),
		credential: { kind: 'password', password: ssh.password },
		tagNames: [tagName],
		inlineProxy: {
			name: proxyName,
			type: 'HTTP',
			host: ssh.host,
			port: ssh.controlPort,
			username: 'import-proxy-user',
			password: 'import-proxy-password',
		},
	};
	proxied.connection.route = 'proxy';
	try {
		const json = await request.post(root + '/connections/import', { headers, data: { items: [direct] } });
		expect(json.status()).toBe(200);
		const jsonResult = readConnectionImportResponse(await json.json());
		expect(jsonResult.items).toHaveLength(1);
		expect(jsonResult.items[0].status).toBe('ok');
		const multipart = await request.post(root + '/connections/import', {
			headers,
			multipart: {
				connectionsFile: {
					name: 'connections.json',
					mimeType: 'application/json',
					buffer: Buffer.from(
						JSON.stringify([
							proxied,
							{
								name: 'old encrypted record',
								auth_method: 'password',
								encrypted_password: 'old-ciphertext',
							},
						]),
					),
				},
			},
		});
		expect(multipart.status()).toBe(200);
		const results = readConnectionImportResponse(await multipart.json()).items;
		expect(results).toHaveLength(2);
		expect(results[0].status).toBe('ok');
		expect(results[1]).toEqual({ status: 'error', code: 'invalid_input' });
		const listed = await request.get(root + '/connections');
		expect(listed.ok()).toBe(true);
		const connections = readConnectionList(await listed.json()).filter(
			(item) => item.name === directName || item.name === proxiedName,
		);
		expect(connections).toHaveLength(2);
		const tagsResponse = await request.get(root + '/tags');
		expect(tagsResponse.ok()).toBe(true);
		const tag = readTagList(await tagsResponse.json()).find((item) => item.name === tagName);
		if (!tag) throw new Error('Imported tag missing');
		const proxiesResponse = await request.get(root + '/proxies');
		expect(proxiesResponse.ok()).toBe(true);
		const proxy = readProxyList(await proxiesResponse.json()).find((item) => item.name === proxyName);
		if (!proxy) throw new Error('Imported proxy missing');
		expect(proxy).toMatchObject({ username: 'import-proxy-user' });
		expect(JSON.stringify(proxy)).not.toContain('import-proxy-password');
		for (const connection of connections) {
			expect(connection.tagIds).toContain(tag.id);
			const credentialResponse = await request.get(root + '/connections/' + connection.id + '/credential');
			expect(credentialResponse.ok()).toBe(true);
			expect(readCredentialView(await credentialResponse.json()).credential).toEqual({ kind: 'password' });
			if (connection.name === proxiedName) {
				expect(connection).toMatchObject({ route: 'proxy', proxyId: proxy.id });
				// The control fixture is not a proxy server. Test the imported SSH credential directly.
				const directRoute = await request.put(root + '/connections/' + connection.id, {
					headers,
					data: { version: connection.version, changes: { route: 'direct', proxyId: null } },
				});
				expect(directRoute.ok()).toBe(true);
				expect(readConnectionMutation(await directRoute.json()).status).toBe('updated');
			}
			const tested = await request.post(root + '/connections/' + connection.id + '/test', { headers });
			expect(tested.ok()).toBe(true);
			expect(readConnectionTestResponse(await tested.json()).status).toBe('ok');
		}
	} finally {
		// Discover actual commits even if an import acknowledgement was lost; never repeat a write.
		const listed = await request.get(root + '/connections');
		expect(listed.ok()).toBe(true);
		const removals = await Promise.allSettled(
			readConnectionList(await listed.json())
				.filter((item) => item.name === directName || item.name === proxiedName)
				.map(async (item) => {
					expect((await request.delete(root + '/connections/' + item.id, { headers })).ok()).toBe(true);
				}),
		);
		const failures = removals.filter((result) => result.status === 'rejected').map((result) => result.reason);
		for (const [kind, decode, name] of [
			['proxies', readProxyList, proxyName],
			['tags', readTagList, tagName],
		]) {
			try {
				const response = await request.get(root + '/' + kind);
				expect(response.ok()).toBe(true);
				for (const item of decode(await response.json()).filter((item) => item.name === name)) {
					expect((await request.delete(root + '/' + kind + '/' + item.id, { headers })).ok()).toBe(true);
				}
			} catch (cause) {
				failures.push(cause);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Import cleanup failed');
	}
});
