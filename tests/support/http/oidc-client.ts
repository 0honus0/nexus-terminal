import assert from 'node:assert/strict';
import type { APIRequestContext } from '@playwright/test';
import type { openOidcProvider } from '../protocols/oidc-provider';
import { readOidcSettingsResponse, readOidcStartResponse } from '../../../packages/shared/src/access/oidc/http-codec';

/** HTTP preparation shared by protocol tests and actual browser journeys. */
export function createOidcClient(
	request: APIRequestContext,
	account: { username: string; password: string },
	origin: string,
) {
	const headers = { Origin: origin };

	async function configure(
		issuer: string,
		authentication: 'client_secret_basic' | 'client_secret_post' | 'none' = 'client_secret_basic',
	) {
		const login = await request.post('/api/v1/auth/login', {
			headers,
			data: { username: account.username, password: account.password, rememberMe: false },
		});
		assert.equal(login.status(), 200, await login.text());
		const c = readOidcSettingsResponse(await (await request.get('/api/v1/auth/oidc/settings')).json());
		const response = await request.put('/api/v1/auth/oidc/settings', {
			headers,
			data: {
				revision: c.revision,
				enabled: true,
				label: 'Pocket ID',
				issuer,
				clientId: 'nexus-client',
				clientAuthentication: authentication,
				secret:
					authentication === 'none' ? { action: 'clear' } : { action: 'replace', value: 'oidc-test-secret' },
				password: account.password,
			},
		});
		assert.equal(response.status(), 200, await response.text());
		const saved = await request.get('/api/v1/auth/oidc/settings');
		assert.ok(!(await saved.text()).includes('oidc-test-secret'));
		return readOidcSettingsResponse(await saved.json());
	}

	async function start(purpose: 'login' | 'binding', revision?: string | null) {
		const response = await request.post('/api/v1/auth/oidc/' + purpose + '/start', {
			headers,
			data: purpose === 'binding' ? { revision, password: account.password } : { rememberMe: true },
		});
		assert.equal(response.status(), 200, await response.text());
		assert.equal(response.headers()['content-type'], 'application/json; charset=utf-8');
		return readOidcStartResponse(await response.json()).authorizationUrl;
	}

	async function bind(provider: Awaited<ReturnType<typeof openOidcProvider>>, revision: string | null) {
		const input = provider.authorize(await start('binding', revision));
		const response = await request.post('/api/v1/auth/oidc/binding/finish', { headers, data: input });
		assert.equal(response.status(), 200, (await response.text()) + JSON.stringify(provider.rejection));
		assert.deepEqual(await response.json(), { completed: 'binding' });
	}

	return { configure, start, bind };
}
