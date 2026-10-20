import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');

function totp(secret) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const key = Buffer.from(bits.match(/.{8}/gu).map((byte) => Number.parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hmac = createHmac('sha1', key).update(counter).digest();
	return String((hmac.readUInt32BE(hmac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

const root = await mkdtemp(join(tmpdir(), 'nexus-f1-auth-'));
let app;
let frontend;
let browser;
try {
	const socket = createServer();
	socket.listen(0, '127.0.0.1');
	await new Promise((resolve) => socket.once('listening', resolve));
	const port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	const origin = 'http://localhost:' + port;
	app = await createApp(join(root, 'auth.db'), {
		encryptionKey: randomBytes(32),

		configuration: () => ({
			ipWhitelist: '',
			ipBlacklistEnabled: true,
			maxLoginAttempts: 5,
			loginBanDuration: 300,
			statusMonitorIntervalSeconds: 3,
			remoteHostRefreshIntervalSeconds: 60,
			passkeys: [{ origin, rpId: 'localhost' }],
			captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
		}),
	});
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	frontend = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{
			cwd: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
			env: {
				...process.env,
				NEXUS_VITE_BACKEND_ORIGIN: 'http://' + backend,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	const output = [];
	frontend.stdout.on('data', (value) => output.push(value.toString()));
	frontend.stderr.on('data', (value) => output.push(value.toString()));
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (frontend.exitCode !== null) {
			throw Error('Vite startup failed: ' + output.join('').slice(-2000));
		}
		try {
			const response = await fetch(origin);
			if (response.ok) {
				ready = true;
				break;
			}
		} catch {
			/* startup */
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	assert.ok(ready, 'Vite ready');
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.exposeFunction('fixtureTotp', totp);
	await page.goto(origin + '/__targets-next');
	const result = await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { createPinia } = await import('/node_modules/.vite/deps/pinia.js');
		const { requestJson } = await import('/src/client/http/json-client.ts');
		const { HttpRequestFailure } = await import('/src/client/http/request-failure.ts');
		const { AuthRequestFailure } = await import('/src/features/auth/model/auth-failure.ts');
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
		check(
			logged.status === 'authenticated' && store.user?.username === 'admin',
			'real password and app projection',
		);
		check((await store.resolveSession(true)) === 'authenticated', 'real cookie status');
		await store.logout();
		check((await api.status()) === null && store.sessionState === 'anonymous', 'real logout and strict 401');
		await store.login({ username: 'admin', password: 'fixture-password-123' });
		const factor = await api.beginTotpSetup();
		check(
			factor.secret.length === 32 && factor.qrCodeUrl.startsWith('data:image/png;base64,'),
			'real setup decoded by Shared',
		);
		const code = await window.fixtureTotp(factor.secret);
		await api.activateTotp(code);
		await store.logout();
		const pending = await store.login({ username: 'admin', password: 'fixture-password-123', rememberMe: true });
		check(
			pending.status === 'two-factor-required' && store.pendingSecondFactor && (await api.status()) === null,
			'real partial login has no full session',
		);
		await store.verifyTwoFactor(await window.fixtureTotp(factor.secret));
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

		const fetchOriginal = window.fetch;

		const json = (body, status = 200) =>
			new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

		try {
			window.fetch = async () => json({ requiresTwoFactor: true });
			check(
				(await store.login({ username: 'admin', password: 'fixture-password-123' })).status ===
					'two-factor-required' && store.pendingSecondFactor,
				'pending TOTP is not login',
			);
			window.fetch = async () => json({ user: { id: 1, username: 'admin', twoFactorEnabled: true } });
			await store.verifyTwoFactor('123456');
			check(store.sessionState === 'authenticated' && !store.pendingSecondFactor, 'TOTP success projection');
			window.fetch = async () => {
				throw Error('private transport detail');
			};
			check(
				(await store.resolveSession(true)) === 'unknown' && store.user === null,
				'network probe remains unknown',
			);
			check((await store.resolveSetupState(true)) === 'unknown', 'setup probe remains unknown');
			let finish;
			window.fetch = () =>
				new Promise((resolve) => {
					finish = resolve;
				});
			const stale = store.login({ username: 'admin', password: 'fixture-password-123' }).catch((cause) => cause);
			store.invalidateSession();
			finish(json({ requiresTwoFactor: false, user: { id: 1, username: 'old', twoFactorEnabled: false } }));
			check(
				(await stale) instanceof AuthRequestFailure &&
					store.user === null &&
					store.sessionState === 'anonymous',
				'late login cannot revive invalid session',
			);
			let cancelled = false;
			window.fetch = async () =>
				new Response(
					new ReadableStream({
						cancel() {
							cancelled = true;
						},
					}),
					{ headers: { 'Content-Type': 'text/plain' } },
				);
			const malformed = await api.status().catch((cause) => cause);
			check(
				malformed instanceof AuthRequestFailure && malformed.code === 'protocol_failure' && cancelled,
				'early body rejection cancels stream',
			);
			window.fetch = async () =>
				json({
					isAuthenticated: true,
					user: { id: 1, username: 'admin', twoFactorEnabled: false, privateToken: 'secret' },
				});
			check(
				(await api.status().catch((cause) => cause)).code === 'protocol_failure',
				'private wire fields rejected',
			);
			window.fetch = async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(5));
						},

						cancel() {
							cancelled = true;
						},
					}),
					{ headers: { 'Content-Type': 'application/json' } },
				);
			cancelled = false;
			const overflow = await requestJson({
				method: 'GET',
				url: '/api/v1/auth/status',
				maxRequestBytes: 4,
				maxResponseBytes: 4,
			}).catch((cause) => cause);
			check(
				overflow instanceof HttpRequestFailure && overflow.outcome === 'unknown' && cancelled,
				'stream budget and cleanup',
			);
			let dispatched = 0;
			window.fetch = async () => {
				dispatched++;
				return json({});
			};
			const abort = new AbortController();
			abort.abort();
			const stopped = await requestJson({
				method: 'GET',
				url: '/api/v1/auth/status',
				signal: abort.signal,
				maxRequestBytes: 4,
				maxResponseBytes: 4,
			}).catch((cause) => cause);
			check(
				stopped.code === 'cancelled' && stopped.outcome === 'not_dispatched' && dispatched === 0,
				'pre-dispatch cancellation',
			);
			window.fetch = async () => json({ code: 'unrecognized' }, 401);
			check(
				(await api.status().catch((cause) => cause)).code === 'protocol_failure',
				'unknown 401 is not anonymous',
			);
			dispatched = 0;
			window.fetch = async () => {
				dispatched++;
				return json({});
			};
			const large = await requestJson({
				method: 'POST',
				url: '/api/v1/auth/login',
				body: { text: 'too large' },
				maxRequestBytes: 4,
				maxResponseBytes: 16,
			}).catch((cause) => cause);
			check(
				large.code === 'invalid_input' && large.outcome === 'not_dispatched' && dispatched === 0,
				'request budget before dispatch',
			);
			window.fetch = async () => {
				dispatched++;
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.error(Error('private stream error'));
						},
					}),
					{ headers: { 'Content-Type': 'application/json' } },
				);
			};
			const broken = await api.logout().catch((cause) => cause);
			check(
				broken instanceof AuthRequestFailure && broken.outcome === 'unknown' && dispatched === 1,
				'response failure does not replay logout',
			);
			dispatched = 0;
			window.fetch = async () => {
				dispatched++;
				throw Error('private response failure');
			};
			store.user = { id: 1, username: 'admin', twoFactorEnabled: false };
			store.sessionState = 'authenticated';
			const passwordUnknown = await store
				.changePassword('fixture-password-123', 'changed-password-456')
				.catch((cause) => cause);
			check(
				passwordUnknown instanceof AuthRequestFailure &&
					passwordUnknown.outcome === 'unknown' &&
					store.sessionState === 'unknown' &&
					store.user === null &&
					dispatched === 1,
				'unconfirmed password change clears local authority without replay',
			);
			window.fetch = async () =>
				json({ secret: 'A'.repeat(32), qrCodeUrl: 'https://example.invalid/secret.png' });
			check(
				(await api.beginTotpSetup().catch((cause) => cause)).code === 'protocol_failure',
				'TOTP rejects remote QR source',
			);
			window.fetch = async () => json({ changed: true, secret: 'private' });
			check(
				(await api.activateTotp('123456').catch((cause) => cause)).code === 'protocol_failure',
				'TOTP rejects additional response fields',
			);
			window.fetch = async () => json({ code: 'challenge_expired' }, 410);
			check(
				(await api.activateTotp('123456').catch((cause) => cause)).code === 'challenge_expired',
				'TOTP expiry remains a typed refusal',
			);
		} finally {
			window.fetch = fetchOriginal;
		}
		return checks;
	});
	assert.equal(result.length, 29);
	console.log('F1 auth browser checks PASS:', result.join('; '));
	const lifecycle = await page.evaluate(async () => {
		const { createApp, h, ref, nextTick, KeepAlive } = await import('/node_modules/.vite/deps/vue.js');
		const { createPinia } = await import('/node_modules/.vite/deps/pinia.js');
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		const { useTwoFactorSettings } = await import('/src/features/security/composables/use-two-factor-settings.ts');
		const enabled = ref(false);
		const node = document.createElement('div');
		document.body.append(node);
		let controller;
		let changes = 0;
		const visible = ref(true);
		const flow = {
			setup() {
				controller = useTwoFactorSettings(
					() => enabled.value,
					() => changes++,
				);
				return () => h('div');
			},
		};
		const mounted = createApp({
			render: () => h(KeepAlive, null, { default: () => (visible.value ? h(flow) : h('div')) }),
		});
		mounted.use(createPinia()).use(i18n).mount(node);
		const original = window.fetch;

		const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

		const checks = [];

		function check(value, name) {
			if (!value) {
				throw Error(name);
			}
			checks.push(name);
		}

		try {
			let calls = 0;
			window.fetch = async () => {
				calls++;
				throw Error('unknown write');
			};
			await controller.begin();
			await controller.begin();
			check(
				controller.needsRefresh.value && calls === 1 && controller.setup.value === null,
				'unknown TOTP setup blocks repeated writes',
			);
			window.fetch = async () =>
				json({ isAuthenticated: true, user: { id: 1, username: 'admin', twoFactorEnabled: true } });
			await controller.refresh();
			check(
				!controller.needsRefresh.value && !controller.loading.value,
				'TOTP recovery reads authoritative session without replay',
			);
			let finish;
			window.fetch = () =>
				new Promise((resolve) => {
					finish = resolve;
				});
			const stale = controller.begin();
			enabled.value = true;
			await nextTick();
			finish(json({ secret: 'A'.repeat(32), qrCodeUrl: 'data:image/png;base64,AAAA' }));
			await stale;
			check(
				controller.setup.value === null && !controller.loading.value,
				'changed factor status invalidates pending setup',
			);
			const hidden = controller.begin();
			visible.value = false;
			await nextTick();
			finish(json({ secret: 'C'.repeat(32), qrCodeUrl: 'data:image/png;base64,AAAA' }));
			await hidden;
			check(
				controller.needsRefresh.value && controller.setup.value === null && !controller.loading.value,
				'cached TOTP page deactivation clears secrets and fences unknown write',
			);
			visible.value = true;
			await nextTick();
			window.fetch = async () =>
				json({ isAuthenticated: true, user: { id: 1, username: 'admin', twoFactorEnabled: false } });
			await controller.refresh();
			window.fetch = () =>
				new Promise((resolve) => {
					finish = resolve;
				});
			const late = controller.begin();
			controller.disablePassword.value = 'private-password';
			mounted.unmount();
			finish(json({ secret: 'B'.repeat(32), qrCodeUrl: 'data:image/png;base64,AAAA' }));
			await late;
			check(
				controller.setup.value === null &&
					controller.disablePassword.value === '' &&
					!controller.loading.value &&
					changes === 0,
				'unmounted TOTP flow clears secrets and ignores late completion',
			);
		} finally {
			window.fetch = original;
			mounted.unmount();
			node.remove();
		}
		return checks;
	});
	assert.equal(lifecycle.length, 5);
	console.log('F1 security lifecycle checks PASS:', lifecycle.join('; '));
	const passwordUi = await page.evaluate(async () => {
		const { createApp, h, onBeforeUnmount, nextTick } = await import('/node_modules/.vite/deps/vue.js');
		const { createPinia } = await import('/node_modules/.vite/deps/pinia.js');
		// Use the application's exact optimized module URL: router injection keys are module-local Symbols.
		const source = await (await fetch('/src/app/router/index.ts')).text();
		const routerUrl = /from ["']([^"']*vue-router[^"']*)["']/u.exec(source)?.[1];
		if (!routerUrl) {
			throw Error('Actual router dependency not found');
		}
		const { createRouter, createMemoryHistory } = await import(routerUrl);
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { default: ChangePasswordPanel } =
			await import('/src/features/security/components/ChangePasswordPanel.vue');
		const pinia = createPinia();
		const store = useAuthStore(pinia);
		await store.login({ username: 'admin', password: 'changed-password-456' });
		const empty = { render: () => h('div') };
		const router = createRouter({
			history: createMemoryHistory(),
			routes: [
				{ path: '/settings', name: 'Settings', component: empty },
				{ path: '/login', name: 'Login', component: empty },
			],
		});
		await router.push('/settings');
		let unmounted = 0;
		const child = {
			setup() {
				onBeforeUnmount(() => unmounted++);
				return () => h(ChangePasswordPanel);
			},
		};
		const node = document.createElement('div');
		document.body.append(node);
		const mounted = createApp({ render: () => (store.sessionState === 'authenticated' ? h(child) : h('div')) });
		mounted.use(pinia).use(i18n).use(router).mount(node);
		const original = window.fetch;
		let writes = 0;
		window.fetch = (url, options) => {
			if (String(url).endsWith('/auth/password')) {
				writes++;
			}
			return original(url, options);
		};
		try {
			for (const [id, value] of [
				['currentPassword', 'changed-password-456'],
				['newPassword', 'final-password-789'],
				['confirmPassword', 'final-password-789'],
			]) {
				const input = node.querySelector('#' + id);
				input.value = value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				await nextTick();
			}
			const form = node.querySelector('form');
			const submitted = new Event('submit', { bubbles: true, cancelable: true });
			form.dispatchEvent(submitted);
			if (!submitted.defaultPrevented) {
				throw Error('Vue submit handler was not attached');
			}
			form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			for (let attempt = 0; attempt < 100 && router.currentRoute.value.name !== 'Login'; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			if (
				writes !== 1 ||
				unmounted !== 1 ||
				store.sessionState !== 'anonymous' ||
				router.currentRoute.value.name !== 'Login'
			) {
				throw Error(
					'Password navigation mismatch: ' +
						JSON.stringify({
							writes,
							unmounted,
							session: store.sessionState,
							route: router.currentRoute.value.name,
						}),
				);
			}
			return 'real password form prevents duplicate writes and navigates after session-driven unmount';
		} finally {
			window.fetch = original;
			mounted.unmount();
			node.remove();
		}
	});
	console.log('F1 password UI check PASS:', passwordUi);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	const passkeyChecks = await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const { createPasskeyCeremony } = await import('/src/features/auth/adapters/browser-passkey.ts');
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { createPinia } = await import('/node_modules/.vite/deps/pinia.js');
		const { AuthRequestFailure } = await import('/src/features/auth/model/auth-failure.ts');
		const api = createAccessApi();
		const store = useAuthStore(createPinia());
		const checks = [];

		function check(value, name) {
			if (!value) {
				throw Error(name);
			}
			checks.push(name);
		}

		await store.login({ username: 'admin', password: 'final-password-789' });
		check(!(await api.passkeys.hasConfigured('admin')), 'real Passkey discovery before registration');
		const options = await api.passkeys.registrationOptions();
		check(
			options.authenticatorSelection.userVerification === 'required' && options.rp.id === 'localhost',
			'real Shared registration options preserve RP and UV',
		);
		const credential = await createPasskeyCeremony().register(options, new AbortController().signal);
		check((await api.passkeys.register(credential)).verified, 'real browser adapter registration and verification');
		let list = await api.passkeys.list();
		check(
			list.length === 1 && list[0].credentialId === credential.id && !Object.hasOwn(list[0], 'publicKey'),
			'real Passkey list safe decoding',
		);
		await api.passkeys.rename(credential.id, 'Fixture device');
		check((await api.passkeys.list())[0].name === 'Fixture device', 'real Passkey rename');
		await store.logout();
		check(await api.passkeys.hasConfigured('admin'), 'real anonymous Passkey discovery');
		await store.loginWithPasskey({ username: 'admin', rememberMe: true });
		check(
			store.sessionState === 'authenticated' &&
				store.user.username === 'admin' &&
				(await api.status()).user.id === store.user.id,
			'real Passkey signature and Auth state',
		);
		list = await api.passkeys.list();
		check(list[0].lastUsedAt !== null && list[0].lastUsedAt >= list[0].createdAt, 'real Passkey use timestamp');
		await api.passkeys.remove(credential.id);
		check(
			(await api.passkeys.list()).length === 0 && !(await api.passkeys.hasConfigured('admin')),
			'real Passkey removal',
		);
		const original = window.fetch;

		const json = (body, status = 200) =>
			new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

		try {
			window.fetch = async () => json({ verified: false }, 400);
			const refused = await api.passkeys.register(credential).catch((cause) => cause);
			check(
				refused instanceof AuthRequestFailure &&
					refused.code === 'invalid_credentials' &&
					refused.outcome === 'confirmed',
				'registration false is a typed refusal',
			);
			window.fetch = async () => json({ challenge: 'AAAA', rpId: 'localhost', userVerification: 'preferred' });
			check(
				(await api.passkeys.authenticationOptions('admin').catch((cause) => cause)).code === 'protocol_failure',
				'weakened verification options rejected',
			);
			window.fetch = async () =>
				json([{ credentialId: credential.id, name: null, transports: [], createdAt: 10, lastUsedAt: 9 }]);
			check(
				(await api.passkeys.list().catch((cause) => cause)).code === 'protocol_failure',
				'invalid credential timestamp relation rejected',
			);
			let calls = 0;
			window.fetch = async () => {
				calls++;
				return json({});
			};
			check(
				(await api.passkeys.rename('bad/id', 'name').catch((cause) => cause)).outcome === 'not_dispatched' &&
					calls === 0,
				'invalid credential path rejected before dispatch',
			);
			let finishOptions;
			let optionsSignal;
			window.fetch = (url, options) => {
				calls++;
				optionsSignal = options.signal;
				return new Promise((resolve) => {
					finishOptions = resolve;
				});
			};
			const stale = store.loginWithPasskey({ username: 'admin', rememberMe: true }).catch((cause) => cause);
			store.invalidateSession();
			finishOptions(json({ challenge: 'AAAA', rpId: 'localhost', userVerification: 'required' }));
			const cancelled = await stale;
			check(
				cancelled instanceof AuthRequestFailure &&
					cancelled.code === 'cancelled' &&
					optionsSignal.aborted &&
					calls === 1 &&
					store.sessionState === 'anonymous',
				'session invalidation aborts Passkey owner and prevents late authentication dispatch',
			);
		} finally {
			window.fetch = original;
		}
		return checks;
	});
	assert.equal(passkeyChecks.length, 14);
	console.log('F1 Passkey checks PASS:', passkeyChecks.join('; '));
	const persistentSession = (await page.context().cookies()).find((cookie) => cookie.name === 'nexus_session');
	assert.ok(
		persistentSession && persistentSession.httpOnly && persistentSession.expires > Date.now() / 1000 + 29 * 86400,
	);
	console.log('F1 Passkey remember-me check PASS: real HttpOnly persistent session expiry');
	const configurationChecks = await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const { configurationApi } = await import('/src/features/preferences/api/configuration-api.ts');
		const { ConfigurationFailure } = await import('/src/features/preferences/model/configuration-types.ts');
		const { ipBlacklistApi } = await import('/src/features/security/api/ip-blacklist-api.ts');
		const api = createAccessApi();
		await api.login({ username: 'admin', password: 'final-password-789' });
		const checks = [];

		function check(value, name) {
			if (!value) {
				throw Error(name);
			}
			checks.push(name);
		}

		const original = await configurationApi.get();
		check(
			original.revision >= 1 && !Object.hasOwn(original.captcha, 'secretKey'),
			'real saved configuration projection excludes secret',
		);
		const network = {
			whitelist: original.network.whitelist,
			blacklistEnabled: original.network.blacklistEnabled,
			maxLoginAttempts: original.network.maxLoginAttempts + 1,
			loginBanDuration: original.network.loginBanDuration,
		};
		const saved = await configurationApi.saveNetwork(original, network);
		check(
			saved.revision === original.revision + 1 &&
				saved.pendingRestart &&
				saved.effectiveRevision === original.effectiveRevision,
			'real network CAS and saved versus effective revision',
		);
		check(
			saved.statusIntervalSeconds === original.statusIntervalSeconds &&
				JSON.stringify(saved.passkeySites) === JSON.stringify(original.passkeySites),
			'real network update preserves other configuration owners',
		);
		const conflict = await configurationApi.saveNetwork(original, network).catch((cause) => cause);
		check(
			conflict instanceof ConfigurationFailure &&
				conflict.code === 'version_conflict' &&
				conflict.outcome === 'confirmed',
			'real stale configuration CAS refused',
		);
		const draft = {
			enabled: false,
			provider: 'hcaptcha',
			siteKey: 'fixture-site',
			hostname: 'localhost',
			secretAction: 'replace',
			secretValue: 'private-fixture-secret',
		};
		await configurationApi.saveCaptcha(saved.revision, draft);
		const captchaSaved = await configurationApi.get();
		check(
			captchaSaved.captcha.hasSecret &&
				captchaSaved.captcha.siteKey === draft.siteKey &&
				!Object.hasOwn(captchaSaved.captcha, 'secretValue'),
			'real CAPTCHA secret replace and safe read',
		);
		draft.secretAction = 'keep';
		draft.secretValue = '';
		await configurationApi.saveCaptcha(captchaSaved.revision, draft);
		const kept = await configurationApi.get();
		check(kept.captcha.hasSecret, 'real explicit CAPTCHA secret keep');
		draft.secretAction = 'clear';
		await configurationApi.saveCaptcha(kept.revision, draft);
		check(!(await configurationApi.get()).captcha.hasSecret, 'real explicit CAPTCHA secret clear');
		check((await api.captchaConfig()).provider === 'none', 'real public CAPTCHA remains installation snapshot');
		for (let attempt = 0; attempt < 5; attempt++) {
			await fetch('/api/v1/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.42' },
				body: JSON.stringify({ username: 'admin', password: 'incorrect-password' }),
			});
		}
		const list = await ipBlacklistApi.list(50, 0);
		check(
			list.entries.length > 0 && list.entries[0].lastAttemptAtMs > 1_000_000_000_000,
			'real blacklist pagination and time projection',
		);
		await ipBlacklistApi.remove(list.entries[0].ip);
		check((await ipBlacklistApi.list(50, 0)).entries.length === 0, 'real blacklist collection DELETE JSON request');
		const fetchOriginal = window.fetch;

		const json = (body, status = 200) =>
			new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

		try {
			window.fetch = async () => json({ code: 'operation_unknown' }, 503);
			check(
				(await configurationApi.saveNetwork(saved, network).catch((cause) => cause)).outcome === 'unknown',
				'configuration unknown remains unknown',
			);
			window.fetch = async () =>
				json({ entries: [{ ip: '127.0.0.1', attempts: 1, lastAttemptAt: 1, blockedUntil: null }], total: 0 });
			check(
				(await ipBlacklistApi.list(50, 0).catch((cause) => cause)).code === 'protocol_failure',
				'blacklist count context mismatch rejected',
			);
		} finally {
			window.fetch = fetchOriginal;
		}
		return checks;
	});
	assert.equal(configurationChecks.length, 12);
	console.log('F1 configuration checks PASS:', configurationChecks.join('; '));
	const managementChecks = await page.evaluate(async () => {
		const { createApp, h, nextTick, ref, KeepAlive } = await import('/node_modules/.vite/deps/vue.js');
		const { createPinia } = await import('/node_modules/.vite/deps/pinia.js');
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { usePasskeySettings } = await import('/src/features/security/composables/use-passkey-settings.ts');
		const { useSecurityConfiguration } =
			await import('/src/features/security/composables/use-security-configuration.ts');
		const { useLoginSecurity } = await import('/src/features/security/composables/useLoginSecurity.ts');
		const pinia = createPinia();
		const store = useAuthStore(pinia);
		store.user = { id: 1, username: 'admin', twoFactorEnabled: false };
		store.sessionState = 'authenticated';
		const original = window.fetch;

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
		let mode = 'normal';
		let finish;
		window.fetch = async (url, options) => {
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
				throw Error('controlled discovery failure');
			}
			if (String(url).endsWith('/captcha')) {
				return json({ enabled: false, provider: 'none', hcaptchaSiteKey: '', recaptchaSiteKey: '' });
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
				configuration = useSecurityConfiguration();
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
			for (let i = 0; i < 100 && (passkeys.loading.value || configuration.loading.value); i++) {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
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
				login.passkeyLoadError.value && !login.hasPasskeys.value,
				'Passkey discovery failure exposes retry state',
			);
		} finally {
			mounted.unmount();
			node.remove();
			window.fetch = original;
		}
		return checks;
	});
	assert.equal(managementChecks.length, 9);
	console.log('F1 management lifecycle checks PASS:', managementChecks.join('; '));
	const securityUiChecks = await page.evaluate(async () => {
		const { createApp, h, nextTick } = await import('/node_modules/.vite/deps/vue.js');
		const { createPinia } = await import('/node_modules/.vite/deps/pinia.js');
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		const { default: CaptchaPanel } = await import('/src/features/security/components/CaptchaPanel.vue');
		const { default: IpAccessPanel } = await import('/src/features/security/components/IpAccessPanel.vue');
		const { default: PasskeyPanel } = await import('/src/features/security/components/PasskeyPanel.vue');
		const { configurationApi } = await import('/src/features/preferences/api/configuration-api.ts');
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const api = createAccessApi();
		const pinia = createPinia();
		const store = useAuthStore(pinia);
		await store.login({ username: 'admin', password: 'final-password-789' });
		const node = document.createElement('div');
		document.body.append(node);
		const mounted = createApp({ render: () => h('div', [h(CaptchaPanel), h(IpAccessPanel), h(PasskeyPanel)]) });
		const original = window.fetch;
		let writes = 0;
		window.fetch = (url, options) => {
			if (options?.method === 'PUT') {
				writes++;
			}
			return original(url, options);
		};
		const checks = [];

		async function until(predicate) {
			for (let i = 0; i < 200; i++) {
				if (await predicate()) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			throw Error('Security UI did not converge');
		}

		function check(value, name) {
			if (!value) {
				throw Error(name);
			}
			checks.push(name);
		}

		async function input(id, value) {
			const control = node.querySelector('#' + id);
			control.value = value;
			control.dispatchEvent(new Event('input', { bubbles: true }));
			await nextTick();
			return control;
		}

		const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

		try {
			mounted.use(pinia).use(i18n).mount(node);
			await until(() => node.querySelector('#captcha-provider') && !node.querySelector('fieldset').disabled);
			const toggle = node.querySelector('#captcha-provider').closest('fieldset').querySelector('[role=checkbox]');
			if (toggle.getAttribute('aria-checked') !== 'true') toggle.click();
			node.querySelector('#captcha-provider').click();
			await nextTick();
			await until(() => document.querySelector('[role=option][data-value=hcaptcha]'));
			document.querySelector('[role=option][data-value=hcaptcha]').click();
			await nextTick();
			await until(
				() =>
					node.querySelector('#captcha-site') &&
					!node.querySelector('fieldset').disabled &&
					!node.querySelector('#ipWhitelist').disabled,
			);
			await input('captcha-hostname', 'localhost');
			node.querySelector('#captcha-secret-action').click();
			await nextTick();
			await until(() => document.querySelector('[role=option][data-value=replace]'));
			document.querySelector('[role=option][data-value=replace]').click();
			await nextTick();
			await input('captcha-secret', 'security-ui-fixture-secret');
			const field = await input('captcha-site', 'updated-ui-site');
			submit(field.closest('form'));
			submit(field.closest('form'));
			await until(
				() =>
					!node.querySelector('fieldset').disabled &&
					node.textContent.includes(i18n.global.t('settings.configuration.saved')),
			);
			check(
				writes === 1 && (await configurationApi.get()).captcha.siteKey === 'updated-ui-site',
				'real CAPTCHA form prevents duplicates and persists explicit draft',
			);
			const networkField = await input('maxLoginAttempts', '8');
			submit(networkField.closest('form'));
			await until(() => node.textContent.includes(i18n.global.t('settings.configuration.conflict')));
			check(
				writes === 2 && node.querySelector('#ipWhitelist').disabled,
				'real independent panels expose stale CAS and block further writes',
			);
			const retry = [...node.querySelectorAll('button')].find(
				(button) => button.textContent.trim() === i18n.global.t('common.retry'),
			);
			retry.click();
			await until(() => !node.querySelector('#ipWhitelist').disabled);
			await input('maxLoginAttempts', '8');
			submit(networkField.closest('form'));
			await until(async () => (await configurationApi.get()).network.maxLoginAttempts === 8);
			check(
				writes === 3 && node.textContent.includes(i18n.global.t('settings.configuration.restart')),
				'real network form converts numeric input after deliberate conflict recovery',
			);
			const register = [...node.querySelectorAll('button')].find(
				(button) => button.textContent.trim() === i18n.global.t('settings.passkey.registerNewButton'),
			);
			await until(() => !register.disabled);
			register.click();
			await until(async () => (await api.passkeys.list()).length === 1 && node.querySelector('li'));
			check(
				node.querySelector('li').textContent.includes('ID:'),
				'real Passkey panel invokes virtual authenticator and displays safe credential',
			);
			const remove = [...node.querySelectorAll('li button')].find(
				(button) => button.textContent.trim() === i18n.global.t('common.delete'),
			);
			await until(() => !remove.disabled);
			remove.click();
			await until(async () => (await api.passkeys.list()).length === 0 && !node.querySelector('li'));
			check(
				node.textContent.includes(i18n.global.t('settings.passkey.noKeysRegistered')),
				'real Passkey panel removes credential and refreshes authoritative list',
			);
		} finally {
			mounted.unmount();
			node.remove();
			window.fetch = original;
		}
		return checks;
	});
	assert.equal(securityUiChecks.length, 5);
	console.log('F1 security UI checks PASS:', securityUiChecks.join('; '));
	await page.close();
} finally {
	const failures = [];
	try {
		if (browser) {
			await browser.close();
		}
	} catch (cause) {
		failures.push(cause);
	}
	try {
		if (frontend) {
			const exited = new Promise((resolve) => frontend.once('exit', resolve));
			frontend.kill('SIGTERM');
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
			if (frontend.exitCode === null) {
				frontend.kill('SIGKILL');
				await exited;
			}
		}
	} catch (cause) {
		failures.push(cause);
	}
	try {
		if (app) {
			await app.close();
		}
	} catch (cause) {
		failures.push(cause);
	}
	try {
		await rm(root, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Auth browser cleanup failed');
	}
}
