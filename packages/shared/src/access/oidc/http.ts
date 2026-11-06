import type { OidcClientAuthentication } from './values.js';

export interface OidcSettingsResponse {
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

export interface OidcSettingsRequest {
	revision: string | null;
	enabled: boolean;
	label: string;
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	secret: { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
	password: string;
}

export interface OidcBindingRequest {
	revision: string;
	password: string;
}

export interface OidcProviderResponse {
	provider: { label: string } | null;
}

export interface OidcStartRequest {
	rememberMe: boolean;
}

export interface OidcStartResponse {
	authorizationUrl: string;
}

/** Only code flow query parameters are accepted, never an arbitrary callback URL. */
export interface OidcFinishRequest {
	code: string | null;
	state: string;
	issuer: string | null;
	error: string | null;
}

export interface OidcFinishResponse {
	completed: 'login' | 'binding';
}

export interface OidcChangedResponse {
	changed: true;
}
