import * as client from 'openid-client';
import { ACCESS_FACTOR_RESPONSE_MAX_BYTES } from '@nexus-terminal/shared/access/values';
import {
	OidcProtocolFailure,
	type OidcAuthorization,
	type OidcAuthorizationResponse,
	type OidcClientConfiguration,
	type OidcProtocol,
} from '../oidc-port.js';

function isLoopback(url: URL): boolean {
	return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/** Allow HTTP only for a local IdP; redirects cannot broaden this transport policy. */
function checkEndpoint(url: URL, issuer: URL): void {
	if (
		url.username ||
		url.password ||
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(issuer) && url.origin === issuer.origin))
	) {
		throw new OidcProtocolFailure('unavailable');
	}
}

async function configuration(input: OidcClientConfiguration, signal: AbortSignal): Promise<client.Configuration> {
	const issuer = new URL(input.issuer);
	checkEndpoint(issuer, issuer);
	const auth =
		input.clientAuthentication === 'none'
			? client.None()
			: input.clientAuthentication === 'client_secret_post'
				? client.ClientSecretPost(input.clientSecret ?? undefined)
				: client.ClientSecretBasic(input.clientSecret ?? undefined);

	const fetcher: client.CustomFetch = async (url, options) => {
		checkEndpoint(new URL(url), issuer);
		const response = await fetch(url, {
			method: options.method,
			headers: options.headers,
			body: options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body,
			redirect: 'error',
			signal: options?.signal ? AbortSignal.any([signal, options.signal]) : signal,
		});
		// Reuse the existing authentication JSON response envelope; enforce while reading.
		let bytes = 0;
		const body = response.body?.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					bytes += chunk.byteLength;
					if (bytes > ACCESS_FACTOR_RESPONSE_MAX_BYTES) {
						throw new OidcProtocolFailure('unavailable');
					}
					controller.enqueue(chunk);
				},
			}),
		);
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};

	const config = await client.discovery(issuer, input.clientId, undefined, auth, {
		[client.customFetch]: fetcher,
		execute:
			issuer.protocol === 'http:'
				? [client.allowInsecureRequests, client.enableNonRepudiationChecks]
				: [client.enableNonRepudiationChecks],
	});
	const server = config.serverMetadata();
	if (!server.authorization_endpoint || !server.token_endpoint || !server.jwks_uri) {
		throw new OidcProtocolFailure('unavailable');
	}
	for (const endpoint of [server.authorization_endpoint, server.token_endpoint, server.jwks_uri]) {
		checkEndpoint(new URL(endpoint), issuer);
	}
	return config;
}

async function protocolBoundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof OidcProtocolFailure) {
			throw cause;
		}
		if (
			cause instanceof client.AuthorizationResponseError ||
			(cause instanceof client.ResponseBodyError && cause.error === 'invalid_grant')
		) {
			throw new OidcProtocolFailure('rejected', { cause });
		}
		throw new OidcProtocolFailure('unavailable', { cause });
	}
}

export class OpenidClient implements OidcProtocol {
	authorize(input: OidcClientConfiguration, authorization: OidcAuthorization, signal: AbortSignal): Promise<string> {
		return protocolBoundary(async () => {
			const config = await configuration(input, signal);
			return client.buildAuthorizationUrl(config, {
				redirect_uri: authorization.redirectUri,
				scope: 'openid',
				response_type: 'code',
				response_mode: 'query',
				code_challenge_method: 'S256',
				code_challenge: await client.calculatePKCECodeChallenge(authorization.verifier),
				state: authorization.state,
				nonce: authorization.nonce,
			}).href;
		});
	}

	verify(
		input: OidcClientConfiguration,
		authorization: OidcAuthorization,
		response: OidcAuthorizationResponse,
		signal: AbortSignal,
	): Promise<{ issuer: string; subject: string }> {
		return protocolBoundary(async () => {
			const config = await configuration(input, signal);
			const url = new URL(authorization.redirectUri);
			url.searchParams.set('state', response.state);
			if (response.code !== null) {
				url.searchParams.set('code', response.code);
			}
			if (response.issuer !== null) {
				url.searchParams.set('iss', response.issuer);
			}
			if (response.error !== null) {
				url.searchParams.set('error', response.error);
			}
			const result = await client.authorizationCodeGrant(config, url, {
				pkceCodeVerifier: authorization.verifier,
				expectedState: authorization.state,
				expectedNonce: authorization.nonce,
				idTokenExpected: true,
			});
			const claims = result.claims();
			if (!claims || typeof claims.iss !== 'string' || typeof claims.sub !== 'string' || !claims.sub) {
				throw new OidcProtocolFailure('rejected');
			}
			return { issuer: claims.iss, subject: claims.sub };
		});
	}
}
