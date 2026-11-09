import { InvalidPayload, record, text } from '../../common/http-codec.js';
import { ACCESS_AUTH_REQUEST_MAX_BYTES, ACCESS_AUTH_RESPONSE_MAX_BYTES, ACCESS_PASSWORD_MAX_BYTES } from '../values.js';
import type { OidcClientAuthentication } from './values.js';
import type {
	OidcSettingsRequest,
	OidcSettingsResponse,
	OidcBindingRequest,
	OidcStartRequest,
	OidcStartResponse,
	OidcFinishRequest,
	OidcFinishResponse,
	OidcChangedResponse,
} from './http.js';

function string(value: unknown): string {
	return text(value, ACCESS_AUTH_REQUEST_MAX_BYTES);
}

function credential(value: unknown, maximum: number): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		new TextEncoder().encode(value).byteLength > maximum ||
		new TextDecoder().decode(new TextEncoder().encode(value)) !== value
	) {
		throw new InvalidPayload();
	}
	return value;
}

function bool(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new InvalidPayload();
	}
	return value;
}

function authentication(value: unknown): OidcClientAuthentication {
	if (value !== 'client_secret_basic' && value !== 'client_secret_post' && value !== 'none') {
		throw new InvalidPayload();
	}
	return value;
}

function revision(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
		throw new InvalidPayload();
	}
	return value;
}

export function readOidcSettingsRequest(value: unknown): OidcSettingsRequest {
	const row = record(
		value,
		['revision', 'label', 'issuer', 'clientId', 'clientAuthentication', 'secret', 'password'],
		ACCESS_AUTH_REQUEST_MAX_BYTES,
	);
	if (row.secret === null || typeof row.secret !== 'object' || !('action' in row.secret)) {
		throw new InvalidPayload();
	}
	const secret = record(row.secret, row.secret.action === 'replace' ? ['action', 'value'] : ['action']);
	if (secret.action !== 'replace' && secret.action !== 'keep' && secret.action !== 'clear') {
		throw new InvalidPayload();
	}
	return {
		revision: revision(row.revision),
		label: string(row.label).trim(),
		issuer: string(row.issuer).trim(),
		clientId: string(row.clientId),
		clientAuthentication: authentication(row.clientAuthentication),
		secret:
			secret.action === 'replace'
				? { action: 'replace', value: credential(secret.value, ACCESS_AUTH_REQUEST_MAX_BYTES) }
				: { action: secret.action },
		password: credential(row.password, ACCESS_PASSWORD_MAX_BYTES),
	};
}

export function readOidcSettingsResponse(value: unknown): OidcSettingsResponse {
	const row = record(
		value,
		['revision', 'label', 'issuer', 'clientId', 'clientAuthentication', 'hasSecret', 'bound', 'callbackUrl'],
		ACCESS_AUTH_RESPONSE_MAX_BYTES,
	);
	const version = revision(row.revision);
	return {
		revision: version,
		label: string(row.label),
		issuer: version === null && row.issuer === '' ? '' : string(row.issuer),
		clientId: version === null && row.clientId === '' ? '' : string(row.clientId),
		clientAuthentication: authentication(row.clientAuthentication),
		hasSecret: bool(row.hasSecret),
		bound: bool(row.bound),
		callbackUrl: string(row.callbackUrl),
	};
}

export function readOidcBindingRequest(value: unknown): OidcBindingRequest {
	const row = record(value, ['revision', 'password'], ACCESS_AUTH_REQUEST_MAX_BYTES);
	const version = revision(row.revision);
	if (version === null) {
		throw new InvalidPayload();
	}
	return { revision: version, password: credential(row.password, ACCESS_PASSWORD_MAX_BYTES) };
}

export function readOidcStartRequest(value: unknown): OidcStartRequest {
	return { rememberMe: bool(record(value, ['rememberMe']).rememberMe) };
}

export function readOidcStartResponse(value: unknown): OidcStartResponse {
	return {
		authorizationUrl: string(record(value, ['authorizationUrl'], ACCESS_AUTH_RESPONSE_MAX_BYTES).authorizationUrl),
	};
}

export function readOidcFinishRequest(value: unknown): OidcFinishRequest {
	const row = record(value, ['code', 'state', 'issuer', 'error'], ACCESS_AUTH_REQUEST_MAX_BYTES);
	const code = row.code === null ? null : string(row.code);
	const error = row.error === null ? null : string(row.error);
	if ((code === null) === (error === null)) {
		throw new InvalidPayload();
	}
	return { code, state: string(row.state), issuer: row.issuer === null ? null : string(row.issuer), error };
}

export function readOidcFinishResponse(value: unknown): OidcFinishResponse {
	const row = record(value, ['completed']);
	if (row.completed !== 'login' && row.completed !== 'binding') {
		throw new InvalidPayload();
	}
	return { completed: row.completed };
}

export function readOidcChangedResponse(value: unknown): OidcChangedResponse {
	const row = record(value, ['changed']);
	if (row.changed !== true) {
		throw new InvalidPayload();
	}
	return { changed: true };
}
