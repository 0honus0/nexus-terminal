import {
	expect,
	test as protocolTest,
	loginAsAdmin,
	HTTP_TEST_ADMIN,
	HTTP_TEST_ORIGIN,
} from '../../../../support/http/protocol-fixture.mjs';
import { openOidcProvider } from '../../../../support/protocols/oidc-provider';
import { createOidcClient } from '../../../../support/http/oidc-client';
import { readOidcSettingsResponse } from '../../../../../packages/shared/src/access/oidc/http-codec';
const oidcHeaders = { Origin: HTTP_TEST_ORIGIN };
const test = protocolTest.extend<{ provider: Awaited<ReturnType<typeof openOidcProvider>> }>({
	provider: async ({}, use) => {
		const provider = await openOidcProvider();
		try {
			await use(provider);
		} finally {
			await provider.close();
		}
	},
});
for (const authentication of ['client_secret_basic', 'client_secret_post', 'none'] as const) {
	test(`OIDC ${authentication}: bind existing account, PKCE login and revoke only OIDC sessions`, async ({
		request,
		httpClients,
		provider,
	}) => {
		const guest = await httpClients.createContext();
		const c = await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).configure(
			provider.issuer,
			authentication,
		);
		expect(await (await guest.get('/api/v1/auth/oidc/provider')).json()).toEqual({ provider: null });
		expect(
			(
				await guest.post('/api/v1/auth/oidc/login/start', {
					headers: oidcHeaders,
					data: { rememberMe: true },
				})
			).status(),
		).toBe(401);
		await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).bind(provider, c.revision);
		expect(await (await guest.get('/api/v1/auth/oidc/provider')).json()).toEqual({
			provider: { label: 'Pocket ID' },
		});
		const response = provider.authorize(
			await createOidcClient(guest, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).start('login'),
		);
		const login = await guest.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: response });
		expect(login.status(), await login.text()).toBe(200);
		expect(login.headers()['set-cookie']).toContain('Max-Age=2592000');
		expect((await guest.get('/api/v1/auth/status')).status()).toBe(200);
		expect(
			(await guest.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: response })).status(),
		).toBe(410);
		expect(new Set(provider.seenVerifiers).size).toBe(2);
		const unlink = await request.delete('/api/v1/auth/oidc/binding', {
			headers: oidcHeaders,
			data: { revision: c.revision, password: HTTP_TEST_ADMIN.password },
		});
		expect(unlink.status()).toBe(200);
		expect((await guest.get('/api/v1/auth/status')).status()).toBe(401);
		expect((await request.get('/api/v1/auth/status')).status()).toBe(200);
	});
}
for (const mode of ['nonce', 'audience', 'issuer', 'expired', 'signature', 'no-id-token', 'unbound-subject'] as const) {
	test(`OIDC rejects ${mode} and never creates a session`, async ({ request, provider }) => {
		const c = await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).configure(provider.issuer);
		await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).bind(provider, c.revision);
		await request.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} });
		if (mode === 'unbound-subject') {
			provider.setSubject('another-account');
		} else {
			provider.setMode(mode);
		}
		const input = provider.authorize(
			await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).start('login'),
		);
		const result = await request.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input });
		expect(result.status()).toBeGreaterThanOrEqual(400);
		expect(await result.text()).not.toContain(input.code);
		expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
		expect(
			(await request.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input })).status(),
		).toBe(410);
	});
}
test('OIDC binding requires current password, browser cookie, original session and exact state', async ({
	request,
	httpClients,
	provider,
}) => {
	const guest = await httpClients.createContext();
	const c = await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).configure(provider.issuer);
	const badPassword = await request.post('/api/v1/auth/oidc/binding/start', {
		headers: oidcHeaders,
		data: { revision: c.revision, password: 'incorrect-password' },
	});
	expect(badPassword.status()).toBe(401);
	const input = provider.authorize(
		await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).start('binding', c.revision),
	);
	expect((await guest.post('/api/v1/auth/oidc/binding/finish', { headers: oidcHeaders, data: input })).status()).toBe(
		410,
	);
	expect(
		(
			await request.post('/api/v1/auth/oidc/binding/finish', {
				headers: oidcHeaders,
				data: { ...input, state: 'wrong' },
			})
		).status(),
	).toBe(410);
	expect(provider.tokenCalls).toBe(0);
	await request.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} });
	await loginAsAdmin(request);
	expect(
		(await request.post('/api/v1/auth/oidc/binding/finish', { headers: oidcHeaders, data: input })).status(),
	).toBeGreaterThanOrEqual(400);
	expect(readOidcSettingsResponse(await (await request.get('/api/v1/auth/oidc/settings')).json()).bound).toBe(false);
});
test('OIDC settings CAS and disable during token exchange reject stale login', async ({
	request,
	httpClients,
	provider,
}) => {
	const guest = await httpClients.createContext();

	let release = () => {};

	let pending: Promise<PromiseSettledResult<import('@playwright/test').APIResponse>[]> | undefined;
	try {
		const c = await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).configure(provider.issuer);
		await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).bind(provider, c.revision);
		provider.setTokenGate(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		const input = provider.authorize(
			await createOidcClient(guest, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).start('login'),
		);
		pending = Promise.allSettled([
			guest.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input }),
		]);
		await expect.poll(() => provider.tokenCalls).toBe(2);
		const save = {
			revision: c.revision,
			enabled: false,
			label: c.label,
			issuer: c.issuer,
			clientId: c.clientId,
			clientAuthentication: c.clientAuthentication,
			secret: { action: 'keep' },
			password: HTTP_TEST_ADMIN.password,
		};
		expect((await request.put('/api/v1/auth/oidc/settings', { headers: oidcHeaders, data: save })).status()).toBe(
			200,
		);
		expect((await request.put('/api/v1/auth/oidc/settings', { headers: oidcHeaders, data: save })).status()).toBe(
			409,
		);
		release();
		const [completion] = await pending;
		if (completion.status === 'rejected') throw completion.reason;
		expect(completion.value.status()).toBe(409);
		expect((await guest.get('/api/v1/auth/status')).status()).toBe(401);
	} finally {
		release();
		const [completion] = (await pending) ?? [];
		if (completion?.status === 'rejected') throw completion.reason;
	}
});
test('OIDC settings never disclose a secret or carry it to a different issuer, and enforce origin', async ({
	request,
	provider,
}) => {
	const c = await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).configure(provider.issuer);
	const input = {
		revision: c.revision,
		enabled: true,
		label: c.label,
		issuer: 'https://another.example',
		clientId: c.clientId,
		clientAuthentication: c.clientAuthentication,
		secret: { action: 'keep' },
		password: HTTP_TEST_ADMIN.password,
	};
	const badOrigin = await request.put('/api/v1/auth/oidc/settings', {
		headers: { Origin: 'https://other.example' },
		data: input,
	});
	expect(badOrigin.status()).toBe(403);
	expect((await request.put('/api/v1/auth/oidc/settings', { headers: oidcHeaders, data: input })).status()).toBe(400);
	const stored = await request.get('/api/v1/auth/oidc/settings');
	expect(readOidcSettingsResponse(await stored.json())).toEqual(c);
	expect(await stored.text()).not.toContain('oidc-test-secret');
	const unknown = await request.post('/api/v1/auth/oidc/binding/start', {
		headers: oidcHeaders,
		data: { revision: c.revision, password: HTTP_TEST_ADMIN.password, redirectUri: 'https://other.example' },
	});
	expect(unknown.status()).toBe(400);
});
test('OIDC logout while the IdP exchanges the code prevents a late login', async ({
	request,
	httpClients,
	provider,
}) => {
	const guest = await httpClients.createContext();

	let release = () => {};

	let pending: Promise<PromiseSettledResult<import('@playwright/test').APIResponse>[]> | undefined;
	try {
		const c = await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).configure(provider.issuer);
		await createOidcClient(request, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).bind(provider, c.revision);
		provider.setTokenGate(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		const input = provider.authorize(
			await createOidcClient(guest, HTTP_TEST_ADMIN, HTTP_TEST_ORIGIN).start('login'),
		);
		pending = Promise.allSettled([
			guest.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input }),
		]);
		await expect.poll(() => provider.tokenCalls).toBe(2);
		expect((await guest.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} })).status()).toBe(200);
		release();
		const [completion] = await pending;
		if (completion.status === 'rejected') throw completion.reason;
		expect(completion.value.status()).toBe(410);
		expect((await guest.get('/api/v1/auth/status')).status()).toBe(401);
	} finally {
		release();
		const [completion] = (await pending) ?? [];
		if (completion?.status === 'rejected') throw completion.reason;
	}
});
