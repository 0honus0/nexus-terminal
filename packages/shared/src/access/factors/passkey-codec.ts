import {
	ACCESS_FACTOR_RESPONSE_MAX_BYTES,
	ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES,
	ACCESS_PASSKEY_MAX_TRANSPORTS,
	ACCESS_PASSKEY_NAME_MAX_BYTES,
	ACCESS_PASSKEY_TRANSPORT_MAX_BYTES,
} from '../values.js';
import { readAccessUser } from '../http.js';
import {
	InvalidFactorPayload,
	type AccessPasskeyAuthenticationOptionsResponse,
	type AccessPasskeyRegistrationOptionsResponse,
	type AccessPasskeySummary,
	type AccessPasskeyLoginResponse,
	type AccessPasskeyVerifiedResponse,
	type AccessPasskeyHasConfiguredResponse,
	type AccessPasskeyRemoveResponse,
	type AccessPasskeyRenameResponse,
} from './http.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).some((key) => !allowed.includes(key)) ||
		required.some((key) => !Object.hasOwn(value, key))
	) {
		throw new InvalidFactorPayload();
	}
	return value;
}

function text(value: unknown, maxBytes: number): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.includes('\0') ||
		new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) !== value ||
		new TextEncoder().encode(value).length > maxBytes
	) {
		throw new InvalidFactorPayload();
	}
	return value;
}

function boundedJson(value: unknown): void {
	if (new TextEncoder().encode(JSON.stringify(value)).length > ACCESS_FACTOR_RESPONSE_MAX_BYTES) {
		throw new InvalidFactorPayload();
	}
}

function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new InvalidFactorPayload();
	}
	return value;
}

function base64url(value: unknown, maxBytes: number): string {
	const result = text(value, maxBytes);
	if (!/^[A-Za-z0-9_-]+$/u.test(result) || result.length % 4 === 1) {
		throw new InvalidFactorPayload();
	}
	return result;
}

export function readPasskeyCredentialId(value: unknown): string {
	return base64url(value, ACCESS_PASSKEY_CREDENTIAL_ID_MAX_BYTES);
}

function transports(value: unknown): string[] {
	if (!Array.isArray(value) || value.length > ACCESS_PASSKEY_MAX_TRANSPORTS) {
		throw new InvalidFactorPayload();
	}
	return value.map((entry: unknown) => text(entry, ACCESS_PASSKEY_TRANSPORT_MAX_BYTES));
}

function descriptors(value: unknown): Array<{ type: 'public-key'; id: string; transports?: string[] }> {
	if (!Array.isArray(value)) {
		throw new InvalidFactorPayload();
	}
	return value.map((entry: unknown) => {
		const row = record(entry, ['type', 'id', 'transports'], ['type', 'id']);
		if (row.type !== 'public-key') {
			throw new InvalidFactorPayload();
		}
		const result: { type: 'public-key'; id: string; transports?: string[] } = {
			type: 'public-key',
			id: readPasskeyCredentialId(row.id),
		};
		if (row.transports !== undefined) {
			result.transports = transports(row.transports);
		}
		return result;
	});
}

function timeout(value: unknown): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const result = integer(value);
	if (result === 0) {
		throw new InvalidFactorPayload();
	}
	return result;
}

export function readPasskeyAuthenticationResponse(value: unknown): AccessPasskeyAuthenticationOptionsResponse {
	boundedJson(value);
	const row = record(
		value,
		['challenge', 'timeout', 'rpId', 'allowCredentials', 'userVerification'],
		['challenge', 'rpId', 'userVerification'],
	);
	if (row.userVerification !== 'required') {
		throw new InvalidFactorPayload();
	}
	const result: AccessPasskeyAuthenticationOptionsResponse = {
		challenge: base64url(row.challenge, 1024),
		rpId: text(row.rpId, 1024),
		userVerification: row.userVerification,
	};
	if (row.timeout !== undefined) {
		result.timeout = timeout(row.timeout);
	}
	if (row.allowCredentials !== undefined) {
		result.allowCredentials = descriptors(row.allowCredentials);
	}
	return result;
}

