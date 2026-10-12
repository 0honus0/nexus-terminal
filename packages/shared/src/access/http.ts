import {
	type AccessHttpErrorCode,
	type AccessCaptchaProvider,
	ACCESS_CAPTCHA_TOKEN_MAX_BYTES,
	ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE,
} from './values.js';
import type { AccessUserView } from './model.js';

/** The initial Access HTTP surface shared by the isolated backend and development client. */
export interface AccessSetupRequest {
	username: string;
	password: string;
	confirmPassword: string;
}

export interface AccessLoginRequest {
	username: string;
	password: string;
	rememberMe?: boolean;
	captchaToken?: string;
}

export interface AccessCaptchaConfigResponse {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	hcaptchaSiteKey: string;
	recaptchaSiteKey: string;
}

export interface AccessIpBlacklistEntry {
	ip: string;
	attempts: number;
	lastAttemptAt: number;
	blockedUntil: number | null;
}

export interface AccessIpBlacklistResponse {
	entries: AccessIpBlacklistEntry[];
	total: number;
}

export interface AccessIpBlacklistRemoveRequest {
	ip: string;
}

export interface AccessIpBlacklistRemoveResponse {
	removed: boolean;
}

export interface AccessPasswordRequest {
	currentPassword: string;
	newPassword: string;
}

export interface AccessNeedsSetupResponse {
	needsSetup: boolean;
}

export interface AccessSetupResponse {
	user: AccessUserView;
}

export interface AccessLoginResponse {
	user: AccessUserView;
	requiresTwoFactor: false;
}

export interface AccessPendingTwoFactorResponse {
	requiresTwoFactor: true;
}

export type AccessPasswordLoginResponse = AccessLoginResponse | AccessPendingTwoFactorResponse;

export interface AccessStatusResponse {
	isAuthenticated: true;
	user: AccessUserView;
}

export interface AccessLogoutResponse {
	loggedOut: true;
}

export interface AccessPasswordResponse {
	passwordChanged: true;
}

export interface AccessHttpErrorResponse {
	code: AccessHttpErrorCode;
}

export class InvalidAccessPayload extends Error {
	constructor() {
		super('invalid_access_payload');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, fields: readonly string[], required = fields): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new InvalidAccessPayload();
	}
	const row = value;
	if (Object.keys(row).some((key) => !fields.includes(key)) || required.some((key) => !Object.hasOwn(row, key))) {
		throw new InvalidAccessPayload();
	}
	return row;
}

function text(value: unknown, minLength: number, maxUtf8Bytes: number): string {
	if (
		typeof value !== 'string' ||
		value.length < minLength ||
		new TextEncoder().encode(value).byteLength > maxUtf8Bytes
	) {
		throw new InvalidAccessPayload();
	}
	return value;
}

function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new InvalidAccessPayload();
	}
	return value;
}

export function readAccessHttpError(value: unknown): AccessHttpErrorResponse {
	const row = record(value, ['code']);
	switch (row.code) {
		case 'invalid_input':
		case 'already_initialized':
		case 'invalid_credentials':
		case 'rate_limited':
		case 'limit_exceeded':
		case 'captcha_invalid':
		case 'captcha_unavailable':
		case 'operation_unknown':
		case 'factor_unavailable':
		case 'challenge_expired':
		case 'not_found':
		case 'conflict':
		case 'storage_unavailable':
		case 'internal_failure':
		case 'unauthenticated':
		case 'forbidden':
			return { code: row.code };
		default:
			throw new InvalidAccessPayload();
	}
}

export function readAccessSetupRequest(value: unknown): AccessSetupRequest {
	const row = record(value, ['username', 'password', 'confirmPassword']);
	const username = text(row.username, 1, 256);
	const password = text(row.password, 8, 1024);
	const confirmPassword = text(row.confirmPassword, 8, 1024);
	if (password !== confirmPassword) {
		throw new InvalidAccessPayload();
	}
	return { username, password, confirmPassword };
}

export function readAccessLoginRequest(value: unknown): AccessLoginRequest {
	const row = record(value, ['username', 'password', 'rememberMe', 'captchaToken'], ['username', 'password']);
	const captchaToken =
		row.captchaToken === undefined ? undefined : text(row.captchaToken, 1, ACCESS_CAPTCHA_TOKEN_MAX_BYTES);
	return {
		username: text(row.username, 1, 256),
		password: text(row.password, 1, 1024),
		rememberMe: row.rememberMe === undefined ? undefined : bool(row.rememberMe),
		captchaToken,
	};
}

export function readAccessIpBlacklistQuery(query: URLSearchParams): { limit: number; offset: number } {
	if (
		[...query.keys()].some((key) => key !== 'limit' && key !== 'offset') ||
		query.getAll('limit').length > 1 ||
		query.getAll('offset').length > 1
	) {
		throw new InvalidAccessPayload();
	}

	const decode = (value: string | null, fallback: number): number => {
		if (value === null) {
			return fallback;
		}
		if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
			throw new InvalidAccessPayload();
		}
		const number = Number(value);
		if (!Number.isSafeInteger(number)) {
			throw new InvalidAccessPayload();
		}
		return number;
	};

	const limit = decode(query.get('limit'), 50);
	const offset = decode(query.get('offset'), 0);
	if (limit < 1 || limit > ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE) {
		throw new InvalidAccessPayload();
	}
	return { limit, offset };
}

