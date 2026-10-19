import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from './management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';
import { SqliteFactorStorage } from '../../../packages/backend/dist/modules/access/factors/adapters/sqlite/factor-sql.js';
import { SqliteSessionStorage } from '../../../packages/backend/dist/modules/access/sessions/adapters/sqlite/session-sql.js';
import { FactorService } from '../../../packages/backend/dist/modules/access/factors/service/factor-service.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '../../../packages/shared/dist/access/values.js';

function totpCode(secret) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hmac = createHmac('sha1', key).update(counter).digest();
	return String((hmac.readUInt32BE(hmac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

function cookies(response) {
	return (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; ');
}

function hasFullCookie(response) {
	return (response.headers['set-cookie'] ?? []).some(
		(value) =>
			value.startsWith(ACCESS_SESSION_COOKIE_NAME + '=') && !value.startsWith(ACCESS_SESSION_COOKIE_NAME + '=;'),
	);
}

function containsCause(error, cause) {
	return (
		error === cause ||
		(error?.cause && containsCause(error.cause, cause)) ||
		(error instanceof AggregateError && error.errors.some((value) => containsCause(value, cause)))
	);
}

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-factor-confirmation-'));
	let f;
	t.after(async () => {
		try {
			await f?.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	f = await openManagement(directory);
	const adminLogin = await f.api('POST', '/api/v1/auth/login', {
		username: 'admin',
		password: f.password,
		rememberMe: false,
	});
	expectStatus(adminLogin, 200);
	const adminCookie = cookies(adminLogin);
	const setup = await f.api('POST', '/api/v1/auth/2fa/setup', {}, { Cookie: adminCookie });
	const secret = expectStatus(setup, 200).secret;
	const setupCookie = adminCookie + '; ' + cookies(setup);

	const login = () =>
		f.anonymous('POST', '/api/v1/auth/login', { username: 'admin', password: f.password, rememberMe: false });

	const verify = () => f.api('POST', '/api/v1/auth/2fa/verify', { token: totpCode(secret) }, { Cookie: setupCookie });

	function row(sql, ...args) {
		const db = new DatabaseSync(f.database, { readOnly: true });
		try {
			return db.prepare(sql).get(...args);
		} finally {
			db.close();
		}
	}

	async function enable() {
		expectStatus(await verify(), 200);
	}

	async function partial() {
		const response = await login();
		assert.equal(expectStatus(response, 200).requiresTwoFactor, true);
		return cookies(response);
	}

	const complete = (partialCookie) =>
		f.anonymous('POST', '/api/v1/auth/login/2fa', { token: totpCode(secret) }, { Cookie: partialCookie });

	return { client: f, verify, enable, partial, complete, row, login, adminCookie };
}

for (const operation of ['enableTotp', 'disableTotp']) {
	await test('Actual ' + operation + ' commit loses confirmation without replay', async (t) => {
		const f = await fixture(t);
		if (operation === 'disableTotp') {
			await f.enable();
		}
		const original = SqliteFactorStorage.prototype[operation];
		const failure = new SqliteFailure('commit_unknown');
		let calls = 0;
		t.mock.method(SqliteFactorStorage.prototype, operation, async function (command) {
			const result = await original.call(this, command);
			assert.equal(result, true);
			calls++;
			throw failure;
		});
		let result;
		if (operation === 'enableTotp') {
			result = await f.verify();
		} else {
			result = await f.client.api(
				'DELETE',
				'/api/v1/auth/2fa',
				{ password: f.client.password },
				{
					Cookie: f.adminCookie,
				},
			);
		}
		assert.deepEqual(expectStatus(result, 503), { code: 'operation_unknown' });
		assert.equal(calls, 1);
		assert.equal(
			f.row('SELECT two_factor_enabled FROM access_accounts WHERE id=1').two_factor_enabled,
			operation === 'enableTotp' ? 1 : 0,
		);
		const login = await f.login();
		expectStatus(login, 200);
		assert.equal(login.body.requiresTwoFactor === true, operation === 'enableTotp');
	});
}

await test('Actual factor session commit unknown consumes original partial but never publishes a full cookie', async (t) => {
	const f = await fixture(t);
	await f.enable();
	const partial = await f.partial();
	const original = SqliteFactorStorage.prototype.completeTotp;
	let issued;
	let calls = 0;
	t.mock.method(SqliteFactorStorage.prototype, 'completeTotp', async function (command) {
		const result = await original.call(this, command);
		assert.equal(result, 'issued');
		issued = command;
		calls++;
		throw new SqliteFailure('commit_unknown');
	});
	const response = await f.complete(partial);
	assert.deepEqual(expectStatus(response, 503), { code: 'operation_unknown' });
	assert.equal(hasFullCookie(response), false);
	assert.equal(calls, 1);
	assert.ok(f.row('SELECT token_digest FROM access_sessions WHERE token_digest=?', issued.tokenDigest));
	assert.equal(
		f.row('SELECT token_digest FROM access_pending_logins WHERE token_digest=?', issued.pendingDigest),
		undefined,
	);
	expectStatus(await f.complete(partial), 401);
	assert.equal(calls, 1, 'same partial never commits again');
});

for (const confirmation of ['missing', 'unavailable']) {
	for (const revokeFailure of [false, true]) {
		await test(
			'Committed factor identity ' + confirmation + ' and revocation ' + (revokeFailure ? 'failure' : 'success'),
			async (t) => {
				const f = await fixture(t);
				await f.enable();
				const partial = await f.partial();
				const originalCommit = SqliteFactorStorage.prototype.completeTotp;
				const originalValidate = SqliteSessionStorage.prototype.validate;
				const originalRevoke = SqliteSessionStorage.prototype.revoke;
				const originalLogin = FactorService.prototype.loginTotp;
				const validationFailure = new SqliteFailure('unavailable');
				const cleanupFailure = new SqliteFailure('unavailable');
				let issued;
				let captured;
				let validationCalls = 0;
				let revokeCalls = 0;
				t.mock.method(SqliteFactorStorage.prototype, 'completeTotp', async function (command) {
					const result = await originalCommit.call(this, command);
					assert.equal(result, 'issued');
					issued = command;
					return result;
				});
				t.mock.method(SqliteSessionStorage.prototype, 'validate', async function (digest, now) {
					const record = await originalValidate.call(this, digest, now);
					if (digest !== issued?.tokenDigest) {
						return record;
					}
					assert.ok(record, 'confirmation reaches actual committed SQLite session');
					validationCalls++;
					if (confirmation === 'unavailable') {
						throw validationFailure;
					}
					return null;
				});
				t.mock.method(SqliteSessionStorage.prototype, 'revoke', async function (digest) {
					if (digest !== issued?.tokenDigest) {
						return originalRevoke.call(this, digest);
					}
					revokeCalls++;
					if (revokeFailure) {
						throw cleanupFailure;
					}
					await originalRevoke.call(this, digest);
				});
				t.mock.method(FactorService.prototype, 'loginTotp', async function (...args) {
					try {
						return await originalLogin.apply(this, args);
					} catch (error) {
						captured = error;
						throw error;
					}
				});
				const response = await f.complete(partial);
				assert.deepEqual(expectStatus(response, 503), { code: 'operation_unknown' });
				assert.equal(hasFullCookie(response), false);
				assert.equal(validationCalls, 1);
				assert.equal(revokeCalls, 1);
				const row = f.row('SELECT token_digest FROM access_sessions WHERE token_digest=?', issued.tokenDigest);
				assert.equal(Boolean(row), revokeFailure);
				assert.equal(
					f.row('SELECT token_digest FROM access_pending_logins WHERE token_digest=?', issued.pendingDigest),
					undefined,
				);
				assert.equal(captured.code, 'operation_unknown');
				if (confirmation === 'unavailable') {
					assert.ok(containsCause(captured, validationFailure));
				}
				if (revokeFailure) {
					assert.ok(captured.cause instanceof AggregateError);
					assert.equal(captured.cause.errors.length, 2);
					assert.ok(containsCause(captured, cleanupFailure));
				}
				expectStatus(await f.complete(partial), 401);
				assert.equal(validationCalls, 1);
				assert.equal(revokeCalls, 1);
			},
		);
	}
}
