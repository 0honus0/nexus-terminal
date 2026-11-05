import {
	REMOTE_DESKTOP_MIN_DIMENSION,
	REMOTE_DESKTOP_MAX_DIMENSION,
	REMOTE_DESKTOP_MIN_DPI,
	REMOTE_DESKTOP_MAX_DPI,
	REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
	REMOTE_DESKTOP_ERROR_CODES,
	RDP_CERTIFICATE_REASONS,
	isRdpCertificateFingerprint,
} from './values.js';
import type {
	RemoteDesktopDisplayRequest,
	RemoteDesktopSessionPath,
	RemoteDesktopSessionResponse,
	RemoteDesktopFailureResponse,
	RemoteDesktopSessionRequest,
	RdpCertificateView,
} from './http.js';
import { record as readRecord, InvalidPayload } from '../../common/http-codec.js';
import {
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_PASSWORD_MAX_BYTES,
} from '../../targets/connections/values.js';

export class InvalidRemoteDesktopPayload extends Error {
	constructor() {
		super('Invalid remote desktop request');
		this.name = 'InvalidRemoteDesktopPayload';
	}
}

function record(value: unknown, keys: readonly string[], maxBytes: number): Record<string, unknown> {
	try {
		return readRecord(value, keys, maxBytes);
	} catch (cause) {
		if (cause instanceof InvalidPayload) {
			throw new InvalidRemoteDesktopPayload();
		}
		throw cause;
	}
}

export function readRemoteDesktopSessionPath(value: unknown): RemoteDesktopSessionPath {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		!('id' in value) ||
		Object.keys(value).length !== 1 ||
		typeof value.id !== 'string' ||
		!/^[1-9][0-9]*$/u.test(value.id)
	) {
		throw new InvalidRemoteDesktopPayload();
	}
	const id = Number(value.id);
	if (!Number.isSafeInteger(id)) {
		throw new InvalidRemoteDesktopPayload();
	}
	return { id };
}

/** Zero or one of each option, all ASCII base-10 positive integers. */
export function readRemoteDesktopDisplay(query: URLSearchParams): RemoteDesktopDisplayRequest {
	const result: RemoteDesktopDisplayRequest = {};
	for (const [key, text] of query) {
		if (key !== 'width' && key !== 'height' && key !== 'dpi') {
			throw new InvalidRemoteDesktopPayload();
		}
		if (query.getAll(key).length !== 1 || !/^[0-9]{1,5}$/u.test(text)) {
			throw new InvalidRemoteDesktopPayload();
		}
		const value = Number(text);
		const min = key === 'dpi' ? REMOTE_DESKTOP_MIN_DPI : REMOTE_DESKTOP_MIN_DIMENSION;
		const max = key === 'dpi' ? REMOTE_DESKTOP_MAX_DPI : REMOTE_DESKTOP_MAX_DIMENSION;
		if (!Number.isSafeInteger(value) || value < min || value > max) {
			throw new InvalidRemoteDesktopPayload();
		}
		result[key] = value;
	}
	return result;
}

export function readRemoteDesktopTicket(query: URLSearchParams): string {
	if (query.size !== 1 || query.getAll('ticket').length !== 1) {
		throw new InvalidRemoteDesktopPayload();
	}
	const ticket = query.get('ticket');
	if (!ticket || !/^[A-Za-z0-9_-]{43}$/u.test(ticket)) {
		throw new InvalidRemoteDesktopPayload();
	}
	return ticket;
}

export function readRemoteDesktopSessionResponse(value: unknown): RemoteDesktopSessionResponse {
	const item = record(
		value,
		['ticket', 'protocol', 'host', 'port', 'username', 'password'],
		REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
	);
	if (
		typeof item.ticket !== 'string' ||
		(item.protocol !== 'RDP' && item.protocol !== 'VNC') ||
		typeof item.host !== 'string' ||
		item.host.length === 0 ||
		new TextEncoder().encode(item.host).byteLength > TARGET_CONNECTION_HOST_MAX_BYTES ||
		typeof item.port !== 'number' ||
		!Number.isInteger(item.port) ||
		item.port < 1 ||
		item.port > 65535 ||
		typeof item.username !== 'string' ||
		new TextEncoder().encode(item.username).byteLength > TARGET_CONNECTION_USERNAME_MAX_BYTES ||
		typeof item.password !== 'string' ||
		item.password.length === 0 ||
		new TextEncoder().encode(item.password).byteLength > TARGET_CONNECTION_PASSWORD_MAX_BYTES
	) {
		throw new InvalidRemoteDesktopPayload();
	}
	return {
		ticket: readRemoteDesktopTicket(new URLSearchParams({ ticket: item.ticket })),
		protocol: item.protocol,
		host: item.host,
		port: item.port,
		username: item.username,
		password: item.password,
	};
}

