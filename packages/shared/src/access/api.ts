/** The initial Access HTTP surface shared by the isolated backend and development client. */
export interface AccessUserView {
	id: number;
	username: string;
	twoFactorEnabled: boolean;
}

export interface AccessSetupRequest {
	username: string;
	password: string;
	confirmPassword: string;
}

export interface AccessLoginRequest {
	username: string;
	password: string;
	rememberMe?: boolean;
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

export class InvalidAccessPayload extends Error {
	constructor() {
		super('invalid_access_payload');
	}
}

function record(value: unknown, fields: readonly string[], required = fields): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidAccessPayload();
	}
	const row = value as Record<string, unknown>;
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
	const row = record(value, ['username', 'password', 'rememberMe'], ['username', 'password']);
	return {
		username: text(row.username, 1, 256),
		password: text(row.password, 1, 1024),
		...(row.rememberMe === undefined ? {} : { rememberMe: bool(row.rememberMe) }),
	};
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

export function readAccessLogin(value: unknown): AccessLoginResponse {
	const row = record(value, ['user', 'requiresTwoFactor']);
	if (row.requiresTwoFactor !== false) {
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
