import { test, expect } from 'vitest';
import { readOidcEnvironment } from '../../../../../packages/backend/src/bootstrap/oidc-environment.ts';
import { StartupConfigurationFailure } from '../../../../../packages/backend/src/bootstrap/startup-configuration-failure.ts';

const configured = {
	NEXUS_OIDC_ISSUER: 'https://id.example.com',
	NEXUS_OIDC_CLIENT_ID: 'nexus',
	NEXUS_OIDC_CLIENT_SECRET: ' secret$with spaces ',
};

test('absent and empty Compose OIDC variables leave database settings in charge', () => {
	expect(readOidcEnvironment({})).toBeUndefined();
	expect(
		readOidcEnvironment({ NEXUS_OIDC_ISSUER: '', NEXUS_OIDC_CLIENT_ID: '', NEXUS_OIDC_CLIENT_SECRET: '' }),
	).toBeUndefined();
});

test('OIDC deployment preserves exact credentials and subject, with optional label and authentication', () => {
	expect(readOidcEnvironment(configured)).toEqual({
		issuer: configured.NEXUS_OIDC_ISSUER,
		clientId: 'nexus',
		clientSecret: configured.NEXUS_OIDC_CLIENT_SECRET,
		clientAuthentication: 'client_secret_basic',
		label: 'Pocket ID',
		subject: null,
	});
	expect(
		readOidcEnvironment({
			...configured,
			NEXUS_OIDC_CLIENT_AUTHENTICATION: 'client_secret_post',
			NEXUS_OIDC_LABEL: ' Company ',
			NEXUS_OIDC_SUBJECT: 'subject with spaces',
		}),
	).toMatchObject({ label: 'Company', subject: 'subject with spaces', clientAuthentication: 'client_secret_post' });
	expect(
		readOidcEnvironment({ ...configured, NEXUS_OIDC_CLIENT_AUTHENTICATION: 'none', NEXUS_OIDC_CLIENT_SECRET: '' }),
	).toMatchObject({ clientAuthentication: 'none', clientSecret: null });
});

for (const [environment, setting] of [
	[{ NEXUS_OIDC_CLIENT_ID: 'nexus' }, 'NEXUS_OIDC_ISSUER'],
	[{ ...configured, NEXUS_OIDC_CLIENT_ID: '' }, 'NEXUS_OIDC_CLIENT_ID'],
	[{ ...configured, NEXUS_OIDC_CLIENT_SECRET: '' }, 'NEXUS_OIDC_CLIENT_SECRET'],
	[{ ...configured, NEXUS_OIDC_CLIENT_AUTHENTICATION: 'password' }, 'NEXUS_OIDC_CLIENT_AUTHENTICATION'],
	[{ ...configured, NEXUS_OIDC_CLIENT_AUTHENTICATION: 'none' }, 'NEXUS_OIDC_CLIENT_SECRET'],
	[{ ...configured, NEXUS_OIDC_LABEL: ' ' }, 'NEXUS_OIDC_LABEL'],
]) {
	test(`invalid OIDC deployment rejects ${setting} without exposing its value`, () => {
		try {
			readOidcEnvironment(environment);
			expect.unreachable();
		} catch (cause) {
			expect(cause).toBeInstanceOf(StartupConfigurationFailure);
			expect(cause.setting).toBe(setting);
			expect(String(cause)).not.toContain(configured.NEXUS_OIDC_CLIENT_SECRET);
		}
	});
}