export function readPasskeyRegistrationResponse(value: unknown): AccessPasskeyRegistrationOptionsResponse {
	boundedJson(value);
	const row = record(
		value,
		[
			'challenge',
			'rp',
			'user',
			'pubKeyCredParams',
			'timeout',
			'excludeCredentials',
			'attestation',
			'authenticatorSelection',
			'extensions',
		],
		['challenge', 'rp', 'user', 'pubKeyCredParams', 'authenticatorSelection'],
	);
	const rp = record(row.rp, ['name', 'id']);
	const user = record(row.user, ['id', 'name', 'displayName']);
	const selection = record(
		row.authenticatorSelection,
		['residentKey', 'userVerification', 'authenticatorAttachment', 'requireResidentKey'],
		['userVerification'],
	);
	if (
		selection.userVerification !== 'required' ||
		!Array.isArray(row.pubKeyCredParams) ||
		row.pubKeyCredParams.length === 0
	) {
		throw new InvalidFactorPayload();
	}
	const selected: NonNullable<AccessPasskeyRegistrationOptionsResponse['authenticatorSelection']> = {
		userVerification: 'required',
	};
	const result: AccessPasskeyRegistrationOptionsResponse = {
		challenge: base64url(row.challenge, 1024),
		rp: { name: text(rp.name, 1024), id: text(rp.id, 1024) },
		user: { id: base64url(user.id, 1024), name: text(user.name, 1024), displayName: text(user.displayName, 1024) },
		pubKeyCredParams: row.pubKeyCredParams.map((entry: unknown) => {
			const parameter = record(entry, ['type', 'alg']);
			if (
				parameter.type !== 'public-key' ||
				typeof parameter.alg !== 'number' ||
				!Number.isSafeInteger(parameter.alg)
			) {
				throw new InvalidFactorPayload();
			}
			return { type: 'public-key', alg: parameter.alg };
		}),
		authenticatorSelection: selected,
	};
	if (selection.residentKey !== undefined) {
		if (
			selection.residentKey !== 'required' &&
			selection.residentKey !== 'preferred' &&
			selection.residentKey !== 'discouraged'
		) {
			throw new InvalidFactorPayload();
		}
		selected.residentKey = selection.residentKey;
	}
	if (selection.authenticatorAttachment !== undefined) {
		if (
			selection.authenticatorAttachment !== 'platform' &&
			selection.authenticatorAttachment !== 'cross-platform'
		) {
			throw new InvalidFactorPayload();
		}
		selected.authenticatorAttachment = selection.authenticatorAttachment;
	}
	if (selection.requireResidentKey !== undefined) {
		if (typeof selection.requireResidentKey !== 'boolean') {
			throw new InvalidFactorPayload();
		}
		selected.requireResidentKey = selection.requireResidentKey;
	}
	if (row.attestation !== undefined) {
		if (
			row.attestation !== 'none' &&
			row.attestation !== 'direct' &&
			row.attestation !== 'indirect' &&
			row.attestation !== 'enterprise'
		) {
			throw new InvalidFactorPayload();
		}
		result.attestation = row.attestation;
	}
	if (row.timeout !== undefined) {
		result.timeout = timeout(row.timeout);
	}
	if (row.excludeCredentials !== undefined) {
		result.excludeCredentials = descriptors(row.excludeCredentials);
	}
	if (row.extensions !== undefined) {
		const extensions = record(row.extensions, ['credProps'], []);
		if (extensions.credProps !== undefined && typeof extensions.credProps !== 'boolean') {
			throw new InvalidFactorPayload();
		}
		result.extensions = extensions.credProps === undefined ? {} : { credProps: extensions.credProps };
	}
	return result;
}

export function readPasskeyList(value: unknown): AccessPasskeySummary[] {
	boundedJson(value);
	if (!Array.isArray(value)) {
		throw new InvalidFactorPayload();
	}
	const ids = new Set<string>();
	return value.map((entry: unknown) => {
		const row = record(entry, ['credentialId', 'name', 'transports', 'createdAt', 'lastUsedAt']);
		const credentialId = readPasskeyCredentialId(row.credentialId);
		const createdAt = integer(row.createdAt);
		const lastUsedAt = row.lastUsedAt === null ? null : integer(row.lastUsedAt);
		if (ids.has(credentialId) || (lastUsedAt !== null && lastUsedAt < createdAt)) {
			throw new InvalidFactorPayload();
		}
		ids.add(credentialId);
		return {
			credentialId,
			name: row.name === null ? null : text(row.name, ACCESS_PASSKEY_NAME_MAX_BYTES),
			transports: transports(row.transports),
			createdAt,
			lastUsedAt,
		};
	});
}

export function readPasskeyLogin(value: unknown): AccessPasskeyLoginResponse {
	const row = record(value, ['verified', 'user']);
	if (row.verified !== true) {
		throw new InvalidFactorPayload();
	}
	return { verified: true, user: readAccessUser(row.user) };
}

export function readPasskeyVerified(value: unknown): AccessPasskeyVerifiedResponse {
	const row = record(value, ['verified']);
	if (typeof row.verified !== 'boolean') {
		throw new InvalidFactorPayload();
	}
	return { verified: row.verified };
}

export function readPasskeyConfigured(value: unknown): AccessPasskeyHasConfiguredResponse {
	const row = record(value, ['hasPasskeys']);
	if (typeof row.hasPasskeys !== 'boolean') {
		throw new InvalidFactorPayload();
	}
	return { hasPasskeys: row.hasPasskeys };
}

export function readPasskeyRemoved(value: unknown): AccessPasskeyRemoveResponse {
	if (record(value, ['removed']).removed !== true) {
		throw new InvalidFactorPayload();
	}
	return { removed: true };
}

export function readPasskeyRenamed(value: unknown): AccessPasskeyRenameResponse {
	if (record(value, ['renamed']).renamed !== true) {
		throw new InvalidFactorPayload();
	}
	return { renamed: true };
}
