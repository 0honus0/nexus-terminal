import { request as requestFactory } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';
import { openOidcProvider, configureOidc, startOidc, bindOidc, oidcHeaders } from '../../support/oidc-provider';
import { readOidcSettingsResponse } from '../../../../packages/shared/src/access/oidc/http-codec';

for (const authentication of ['client_secret_basic', 'client_secret_post', 'none'] as const) {
	test(`OIDC ${authentication}: bind existing account, PKCE login and revoke only OIDC sessions`, async ({
		request,
	}) => {
		const provider = await openOidcProvider();
		const guest = await requestFactory.newContext({ baseURL: E2E_URLS.frontendOrigin });
		try {
			const c = await configureOidc(request, provider.issuer, authentication);
			expect(await (await guest.get('/api/v1/auth/oidc/provider')).json()).toEqual({ provider: null });
			expect(
				(
					await guest.post('/api/v1/auth/oidc/login/start', {
						headers: oidcHeaders,
						data: { rememberMe: true },
					})
				).status(),
			).toBe(401);
			await bindOidc(request, provider, c.revision);
			expect(await (await guest.get('/api/v1/auth/oidc/provider')).json()).toEqual({
				provider: { label: 'Pocket ID' },
			});
			const response = provider.authorize(await startOidc(guest, 'login'));
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
				data: { revision: c.revision, password: E2E_ADMIN.password },
			});
			expect(unlink.status()).toBe(200);
			expect((await guest.get('/api/v1/auth/status')).status()).toBe(401);
			expect((await request.get('/api/v1/auth/status')).status()).toBe(200);
		} finally {
			await guest.dispose();
			await provider.close();
		}
	});
}

for (const mode of ['nonce', 'audience', 'issuer', 'expired', 'signature', 'no-id-token', 'unbound-subject'] as const) {
	test(`OIDC rejects ${mode} and never creates a session`, async ({ request }) => {
		const provider = await openOidcProvider();
		try {
			const c = await configureOidc(request, provider.issuer);
			await bindOidc(request, provider, c.revision);
			await request.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} });
			if (mode === 'unbound-subject') {
				provider.setSubject('another-account');
			} else {
				provider.setMode(mode);
			}
			const input = provider.authorize(await startOidc(request, 'login'));
			const result = await request.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input });
			expect(result.status()).toBeGreaterThanOrEqual(400);
			expect(await result.text()).not.toContain(input.code);
			expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
			expect(
				(await request.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input })).status(),
			).toBe(410);
		} finally {
			await provider.close();
		}
	});
}

test('OIDC binding requires current password, browser cookie, original session and exact state', async ({
	request,
}) => {
	const provider = await openOidcProvider();
	const guest = await requestFactory.newContext({ baseURL: E2E_URLS.frontendOrigin });
	try {
		const c = await configureOidc(request, provider.issuer);
		const badPassword = await request.post('/api/v1/auth/oidc/binding/start', {
			headers: oidcHeaders,
			data: { revision: c.revision, password: 'incorrect-password' },
		});
		expect(badPassword.status()).toBe(401);
		const input = provider.authorize(await startOidc(request, 'binding', c.revision));
		expect(
			(await guest.post('/api/v1/auth/oidc/binding/finish', { headers: oidcHeaders, data: input })).status(),
		).toBe(410);
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
		await loginAsInitialAdmin(request);
		expect(
			(await request.post('/api/v1/auth/oidc/binding/finish', { headers: oidcHeaders, data: input })).status(),
		).toBeGreaterThanOrEqual(400);
		expect(readOidcSettingsResponse(await (await request.get('/api/v1/auth/oidc/settings')).json()).bound).toBe(
			false,
		);
	} finally {
		await guest.dispose();
		await provider.close();
	}
});

test('OIDC settings CAS and disable during token exchange reject stale login', async ({ request }) => {
	const provider = await openOidcProvider();
	const guest = await requestFactory.newContext({ baseURL: E2E_URLS.frontendOrigin });

	let release = () => {};

	try {
		const c = await configureOidc(request, provider.issuer);
		await bindOidc(request, provider, c.revision);
		provider.setTokenGate(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		const input = provider.authorize(await startOidc(guest, 'login'));
		const pending = guest.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input });
		await expect.poll(() => provider.tokenCalls).toBe(2);
		const save = {
			revision: c.revision,
			enabled: false,
			label: c.label,
			issuer: c.issuer,
			clientId: c.clientId,
			clientAuthentication: c.clientAuthentication,
			secret: { action: 'keep' },
			password: E2E_ADMIN.password,
		};
		expect((await request.put('/api/v1/auth/oidc/settings', { headers: oidcHeaders, data: save })).status()).toBe(
			200,
		);
		expect((await request.put('/api/v1/auth/oidc/settings', { headers: oidcHeaders, data: save })).status()).toBe(
			409,
		);
		release();
		expect((await pending).status()).toBe(409);
		expect((await guest.get('/api/v1/auth/status')).status()).toBe(401);
	} finally {
		release();
		await guest.dispose();
		await provider.close();
	}
});

test('OIDC settings never disclose a secret or carry it to a different issuer, and enforce origin', async ({
	request,
}) => {
	const provider = await openOidcProvider();
	try {
		const c = await configureOidc(request, provider.issuer);
		const input = {
			revision: c.revision,
			enabled: true,
			label: c.label,
			issuer: 'https://another.example',
			clientId: c.clientId,
			clientAuthentication: c.clientAuthentication,
			secret: { action: 'keep' },
			password: E2E_ADMIN.password,
		};
		const badOrigin = await request.put('/api/v1/auth/oidc/settings', {
			headers: { Origin: 'https://other.example' },
			data: input,
		});
		expect(badOrigin.status()).toBe(403);
		expect((await request.put('/api/v1/auth/oidc/settings', { headers: oidcHeaders, data: input })).status()).toBe(
			400,
		);
		const stored = await request.get('/api/v1/auth/oidc/settings');
		expect(readOidcSettingsResponse(await stored.json())).toEqual(c);
		expect(await stored.text()).not.toContain('oidc-test-secret');
		const unknown = await request.post('/api/v1/auth/oidc/binding/start', {
			headers: oidcHeaders,
			data: { revision: c.revision, password: E2E_ADMIN.password, redirectUri: 'https://other.example' },
		});
		expect(unknown.status()).toBe(400);
	} finally {
		await provider.close();
	}
});

test('OIDC logout while the IdP exchanges the code prevents a late login', async ({ request }) => {
	const provider = await openOidcProvider();
	const guest = await requestFactory.newContext({ baseURL: E2E_URLS.frontendOrigin });

	let release = () => {};

	try {
		const c = await configureOidc(request, provider.issuer);
		await bindOidc(request, provider, c.revision);
		provider.setTokenGate(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		const input = provider.authorize(await startOidc(guest, 'login'));
		const pending = guest.post('/api/v1/auth/oidc/login/finish', { headers: oidcHeaders, data: input });
		await expect.poll(() => provider.tokenCalls).toBe(2);
		expect((await guest.post('/api/v1/auth/logout', { headers: oidcHeaders, data: {} })).status()).toBe(200);
		release();
		expect((await pending).status()).toBe(410);
		expect((await guest.get('/api/v1/auth/status')).status()).toBe(401);
	} finally {
		release();
		await guest.dispose();
		await provider.close();
	}
});
