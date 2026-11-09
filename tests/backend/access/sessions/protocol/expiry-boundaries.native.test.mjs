import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { SqliteFactorStorage } from '../../../../../packages/backend/dist/modules/access/factors/adapters/sqlite/factor-sql.js';
import { ACCESS_PARTIAL_SECONDS } from '../../../../../packages/shared/dist/access/values.js';

// Advance only Date at real read/commit barriers. HTTP, signature verification,
// SQLite transactions and resource cleanup remain real; the production TTL is unchanged.
const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'natural-access-'));
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

mock.timers.enable({ apis: ['Date'], now: Date.now() });
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
	const requireE2e = createRequire(new URL('../../../../package.json', import.meta.url));
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

	await test(
		'Challenge expires after actual read, and TOTP/Passkey expire before original commit',
		{ timeout: 60000 },
		async (t) => {
			const find = SqliteFactorStorage.prototype.findChallenge;
			const completeTotp = SqliteFactorStorage.prototype.completeTotp;
			const completePasskey = SqliteFactorStorage.prototype.completePasskeyLogin;
			let reads = 0;
			let totpCommits = 0;
			let passkeyCommits = 0;
			let release;
			const boundary = new Promise((resolve) => {
				release = resolve;
			});
			t.after(() => release());
			t.mock.method(SqliteFactorStorage.prototype, 'findChallenge', async function (...args) {
				const record = await find.apply(this, args);
				assert.ok(record && record.expiresAt > Date.now(), 'the real challenge was live when read');
				reads++;
				if (record.kind === 'totp_setup') await boundary;
				return record;
			});
			t.mock.method(SqliteFactorStorage.prototype, 'completeTotp', async function (command) {
				totpCommits++;
				assert.ok(pendingRow.expires_at > Date.now());
				await boundary;
				return completeTotp.call(this, command);
			});
			t.mock.method(SqliteFactorStorage.prototype, 'completePasskeyLogin', async function (command) {
				passkeyCommits++;
				assert.ok(
					passkeyRow.expires_at > Date.now(),
					'signature verified before the original challenge expired',
				);
				await boundary;
				return completePasskey.call(this, command);
			});
			const results = Promise.all([
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
			// Reach all three genuine boundaries before moving the shared backend clock.
			await Promise.race([
				until(
					() => [reads, totpCommits, passkeyCommits],
					(value) => value[0] === 2 && value[1] === 1 && value[2] === 1,
					'All live authentication read/commit boundaries reached',
					t.signal,
				),
				results.then(() => assert.fail('Authentication completed before the expiry barrier')),
			]);
			mock.timers.tick(
				Math.max(challenge.expires_at, pendingRow.expires_at, passkeyRow.expires_at) - Date.now() + 1,
			);
			release();
			for (const result of await results) assert.equal(result.status, 401, JSON.stringify(result.body));
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
		'Authentication expiry real elapsed with virtual Date: ' + Math.round(performance.now() - started) + 'ms',
	);
} finally {
	mock.restoreAll();
	const outcomes = await Promise.allSettled([
		Promise.resolve().then(() => browser?.close()),
		...fixtures.map((f) => Promise.resolve().then(() => f.close())),
	]);
	// Retain SQLite evidence, including when assertions or resource cleanup fail.
	const failures = outcomes.filter((result) => result.status === 'rejected').map((result) => result.reason);
	mock.timers.reset();
	if (failures.length) throw new AggregateError(failures, 'Authentication expiry fixture cleanup failed');
}
