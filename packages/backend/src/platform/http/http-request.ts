import type { IncomingMessage } from 'node:http';
import { HttpInputFailure } from './http-errors.js';

const requestCookies = new WeakMap<IncomingMessage, Readonly<Record<string, string | undefined>>>();

export function firstHeader(request: IncomingMessage, key: string): string | null {
	const raw = request.headers[key];
	if (Array.isArray(raw)) {
		return raw[0] ?? null;
	}
	return raw ?? null;
}

/** Apply the same ambiguity policy to native HTTP parsing and WS upgrade parsing. */
export function bindRequestCookies(request: IncomingMessage, cookies: Record<string, string | undefined>): void {
	const raw = firstHeader(request, 'cookie');
	if (!raw || raw.length > 8192) {
		for (const name of Object.keys(cookies)) {
			delete cookies[name];
		}
	} else {
		const names = new Set<string>();
		for (const part of raw.split(';')) {
			const separator = part.indexOf('=');
			if (separator < 0) {
				continue;
			}
			const name = part.slice(0, separator).trim();
			if (names.has(name)) {
				delete cookies[name];
			}
			names.add(name);
		}
	}
	requestCookies.set(request, cookies);
}

export function readRequestCookie(request: IncomingMessage, name: string): string | null {
	const cookies = requestCookies.get(request);
	if (!cookies) {
		throw new Error('Request cookies were not initialized by the HTTP transport');
	}
	return Object.hasOwn(cookies, name) ? (cookies[name] ?? null) : null;
}

function requestHost(request: IncomingMessage, trustedPeer: boolean): string | null {
	const forwardedHost = trustedPeer ? firstHeader(request, 'x-forwarded-host') : null;
	if (forwardedHost) {
		// Multiple proxy assertions are ambiguous; do not guess which hop supplied the truth.
		return forwardedHost.includes(',') ? null : forwardedHost.trim();
	}
	return firstHeader(request, 'host');
}

function requestProtocol(request: IncomingMessage, trustedPeer: boolean): string {
	const forwardedProto = trustedPeer ? firstHeader(request, 'x-forwarded-proto') : null;
	if (forwardedProto) {
		return forwardedProto.includes(',') ? '' : forwardedProto.trim();
	}
	return 'encrypted' in request.socket && request.socket.encrypted === true ? 'https' : 'http';
}

export function validateOrigin(request: IncomingMessage, origins: readonly URL[], trustedPeer: boolean): URL {
	const host = requestHost(request, trustedPeer);
	const protocol = requestProtocol(request, trustedPeer);
	const expectedOrigin = origins.find((origin) => host === origin.host && protocol === origin.protocol.slice(0, -1));
	if (!expectedOrigin) {
		throw new HttpInputFailure(403, 'invalid_host');
	}
	if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
		return expectedOrigin;
	}
	const site = firstHeader(request, 'sec-fetch-site');
	const rawOrigin = firstHeader(request, 'origin');
	if (site === 'same-site' || site === 'cross-site' || site === 'none') {
		throw new HttpInputFailure(403, 'csrf_rejected');
	}
	if (rawOrigin) {
		try {
			const origin = new URL(rawOrigin);
			if (origin.origin !== expectedOrigin.origin || rawOrigin !== origin.origin) {
				throw new HttpInputFailure(403, 'csrf_rejected');
			}
		} catch {
			throw new HttpInputFailure(403, 'csrf_rejected');
		}
	} else if (site !== 'same-origin') {
		// No origin and no positive browser same-origin metadata cannot prove
		// cookie-bearing mutation provenance.
		throw new HttpInputFailure(403, 'csrf_rejected');
	}
	return expectedOrigin;
}
