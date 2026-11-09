import type { OidcClientAuthentication } from '@nexus-terminal/shared/access/oidc/values';

export interface OidcConfigurationRecord {
	revision: string;
	userId: number;
	label: string;
	issuer: string;
	clientId: string;
	clientAuthentication: OidcClientAuthentication;
	secretCipher: string | null;
	subject: string | null;
}

export interface OidcFlowRecord {
	cookieDigest: string;
	revision: string;
	purpose: 'login' | 'binding';
	sessionDigest: string | null;
	passwordRevision: string;
	redirectUri: string;
	state: string;
	nonce: string;
	verifierCipher: string;
	rememberMe: boolean;
	expiresAt: number;
}

export interface OidcStorageFacts {
	configuration: OidcConfigurationRecord | null;
	sessionUserId: number | null;
	account: { id: number; passwordRevision: string; passkeyRequired: boolean } | null;
	blockedUntil: number;
}

export interface OidcCompletionWrite {
	cookieDigest: string;
	sessionDigest: string | null;
	rememberMe: boolean;
	source: string;
	tokenDigest: string;
	expiresAt: number;
}

export type OidcCompletionDecision = { purpose: 'binding'; subject: string; revision: string } | { purpose: 'login' };

export interface OidcProviderRecord {
	label: string;
}

export interface OidcStorage {
	readProvider(): Promise<OidcProviderRecord | null>;
	read(sessionDigest: string | null, source: string): Promise<OidcStorageFacts>;
	/** Null identity is reserved for trusted installation; null decision leaves all sessions untouched. */
	configure(
		sessionDigest: string | null,
		decide: (facts: OidcStorageFacts) => OidcConfigurationRecord | null,
	): Promise<void>;
	begin(
		flow: OidcFlowRecord,
		previousCookieDigest: string | null,
		source: string,
		admit: (facts: OidcStorageFacts) => void,
	): Promise<void>;
	consume(cookieDigest: string, state: string, redirectUri: string): Promise<OidcFlowRecord | null>;
	complete(
		command: OidcCompletionWrite,
		decide: (facts: OidcStorageFacts, claimedExpiresAt: number | null) => OidcCompletionDecision,
	): Promise<void>;
	revokeIssued(tokenDigest: string): Promise<void>;
	discard(cookieDigest: string): Promise<void>;
}
