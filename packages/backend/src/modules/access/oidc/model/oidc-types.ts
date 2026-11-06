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
}

export interface OidcSettingsChange {
	revision: string | null;
	enabled: boolean;
	label: string;
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	secret: { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
}

export interface OidcCallback {
	code: string | null;
	state: string;
	issuer: string | null;
	error: string | null;
}

export interface OidcFlow {
	cookieDigest: string;
	revision: string;
	purpose: 'login' | 'binding';
	sessionDigest: string | null;
	passwordRevision: string;
	redirectUri: string;
	state: string;
	nonce: string;
	verifier: string;
	rememberMe: boolean;
	expiresAt: number;
}

export interface OidcConfiguration {
	revision: string;
	userId: number;
	enabled: boolean;
	label: string;
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	encryptedSecret: string | null;
	subject: string | null;
}

export interface OidcFacts {
	configuration: OidcConfiguration | null;
	sessionUserId: number | null;
	account: { id: number; passwordRevision: string; passkeyRequired: boolean } | null;
	blockedUntil: number;
}

export interface OidcStart {
	purpose: 'login' | 'binding';
	token: string | null;
	previousCookie: string | null;
	revision: string | null;
	redirectUri: string;
	rememberMe: boolean;
	source: string;
	enforceBlock: () => boolean;
	signal: AbortSignal;
}

export type OidcCompleted = { purpose: 'binding' } | { purpose: 'login'; token: string; rememberMe: boolean };