export function readAccessIpBlacklistRemoveRequest(value: unknown): AccessIpBlacklistRemoveRequest {
	const row = record(value, ['ip']);
	return { ip: text(row.ip, 1, 128) };
}

export function readAccessCaptchaConfig(value: unknown): AccessCaptchaConfigResponse {
	const row = record(value, ['enabled', 'provider', 'hcaptchaSiteKey', 'recaptchaSiteKey']);
	if (row.provider !== 'none' && row.provider !== 'hcaptcha' && row.provider !== 'recaptcha') {
		throw new InvalidAccessPayload();
	}
	return {
		enabled: bool(row.enabled),
		provider: row.provider,
		hcaptchaSiteKey: text(row.hcaptchaSiteKey, 0, 1024),
		recaptchaSiteKey: text(row.recaptchaSiteKey, 0, 1024),
	};
}

export function readAccessIpBlacklist(value: unknown): AccessIpBlacklistResponse {
	const row = record(value, ['entries', 'total']);
	if (
		!Array.isArray(row.entries) ||
		row.entries.length > ACCESS_IP_BLACKLIST_MAX_PAGE_SIZE ||
		typeof row.total !== 'number' ||
		!Number.isSafeInteger(row.total) ||
		row.total < 0
	) {
		throw new InvalidAccessPayload();
	}
	const entries = row.entries.map((item: unknown): AccessIpBlacklistEntry => {
		const entry = record(item, ['ip', 'attempts', 'lastAttemptAt', 'blockedUntil']);
		const attempts = entry.attempts;
		const lastAttemptAt = entry.lastAttemptAt;
		const blockedUntil = entry.blockedUntil;
		if (
			typeof attempts !== 'number' ||
			!Number.isSafeInteger(attempts) ||
			attempts < 0 ||
			typeof lastAttemptAt !== 'number' ||
			!Number.isSafeInteger(lastAttemptAt) ||
			lastAttemptAt < 0
		) {
			throw new InvalidAccessPayload();
		}
		if (
			blockedUntil !== null &&
			(typeof blockedUntil !== 'number' || !Number.isSafeInteger(blockedUntil) || blockedUntil < 0)
		) {
			throw new InvalidAccessPayload();
		}
		return {
			ip: text(entry.ip, 1, 128),
			attempts,
			lastAttemptAt,
			blockedUntil,
		};
	});
	return { entries, total: row.total };
}

export function readAccessIpBlacklistRemove(value: unknown): AccessIpBlacklistRemoveResponse {
	const row = record(value, ['removed']);
	return { removed: bool(row.removed) };
}

export function readAccessPasswordRequest(value: unknown): AccessPasswordRequest {
	const row = record(value, ['currentPassword', 'newPassword']);
	return { currentPassword: text(row.currentPassword, 1, 1024), newPassword: text(row.newPassword, 8, 1024) };
}

export function readAccessUser(value: unknown): AccessUserView {
	const row = record(value, ['id', 'username', 'twoFactorEnabled']);
	if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1) {
		throw new InvalidAccessPayload();
	}
	return { id: row.id, username: text(row.username, 1, 256), twoFactorEnabled: bool(row.twoFactorEnabled) };
}

export function readAccessNeedsSetup(value: unknown): AccessNeedsSetupResponse {
	const row = record(value, ['needsSetup']);
	return { needsSetup: bool(row.needsSetup) };
}

export function readAccessSetup(value: unknown): AccessSetupResponse {
	const row = record(value, ['user']);
	return { user: readAccessUser(row.user) };
}

export function readAccessLogin(value: unknown): AccessPasswordLoginResponse {
	const row = record(value, ['user', 'requiresTwoFactor'], ['requiresTwoFactor']);
	if (row.requiresTwoFactor === true && !Object.hasOwn(row, 'user')) {
		return { requiresTwoFactor: true };
	}
	if (row.requiresTwoFactor !== false || !Object.hasOwn(row, 'user')) {
		throw new InvalidAccessPayload();
	}
	return { user: readAccessUser(row.user), requiresTwoFactor: false };
}

export function readAccessStatus(value: unknown): AccessStatusResponse {
	const row = record(value, ['isAuthenticated', 'user']);
	if (row.isAuthenticated !== true) {
		throw new InvalidAccessPayload();
	}
	return { isAuthenticated: true, user: readAccessUser(row.user) };
}

export function readAccessLogout(value: unknown): AccessLogoutResponse {
	const row = record(value, ['loggedOut']);
	if (row.loggedOut !== true) {
		throw new InvalidAccessPayload();
	}
	return { loggedOut: true };
}

export function readAccessPassword(value: unknown): AccessPasswordResponse {
	const row = record(value, ['passwordChanged']);
	if (row.passwordChanged !== true) {
		throw new InvalidAccessPayload();
	}
	return { passwordChanged: true };
}
