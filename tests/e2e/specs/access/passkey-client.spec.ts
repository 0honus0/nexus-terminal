import { test, expect } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { readPasskeyList } from '../../../../packages/shared/src/access/factors/passkey-codec';

test('native Passkey clients sign in with persistent cookies and the actual settings panel creates and removes keys', async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	try {
		await page.goto('/settings');
		const results = await page.evaluate(
			async (admin) => {
				const path = '/__e2e__/browser-clients.js';
				const {
					createAccessApi,
					createPasskeyCeremony,
					useAuthStore,
					createPinia,
				}: typeof import('../../support/browser-clients') = await import(path);
				const api = createAccessApi();
				const store = useAuthStore(createPinia());
				await store.login(admin);
				const options = await api.passkeys.registrationOptions();
				if (
					options.authenticatorSelection?.userVerification !== 'required' ||
					options.rp.id !== location.hostname
				)
					throw Error('Real RP or user verification was weakened');
				const credential = await createPasskeyCeremony().register(options, new AbortController().signal);
				if (!(await api.passkeys.register(credential)).verified)
					throw Error('Actual native registration was not verified');
				const initial = await api.passkeys.list();
				if (
					initial.length !== 1 ||
					initial[0].credentialId !== credential.id ||
					Object.hasOwn(initial[0], 'publicKey')
				)
					throw Error('Unsafe or unrelated credential list');
				await api.passkeys.rename(credential.id, 'Fixture device');
				if ((await api.passkeys.list())[0].name !== 'Fixture device')
					throw Error('Actual credential rename lost');
				await store.logout();
				await store.loginWithPasskey({ username: admin.username, rememberMe: true });
				const identity = await api.status();
				if (
					store.sessionState !== 'authenticated' ||
					store.user?.username !== admin.username ||
					identity?.user.id !== store.user.id
				)
					throw Error('Native signature did not publish matching authority');
				const used = (await api.passkeys.list())[0];
				if (used.lastUsedAt === null || used.lastUsedAt < used.createdAt)
					throw Error('Actual credential use timestamp missing');
				await api.passkeys.remove(credential.id);
				return { remaining: (await api.passkeys.list()).length };
			},
			{ username: E2E_ADMIN.username, password: E2E_ADMIN.password },
		);
		expect(results.remaining).toBe(0);
		const cookie = (await context.cookies()).find((item) => item.name === 'nexus_session');
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);
		await page.reload();
		await page.getByRole('tab', { name: 'Security', exact: true }).click();
		const panel = page
			.getByRole('heading', { name: 'Passkey Management', exact: true })
			.locator('xpath=ancestor::section[1]');
		await panel.getByRole('button', { name: 'Register New Passkey', exact: true }).click();
		await expect(panel.locator('li')).toHaveCount(1);
		await expect(panel.locator('li')).toContainText('ID:');

		const list = async () =>
			readPasskeyList(await (await context.request.get('/api/v1/auth/user/passkeys')).json());

		expect(await list()).toHaveLength(1);
		await panel.locator('li').getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(panel.locator('li')).toHaveCount(0);
		await expect(panel).toContainText('No Passkeys registered yet.');
		expect(await list()).toHaveLength(0);
		expect(errors).toEqual([]);
	} finally {
		await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
		await cdp.send('WebAuthn.disable');
		await cdp.detach();
	}
});