export function readRemoteDesktopFailureResponse(value: unknown): RemoteDesktopFailureResponse {
	if (value && typeof value === 'object' && 'code' in value && value.code === 'certificate_required') {
		const item = record(value, ['code', 'certificate'], REMOTE_DESKTOP_RESPONSE_MAX_BYTES);
		return { code: 'certificate_required', certificate: readRdpCertificate(item.certificate) };
	}
	const item = record(value, ['code'], REMOTE_DESKTOP_RESPONSE_MAX_BYTES);
	const code = REMOTE_DESKTOP_ERROR_CODES.find((candidate) => candidate === item.code);
	if (code === undefined || code === 'certificate_required') {
		throw new InvalidRemoteDesktopPayload();
	}
	return { code };
}

function readEndpoint(host: unknown, port: unknown): { host: string; port: number } {
	if (
		typeof host !== 'string' ||
		!host.length ||
		/[\s\u0000-\u001f\u007f]/u.test(host) ||
		new TextEncoder().encode(host).byteLength > TARGET_CONNECTION_HOST_MAX_BYTES ||
		typeof port !== 'number' ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65535
	) {
		throw new InvalidRemoteDesktopPayload();
	}
	return { host, port };
}

function readPreviousFingerprint(value: unknown): string | null {
	if (value !== null && !isRdpCertificateFingerprint(value)) {
		throw new InvalidRemoteDesktopPayload();
	}
	return value;
}

function readRdpCertificate(value: unknown): RdpCertificateView {
	const item = record(
		value,
		[
			'connectionId',
			'host',
			'port',
			'fingerprint',
			'previousFingerprint',
			'subject',
			'issuer',
			'validFrom',
			'validTo',
			'reason',
		],
		REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
	);
	const endpoint = readEndpoint(item.host, item.port);
	const reason = RDP_CERTIFICATE_REASONS.find((candidate) => candidate === item.reason);
	if (
		typeof item.connectionId !== 'number' ||
		!Number.isSafeInteger(item.connectionId) ||
		item.connectionId < 1 ||
		!isRdpCertificateFingerprint(item.fingerprint) ||
		typeof item.subject !== 'string' ||
		typeof item.issuer !== 'string' ||
		typeof item.validFrom !== 'number' ||
		!Number.isSafeInteger(item.validFrom) ||
		typeof item.validTo !== 'number' ||
		!Number.isSafeInteger(item.validTo) ||
		item.validTo < item.validFrom ||
		reason === undefined
	) {
		throw new InvalidRemoteDesktopPayload();
	}
	const previousFingerprint = readPreviousFingerprint(item.previousFingerprint);
	const changed = previousFingerprint !== null && previousFingerprint !== item.fingerprint;
	if ((reason === 'changed') !== changed) {
		throw new InvalidRemoteDesktopPayload();
	}
	return {
		connectionId: item.connectionId,
		host: endpoint.host,
		port: endpoint.port,
		fingerprint: item.fingerprint,
		previousFingerprint,
		subject: item.subject,
		issuer: item.issuer,
		validFrom: item.validFrom,
		validTo: item.validTo,
		reason,
	};
}

export function readRemoteDesktopSessionRequest(value: unknown): RemoteDesktopSessionRequest {
	const body = record(value, ['certificate'], REMOTE_DESKTOP_RESPONSE_MAX_BYTES);
	if (body.certificate === null) {
		return { certificate: null };
	}
	const item = record(
		body.certificate,
		['host', 'port', 'fingerprint', 'previousFingerprint', 'remember'],
		REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
	);
	const endpoint = readEndpoint(item.host, item.port);
	if (!isRdpCertificateFingerprint(item.fingerprint) || typeof item.remember !== 'boolean') {
		throw new InvalidRemoteDesktopPayload();
	}
	return {
		certificate: {
			host: endpoint.host,
			port: endpoint.port,
			fingerprint: item.fingerprint,
			previousFingerprint: readPreviousFingerprint(item.previousFingerprint),
			remember: item.remember,
		},
	};
}
