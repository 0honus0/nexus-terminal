import { test, expect, vi } from 'vitest';

test('security controllers retain mutation and refresh failures across cached-view lifecycle', async () => {
	const { createApp, h, nextTick, ref, KeepAlive } = await import('vue');
	const { createPinia } = await import('pinia');
	const { default: i18n } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
	const { useAuthStore } = await import('../../../../packages/frontend/src/features/auth/store/auth.store.ts');
	const { usePasskeySettings } =
		await import('../../../../packages/frontend/src/features/security/composables/use-passkey-settings.ts');
	const { useSecurityConfiguration } =
		await import('../../../../packages/frontend/src/features/security/composables/use-security-configuration.ts');
	const { useLoginSecurity } =
		await import('../../../../packages/frontend/src/features/security/composables/useLoginSecurity.ts');
	const pinia = createPinia();
	const store = useAuthStore(pinia);
	store.user = { id: 1, username: 'admin', twoFactorEnabled: false };
	store.sessionState = 'authenticated';
	const original = globalThis.fetch;

	const json = (body, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

	const fixture = {
		version: 10,
		effectiveVersion: 1,
		requiresRestart: true,
		effectiveMonitoring: { statusMonitorIntervalSeconds: 3, remoteHostRefreshIntervalSeconds: 60 },
		policy: {
			ipWhitelist: '',
			ipBlacklistEnabled: true,
			maxLoginAttempts: 5,
			loginBanDuration: 300,
			statusMonitorIntervalSeconds: 3,
			remoteHostRefreshIntervalSeconds: 60,
			passkeys: [],
		},
		captcha: { enabled: false, provider: 'none', siteKey: '', hasSecret: false, expectedHostname: null },
	};
	let writes = 0;
	let passkeyDiscoveryRequests = 0;
	let mode = 'normal';
	let finish;
	globalThis.fetch = async (url, options) => {
		if (options?.method === 'PUT') {
			writes++;
			if (mode === 'conflict') {
				return json({ code: 'version_conflict' }, 409);
			}
			if (mode === 'unknown') {
				throw Error('controlled response failure');
			}
			if (mode === 'delayed') {
				return new Promise((resolve) => {
					finish = resolve;
				});
			}
			return json({ renamed: true });
		}
		if (String(url).endsWith('/user/passkeys')) {
			if (mode === 'refresh-failed') {
				throw Error('controlled list failure');
			}
			return json([{ credentialId: 'AAAA', name: null, transports: [], createdAt: 10, lastUsedAt: null }]);
		}
		if (String(url).includes('has-configured')) {
			passkeyDiscoveryRequests += 1;
			throw Error('Passkey discovery must not run from login security');
		}
		if (String(url).endsWith('/login/options')) {
			return json({
				captcha: { enabled: false, provider: 'none', hcaptchaSiteKey: '', recaptchaSiteKey: '' },
				oidc: null,
				hasPasskeys: false,
			});
		}
		return json(fixture);
	};
	let passkeys;
	let configuration;
	let login;
	const visible = ref(true);
	const child = {
		setup() {
			passkeys = usePasskeySettings();
			configuration = useSecurityConfiguration('captcha');
			login = useLoginSecurity();
			return () => h('div');
		},
	};
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => h(KeepAlive, () => (visible.value ? h(child) : null)) });
	const checks = [];

	function check(value, name) {
		if (!value) {
			throw Error(name);
		}
		checks.push(name);
	}

	try {
		mounted.use(pinia).use(i18n).mount(node);
		await vi.waitFor(
			() => {
				expect(passkeys.loading.value).toBe(false);
				expect(configuration.loading.value).toBe(false);
			},
			{ timeout: 1000, interval: 10 },
		);
		check(
			!passkeys.needsRefresh.value && configuration.snapshot.value.revision === 10,
			'mounted management controllers load authority',
		);
		mode = 'refresh-failed';
		passkeys.names.value.AAAA = 'Updated device';
		await passkeys.saveName(passkeys.passkeys.value[0]);
		check(
			passkeys.needsRefresh.value &&
				writes === 1 &&
				!passkeys.success.value &&
				passkeys.message.value === i18n.global.t('settings.passkey.error.refreshAfterChange'),
			'confirmed Passkey mutation and failed refresh remain distinct',
		);
		await passkeys.remove(passkeys.passkeys.value[0]);
		check(writes === 1, 'Passkey mutation blocked until read recovery');
		mode = 'normal';
		await passkeys.refresh();
		check(!passkeys.needsRefresh.value, 'Passkey read recovery allows deliberate next change');
		mode = 'conflict';
		await configuration.saveNetwork();
		check(
			configuration.needsRefresh.value && configuration.snapshot.value.revision === 10 && writes === 2,
			'configuration conflict preserves original revision without replay',
		);
		await configuration.saveNetwork();
		check(writes === 2, 'configuration conflict blocks repeated write');
		mode = 'normal';
		await configuration.refresh();
		mode = 'unknown';
		await configuration.saveNetwork();
		check(
			configuration.needsRefresh.value && writes === 3,
			'configuration response failure blocks retry pending read',
		);
		mode = 'normal';
		await configuration.refresh();
		mode = 'delayed';
		const late = configuration.saveNetwork();
		configuration.captcha.value.secretValue = 'ephemeral-secret';
		visible.value = false;
		await nextTick();
		finish(json({ ...fixture, version: 11 }));
		await late;
		check(
			configuration.snapshot.value === null &&
				configuration.captcha.value.secretValue === '' &&
				!configuration.loading.value,
			'deactivated settings fence late write and clear secret',
		);
		visible.value = true;
		mode = 'normal';
		await nextTick();
		await login.refresh();
		check(
			!login.loading.value && login.captchaStatus.value === 'ready' && passkeyDiscoveryRequests === 0,
			'login security refreshes CAPTCHA without Passkey discovery',
		);
	} finally {
		mounted.unmount();
		node.remove();
		globalThis.fetch = original;
	}
	expect(checks).toHaveLength(9);
});
