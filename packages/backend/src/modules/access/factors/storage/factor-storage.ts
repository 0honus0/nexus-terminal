/** Private persistence records, separate from the Factors application model. */
export interface PendingLoginRecord {
	accountId: number;
	rememberMe: boolean;
	expiresAt: number;
}

export interface FactorChallengeRecord {
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

export interface PasskeyStorageRecord {
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

export interface PasskeyRegistrationWrite {
	credentialId: string;
	publicKeyBase64: string;
	generation: string;
	counter: number;
	transports: string[];
	name: string | null;
	backedUp: boolean;
}

export interface PendingLoginWrite {
	tokenDigest: string;
	accountId: number;
	passwordHash: string;
	rememberMe: boolean;
	expiresAt: number;
	source: string;
	enforceBan: boolean;
	maxPending: number;
	previousDigest: string | null;
	signal?: AbortSignal;
}

export interface ChallengeCapacity {
	maxChallenges: number;
	maxAnonymous: number;
	maxPerSource: number;
}

export interface CompleteFactorLogin {
	pendingDigest: string;
	tokenDigest: string;
	expectedEncryptedSecret: string;
	source: string;
	enforceBan: boolean;
	expiresAt: number;
}

export interface CompletePasskeyLogin {
	challengeDigest: string;
	accountId: number;
	credentialId: string;
	expectedGeneration: string;
	expectedCounter: number;
	nextCounter: number;
	tokenDigest: string;
	rememberMe: boolean;
	source: string;
	enforceBan: boolean;
	expiresAt: number;
}

export interface FactorStorage {
	revokeFlows(
		partialDigest: string | null,
		challengeDigest: string | null,
		setupDigest: string | null,
	): Promise<void>;

	storePending(
		command: PendingLoginWrite,
	): Promise<'stored' | 'credentials_changed' | 'rate_limited' | 'limit_exceeded' | 'cancelled'>;
	findPending(tokenDigest: string): Promise<PendingLoginRecord | null>;
	completeTotp(command: CompleteFactorLogin): Promise<'issued' | 'stale' | 'rate_limited'>;

	storeChallenge(
		tokenDigest: string,
		oldDigest: string | null,
		challenge: FactorChallengeRecord,
		limits: ChallengeCapacity,
	): Promise<'stored' | 'unauthenticated' | 'limit_exceeded' | 'challenge_expired'>;
	findChallenge(
		tokenDigest: string,
		kind: FactorChallengeRecord['kind'],
		now: () => number,
	): Promise<FactorChallengeRecord | null>;
	consumeChallenge(tokenDigest: string, kind: FactorChallengeRecord['kind'], now: () => number): Promise<boolean>;

	enableTotp(command: {
		sessionDigest: string;
		accountId: number;
		challengeDigest: string;
		encrypted: string;
	}): Promise<boolean>;
	disableTotp(command: {
		sessionDigest: string;
		accountId: number;
		expectedHash: string;
		expectedSecret: string;
	}): Promise<boolean>;
	getEncryptedTotp(accountId: number): Promise<string | null>;

	listPasskeys(accountId: number): Promise<PasskeyStorageRecord[]>;
	getPasskey(credentialId: string): Promise<PasskeyStorageRecord | null>;
	hasPasskeys(accountId: number | null): Promise<boolean>;
	completeRegistration(command: {
		challengeDigest: string;
		sessionDigest: string;
		accountId: number;
		credential: PasskeyRegistrationWrite;
	}): Promise<boolean>;
	completePasskeyLogin(command: CompletePasskeyLogin): Promise<'issued' | 'stale' | 'rate_limited'>;
	renamePasskey(command: {
		sessionDigest: string;
		accountId: number;
		credentialId: string;
		name: string;
	}): Promise<boolean>;
	deletePasskey(command: { sessionDigest: string; accountId: number; credentialId: string }): Promise<boolean>;
}
