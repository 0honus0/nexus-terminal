export interface PendingLogin {
	accountId: number;
	rememberMe: boolean;
	expiresAt: number;
}

export interface FactorChallenge {
	kind: 'totp_setup' | 'passkey_registration' | 'passkey_authentication';
	accountId: number | null;
	sessionDigest: string | null;
	sourceIp: string | null;
	passwordRevision: string | null;
	challenge: string;
	origin: string | null;
	rpId: string | null;
	expiresAt: number;
}

export interface PasskeyCredential {
	credentialId: string;
	accountId: number;
	publicKeyBase64: string;
	generation: string;
	counter: number;
	transports: string[];
	name: string | null;
	backedUp: boolean;
	createdAt: number;
	updatedAt: number;
	lastUsedAt: number | null;
}

/** Application-owned projection of WebAuthn options, independent of vendor objects. */
export interface FactorWebauthnOptions {
	challenge: string;
	timeout?: number;
	rp?: { name: string; id?: string };
	user?: { id: string; name: string; displayName: string };
	pubKeyCredParams?: Array<{ type: 'public-key'; alg: number }>;
	attestation?: string;
	userVerification?: string;
	rpId?: string;
	excludeCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>;
	allowCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>;
	authenticatorSelection?: {
		residentKey?: string;
		userVerification?: string;
		authenticatorAttachment?: string;
		requireResidentKey?: boolean;
	};
	extensions?: { credProps?: boolean };
}

/** Validated application credential evidence; never a vendor response instance. */
export interface FactorPasskeySubmission {
	id: string;
	rawId: string;
	type: 'public-key';
	response: {
		clientDataJSON: string;
		attestationObject?: string;
		authenticatorData?: string;
		signature?: string;
		userHandle?: string | null;
		transports?: string[];
		publicKeyAlgorithm?: number;
		publicKey?: string;
	};
	authenticatorAttachment?: 'platform' | 'cross-platform' | null;
	clientExtensionResults: { credProps?: { rk?: boolean } };
}

/** A factor can issue a complete session only after the final storage transaction has committed. */
export type IssuedFactorLogin =
	| { status: 'issued'; token: string; accountId: number; rememberMe: boolean; expiresAt: number }
	| { status: 'stale' }
	| { status: 'invalid' }
	| { status: 'rate_limited' };

/** Factor Service result consumed only by the Access HTTP interface. */
export type FactorLoginResult =
	| { status: 'rate_limited' | 'invalid_credentials' | 'unauthenticated' }
	| {
			status: 'authenticated';
			token: string;
			identity: { id: number; username: string; twoFactorEnabled: boolean };
			rememberMe: boolean;
			expiresAt: number;
	  };

/** Password-verified facts required to begin a partial login. */
export interface StartPartialLogin {
	accountId: number;
	passwordHash: string;
	rememberMe: boolean;
	source: string;
	enforceFailurePolicy: boolean;
	previousPartial: string | null;
	signal?: AbortSignal;
}

export interface FactorChallengePolicy {
	expiresAt: number;
	maxChallenges: number;
	maxAnonymous: number;
	maxPerSource: number;
}

export interface VerifyPasskeyLogin {
	expiresAt: number;
	cookie: string;
	response: FactorPasskeySubmission;
	rememberMe: boolean;
	source: string;
	enforceFailurePolicy: boolean;
}

export interface PartialLoginStartResult {
	status: 'stored' | 'credentials_changed' | 'rate_limited' | 'limit_exceeded' | 'cancelled';
	token: string;
	expiresAt: number;
}

export interface FactorPasskeyOptionsIssue {
	cookie: string;
	options: FactorWebauthnOptions;
}

export interface FactorTotpSetupIssue {
	cookie: string;
	secret: string;
	qrCodeUrl: string;
}

export interface PasskeyAuthenticationOptionsCommand {
	origin: string;
	accountId: number | null;
	previous: string | null;
	source: string;
	restrictToNone: boolean;
}

/** Account-visible application projection, before the Shared HTTP mapper. */
export interface FactorPasskeySummary {
	credentialId: string;
	name: string | null;
	transports: string[];
	createdAt: number;
	lastUsedAt: number | null;
}

export interface BeginFactorSetup {
	accountId: number;
	username: string;
	session: string;
	previous: string | null;
	policy: FactorChallengePolicy;
}

export interface CompletePartialLogin {
	cookie: string;
	code: string;
	source: string;
	enforceFailurePolicy: boolean;
	expiresAt: number;
}

export interface FactorPasskeySite {
	origin: string;
	rpId: string;
}

export interface BeginPasskeySetup {
	accountId: number;
	username: string;
	session: string;
	previous: string | null;
	policy: FactorChallengePolicy;
	origin: string;
}
