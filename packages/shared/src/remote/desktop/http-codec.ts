import {
	REMOTE_DESKTOP_MIN_DIMENSION,
	REMOTE_DESKTOP_MAX_DIMENSION,
	REMOTE_DESKTOP_MIN_DPI,
	REMOTE_DESKTOP_MAX_DPI,
	REMOTE_DESKTOP_RESPONSE_MAX_BYTES,
	REMOTE_DESKTOP_ERROR_CODES,
} from './values.js';
import type {
	RemoteDesktopDisplayRequest,
	RemoteDesktopSessionPath,
	RemoteDesktopSessionResponse,
	RemoteDesktopFailureResponse,
} from './http.js';
import { record, integer } from '../../common/http-codec.js';

export class InvalidRemoteDesktopPayload extends Error {
	constructor() {
		super('Invalid remote desktop request');
		this.name = 'InvalidRemoteDesktopPayload';
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
	const item = record(value, ['ticket', 'lastConnectedAt'], REMOTE_DESKTOP_RESPONSE_MAX_BYTES);
	if (typeof item.ticket !== 'string') {
		throw new InvalidRemoteDesktopPayload();
	}
	return {
		ticket: readRemoteDesktopTicket(new URLSearchParams({ ticket: item.ticket })),
		lastConnectedAt: integer(item.lastConnectedAt, 1, Math.floor(Number.MAX_SAFE_INTEGER / 1000)),
	};
}

export function readRemoteDesktopFailureResponse(value: unknown): RemoteDesktopFailureResponse {
	const item = record(value, ['code'], REMOTE_DESKTOP_RESPONSE_MAX_BYTES);
	const code = REMOTE_DESKTOP_ERROR_CODES.find((candidate) => candidate === item.code);
	if (code === undefined) {
		throw new InvalidRemoteDesktopPayload();
	}
	return { code };
}
