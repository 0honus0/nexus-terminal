import { test, expect, loginAsAdmin, HTTP_TEST_ADMIN } from '../../../../support/http/protocol-fixture.mjs';
import { totpCode, invalidTotpCode } from '../../../../support/protocols/totp';
import { readAccessTotpSetup } from '../../../../../packages/shared/src/access/factors/http-codec';
test('2FA can be enabled, required at login, verified, and disabled', async ({ request }) => {
	await loginAsAdmin(request);

	let secret = '';
	{
		const setup = await request.post('/api/v1/auth/2fa/setup', {});
		expect(setup.ok()).toBeTruthy();
		const setupBody = readAccessTotpSetup(await setup.json());
		secret = setupBody.secret;
		expect(secret).toBeTruthy();
		expect(setupBody.qrCodeUrl).toMatch(/^data:image\/png;base64,/);

		const token = totpCode(secret);
		const verify = await request.post('/api/v1/auth/2fa/verify', { data: { token } });
		expect(verify.ok()).toBeTruthy();

		const status = await request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		await expect(status.json()).resolves.toMatchObject({
			isAuthenticated: true,
			user: { username: HTTP_TEST_ADMIN.username, twoFactorEnabled: true },
		});
	}

	{
		expect((await request.post('/api/v1/auth/logout', {})).ok()).toBeTruthy();
		const login = await request.post('/api/v1/auth/login', {
			data: {
				username: HTTP_TEST_ADMIN.username,
				password: HTTP_TEST_ADMIN.password,
				rememberMe: false,
			},
		});
		expect(login.ok()).toBeTruthy();
		await expect(login.json()).resolves.toMatchObject({ requiresTwoFactor: true });

		const incompleteStatus = await request.get('/api/v1/auth/status');
		expect(incompleteStatus.status()).toBe(401);
	}

	{
		const invalid = await request.post('/api/v1/auth/login/2fa', {
			data: { token: invalidTotpCode(secret) },
		});
		expect(invalid.status()).toBe(401);

		const token = totpCode(secret);
		const verify = await request.post('/api/v1/auth/login/2fa', { data: { token } });
		expect(verify.ok()).toBeTruthy();

		const status = await request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		await expect(status.json()).resolves.toMatchObject({ isAuthenticated: true });
	}

	{
		const wrongPassword = await request.delete('/api/v1/auth/2fa', {
			data: { password: 'not-the-password' },
		});
		expect(wrongPassword.status()).toBe(401);

		const disable = await request.delete('/api/v1/auth/2fa', { data: { password: HTTP_TEST_ADMIN.password } });
		expect(disable.ok()).toBeTruthy();

		const status = await request.get('/api/v1/auth/status');
		expect(status.ok()).toBeTruthy();
		await expect(status.json()).resolves.toMatchObject({
			user: { username: HTTP_TEST_ADMIN.username, twoFactorEnabled: false },
		});
	}
});
