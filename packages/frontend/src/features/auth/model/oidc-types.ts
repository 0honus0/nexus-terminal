import type { OidcClientAuthentication } from '@nexus-terminal/shared/access/oidc/values';

export interface OidcSettings {
	revision: string | null;
	enabled: boolean;
	label: string;
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	hasSecret: boolean;
	bound: boolean;
	callbackUrl: string;
}

export interface OidcSettingsChange {
	revision: string | null;
	enabled: boolean;
	label: string;
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	secret: { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
	password: string;
}

export interface OidcCallback {
	code: string | null;
	state: string;
	issuer: string | null;
	error: string | null;
}
