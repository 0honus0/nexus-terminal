/** A provider exception leaves verification outcome unavailable, not a confirmed invalid credential. */
export class WebauthnTechnicalFailure extends Error {
	constructor(cause: unknown) {
		super('WebAuthn verification unavailable', { cause });
		this.name = 'WebauthnTechnicalFailure';
	}
}

/** WebAuthn technical credential material, without account or session ownership. */
export interface WebauthnPublicKey {
	id: string;
	publicKeyBase64: string;
	counter: number;
	transports: string[];
}

export interface WebauthnRegisteredKey extends WebauthnPublicKey {
	backedUp: boolean;
}

export interface WebauthnRelyingParty {
	origin: string;
	rpId: string;
}

/** Explicit technology facts returned by an authenticator options provider. */
export interface WebauthnCredentialDescriptor {
	type: 'public-key';
	id: string;
	transports?: string[];
}

export interface WebauthnOptions {
	challenge: string;
	timeout?: number;
	userVerification?: string;
	rpId?: string;
	allowCredentials?: WebauthnCredentialDescriptor[];
	excludeCredentials?: WebauthnCredentialDescriptor[];
	extensions?: { credProps?: boolean };
}

export interface WebauthnRegistrationOptions extends WebauthnOptions {
	rp: { name: string; id?: string };
	user: { id: string; name: string; displayName: string };
	pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
	attestation?: string;
	authenticatorSelection?: {
		residentKey?: string;
		userVerification?: string;
		authenticatorAttachment?: string;
		requireResidentKey?: boolean;
	};
}

export interface WebauthnAuthenticationOptions extends WebauthnOptions {
	challenge: string;
}

/** Decoded authenticator evidence, independent of the vendor's JSON classes. */
export interface WebauthnResponse {
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

export interface WebauthnPort {
	registrationOptions(input: {
		rp: WebauthnRelyingParty;
		displayName: string;
		relyingPartyName: string;
		userId: string;
		excluded: { id: string; transports: string[] }[];
	}): Promise<WebauthnRegistrationOptions>;
	authenticationOptions(input: {
		rp: WebauthnRelyingParty;
		allowed: { id: string; transports: string[] }[] | null;
	}): Promise<WebauthnAuthenticationOptions>;
	registrationVerify(input: {
		rp: WebauthnRelyingParty;
		challenge: string;
		response: WebauthnResponse;
	}): Promise<WebauthnRegisteredKey | null>;
	authenticationVerify(input: {
		rp: WebauthnRelyingParty;
		challenge: string;
		response: WebauthnResponse;
		key: WebauthnPublicKey;
	}): Promise<number | null>;
}
