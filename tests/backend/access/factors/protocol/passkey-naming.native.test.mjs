import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readPasskeyList,
	readPasskeyRegistrationResponse,
} from '../../../../../packages/shared/dist/access/factors/passkey-codec.js';

const requireBackend = createRequire(new URL('../../../../../packages/backend/package.json', import.meta.url));
const { isoCBOR } = requireBackend('@simplewebauthn/server/helpers');
const origin = 'http://127.0.0.1:0';

/** Valid none attestation exercises the actual challenge, verifier and registration transaction. */
function registration(options, aaguid) {
	const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const jwk = publicKey.export({ format: 'jwk' });
	assert.ok(jwk.x && jwk.y && options.rp.id);
	const key = new Map([
		[1, 2],
		[3, -7],
		[-1, 1],
		[-2, Buffer.from(jwk.x, 'base64url')],
		[-3, Buffer.from(jwk.y, 'base64url')],
	]);
	const id = randomBytes(32);
	const length = Buffer.alloc(2);
	length.writeUInt16BE(id.length);
	const authData = Buffer.concat([
		createHash('sha256').update(options.rp.id).digest(),
		Buffer.from([0x45]),
		Buffer.alloc(4),
		Buffer.from(aaguid.replaceAll('-', ''), 'hex'),
		length,
		id,
		isoCBOR.encode(key),
	]);
	return {
		id: id.toString('base64url'),
		rawId: id.toString('base64url'),
		type: 'public-key',
		response: {
			clientDataJSON: Buffer.from(
				JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }),
			).toString('base64url'),
			attestationObject: Buffer.from(
				isoCBOR.encode(
					new Map([
						['fmt', 'none'],
						['attStmt', new Map()],
						['authData', authData],
					]),
				),
			).toString('base64url'),
			transports: ['internal'],
		},
		clientExtensionResults: {},
	};
}

await test('Passkey naming preserves actual registration verification, single use and user rename', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'passkey-naming-'));
	const timing = { setupMs: null, executeMs: null, drainMs: null };
	const started = performance.now();
	const f = await openManagement(root, {
		configuration: () => ({
			ipWhitelist: '',
			ipBlacklistEnabled: true,
			maxLoginAttempts: 5,
			loginBanDuration: 300,
			statusMonitorIntervalSeconds: 3,
			remoteHostRefreshIntervalSeconds: 60,
			passkeys: [{ origin, rpId: '127.0.0.1' }],
			captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
		}),
	});
	timing.setupMs = performance.now() - started;
	const executing = performance.now();
	t.after(async () => {
		timing.executeMs = performance.now() - executing;
		const drain = performance.now();
		try {
			await f.close();
		} finally {
			timing.drainMs = performance.now() - drain;
			await writeFile(join(root, 'timings.json'), JSON.stringify(timing, null, 2));
			t.diagnostic(JSON.stringify(timing));
		}
	});
	for (const entry of [
		{ provider: 'Bitwarden', aaguid: 'd548826e-79b4-db40-a3d8-11116f7e8349', name: 'Bitwarden Passkey' },
		{ provider: 'Apple', aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd', name: 'Apple Passwords Passkey' },
		{ provider: 'unknown', aaguid: 'b8c799aa-2e31-41a0-92b1-7d30123ce541', name: null },
		{ provider: 'anonymous', aaguid: '00000000-0000-0000-0000-000000000000', name: null },
	]) {
		await t.test(entry.provider + ' names are display hints, not verification authority', async () => {
			const prepared = await f.api('POST', '/api/v1/auth/passkey/registration-options', {});
			const options = readPasskeyRegistrationResponse(expectStatus(prepared, 200));
			const challengeCookie = prepared.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
			const headers = { Cookie: f.getSessionCookie() + '; ' + challengeCookie };
			assert.equal(options.attestation, 'none');
			const credential = registration(options, entry.aaguid);
			expectStatus(
				await f.api('POST', '/api/v1/auth/passkey/register', { registrationResponse: credential }, headers),
				201,
			);

			const read = async () =>
				readPasskeyList(expectStatus(await f.api('GET', '/api/v1/auth/user/passkeys'), 200)).find(
					(item) => item.credentialId === credential.id,
				);

			assert.equal((await read()).name, entry.name);
			assert.ok(
				(await f.api('POST', '/api/v1/auth/passkey/register', { registrationResponse: credential }, headers))
					.status >= 400,
			);
			expectStatus(
				await f.api('PUT', '/api/v1/auth/user/passkeys/' + credential.id + '/name', {
					name: 'My portable key',
				}),
				200,
			);
			assert.equal((await read()).name, 'My portable key');
			expectStatus(await f.api('DELETE', '/api/v1/auth/user/passkeys/' + credential.id), 200);
			assert.equal(await read(), undefined);
		});
	}
});
