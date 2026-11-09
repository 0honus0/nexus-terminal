import type { AccessRegistrationOptions } from '../modules/access/register.js';
import { StartupConfigurationFailure } from './startup-configuration-failure.js';

/** Empty Compose variables leave database-managed OIDC unchanged. */
export function readOidcEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
): AccessRegistrationOptions['oidc'] {
	const names = [
		'NEXUS_OIDC_ISSUER',
		'NEXUS_OIDC_CLIENT_ID',
		'NEXUS_OIDC_CLIENT_SECRET',
		'NEXUS_OIDC_CLIENT_AUTHENTICATION',
		'NEXUS_OIDC_LABEL',
		'NEXUS_OIDC_SUBJECT',
	];
	if (!names.some((name) => environment[name] !== undefined && environment[name] !== '')) {
		return undefined;
	}

	const required = (name: string): string => {
		const value = environment[name];
		if (value === undefined || value === '') {
			throw new StartupConfigurationFailure(name);
		}
		return value;
	};

	const clientAuthentication = environment.NEXUS_OIDC_CLIENT_AUTHENTICATION || 'client_secret_basic';
	if (
		clientAuthentication !== 'client_secret_basic' &&
		clientAuthentication !== 'client_secret_post' &&
		clientAuthentication !== 'none'
	) {
		throw new StartupConfigurationFailure('NEXUS_OIDC_CLIENT_AUTHENTICATION');
	}
	const secret = environment.NEXUS_OIDC_CLIENT_SECRET;
	if (clientAuthentication === 'none' && secret !== undefined && secret !== '') {
		throw new StartupConfigurationFailure('NEXUS_OIDC_CLIENT_SECRET');
	}
	const issuer = required('NEXUS_OIDC_ISSUER').trim();
	const label = environment.NEXUS_OIDC_LABEL ? required('NEXUS_OIDC_LABEL').trim() : 'Pocket ID';
	if (!issuer) {
		throw new StartupConfigurationFailure('NEXUS_OIDC_ISSUER');
	}
	if (!label) {
		throw new StartupConfigurationFailure('NEXUS_OIDC_LABEL');
	}
	return {
		issuer,
		clientId: required('NEXUS_OIDC_CLIENT_ID'),
		clientAuthentication,
		clientSecret: clientAuthentication === 'none' ? null : required('NEXUS_OIDC_CLIENT_SECRET'),
		label,
		subject: environment.NEXUS_OIDC_SUBJECT ? required('NEXUS_OIDC_SUBJECT') : null,
	};
}
