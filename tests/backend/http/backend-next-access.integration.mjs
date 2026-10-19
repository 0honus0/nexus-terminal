import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ACCESS_SESSION_COOKIE_NAME,
	ACCESS_PARTIAL_COOKIE_NAME,
	ACCESS_TOTP_SETUP_COOKIE_NAME,
	ACCESS_CHALLENGE_COOKIE_NAME,
	ACCESS_REMEMBER_SECONDS,
} from '../../../packages/shared/dist/access/values.js';
import { createApp } from '../../../packages/backend/dist/bootstrap/create-app.js';
import { RfcTotp } from '../../../packages/backend/dist/platform/security/adapters/rfc-totp.js';
import { SqliteFactorStorage } from '../../../packages/backend/dist/modules/access/factors/adapters/sqlite/factor-sql.js';
import { SqliteSessionStorage } from '../../../packages/backend/dist/modules/access/sessions/adapters/sqlite/session-sql.js';
import { FactorService } from '../../../packages/backend/dist/modules/access/factors/service/factor-service.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { NativeWebauthn } from '../../../packages/backend/dist/platform/security/adapters/native-webauthn.js';
import { SecretBox, SecretBoxFailure } from '../../../packages/backend/dist/platform/security/secret-box.js';
import { WebauthnTechnicalFailure } from '../../../packages/backend/dist/platform/security/webauthn-port.js';
import { interruptAccessResponse, responseTokenDigest } from './access-delivery-fixture.mjs';
import { until } from '../remote/openssh-fixture.mjs';

const requireBackend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const requireE2e = createRequire(new URL('../../e2e/package.json', import.meta.url));
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = requireBackend('undici');
const { WebSocket } = requireBackend('ws');
const { chromium } = requireE2e('@playwright/test');
const password = 'b10-access-isolated-password';

function configuration() {
	return {
		ipWhitelist: '',
		ipBlacklistEnabled: true,
		maxLoginAttempts: 2,
		loginBanDuration: 300,
		statusMonitorIntervalSeconds: 3,
		remoteHostRefreshIntervalSeconds: 60,
		passkeys: [],
		captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
	};
}

function client(address, origin, cookie = '', headers = {}) {
	const jar = new Map(
		cookie
			.split('; ')
			.filter(Boolean)
			.map((part) => part.split('=')),
	);
	return {
		get cookie() {
			return [...jar].map(([name, value]) => name + '=' + value).join('; ');
		},

		async send(method, path, body) {
			const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
			const response = await new Promise((resolve, reject) => {
				const req = request(
					'http://' + address + path,
					{
						method,
						headers: {
							Host: new URL(origin).host,
							Origin: origin,
							Cookie: this.cookie,
							...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}),
							...headers,
						},
					},
					(res) => {
						const chunks = [];
						res.on('data', (chunk) => chunks.push(chunk));
						res.on('error', reject);
						res.on('end', () => {
							try {
								resolve({
									status: res.statusCode,
									headers: res.headers,
									body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
								});
							} catch (error) {
								reject(error);
							}
						});
					},
				);
				req.on('error', reject);
				req.setTimeout(15000, () => req.destroy(new Error('Access fixture HTTP deadline')));
				req.end(bytes);
			});
			for (const entry of response.headers['set-cookie'] ?? []) {
				const [name, value] = entry.split(';')[0].split('=');
				if (value) {
					jar.set(name, value);
				} else {
					jar.delete(name);
				}
			}
			return response;
		},
	};
}

function expect(response, status, code) {
	assert.equal(response.status, status, JSON.stringify(response.body));
	if (code !== undefined) {
		assert.deepEqual(response.body, { code });
	}
	return response.body;
}

