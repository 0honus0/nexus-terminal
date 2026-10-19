import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { deliverAccessResult } from '../../../packages/backend/dist/modules/access/interfaces/http/access-delivery.js';
import { openManagement } from './management-fixture.mjs';
import { interruptAccessResponse, responseTokenDigest } from './access-delivery-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
import {
	ACCESS_SESSION_COOKIE_NAME,
	ACCESS_PARTIAL_COOKIE_NAME,
	ACCESS_TOTP_SETUP_COOKIE_NAME,
	ACCESS_CHALLENGE_COOKIE_NAME,
} from '../../../packages/shared/dist/access/values.js';

function totp(secret) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const key = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hmac = createHmac('sha1', key).update(counter).digest();
	return String((hmac.readUInt32BE(hmac.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}

for (const stage of ['send', 'close', 'late_issue']) {
	await test(
		'Access ' + stage + ' failure retains revocation cause and releases every transport listener',
		async () => {
			const request = Object.assign(new EventEmitter(), { aborted: false });
			const socket = Object.assign(new EventEmitter(), { destroyed: false });
			const response = Object.assign(new EventEmitter(), { destroyed: false, socket });
			const cleanupFailure = new Error('Controlled credential revocation failure');
			const sendFailure = new Error('Controlled delivery failure');
			let revocations = 0;
			let issuedSignal;
			const result = deliverAccessResult(
				{ request, response },
				async (signal) => {
					issuedSignal = signal;
					if (stage === 'late_issue') {
						request.aborted = true;
						request.emit('aborted');
					}
					return 'issued-token';
				},
				() => {
					if (stage === 'send') throw sendFailure;
					response.destroyed = true;
					response.emit('close');
				},
				async (value) => {
					assert.equal(value, 'issued-token');
					revocations++;
					throw cleanupFailure;
				},
			);
			await assert.rejects(result, (error) => {
				if (stage === 'send') {
					assert.ok(error instanceof AggregateError);
					assert.strictEqual(error.errors[0], sendFailure);
					assert.strictEqual(error.errors[1].cause, cleanupFailure);
				} else {
					assert.strictEqual(error.cause, cleanupFailure);
					assert.equal(issuedSignal.aborted, true);
				}
				return true;
			});
			assert.equal(revocations, 1);
			for (const emitter of [request, response, socket]) assert.deepEqual(emitter.eventNames(), []);
		},
	);
}

function cookie(response) {
	return (response.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; ');
}

for (const kind of ['password', 'partial', 'totp', 'setup', 'registration-options', 'authentication-options']) {
	await test('Actual ' + kind + ' response disconnect revokes the issued credential before shutdown', async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-access-delivery-'));
		let f;
		try {
			f = await openManagement(directory, {
				configuration: () => ({
					ipWhitelist: '',
					ipBlacklistEnabled: true,
					maxLoginAttempts: 10,
					loginBanDuration: 300,
					statusMonitorIntervalSeconds: 3,
					remoteHostRefreshIntervalSeconds: 60,
					passkeys: [{ origin: 'http://127.0.0.1:0', rpId: '127.0.0.1' }],
					captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
				}),
			});
			const login = { username: 'admin', password: f.password, rememberMe: false };
			const full = cookie(await f.anonymous('POST', '/api/v1/auth/login', login));
			let path = '/api/v1/auth/login';
			let input = login;
			let headers = {};
			let name = ACCESS_SESSION_COOKIE_NAME;
			let table = 'access_sessions';
			if (kind === 'partial' || kind === 'totp') {
				const setup = await f.api('POST', '/api/v1/auth/2fa/setup', {}, { Cookie: full });
				const secret = expectStatus(setup, 200).secret;
				expectStatus(
					await f.api(
						'POST',
						'/api/v1/auth/2fa/verify',
						{ token: totp(secret) },
						{ Cookie: full + '; ' + cookie(setup) },
					),
					200,
				);
				if (kind === 'partial') {
					name = ACCESS_PARTIAL_COOKIE_NAME;
					table = 'access_pending_logins';
				} else {
					const partial = await f.anonymous('POST', path, login);
					assert.equal(expectStatus(partial, 200).requiresTwoFactor, true);
					path = '/api/v1/auth/login/2fa';
					input = { token: totp(secret) };
					headers = { Cookie: cookie(partial) };
				}
			} else if (kind === 'setup' || kind.endsWith('-options')) {
				path = kind === 'setup' ? '/api/v1/auth/2fa/setup' : '/api/v1/auth/passkey/' + kind;
				input = kind === 'authentication-options' ? { username: 'admin' } : {};
				headers = kind === 'authentication-options' ? {} : { Cookie: full };
				name = kind === 'setup' ? ACCESS_TOTP_SETUP_COOKIE_NAME : ACCESS_CHALLENGE_COOKIE_NAME;
				table = 'access_factor_challenges';
			}
			const interrupted = interruptAccessResponse(t, path);
			await assert.rejects(f.anonymous('POST', path, input, headers), { code: 'ECONNRESET' });
			assert.equal(interrupted.count, 1);
			assert.equal(interrupted.delivered, false);
			const digest = responseTokenDigest(interrupted, name);
			await until(
				() => {
					const db = new DatabaseSync(f.database, { readOnly: true });
					try {
						return db
							.prepare('SELECT count(*) AS count FROM ' + table + ' WHERE token_digest=?')
							.get(digest).count;
					} finally {
						db.close();
					}
				},
				(count) => count === 0,
				'issued resource actually revoked',
			);
			expectStatus(await f.api('GET', '/api/v1/auth/status', undefined, { Cookie: full }), 200);
		} finally {
			try {
				await f?.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	});
}
