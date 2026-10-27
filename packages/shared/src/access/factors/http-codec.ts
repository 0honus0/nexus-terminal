import { ACCESS_TOTP_SETUP_RESPONSE_MAX_BYTES } from '../values.js';
import { readAccessUser } from '../http.js';
import {
	InvalidFactorPayload,
	type AccessTotpLoginResponse,
	type AccessTotpSetupResponse,
	type AccessTotpChangedResponse,
} from './http.js';

export function readAccessTotpLogin(value: unknown): AccessTotpLoginResponse {
	return { user: readAccessUser(exactRecord(value, ['user']).user) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key))
	) {
		throw new InvalidFactorPayload();
	}
	return value;
}

export function readAccessTotpSetup(value: unknown): AccessTotpSetupResponse {
	const row = exactRecord(value, ['secret', 'qrCodeUrl']);
	// The producer generates a 20-byte Base32 secret and an inline PNG, never a remote image URL.
	if (
		typeof row.secret !== 'string' ||
		typeof row.qrCodeUrl !== 'string' ||
		new TextEncoder().encode(JSON.stringify(value)).length > ACCESS_TOTP_SETUP_RESPONSE_MAX_BYTES ||
		!/^[A-Z2-7]{32}$/u.test(row.secret) ||
		!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(row.qrCodeUrl)
	) {
		throw new InvalidFactorPayload();
	}
	return { secret: row.secret, qrCodeUrl: row.qrCodeUrl };
}

export function readAccessTotpChanged(value: unknown): AccessTotpChangedResponse {
	if (exactRecord(value, ['changed']).changed !== true) {
		throw new InvalidFactorPayload();
	}
	return { changed: true };
}
