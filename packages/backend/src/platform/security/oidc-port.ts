import type { OidcClientAuthentication } from '@nexus-terminal/shared/access/oidc/values';

export interface OidcClientConfiguration {
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	clientSecret: string | null;
}

export interface OidcAuthorization {
	redirectUri: string;
	verifier: string;
	state: string;
	nonce: string;
}

export interface OidcAuthorizationResponse {
	code: string | null;
	state: string;
	issuer: string | null;
	error: string | null;
}

export interface OidcProtocol {
	authorize(
		configuration: OidcClientConfiguration,
		authorization: OidcAuthorization,
		signal: AbortSignal,
	): Promise<string>;
	verify(
		configuration: OidcClientConfiguration,
		authorization: OidcAuthorization,
		response: OidcAuthorizationResponse,
		signal: AbortSignal,
	): Promise<{ issuer: string; subject: string }>;
}

export class OidcProtocolFailure extends Error {
	constructor(
		readonly kind: 'rejected' | 'unavailable',
		options?: ErrorOptions,
	) {
		super('OIDC protocol ' + kind, options);
	}
}
