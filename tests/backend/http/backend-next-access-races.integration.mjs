import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { ScryptPasswordHasher } from '../../../packages/backend/dist/platform/security/password-hasher.js';
import { createRequire } from 'node:module';
import { CaptchaService } from '../../../packages/backend/dist/modules/access/captcha/service/captcha-service.js';
import { origin, send, expectStatus } from '../remote/openssh-fixture.mjs';

const password = 'b10-access-races-original-password';
const candidate = 'b10-access-races-next-password';
const alternate = 'b10-access-races-competing-password';

function gate() {
	let resolve;
	const promise = new Promise((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

async function fixture(t, options = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-access-races-'));
	let app;
	t.after(async () => {
		try {
			await app?.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32), ...options });
	const address = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	expectStatus(
		await send(address, '', 'POST', '/api/v1/auth/setup', {
			username: 'admin',
			password,
			confirmPassword: password,
		}),
		201,
	);

	const api = (cookie, method, path, input, headers) => send(address, cookie, method, path, input, headers);

	const login = (value = password) =>
		api('', 'POST', '/api/v1/auth/login', { username: 'admin', password: value, rememberMe: false });

	const cookie = (response) => response.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');

	return { api, login, cookie };
}

await test('Logout during actual password derivation prevents a stale session from changing credentials', async (t) => {
	const release = gate();
	t.after(() => release.resolve());
	const f = await fixture(t);
	const first = f.cookie(await f.login());
	const other = f.cookie(await f.login());
	const entered = gate();
	const hash = ScryptPasswordHasher.prototype.hash;
	t.mock.method(ScryptPasswordHasher.prototype, 'hash', async function (value) {
		const derived = await hash.call(this, value);
		if (value === candidate) {
			entered.resolve();
			await release.promise;
		}
		return derived;
	});
	const pending = f.api(first, 'PUT', '/api/v1/auth/password', { currentPassword: password, newPassword: candidate });
	await entered.promise;
	expectStatus(await f.api(first, 'POST', '/api/v1/auth/logout', {}), 200);
	release.resolve();
	const refused = await pending;
	expectStatus(refused, 409);
	assert.deepEqual(refused.body, { code: 'conflict' });
	expectStatus(await f.api(other, 'GET', '/api/v1/auth/status'), 200);
	expectStatus(await f.login(), 200);
	expectStatus(await f.login(candidate), 401);
});

await test('Two password changes verified against the same credential have one transaction winner', async (t) => {
	const firstRelease = gate();
	const secondRelease = gate();
	t.after(() => {
		firstRelease.resolve();
		secondRelease.resolve();
	});
	const f = await fixture(t);
	const first = f.cookie(await f.login());
	const second = f.cookie(await f.login());
	const firstReady = gate();
	const secondReady = gate();
	const hash = ScryptPasswordHasher.prototype.hash;
	t.mock.method(ScryptPasswordHasher.prototype, 'hash', async function (value) {
		const derived = await hash.call(this, value);
		if (value === candidate) {
			firstReady.resolve();
			await firstRelease.promise;
		}
		if (value === alternate) {
			secondReady.resolve();
			await secondRelease.promise;
		}
		return derived;
	});
	const one = f.api(first, 'PUT', '/api/v1/auth/password', { currentPassword: password, newPassword: candidate });
	const two = f.api(second, 'PUT', '/api/v1/auth/password', { currentPassword: password, newPassword: alternate });
	await Promise.all([firstReady.promise, secondReady.promise]);
	firstRelease.resolve();
	expectStatus(await one, 200);
	secondRelease.resolve();
	const loser = await two;
	expectStatus(loser, 409);
	assert.deepEqual(loser.body, { code: 'conflict' });
	for (const cookie of [first, second]) {
		expectStatus(await f.api(cookie, 'GET', '/api/v1/auth/status'), 401);
	}
	expectStatus(await f.login(candidate), 200);
	expectStatus(await f.login(), 401);
	expectStatus(await f.login(alternate), 401);
});

await test('A login with an actual old password verification cannot issue a session after concurrent credential change', async (t) => {
	const release = gate();
	t.after(() => release.resolve());
	const f = await fixture(t);
	const owner = f.cookie(await f.login());
	const entered = gate();
	const verify = ScryptPasswordHasher.prototype.verify;
	let held = false;
	t.mock.method(ScryptPasswordHasher.prototype, 'verify', async function (value, encoded) {
		const accepted = await verify.call(this, value, encoded);
		if (!held && value === password) {
			held = true;
			entered.resolve();
			await release.promise;
		}
		return accepted;
	});
	const pending = f.login();
	await entered.promise;
	expectStatus(
		await f.api(owner, 'PUT', '/api/v1/auth/password', { currentPassword: password, newPassword: candidate }),
		200,
	);
	release.resolve();
	const response = await pending;
	expectStatus(response, 401);
	assert.deepEqual(response.body, { code: 'invalid_credentials' });
	assert.equal(
		(response.headers['set-cookie'] ?? []).some((value) => /^nexus_session=[^;]/u.test(value)),
		false,
	);
	expectStatus(await f.api(owner, 'GET', '/api/v1/auth/status'), 401);
	expectStatus(await f.login(candidate), 200);
});

for (const boundary of ['captcha', 'password']) {
	await test(
		'A concurrent ban after actual ' + boundary + ' verification prevents late session issuance',
		async (t) => {
			const release = gate();
			t.after(() => release.resolve());
			const requireBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
			const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = requireBackend('undici');
			const previous = getGlobalDispatcher();
			const mock = new MockAgent();
			mock.disableNetConnect();
			setGlobalDispatcher(mock);
			t.after(async () => {
				setGlobalDispatcher(previous);
				await mock.close();
			});
			const config = {
				ipWhitelist: '',
				ipBlacklistEnabled: true,
				maxLoginAttempts: 2,
				loginBanDuration: 300,
				statusMonitorIntervalSeconds: 3,
				remoteHostRefreshIntervalSeconds: 60,
				passkeys: [],
				captcha: {
					enabled: true,
					provider: 'hcaptcha',
					siteKey: 'test-public',
					secretKey: 'test-private',
					expectedHostname: '127.0.0.1',
				},
			};
			const f = await fixture(t, { configuration: () => config });
			const pool = mock.get('https://api.hcaptcha.com');
			let verified = 0;
			pool.intercept({ path: '/siteverify', method: 'POST' })
				.reply(() => {
					verified += 1;
					return { statusCode: 200, data: { success: true, hostname: '127.0.0.1' } };
				})
				.times(4);
			const entered = gate();
			if (boundary === 'captcha') {
				const verify = CaptchaService.prototype.verify;
				t.mock.method(CaptchaService.prototype, 'verify', async function (token, ...args) {
					const accepted = await verify.call(this, token, ...args);
					if (token === 'held') {
						assert.equal(accepted, true);
						entered.resolve();
						await release.promise;
					}
					return accepted;
				});
			} else {
				const verify = ScryptPasswordHasher.prototype.verify;
				let held = false;
				t.mock.method(ScryptPasswordHasher.prototype, 'verify', async function (value, encoded) {
					const accepted = await verify.call(this, value, encoded);
					if (!held && value === password) {
						held = true;
						assert.equal(accepted, true);
						entered.resolve();
						await release.promise;
					}
					return accepted;
				});
			}

			const login = (value, token, source) =>
				f.api(
					'',
					'POST',
					'/api/v1/auth/login',
					{
						username: 'admin',
						password: value,
						rememberMe: false,
						captchaToken: token,
					},
					{ 'X-Forwarded-For': source },
				);

			const source = '8.8.4.4';
			const pending = login(password, 'held', source);
			await entered.promise;
			for (let index = 0; index < 2; index += 1) {
				expectStatus(await login('incorrect-password', 'bad-' + index, source), 401);
			}
			release.resolve();
			const late = await pending;
			expectStatus(late, 429);
			assert.deepEqual(late.body, { code: 'rate_limited' });
			assert.equal(
				(late.headers['set-cookie'] ?? []).some((value) => /^nexus_session=[^;]/u.test(value)),
				false,
			);
			const denied = await login(password, 'not-dispatched', source);
			expectStatus(denied, 429);
			assert.equal(verified, 3, 'banned admission never dispatches another provider verification');
			expectStatus(await login(password, 'independent-source', '8.8.8.8'), 200);
			mock.assertNoPendingInterceptors();
		},
	);
}