// Independent RFC 4226/6238 producer; production only receives the six-digit result.
function totp(secret, timestamp = Date.now()) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const key = Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30000)));
	const hmac = createHmac('sha1', key).update(counter).digest();
	return String((hmac.readUInt32BE(hmac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function checkWorkspaceAdmission(address, origin, cookie, source, admitted) {
	const socket = new WebSocket('ws://' + address + '/ws/workspace', {
		origin,
		headers: { Host: new URL(origin).host, Cookie: cookie, 'X-Forwarded-For': source },
	});
	const closed = new Promise((resolve) => socket.once('close', resolve));
	try {
		if (admitted) {
			await once(socket, 'open');
		} else {
			await assert.rejects(once(socket, 'open'), { message: 'Unexpected server response: 401' });
		}
	} finally {
		if (socket.readyState !== WebSocket.CLOSED) {
			socket.close();
		}
		await closed;
	}
}

async function verifyPasskeyConfirmation(
	fault,
	{ guest, signedAssertion, database, credentialId, origin, confirmation, revokeFailure },
) {
	const actor = guest();
	const proof = await signedAssertion(actor);
	const originalCookie = actor.cookie;
	const originalCommit = SqliteFactorStorage.prototype.completePasskeyLogin;
	const originalValidate = SqliteSessionStorage.prototype.validate;
	const originalRevoke = SqliteSessionStorage.prototype.revoke;
	const originalAuthenticate = FactorService.prototype.authenticatePasskey;
	const validationFailure = new SqliteFailure('unavailable');
	const cleanupFailure = new SqliteFailure('unavailable');
	let issued;
	let captured;
	let commits = 0;
	let validations = 0;
	let revocations = 0;
	fault.mock.method(SqliteFactorStorage.prototype, 'completePasskeyLogin', async function (command) {
		const result = await originalCommit.call(this, command);
		assert.equal(result, 'issued');
		issued = command;
		commits += 1;
		if (confirmation === 'commit_unknown') {
			throw new SqliteFailure('commit_unknown');
		}
		return result;
	});
	fault.mock.method(SqliteSessionStorage.prototype, 'validate', async function (digest, now) {
		const record = await originalValidate.call(this, digest, now);
		if (digest !== issued?.tokenDigest) {
			return record;
		}
		assert.ok(record, 'confirmation reads the actually committed Passkey session');
		validations += 1;
		if (confirmation === 'unavailable') {
			throw validationFailure;
		}
		return null;
	});
	fault.mock.method(SqliteSessionStorage.prototype, 'revoke', async function (digest) {
		if (digest !== issued?.tokenDigest) {
			return originalRevoke.call(this, digest);
		}
		revocations += 1;
		if (revokeFailure) {
			throw cleanupFailure;
		}
		return originalRevoke.call(this, digest);
	});
	fault.mock.method(FactorService.prototype, 'authenticatePasskey', async function (...args) {
		try {
			return await originalAuthenticate.apply(this, args);
		} catch (error) {
			captured = error;
			throw error;
		}
	});
	const response = await actor.send('POST', '/api/v1/auth/passkey/authenticate', {
		assertionResponse: proof,
	});
	expect(response, 503, 'operation_unknown');
	assert.equal(actor.cookie.includes(ACCESS_SESSION_COOKIE_NAME + '='), false);
	assert.equal(commits, 1);
	const confirmed = confirmation !== 'commit_unknown';
	assert.equal(validations, confirmed ? 1 : 0);
	assert.equal(revocations, confirmed ? 1 : 0);
	const db = new DatabaseSync(database, { readOnly: true });
	try {
		const session = db
			.prepare('SELECT token_digest FROM access_sessions WHERE token_digest=?')
			.get(issued.tokenDigest);
		assert.equal(Boolean(session), !confirmed || revokeFailure);
		assert.equal(
			db
				.prepare('SELECT token_digest FROM access_factor_challenges WHERE token_digest=?')
				.get(issued.challengeDigest),
			undefined,
		);
		const credential = db.prepare('SELECT counter FROM access_passkeys WHERE credential_id=?').get(credentialId);
		assert.equal(credential.counter, issued.nextCounter);
	} finally {
		db.close();
	}
	assert.equal(captured.code, 'operation_unknown');
	if (revokeFailure) {
		assert.ok(captured.cause instanceof AggregateError);
		assert.equal(captured.cause.errors.length, 2);
		assert.strictEqual(captured.cause.errors[1].cause, cleanupFailure);
	}
	if (confirmation === 'unavailable') {
		const primary = revokeFailure ? captured.cause.errors[0] : captured.cause;
		assert.strictEqual(primary.cause, validationFailure);
	}
	const replay = client(new URL(origin).host, origin, originalCookie);
	expect(
		await replay.send('POST', '/api/v1/auth/passkey/authenticate', {
			assertionResponse: proof,
		}),
		401,
		'invalid_credentials',
	);
	assert.equal(commits, 1);
	assert.equal(revocations, confirmed ? 1 : 0);
}

async function unusedPort() {
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = server.address().port;
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	return port;
}

await test(
	'B10 installed Access factors, proxy source policy and CAPTCHA failure boundaries',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-access-'));
		const applications = [];

		const open = async (name, config = configuration(), options = {}) => {
			const origin = options.origin ?? 'http://127.0.0.1:0';
			const app = await createApp(join(directory, name + '.db'), {
				encryptionKey: randomBytes(32),

				configuration: () => config,
			});
			applications.push(app);
			const address = await app.listenHttp({
				publicOrigin: origin,
				bindHost: '127.0.0.1',
				port: options.port ?? 0,
				trustedProxies: options.trustedProxies ?? ['loopback'],
			});
			const admin = client(address, origin);
			expect(
				await admin.send('POST', '/api/v1/auth/setup', {
					username: 'admin',
					password,
					confirmPassword: password,
				}),
				201,
			);
			return {
				app,
				address,
				origin,
				admin,

				guest: (headers = {}) => client(address, origin, '', headers),
			};
		};

		const login = (actor, rememberMe = false, captchaToken) =>
			actor.send('POST', '/api/v1/auth/login', {
				username: 'admin',
				password,
				rememberMe,
				...(captchaToken === undefined ? {} : { captchaToken }),
			});

		try {
			await t.test(
				'TOTP presentation failure does not create a challenge or downgrade normal authentication',
				async (child) => {
					const { admin } = await open('totp-generate-fault');
					expect(await login(admin), 200);
					child.mock.method(RfcTotp.prototype, 'generate', async () => {
						throw new Error('controlled TOTP presentation failure');
					});
					const response = await admin.send('POST', '/api/v1/auth/2fa/setup', {});
					expect(response, 500, 'internal_failure');
					assert.equal(admin.cookie.includes(ACCESS_TOTP_SETUP_COOKIE_NAME + '='), false);
					assert.equal(
						expect(await admin.send('GET', '/api/v1/auth/status'), 200).user.twoFactorEnabled,
						false,
					);
					child.mock.restoreAll();
					assert.match(
						expect(await admin.send('POST', '/api/v1/auth/2fa/setup', {}), 200).secret,
						/^[A-Z2-7]{32}$/u,
					);
				},
			);

			await t.test(
				'A TOTP verifier exception neither enables the factor nor consumes its original setup',
				async (child) => {
					const { admin } = await open('totp-verify-fault');
					expect(await login(admin), 200);
					const setup = expect(await admin.send('POST', '/api/v1/auth/2fa/setup', {}), 200);
					child.mock.method(RfcTotp.prototype, 'verify', () => {
						throw new Error('controlled TOTP verifier failure');
					});
					expect(
						await admin.send('POST', '/api/v1/auth/2fa/verify', { token: totp(setup.secret) }),
						500,
						'internal_failure',
					);
					assert.equal(
						expect(await admin.send('GET', '/api/v1/auth/status'), 200).user.twoFactorEnabled,
						false,
					);
					child.mock.restoreAll();
					expect(await admin.send('POST', '/api/v1/auth/2fa/verify', { token: totp(setup.secret) }), 200);
					assert.equal(
						expect(await admin.send('GET', '/api/v1/auth/status'), 200).user.twoFactorEnabled,
						true,
					);
				},
			);

			await t.test(
				'A partial-login secret decryption failure never grants a session and leaves the original pending flow recoverable',
				async (child) => {
					const { admin, guest } = await open('totp-decrypt-fault');
					expect(await login(admin), 200);
					const setup = expect(await admin.send('POST', '/api/v1/auth/2fa/setup', {}), 200);
					expect(await admin.send('POST', '/api/v1/auth/2fa/verify', { token: totp(setup.secret) }), 200);
					const partial = guest();
					assert.deepEqual(expect(await login(partial), 200), { requiresTwoFactor: true });
					const cookie = partial.cookie;
					child.mock.method(SecretBox.prototype, 'decrypt', () => {
						throw new SecretBoxFailure('authentication_failed');
					});
					expect(
						await partial.send('POST', '/api/v1/auth/login/2fa', { token: totp(setup.secret) }),
						503,
						'storage_unavailable',
					);
					assert.equal(
						partial.cookie,
						cookie,
						'technical failure cannot substitute a complete authentication cookie',
					);
					expect(await partial.send('GET', '/api/v1/auth/status'), 401, 'unauthenticated');
					child.mock.restoreAll();
					expect(await partial.send('POST', '/api/v1/auth/login/2fa', { token: totp(setup.secret) }), 200);
					expect(await partial.send('GET', '/api/v1/auth/status'), 200);
				},
			);

			for (const operation of ['registration', 'authentication']) {
				await t.test(
					'WebAuthn ' + operation + ' options provider failure stays unavailable without issuing a challenge',
					async (child) => {
						const config = configuration();
						config.passkeys = [{ origin: 'http://127.0.0.1:0', rpId: '127.0.0.1' }];
						const { admin, guest } = await open('passkey-options-' + operation, config);
						expect(await login(admin), 200);
						const actor = operation === 'registration' ? admin : guest();
						const path = '/api/v1/auth/passkey/' + operation + '-options';
						child.mock.method(NativeWebauthn.prototype, operation + 'Options', async () => {
							throw new WebauthnTechnicalFailure(new Error('controlled options provider failure'));
						});
						const response = await actor.send('POST', path, {});
						expect(response, 503, 'factor_unavailable');
						assert.equal(
							(response.headers['set-cookie'] ?? []).some((value) =>
								value.startsWith(ACCESS_CHALLENGE_COOKIE_NAME + '='),
							),
							false,
						);
						if (operation === 'authentication') {
							expect(await actor.send('GET', '/api/v1/auth/status'), 401, 'unauthenticated');
						}
						child.mock.restoreAll();
						expect(await actor.send('POST', path, {}), 200);
					},
				);
			}

			await t.test(
				'TOTP setup binds its login, partial login has no management rights, single consumption and disable',
				async () => {
					assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
					const { admin, guest, address, origin } = await open('totp');
					expect(await login(admin), 200);
					const setup = expect(await admin.send('POST', '/api/v1/auth/2fa/setup', {}), 200);
					assert.match(setup.secret, /^[A-Z2-7]{32}$/u);
					assert.match(setup.qrCodeUrl, /^data:image\/png;base64,/u);
					const other = guest();
					expect(await login(other), 200);
					const stolen = client(
						address,
						origin,
						other.cookie +
							'; ' +
							admin.cookie
								.split('; ')
								.find((part) => part.startsWith(ACCESS_TOTP_SETUP_COOKIE_NAME + '=')),
					);
					expect(
						await stolen.send('POST', '/api/v1/auth/2fa/verify', { token: totp(setup.secret) }),
						401,
						'invalid_credentials',
					);
					expect(await admin.send('POST', '/api/v1/auth/2fa/verify', { token: totp(setup.secret) }), 200);
					assert.equal(
						expect(await admin.send('GET', '/api/v1/auth/status'), 200).user.twoFactorEnabled,
						true,
					);
					const partial = guest();
					const first = await login(partial, true);
					assert.deepEqual(expect(first, 200), { requiresTwoFactor: true });
					assert.ok(partial.cookie.includes(ACCESS_PARTIAL_COOKIE_NAME + '='));
					assert.equal(partial.cookie.includes(ACCESS_SESSION_COOKIE_NAME + '='), false);
					expect(await partial.send('GET', '/api/v1/auth/status'), 401, 'unauthenticated');
					expect(await partial.send('GET', '/api/v1/targets/connections'), 401, 'unauthenticated');
					const oldPartial = partial.cookie;
					expect(await login(partial, true), 200);
					assert.notEqual(partial.cookie, oldPartial);
					expect(
						await client(address, origin, oldPartial).send('POST', '/api/v1/auth/login/2fa', {
							token: totp(setup.secret),
						}),
						401,
					);
					expect(
						await partial.send('POST', '/api/v1/auth/login/2fa', { token: 'abc123' }),
						400,
						'invalid_input',
					);
					const window = [-30000, 0, 30000].map((delta) => totp(setup.secret, Date.now() + delta));
					const invalidCode = ['000000', '000001', '000002', '000003'].find((code) => !window.includes(code));
					expect(
						await partial.send('POST', '/api/v1/auth/login/2fa', { token: invalidCode }),
						401,
						'invalid_credentials',
					);
					const pendingCookie = partial.cookie;
					const contenders = [partial, client(address, origin, pendingCookie)];
					const completions = await Promise.all(
						contenders.map((actor) =>
							actor.send('POST', '/api/v1/auth/login/2fa', { token: totp(setup.secret) }),
						),
					);
					assert.deepEqual(completions.map((response) => response.status).sort(), [200, 401]);
					const winner = completions.findIndex((response) => response.status === 200);
					assert.ok(
						completions[winner].headers['set-cookie'].some(
							(value) =>
								value.startsWith(ACCESS_SESSION_COOKIE_NAME + '=') &&
								value.includes('Max-Age=' + ACCESS_REMEMBER_SECONDS),
						),
					);
					expect(
						await client(address, origin, pendingCookie).send('POST', '/api/v1/auth/login/2fa', {
							token: totp(setup.secret),
						}),
						401,
					);
					expect(await contenders[winner].send('GET', '/api/v1/targets/connections'), 200);
					const logoutPartial = guest();
					expect(await login(logoutPartial), 200);
					const loggedOutCookie = logoutPartial.cookie;
					expect(await logoutPartial.send('POST', '/api/v1/auth/logout', {}), 200);
					expect(
						await client(address, origin, loggedOutCookie).send('POST', '/api/v1/auth/login/2fa', {
							token: totp(setup.secret),
						}),
						401,
					);
					const revokedPartial = guest();
					expect(await login(revokedPartial), 200);
					expect(
						await admin.send('DELETE', '/api/v1/auth/2fa', { password: 'incorrect-password' }),
						401,
						'invalid_credentials',
					);
					expect(await admin.send('DELETE', '/api/v1/auth/2fa', { password }), 200);
					expect(
						await revokedPartial.send('POST', '/api/v1/auth/login/2fa', { token: totp(setup.secret) }),
						401,
					);
					const ordinary = guest();
					assert.equal(expect(await login(ordinary), 200).requiresTwoFactor, false);
					expect(await ordinary.send('GET', '/api/v1/auth/status'), 200);
				},
			);

			await t.test(
				'trusted forwarding applies public whitelist/ban and unban; untrusted forwarding cannot forge source',
				async () => {
					const config = configuration();
					config.ipWhitelist = '8.8.8.0/24';
					const { admin, guest, address, origin } = await open('sources', config);
					expect(await login(admin), 200);
					expect(
						await guest({ 'X-Forwarded-For': '9.9.9.9' }).send('GET', '/not-installed'),
						403,
						'forbidden',
					);
					await checkWorkspaceAdmission(address, origin, admin.cookie, '9.9.9.9', false);
					const publicClient = guest({ 'X-Forwarded-For': '8.8.8.8' });
					for (let i = 0; i < 2; i++) {
						expect(
							await publicClient.send('POST', '/api/v1/auth/login', {
								username: 'admin',
								password: 'wrong-password',
								rememberMe: false,
							}),
							401,
							'invalid_credentials',
						);
					}
					expect(await login(publicClient), 429, 'rate_limited');
					await checkWorkspaceAdmission(address, origin, admin.cookie, '8.8.8.8', false);
					expect(await publicClient.send('GET', '/api/v1/targets/connections'), 403, 'forbidden');
					const rows = expect(
						await admin.send('GET', '/api/v1/settings/ip-blacklist?limit=50&offset=0'),
						200,
					);
					assert.equal(rows.entries.find((entry) => entry.ip === '8.8.8.8')?.attempts, 2);
					assert.ok(rows.entries.find((entry) => entry.ip === '8.8.8.8')?.blockedUntil > Date.now() / 1000);
					assert.deepEqual(
						expect(await admin.send('DELETE', '/api/v1/settings/ip-blacklist', { ip: '8.8.8.8' }), 200),
						{ removed: true },
					);
					expect(await login(publicClient), 200);
					expect(await publicClient.send('GET', '/api/v1/targets/connections'), 200);
					await checkWorkspaceAdmission(address, origin, admin.cookie, '8.8.8.8', true);
					expect(await login(guest({ 'X-Forwarded-For': '192.168.1.15' })), 200);
					const untrusted = await open('untrusted-source', config, { trustedProxies: [] });
					const forged = untrusted.guest({ 'X-Forwarded-For': '9.9.9.9' });
					expect(await login(forged), 200);
				},
			);

			await t.test(
				'CAPTCHA real fetch encoder/decoder: hostname, malformed/oversized/non-2xx and provider refusal fail closed',
				async () => {
					const previous = getGlobalDispatcher();
					const mock = new MockAgent();
					mock.disableNetConnect();
					setGlobalDispatcher(mock);
					try {
						const config = configuration();
						config.captcha = {
							enabled: true,
							provider: 'hcaptcha',
							siteKey: 'b10-public-site',
							secretKey: 'b10-private-secret',
							expectedHostname: '127.0.0.1',
						};
						const { guest } = await open('captcha', config);
						const actor = guest();
						const visible = expect(await actor.send('GET', '/api/v1/auth/captcha/config'), 200);
						assert.equal(JSON.stringify(visible).includes('b10-private-secret'), false);
						expect(await login(actor), 400, 'invalid_input');
						const pool = mock.get('https://api.hcaptcha.com');
						const calls = [];

						const reply = (status, body) =>
							pool
								.intercept({
									path: '/siteverify',
									method: 'POST',
								})
								.reply((options) => {
									calls.push(new URLSearchParams(options.body));
									return { statusCode: status, data: body };
								});

						reply(200, { success: false });
						expect(await login(actor, false, 'refused'), 401, 'captcha_invalid');
						reply(200, { success: true, hostname: 'another.example' });
						expect(await login(actor, false, 'wrong-host'), 401, 'captcha_invalid');
						for (const [status, body] of [
							[200, 'invalid-json'],
							[200, { success: 'true' }],
							[200, 'x'.repeat(16385)],
							[503, 'upstream unavailable'],
						]) {
							reply(status, body);
							expect(await login(actor, false, 'unavailable'), 503, 'captcha_unavailable');
						}
						reply(200, { success: true, hostname: '127.0.0.1' });
						expect(await login(actor, false, 'accepted'), 200);
						expect(await actor.send('GET', '/api/v1/auth/status'), 200);
						assert.equal(calls.length, 7);
						assert.ok(
							calls.every(
								(form) =>
									form.get('secret') === 'b10-private-secret' &&
									form.get('sitekey') === 'b10-public-site' &&
									form.get('remoteip') === '127.0.0.1',
							),
						);
						const faultActor = guest({ 'X-Forwarded-For': '8.8.4.4' });
						for (let i = 0; i < 3; i++) {
							pool.intercept({ path: '/siteverify', method: 'POST' }).replyWithError(
								new Error('fixture provider unavailable'),
							);
							expect(await login(faultActor, false, 'network-fault'), 503, 'captcha_unavailable');
						}
						assert.equal(
							expect(
								await actor.send('GET', '/api/v1/settings/ip-blacklist?limit=50&offset=0'),
								200,
							).entries.some((entry) => entry.ip === '8.8.4.4'),
							false,
						);
						const recaptchaConfig = configuration();
						recaptchaConfig.captcha = {
							enabled: true,
							provider: 'recaptcha',
							siteKey: 'b10-google-public',
							secretKey: 'b10-google-private',
							expectedHostname: '127.0.0.1',
						};
						const googleActor = (await open('recaptcha', recaptchaConfig)).guest();
						const google = mock.get('https://www.google.com');
						for (const extra of [{ score: 0.99 }, { action: 'login' }]) {
							google
								.intercept({ path: '/recaptcha/api/siteverify', method: 'POST' })
								.reply(200, { success: true, hostname: '127.0.0.1', ...extra });
							expect(await login(googleActor, false, 'v3-token'), 401, 'captcha_invalid');
						}
						google
							.intercept({
								path: '/recaptcha/api/siteverify',
								method: 'POST',

								body: (value) => {
									const form = new URLSearchParams(value);
									return (
										form.get('secret') === 'b10-google-private' &&
										form.get('response') === 'v2-token' &&
										!form.has('sitekey')
									);
								},
							})
							.reply(200, { success: true, hostname: '127.0.0.1' });
						expect(await login(googleActor, false, 'v2-token'), 200);
						mock.assertNoPendingInterceptors();
					} finally {
						setGlobalDispatcher(previous);
						await mock.close();
					}
				},
			);

			await t.test(
				'Chromium virtual authenticator registers, signs in and manages a real verified Passkey',
				async (passkey) => {
					const port = await unusedPort();
					const origin = 'http://localhost:' + port;
					const config = configuration();
					config.passkeys = [{ origin, rpId: 'localhost' }];
					const { admin, guest } = await open('passkeys', config, { origin, port });
					expect(await login(admin), 200);
					const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
					try {
						t.diagnostic('Passkey virtual authenticator Chromium ' + browser.version());
						const context = await browser.newContext();
						const page = await context.newPage();
						const cdp = await context.newCDPSession(page);
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
						await page.goto(origin + '/api/v1/auth/status');
						const options = expect(
							await admin.send('POST', '/api/v1/auth/passkey/registration-options', {}),
							200,
						);
						assert.equal(options.authenticatorSelection.userVerification, 'required');
						const registration = await page.evaluate(async (wire) => {
							const key = PublicKeyCredential.parseCreationOptionsFromJSON(wire);
							return (await navigator.credentials.create({ publicKey: key })).toJSON();
						}, options);
						assert.deepEqual(
							expect(
								await admin.send('POST', '/api/v1/auth/passkey/register', {
									registrationResponse: registration,
								}),
								201,
							),
							{ verified: true },
						);
						const stored = expect(await admin.send('GET', '/api/v1/auth/user/passkeys'), 200);
						assert.equal(stored.length, 1);
						assert.equal(stored[0].credentialId, registration.id);
						assert.equal(Object.hasOwn(stored[0], 'publicKey'), false);

						const signedAssertion = async (actor) => {
							const wire = expect(
								await actor.send('POST', '/api/v1/auth/passkey/authentication-options', {
									username: 'admin',
								}),
								200,
							);
							assert.equal(wire.userVerification, 'required');
							return page.evaluate(
								async (options) =>
									(
										await navigator.credentials.get({
											publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
										})
									).toJSON(),
								wire,
							);
						};

						const anonymous = guest();
						const assertion = await signedAssertion(anonymous);
						await passkey.test(
							'An actual vendor signature verification outage grants no identity and preserves the original challenge',
							async (fault) => {
								const originalCookie = anonymous.cookie;
								let verificationCalls = 0;
								fault.mock.method(webcrypto.subtle, 'verify', async () => {
									verificationCalls += 1;
									throw new Error('controlled cryptographic provider outage');
								});
								expect(
									await anonymous.send('POST', '/api/v1/auth/passkey/authenticate', {
										assertionResponse: assertion,
									}),
									503,
									'factor_unavailable',
								);
								assert.equal(
									verificationCalls,
									1,
									'Real NativeWebauthn and vendor verifier reached the cryptographic provider',
								);
								assert.equal(anonymous.cookie, originalCookie);
								expect(await anonymous.send('GET', '/api/v1/auth/status'), 401, 'unauthenticated');
							},
						);
						const staleCookie = anonymous.cookie;
						expect(
							await anonymous.send('POST', '/api/v1/auth/passkey/authenticate', {
								assertionResponse: assertion,
								rememberMe: true,
							}),
							200,
						);
						expect(await anonymous.send('GET', '/api/v1/auth/status'), 200);
						const replay = client(new URL(origin).host, origin, staleCookie);
						expect(
							await replay.send('POST', '/api/v1/auth/passkey/authenticate', {
								assertionResponse: assertion,
							}),
							401,
						);
						for (const kind of ['origin', 'challenge', 'rp', 'uv', 'signature']) {
							const rejected = guest();
							const proof = await signedAssertion(rejected);
							if (kind === 'origin' || kind === 'challenge') {
								const data = JSON.parse(
									Buffer.from(proof.response.clientDataJSON, 'base64url').toString('utf8'),
								);
								data[kind] = kind === 'origin' ? 'https://untrusted.example' : 'unrelated-challenge';
								proof.response.clientDataJSON = Buffer.from(JSON.stringify(data)).toString('base64url');
							} else {
								const field = kind === 'signature' ? 'signature' : 'authenticatorData';
								const bytes = Buffer.from(proof.response[field], 'base64url');
								if (kind === 'rp') {
									bytes[0] ^= 1;
								} else if (kind === 'uv') {
									bytes[32] &= ~4;
								} else {
									bytes[bytes.length - 1] ^= 1;
								}
								proof.response[field] = bytes.toString('base64url');
							}
							expect(
								await rejected.send('POST', '/api/v1/auth/passkey/authenticate', {
									assertionResponse: proof,
								}),
								401,
								'invalid_credentials',
							);
							expect(await rejected.send('GET', '/api/v1/auth/status'), 401, 'unauthenticated');
						}
						const replaced = guest();
						const superseded = await signedAssertion(replaced);
						await signedAssertion(replaced);
						expect(
							await replaced.send('POST', '/api/v1/auth/passkey/authenticate', {
								assertionResponse: superseded,
							}),
							401,
							'invalid_credentials',
						);
						const healthy = guest();
						expect(
							await healthy.send('POST', '/api/v1/auth/passkey/authenticate', {
								assertionResponse: await signedAssertion(healthy),
							}),
							200,
						);
						for (const confirmation of ['commit_unknown', 'missing', 'unavailable']) {
							const revocationCases = confirmation === 'commit_unknown' ? [false] : [false, true];
							for (const revokeFailure of revocationCases) {
								await passkey.test(
									'Actual Passkey ' + confirmation + ', revoke failure=' + revokeFailure,
									(fault) =>
										verifyPasskeyConfirmation(fault, {
											guest,
											signedAssertion,
											database: join(directory, 'passkeys.db'),
											credentialId: registration.id,
											origin,
											confirmation,
											revokeFailure,
										}),
								);
							}
						}
						await passkey.test(
							'Actual signed Passkey completion interrupted before HTTP finish revokes its session',
							async (fault) => {
								const actor = guest();
								const proof = await signedAssertion(actor);
								const interrupted = interruptAccessResponse(fault, '/api/v1/auth/passkey/authenticate');
								await assert.rejects(
									actor.send('POST', '/api/v1/auth/passkey/authenticate', {
										assertionResponse: proof,
									}),
									{ code: 'ECONNRESET' },
								);
								const digest = responseTokenDigest(interrupted, ACCESS_SESSION_COOKIE_NAME);
								await until(
									() => {
										const db = new DatabaseSync(join(directory, 'passkeys.db'), { readOnly: true });
										try {
											return db
												.prepare(
													'SELECT count(*) AS count FROM access_sessions WHERE token_digest=?',
												)
												.get(digest).count;
										} finally {
											db.close();
										}
									},
									(count) => count === 0,
									'undelivered Passkey session revoked',
								);
								assert.equal(interrupted.body.verified, true);
								expect(
									await actor.send('POST', '/api/v1/auth/passkey/authenticate', {
										assertionResponse: proof,
									}),
									401,
								);
							},
						);
						const refreshed = expect(await admin.send('GET', '/api/v1/auth/user/passkeys'), 200)[0];
						assert.ok(refreshed.lastUsedAt >= refreshed.createdAt);
						assert.equal(Object.hasOwn(refreshed, 'counter'), false);
						expect(
							await admin.send('PUT', '/api/v1/auth/user/passkeys/' + registration.id + '/name', {
								name: 'B10 verified device',
							}),
							200,
						);
						assert.equal(
							expect(await admin.send('GET', '/api/v1/auth/user/passkeys'), 200)[0].name,
							'B10 verified device',
						);
						expect(await admin.send('DELETE', '/api/v1/auth/user/passkeys/' + registration.id), 200);
						assert.deepEqual(expect(await admin.send('GET', '/api/v1/auth/user/passkeys'), 200), []);
					} finally {
						await browser.close();
					}
				},
			);
		} finally {
			const outcomes = await Promise.allSettled(applications.map((app) => app.close()));
			try {
				await rm(directory, { recursive: true, force: true });
			} catch (reason) {
				outcomes.push({ status: 'rejected', reason });
			}
			const failures = outcomes
				.filter((outcome) => outcome.status === 'rejected')
				.map((outcome) => outcome.reason);
			if (failures.length) {
				throw new AggregateError(failures, 'Access fixture cleanup failed');
			}
		}
	},
);
