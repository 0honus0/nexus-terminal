import { test, expect, vi, onTestFinished } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { openOidcProvider } from '../../../../support/protocols/oidc-provider.ts';
import { readOidcEnvironment } from '../../../../../packages/backend/dist/bootstrap/oidc-environment.js';

import { SqliteOidcStorage } from '../../../../../packages/backend/dist/modules/access/oidc/adapters/sqlite/oidc-sql.js';
import { SqliteFactorStorage } from '../../../../../packages/backend/dist/modules/access/factors/adapters/sqlite/factor-sql.js';

const responseCookie = (response) => response.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');

test('environment enables OIDC after initial account setup, preserves sessions on restart, and rejects other subjects', async () => {
	const oidcReads = vi.spyOn(SqliteOidcStorage.prototype, 'readProvider');
	const passkeyReads = vi.spyOn(SqliteFactorStorage.prototype, 'hasPasskeys');
	onTestFinished(() => {
		oidcReads.mockRestore();
		passkeyReads.mockRestore();
	});
	const provider = await openOidcProvider();
	let app;
	try {
		const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'oidc-environment-'));
		const options = {
			oidc: readOidcEnvironment({
				NEXUS_OIDC_ISSUER: provider.issuer,
				NEXUS_OIDC_CLIENT_ID: 'nexus-client',
				NEXUS_OIDC_CLIENT_SECRET: 'oidc-test-secret',
				NEXUS_OIDC_SUBJECT: 'bound-account',
			}),
		};
		app = await openManagement(directory, options);
		const settings = await app.api('GET', '/api/v1/auth/oidc/settings');
		expect(settings.status).toBe(200);
		expect(settings.body).toMatchObject({ bound: true, hasSecret: true });
		expect(JSON.stringify(settings.body)).not.toContain('oidc-test-secret');
		expect((await app.anonymous('GET', '/api/v1/auth/login/options')).body).toMatchObject({
			oidc: { label: 'Pocket ID' },
		});
		const cached = await Promise.all(
			Array.from({ length: 10 }, () => app.anonymous('GET', '/api/v1/auth/login/options')),
		);
		expect(cached.every((response) => response.status === 200 && response.body.oidc?.label === 'Pocket ID')).toBe(
			true,
		);
		expect(oidcReads).toHaveBeenCalledTimes(1);
		expect(passkeyReads).toHaveBeenCalledTimes(1);
		const login = await app.anonymous('POST', '/api/v1/auth/oidc/login/start', { rememberMe: true });
		expect(login.status).toBe(200);
		const finish = await app.anonymous(
			'POST',
			'/api/v1/auth/oidc/login/finish',
			provider.authorize(login.body.authorizationUrl),
			{ Cookie: responseCookie(login) },
		);
		expect(finish.status).toBe(200);
		const cookie = responseCookie(finish);
		expect((await app.anonymous('GET', '/api/v1/auth/status', undefined, { Cookie: cookie })).status).toBe(200);
		await app.restart();
		expect((await app.api('GET', '/api/v1/auth/oidc/settings')).body.revision).toBe(settings.body.revision);
		expect((await app.anonymous('GET', '/api/v1/auth/status', undefined, { Cookie: cookie })).status).toBe(200);
		provider.setSubject('unapproved-account');
		const wrong = await app.anonymous('POST', '/api/v1/auth/oidc/login/start', { rememberMe: false });
		const rejected = await app.anonymous(
			'POST',
			'/api/v1/auth/oidc/login/finish',
			provider.authorize(wrong.body.authorizationUrl),
			{ Cookie: responseCookie(wrong) },
		);
		expect(rejected.status).toBe(401);
		options.oidc.clientSecret = 'rotated-secret';
		await app.restart();
		expect((await app.anonymous('GET', '/api/v1/auth/status', undefined, { Cookie: cookie })).status).toBe(401);
		expect((await app.api('GET', '/api/v1/auth/status')).status).toBe(200);
	} finally {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => app?.close()),
			Promise.resolve().then(() => provider.close()),
		]);
		const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
		if (errors.length) throw new AggregateError(errors, 'OIDC environment fixture cleanup failed');
	}
});
