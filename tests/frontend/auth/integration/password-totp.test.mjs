import { test, expect } from 'vitest';
import { openAccess, totp } from '../support/fixture.mjs';

test('real password, TOTP, cookie and password-change lifecycle retain original authority', async () => {
	await openAccess();
	const { createAccessApi } = await import('../../../../packages/frontend/src/features/auth/api/access-api.ts');
	const { useAuthStore } = await import('../../../../packages/frontend/src/features/auth/store/auth.store.ts');
	const { createPinia } = await import('pinia');
	const { AuthRequestFailure } =
		await import('../../../../packages/frontend/src/features/auth/model/auth-failure.ts');
	const api = createAccessApi();
	const checks = [];

	function check(value, name) {
		if (!value) {
			throw Error(name);
		}
		checks.push(name);
	}

	check(await api.needsSetup(), 'real setup probe');
	await api.setup({
		username: 'admin',
		password: 'fixture-password-123',
		confirmPassword: 'fixture-password-123',
	});
	const store = useAuthStore(createPinia());
	const logged = await store.login({ username: 'admin', password: 'fixture-password-123' });
	check(logged.status === 'authenticated' && store.user?.username === 'admin', 'real password and app projection');
	check((await store.resolveSession(true)) === 'authenticated', 'real cookie status');
	await store.logout();
	check((await api.status()) === null && store.sessionState === 'anonymous', 'real logout and strict 401');
	await store.login({ username: 'admin', password: 'fixture-password-123' });
	const factor = await api.beginTotpSetup();
	check(
		factor.secret.length === 32 && factor.qrCodeUrl.startsWith('data:image/png;base64,'),
		'real setup decoded by Shared',
	);
	const code = totp(factor.secret);
	await api.activateTotp(code);
	await store.logout();
	const pending = await store.login({ username: 'admin', password: 'fixture-password-123', rememberMe: true });
	check(
		pending.status === 'two-factor-required' && store.pendingSecondFactor && (await api.status()) === null,
		'real partial login has no full session',
	);
	await store.verifyTwoFactor(totp(factor.secret));
	check(
		store.user?.twoFactorEnabled && (await store.resolveSession(true)) === 'authenticated',
		'real TOTP login and cookie',
	);
	const refused = await api.disableTotp('incorrect-password').catch((cause) => cause);
	check(
		refused instanceof AuthRequestFailure &&
			refused.code === 'invalid_credentials' &&
			refused.outcome === 'confirmed',
		'real TOTP disable requires password',
	);
	await api.disableTotp('fixture-password-123');
	await store.resolveSession(true);
	check(!store.user.twoFactorEnabled, 'real TOTP disable reflected in session');
	const passwordRefused = await store
		.changePassword('incorrect-password', 'changed-password-456')
		.catch((cause) => cause);
	check(
		passwordRefused instanceof AuthRequestFailure &&
			passwordRefused.outcome === 'confirmed' &&
			store.sessionState === 'authenticated',
		'real refused password change preserves session',
	);
	await store.changePassword('fixture-password-123', 'changed-password-456');
	check(
		store.sessionState === 'anonymous' && store.user === null && (await api.status()) === null,
		'real password change revokes server and local sessions',
	);
	const oldPassword = await store
		.login({ username: 'admin', password: 'fixture-password-123' })
		.catch((cause) => cause);
	check(oldPassword.code === 'invalid_credentials', 'real old password rejected');
	check(
		(await store.login({ username: 'admin', password: 'changed-password-456' })).status === 'authenticated',
		'real new password accepted',
	);
	await store.logout();

	expect(checks).toHaveLength(13);
});
