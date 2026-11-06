import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import { readOidcFinishRequest } from '@nexus-terminal/shared/access/oidc/http-codec';
import type { OidcCallback } from '../model/oidc-types';

const purposeKey = 'nexus-oidc-purpose';

export function redirectToOidc(url: string, purpose: 'login' | 'binding'): void {
	const target = new URL(url);
	if (
		target.protocol !== 'https:' &&
		!(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
	) {
		throw new InvalidPayload();
	}
	window.sessionStorage.setItem(purposeKey, purpose);
	window.location.assign(target.href);
}

export function consumeOidcCallback(): { purpose: 'login' | 'binding'; response: OidcCallback } {
	const query = new URL(window.location.href).searchParams;
	// Remove authorization codes before any subsequent route change, including failures.
	window.history.replaceState(window.history.state, '', window.location.pathname);
	const purpose = window.sessionStorage.getItem(purposeKey);
	window.sessionStorage.removeItem(purposeKey);
	if (purpose !== 'login' && purpose !== 'binding') {
		throw new InvalidPayload();
	}
	for (const key of ['code', 'state', 'iss', 'error']) {
		if (query.getAll(key).length > 1) {
			throw new InvalidPayload();
		}
	}
	const result = readOidcFinishRequest({
		code: query.get('code'),
		state: query.get('state'),
		issuer: query.get('iss'),
		error: query.get('error'),
	});
	return {
		purpose,
		response: { code: result.code, state: result.state, issuer: result.issuer, error: result.error },
	};
}
