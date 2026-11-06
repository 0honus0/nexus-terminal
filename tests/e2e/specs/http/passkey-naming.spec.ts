import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_URLS } from '../../support/test-env';
import {
	readPasskeyList,
	readPasskeyRegistrationResponse,
} from '../../../../packages/shared/src/access/factors/passkey-codec';
import type { AccessPasskeyRegistrationOptionsResponse } from '../../../../packages/shared/src/access/factors/http';

const requireBackend = createRequire(path.resolve(__dirname, '../../../../packages/backend/package.json'));
const { isoCBOR } = requireBackend('@simplewebauthn/server/helpers');

// A valid "none" attestation exercises the real verifier, challenge and registration transaction.
// AAGUID is a display hint, so no vendor trust attestation is requested or manufactured here.
function registration(options: AccessPasskeyRegistrationOptionsResponse, aaguid: string) {
	const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
	const jwk = publicKey.export({ format: 'jwk' });
	if (!jwk.x || !jwk.y || !options.rp.id) {
		throw new Error('Missing registration key coordinates or RP ID');
	}
	const key = new Map<number, number | Uint8Array>([
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
	const attestation = new Map<string, unknown>([
		['fmt', 'none'],
		['attStmt', new Map()],
		['authData', authData],
	]);
	return {
		id: id.toString('base64url'),
		rawId: id.toString('base64url'),
		type: 'public-key',
		response: {
			clientDataJSON: Buffer.from(
				JSON.stringify({
					type: 'webauthn.create',
					challenge: options.challenge,
					origin: E2E_URLS.frontendOrigin,
				}),
			).toString('base64url'),
			attestationObject: Buffer.from(isoCBOR.encode(attestation)).toString('base64url'),
			transports: ['internal'],
		},
		clientExtensionResults: {},
	};
}

for (const entry of [
	{ provider: 'Bitwarden', aaguid: 'd548826e-79b4-db40-a3d8-11116f7e8349', name: 'Bitwarden Passkey' },
	{ provider: 'Apple', aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd', name: 'Apple Passwords Passkey' },
	{ provider: 'unknown', aaguid: 'b8c799aa-2e31-41a0-92b1-7d30123ce541', name: null },
	{ provider: 'anonymous', aaguid: '00000000-0000-0000-0000-000000000000', name: null },
]) {
	test(`new ${entry.provider} passkey receives a display name without changing verification`, async ({ request }) => {
		await loginAsInitialAdmin(request);
		const headers = { Origin: E2E_URLS.frontendOrigin };
		const optionsResponse = await request.post('/api/v1/auth/passkey/registration-options', { headers, data: {} });
		expect(optionsResponse.status()).toBe(200);
		const options = readPasskeyRegistrationResponse(await optionsResponse.json());
		expect(options.attestation).toBe('none');
		const credential = registration(options, entry.aaguid);
		const response = await request.post('/api/v1/auth/passkey/register', {
			headers,
			data: { registrationResponse: credential },
		});
		expect(response.status()).toBe(201);
		try {
			const read = async () => {
				const list = await request.get('/api/v1/auth/user/passkeys');
				expect(list.status()).toBe(200);
				return readPasskeyList(await list.json()).find((item) => item.credentialId === credential.id);
			};

			expect(await read()).toMatchObject({ name: entry.name });
			const replay = await request.post('/api/v1/auth/passkey/register', {
				headers,
				data: { registrationResponse: credential },
			});
			expect(replay.status()).toBeGreaterThanOrEqual(400);
			const renamed = await request.put(`/api/v1/auth/user/passkeys/${credential.id}/name`, {
				headers,
				data: { name: 'My portable key' },
			});
			expect(renamed.status()).toBe(200);
			expect(await read()).toMatchObject({ name: 'My portable key' });
		} finally {
			const removed = await request.delete(`/api/v1/auth/user/passkeys/${credential.id}`, { headers });
			expect(removed.status()).toBe(200);
		}
	});
}
