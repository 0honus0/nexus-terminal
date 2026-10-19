import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { openManagement } from './management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';
import { SqliteFactorStorage } from '../../../packages/backend/dist/modules/access/factors/adapters/sqlite/factor-sql.js';
import { ACCESS_PARTIAL_SECONDS } from '../../../packages/shared/dist/access/values.js';

// Companion to the unchanged 60-second unified runner: warm real challenges before starting bounded cases.
const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-natural-access-'));
const started = performance.now();
const fixtures = [];
let browser;

function cookie(response) {
	return (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; ');
}

function row(f, sql) {
	const db = new DatabaseSync(f.database, { readOnly: true });
	try {
		return db.prepare(sql).get();
	} finally {
		db.close();
	}
}

function totp(secret) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hmac = createHmac('sha1', key).update(counter).digest();
	return String((hmac.readUInt32BE(hmac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function open(name, options, transport) {
	const root = join(directory, name);
	await mkdir(root);
	const f = await openManagement(root, options, transport);
	fixtures.push(f);
	const login = await f.anonymous('POST', '/api/v1/auth/login', { username: 'admin', password: f.password });
	expectStatus(login, 200);
	return { ...f, full: cookie(login) };
}

async function untilExpiry(expiresAt) {
	while (Date.now() <= expiresAt) await delay(Math.min(1000, expiresAt - Date.now() + 1));
}

try {
	const setup = await open('setup');
	const setupResponse = await setup.api('POST', '/api/v1/auth/2fa/setup', {}, { Cookie: setup.full });
	const setupSecret = expectStatus(setupResponse, 200).secret;
	const setupCookie = setup.full + '; ' + cookie(setupResponse);
	const challenge = row(setup, 'SELECT expires_at FROM access_factor_challenges');
	assert.ok(challenge.expires_at - Date.now() > ACCESS_PARTIAL_SECONDS * 1000 - 3000);

	const pending = await open('pending');
	const response = await pending.api('POST', '/api/v1/auth/2fa/setup', {}, { Cookie: pending.full });
	const secret = expectStatus(response, 200).secret;
	expectStatus(
		await pending.api(
			'POST',
			'/api/v1/auth/2fa/verify',
			{ token: totp(secret) },
			{ Cookie: pending.full + '; ' + cookie(response) },
		),
		200,
	);
	const partial = await pending.anonymous('POST', '/api/v1/auth/login', {
		username: 'admin',
		password: pending.password,
	});
	assert.equal(expectStatus(partial, 200).requiresTwoFactor, true);
	const pendingRow = row(pending, 'SELECT expires_at FROM access_pending_logins');
	const initialSessions = row(pending, 'SELECT count(*) AS count FROM access_sessions').count;

	const server = createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	const origin = 'http://localhost:' + port;
	const passkey = await open(
		'passkey',
		{
			configuration: () => ({
				ipWhitelist: '',
				ipBlacklistEnabled: true,
				maxLoginAttempts: 10,
				loginBanDuration: 300,
				statusMonitorIntervalSeconds: 3,
				remoteHostRefreshIntervalSeconds: 60,
				passkeys: [{ origin, rpId: 'localhost' }],
				captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
			}),
		},
		{ origin, port },
	);
	const requireE2e = createRequire(new URL('../../e2e/package.json', import.meta.url));
	const { chromium } = requireE2e('@playwright/test');
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
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
	const registrationOptions = await passkey.api(
		'POST',
		'/api/v1/auth/passkey/registration-options',
		{},
		{ Cookie: passkey.full },
	);
	const options = expectStatus(registrationOptions, 200);
	const registration = await page.evaluate(
		async (wire) =>
			(
				await navigator.credentials.create({
					publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(wire),
				})
			).toJSON(),
		options,
	);
	expectStatus(
		await passkey.api(
			'POST',
			'/api/v1/auth/passkey/register',
			{ registrationResponse: registration },
			{ Cookie: passkey.full + '; ' + cookie(registrationOptions) },
		),
		201,
	);
	const authOptions = await passkey.anonymous('POST', '/api/v1/auth/passkey/authentication-options', {
		username: 'admin',
	});
	const wire = expectStatus(authOptions, 200);
	const proof = await page.evaluate(
		async (wire) =>
			(
				await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(wire) })
			).toJSON(),
		wire,
	);
	const passkeyRow = row(
		passkey,
		"SELECT expires_at FROM access_factor_challenges WHERE kind='passkey_authentication'",
	);
	const beforeCounter = row(passkey, 'SELECT counter FROM access_passkeys').counter;
	const beforeSessions = row(passkey, 'SELECT count(*) AS count FROM access_sessions').count;
	console.log('Real five-minute challenges issued; warming without clock or TTL changes.');
	const firstExpiry = Math.min(challenge.expires_at, pendingRow.expires_at, passkeyRow.expires_at);
	while (Date.now() < firstExpiry - 3000) await delay(Math.min(1000, firstExpiry - 3000 - Date.now()));
	await test(
		'Natural challenge expiry after actual read, and TOTP/Passkey expiry before original commit',
		{ timeout: 60000 },
		async (t) => {
			const find = SqliteFactorStorage.prototype.findChallenge;
			const completeTotp = SqliteFactorStorage.prototype.completeTotp;
			const completePasskey = SqliteFactorStorage.prototype.completePasskeyLogin;
			let reads = 0;
			let totpCommits = 0;
			let passkeyCommits = 0;
			t.mock.method(SqliteFactorStorage.prototype, 'findChallenge', async function (...args) {
				const record = await find.apply(this, args);
				assert.ok(record && record.expiresAt > Date.now(), 'the real challenge was live when read');
				reads++;
				if (record.kind === 'totp_setup') await untilExpiry(record.expiresAt);
				return record;
			});
			t.mock.method(SqliteFactorStorage.prototype, 'completeTotp', async function (command) {
				totpCommits++;
				assert.ok(pendingRow.expires_at > Date.now());
				await untilExpiry(pendingRow.expires_at);
				return completeTotp.call(this, command);
			});
			t.mock.method(SqliteFactorStorage.prototype, 'completePasskeyLogin', async function (command) {
				passkeyCommits++;
				assert.ok(
					passkeyRow.expires_at > Date.now(),
					'signature verified before the original challenge expired',
				);
				await untilExpiry(passkeyRow.expires_at);
				return completePasskey.call(this, command);
			});
			const results = await Promise.all([
				setup.api('POST', '/api/v1/auth/2fa/verify', { token: totp(setupSecret) }, { Cookie: setupCookie }),
				pending.anonymous(
					'POST',
					'/api/v1/auth/login/2fa',
					{ token: totp(secret) },
					{ Cookie: cookie(partial) },
				),
				passkey.anonymous(
					'POST',
					'/api/v1/auth/passkey/authenticate',
					{ assertionResponse: proof },
					{ Cookie: cookie(authOptions) },
				),
			]);
			for (const result of results) assert.equal(result.status, 401, JSON.stringify(result.body));
			assert.equal(reads, 2);
			assert.equal(totpCommits, 1);
			assert.equal(passkeyCommits, 1);
			assert.equal(row(setup, 'SELECT two_factor_enabled FROM access_accounts').two_factor_enabled, 0);
			assert.equal(row(pending, 'SELECT count(*) AS count FROM access_sessions').count, initialSessions);
			assert.equal(row(passkey, 'SELECT count(*) AS count FROM access_sessions').count, beforeSessions);
			assert.equal(row(passkey, 'SELECT counter FROM access_passkeys').counter, beforeCounter);
		},
	);
	console.log(
		'Natural expiry elapsed including real challenge warmup: ' + Math.round(performance.now() - started) + 'ms',
	);
} finally {
	mock.restoreAll();
	const outcomes = await Promise.allSettled([browser?.close(), ...fixtures.map((f) => f.close())]);
	await rm(directory, { recursive: true, force: true });
	const failures = outcomes.filter((result) => result.status === 'rejected').map((result) => result.reason);
	if (failures.length) throw new AggregateError(failures, 'Natural expiry fixture cleanup failed');
}
