import {
	ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,
	ACCESS_PASSKEY_NAME_MAX_BYTES,
	ACCESS_PASSKEY_EVIDENCE_MAX_BYTES,
	ACCESS_PASSKEY_MAX_TRANSPORTS,
	ACCESS_PASSKEY_TRANSPORT_MAX_BYTES,
} from '../values.js';
import type { AccessUserView } from '../model.js';

export class InvalidFactorPayload extends Error {
	constructor() {
		super('invalid_factor_payload');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(
	value: unknown,
	allowed: readonly string[],
	required: readonly string[] = allowed,
): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new InvalidFactorPayload();
	}
	const object = value;
	if (
		Object.keys(object).some((key) => !allowed.includes(key)) ||
		required.some((key) => !Object.hasOwn(object, key))
	) {
		throw new InvalidFactorPayload();
	}
	return object;
}

function bounded(value: unknown, maxBytes = 1024): string {
	if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).length > maxBytes) {
		throw new InvalidFactorPayload();
	}
	return value;
}

export interface AccessTotpTokenRequest {
	token: string;
}

export interface AccessTotpDisableRequest {
	password: string;
}

export interface AccessPasskeyAuthenticationOptionsRequest {
	username?: string;
}

export interface AccessPasskeyClientCredential {
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

export interface AccessPasskeyRegisterRequest {
	registrationResponse: AccessPasskeyClientCredential;
}

export interface AccessPasskeyAuthenticateRequest {
	assertionResponse: AccessPasskeyClientCredential;
	rememberMe?: boolean;
}

export interface AccessPasskeyRenameRequest {
	name: string;
}

export function readTotpToken(value: unknown): string {
	const row = record(value, ['token']);
	const token = bounded(row.token, 6);
	if (!/^[0-9]{6}$/u.test(token)) {
		throw new InvalidFactorPayload();
	}
	return token;
}

export function readTotpDisable(value: unknown): string {
	return bounded(record(value, ['password']).password, 1024);
}

export function readPasskeyAuthenticationOptions(value: unknown): string | undefined {
	const row = record(value, ['username'], []);
	return row.username === undefined ? undefined : bounded(row.username, 256);
}

export function readPasskeyHasConfigured(query: URLSearchParams): string | undefined {
	if ([...query.keys()].some((key) => key !== 'username') || query.getAll('username').length > 1) {
		throw new InvalidFactorPayload();
	}
	const username = query.get('username');
	return username === null ? undefined : bounded(username, 256);
}

export function readPasskeyCredential(
	value: unknown,
	kind: 'registration' | 'authentication',
): AccessPasskeyClientCredential {
	const row = record(
		value,
		['id', 'rawId', 'response', 'type', 'clientExtensionResults', 'authenticatorAttachment'],
		['id', 'rawId', 'response', 'type'],
	);
	const responseFields =
		kind === 'registration'
			? [
					'clientDataJSON',
					'attestationObject',
					'authenticatorData',
					'transports',
					'publicKeyAlgorithm',
					'publicKey',
				]
			: ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle'];
	const requiredFields =
		kind === 'registration'
			? ['clientDataJSON', 'attestationObject']
			: ['clientDataJSON', 'authenticatorData', 'signature'];
	const payload = record(row.response, responseFields, requiredFields);
	if (row.type !== 'public-key') {
		throw new InvalidFactorPayload();
	}
	const id = bounded(row.id, ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES);
	const rawId = bounded(row.rawId, ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES);
	if (id !== rawId || !/^[A-Za-z0-9_-]+$/u.test(id)) {
		throw new InvalidFactorPayload();
	}
	const details: AccessPasskeyClientCredential['response'] = {
		clientDataJSON: bounded(payload.clientDataJSON, ACCESS_PASSKEY_EVIDENCE_MAX_BYTES),
	};

	if (payload.attestationObject !== undefined) {
		details.attestationObject = bounded(payload.attestationObject, ACCESS_PASSKEY_EVIDENCE_MAX_BYTES);
	}
	if (payload.authenticatorData !== undefined) {
		details.authenticatorData = bounded(payload.authenticatorData, ACCESS_PASSKEY_EVIDENCE_MAX_BYTES);
	}
	if (payload.signature !== undefined) {
		details.signature = bounded(payload.signature, ACCESS_PASSKEY_EVIDENCE_MAX_BYTES);
	}
	if (payload.publicKey !== undefined) {
		details.publicKey = bounded(payload.publicKey, ACCESS_PASSKEY_EVIDENCE_MAX_BYTES);
	}
	if (payload.userHandle !== undefined) {
		details.userHandle =
			payload.userHandle === null ? null : bounded(payload.userHandle, ACCESS_PASSKEY_EVIDENCE_MAX_BYTES);
	}
	if (payload.transports !== undefined) {
		if (
			!Array.isArray(payload.transports) ||
			payload.transports.length > ACCESS_PASSKEY_MAX_TRANSPORTS ||
			!payload.transports.every(
				(transport: unknown) =>
					typeof transport === 'string' &&
					new TextEncoder().encode(transport).length <= ACCESS_PASSKEY_TRANSPORT_MAX_BYTES,
			)
		) {
			throw new InvalidFactorPayload();
		}
		details.transports = payload.transports.map((transport: string) => transport);
	}
	if (payload.publicKeyAlgorithm !== undefined) {
		if (typeof payload.publicKeyAlgorithm !== 'number' || !Number.isSafeInteger(payload.publicKeyAlgorithm)) {
			throw new InvalidFactorPayload();
		}
		details.publicKeyAlgorithm = payload.publicKeyAlgorithm;
	}

	const result: AccessPasskeyClientCredential = {
		id,
		rawId,
		type: 'public-key',
		response: details,
		clientExtensionResults: {},
	};
	if (row.authenticatorAttachment !== undefined) {
		if (
			row.authenticatorAttachment !== null &&
			row.authenticatorAttachment !== 'platform' &&
			row.authenticatorAttachment !== 'cross-platform'
		) {
			throw new InvalidFactorPayload();
		}
		result.authenticatorAttachment = row.authenticatorAttachment;
	}
	if (row.clientExtensionResults !== undefined) {
		const extensions = record(row.clientExtensionResults, ['credProps'], []);
		if (JSON.stringify(extensions).length > 8192) {
			throw new InvalidFactorPayload();
		}
		if (extensions.credProps !== undefined) {
			const props = record(extensions.credProps, ['rk'], []);
			if (props.rk !== undefined && typeof props.rk !== 'boolean') {
				throw new InvalidFactorPayload();
			}
			result.clientExtensionResults.credProps = props.rk === undefined ? {} : { rk: props.rk };
		}
	}
	return result;
}

export function readPasskeyRegister(value: unknown): AccessPasskeyClientCredential {
	const row = record(value, ['registrationResponse']);
	return readPasskeyCredential(row.registrationResponse, 'registration');
}

export function readPasskeyAuthenticate(value: unknown): {
	response: AccessPasskeyClientCredential;
	rememberMe: boolean;
} {
	const row = record(value, ['assertionResponse', 'rememberMe'], ['assertionResponse']);
	if (row.rememberMe !== undefined && typeof row.rememberMe !== 'boolean') {
		throw new InvalidFactorPayload();
	}
	return {
		response: readPasskeyCredential(row.assertionResponse, 'authentication'),
		rememberMe: row.rememberMe === true,
	};
}

export function readPasskeyName(value: unknown): string {
	return bounded(record(value, ['name']).name, ACCESS_PASSKEY_NAME_MAX_BYTES);
}

export interface AccessTotpSetupResponse {
	secret: string;
	qrCodeUrl: string;
}

export interface AccessTotpChangedResponse {
	changed: true;
}

export interface AccessPasskeyVerifiedResponse {
	verified: boolean;
}

export interface AccessPasskeyHasConfiguredResponse {
	hasPasskeys: boolean;
}

export interface AccessPasskeySummary {
	credentialId: string;
	name: string | null;
	transports: string[];
	createdAt: number;
	lastUsedAt: number | null;
}

/** Browser creation and request options share their stable optional projection fields. */
export interface AccessWebauthnOptions {
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

export interface AccessPasskeyRegistrationOptionsResponse extends AccessWebauthnOptions {
	rp: { name: string; id?: string };
	user: { id: string; name: string; displayName: string };
	pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
}

export interface AccessPasskeyAuthenticationOptionsResponse extends AccessWebauthnOptions {
	challenge: string;
}

export interface AccessPasskeyRemoveResponse {
	removed: true;
}

export interface AccessPasskeyRenameResponse {
	renamed: true;
}

export interface AccessTotpLoginResponse {
	user: AccessUserView;
}

export interface AccessPasskeyLoginResponse {
	verified: true;
	user: AccessUserView;
}
