import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { once } from 'node:events';
import type { APIRequestContext } from '@playwright/test';
import { expect } from './fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from './auth';
import { E2E_URLS } from './test-env';
import { readOidcSettingsResponse, readOidcStartResponse } from '../../../packages/shared/src/access/oidc/http-codec';

/** A real signing IdP; tests use the production discovery, token exchange and JWT verifier. */
export async function openOidcProvider() {
	const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
	const publicKey = key.publicKey.export({ format: 'jwk' });
	let issuer = '';
	let subject = 'bound-account';
	let mode: 'normal' | 'nonce' | 'audience' | 'issuer' | 'expired' | 'signature' | 'no-id-token' = 'normal';
	let tokenCalls = 0;
	let rejection: unknown;
	let tokenGate: Promise<void> | null = null;
	const codes = new Map<string, URLSearchParams>();
	const seenVerifiers: string[] = [];

	const handler = async (
		request: import('node:http').IncomingMessage,
		response: import('node:http').ServerResponse,
	) => {
		const url = new URL(request.url ?? '/', issuer);
		response.setHeader('Content-Type', 'application/json');
		if (url.pathname === '/.well-known/openid-configuration') {
			response.end(
				JSON.stringify({
					issuer,
					authorization_endpoint: issuer + '/authorize',
					token_endpoint: issuer + '/token',
					jwks_uri: issuer + '/jwks',
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code'],
					subject_types_supported: ['public'],
					id_token_signing_alg_values_supported: ['RS256'],
					token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
					code_challenge_methods_supported: ['S256'],
					authorization_response_iss_parameter_supported: true,
				}),
			);
		} else if (url.pathname === '/jwks') {
			response.end(JSON.stringify({ keys: [{ ...publicKey, alg: 'RS256', use: 'sig', kid: 'e2e' }] }));
		} else if (url.pathname === '/authorize') {
			const query = authorize(url.href);
			const target = new URL(url.searchParams.get('redirect_uri') ?? '');
			target.searchParams.set('code', query.code);
			target.searchParams.set('state', query.state);
			target.searchParams.set('iss', issuer);
			response.writeHead(302, { Location: target.href });
			response.end();
		} else if (url.pathname === '/token') {
			tokenCalls += 1;
			const parts = [];
			for await (const chunk of request) {
				parts.push(Buffer.from(chunk));
			}
			const body = new URLSearchParams(Buffer.concat(parts).toString());
			const code = body.get('code') ?? '';
			const authorization = codes.get(code);
			codes.delete(code);
			const verifier = body.get('code_verifier') ?? '';
			seenVerifiers.push(verifier);
			const basic = request.headers.authorization?.startsWith('Basic ')
				? Buffer.from(request.headers.authorization.slice(6), 'base64')
						.toString()
						.split(':')
						.map((part) => decodeURIComponent(part.replaceAll('+', ' ')))
				: [];
			const authorized =
				(basic[0] === 'nexus-client' && basic[1] === 'oidc-test-secret') ||
				(body.get('client_id') === 'nexus-client' &&
					(body.get('client_secret') === 'oidc-test-secret' || body.get('client_secret') === null));
			if (
				!authorization ||
				!authorized ||
				authorization.get('code_challenge') !== createHash('sha256').update(verifier).digest('base64url') ||
				authorization.get('redirect_uri') !== body.get('redirect_uri')
			) {
				rejection = {
					hasCode: Boolean(authorization),
					authorized,
					authScheme: request.headers.authorization?.split(' ')[0],
					pkce:
						authorization?.get('code_challenge') ===
						createHash('sha256').update(verifier).digest('base64url'),
					redirect: authorization?.get('redirect_uri') === body.get('redirect_uri'),
					bodyKeys: [...body.keys()],
				};
				response.writeHead(400);
				response.end(JSON.stringify({ error: 'invalid_grant' }));
				return;
			}
			if (tokenGate) {
				await tokenGate;
			}
			const now = Math.floor(Date.now() / 1000);
			const claims = {
				iss: mode === 'issuer' ? issuer + '/wrong' : issuer,
				sub: subject,
				aud: mode === 'audience' ? 'another-client' : 'nexus-client',
				exp: mode === 'expired' ? now - 3600 : now + 300,
				iat: now,
				nonce: mode === 'nonce' ? 'wrong-nonce' : authorization.get('nonce'),
			};
			const data =
				Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'e2e' })).toString('base64url') +
				'.' +
				Buffer.from(JSON.stringify(claims)).toString('base64url');
			const jwt =
				data +
				'.' +
				sign(
					'RSA-SHA256',
					Buffer.from(data),
					mode === 'signature' ? wrongKey.privateKey : key.privateKey,
				).toString('base64url');
			response.end(
				JSON.stringify({
					access_token: 'not-retained',
					token_type: 'Bearer',
					expires_in: 300,
					...(mode === 'no-id-token' ? {} : { id_token: jwt }),
				}),
			);
		} else {
			response.writeHead(404);
			response.end('{}');
		}
	};

	const server = createServer((request, response) => {
		void handler(request, response).catch(() => {
			response.writeHead(500);
			response.end('{}');
		});
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Missing IdP address');
	}
	issuer = 'http://127.0.0.1:' + address.port;

	function authorize(url: string) {
		const params = new URL(url).searchParams;
		expect(params.get('scope')).toBe('openid');
		expect(params.get('code_challenge_method')).toBe('S256');
		expect(params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u);
		const state = params.get('state');
		if (!state) {
			throw new Error('Missing state');
		}
		const code = randomUUID();
		codes.set(code, params);
		return { code, state, issuer, error: null };
	}

	return {
		issuer,
		authorize,

		setSubject(value: string) {
			subject = value;
		},

		setMode(value: typeof mode) {
			mode = value;
		},

		setTokenGate(gate: Promise<void> | null) {
			tokenGate = gate;
		},

		get rejection() {
			return rejection;
		},

		get tokenCalls() {
			return tokenCalls;
		},

		get seenVerifiers() {
			return [...seenVerifiers];
		},

		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		},
	};
}

export const oidcHeaders = { Origin: E2E_URLS.frontendOrigin };

export async function configureOidc(
	request: APIRequestContext,
	issuer: string,
	authentication: 'client_secret_basic' | 'client_secret_post' | 'none' = 'client_secret_basic',
) {
	await loginAsInitialAdmin(request);
	const c = readOidcSettingsResponse(await (await request.get('/api/v1/auth/oidc/settings')).json());
	const response = await request.put('/api/v1/auth/oidc/settings', {
		headers: oidcHeaders,
		data: {
			revision: c.revision,
			enabled: true,
			label: 'Pocket ID',
			issuer,
			clientId: 'nexus-client',
			clientAuthentication: authentication,
			secret: authentication === 'none' ? { action: 'clear' } : { action: 'replace', value: 'oidc-test-secret' },
			password: E2E_ADMIN.password,
		},
	});
	expect(response.status(), await response.text()).toBe(200);
	const saved = await request.get('/api/v1/auth/oidc/settings');
	expect(await saved.text()).not.toContain('oidc-test-secret');
	return readOidcSettingsResponse(await saved.json());
}

export async function startOidc(request: APIRequestContext, purpose: 'login' | 'binding', revision?: string | null) {
	const response = await request.post('/api/v1/auth/oidc/' + purpose + '/start', {
		headers: oidcHeaders,
		data: purpose === 'binding' ? { revision, password: E2E_ADMIN.password } : { rememberMe: true },
	});
	expect(response.status(), await response.text()).toBe(200);
	expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
	return readOidcStartResponse(await response.json()).authorizationUrl;
}

export async function bindOidc(
	request: APIRequestContext,
	provider: Awaited<ReturnType<typeof openOidcProvider>>,
	revision: string | null,
) {
	const input = provider.authorize(await startOidc(request, 'binding', revision));
	const bound = await request.post('/api/v1/auth/oidc/binding/finish', { headers: oidcHeaders, data: input });
	expect(bound.status(), (await bound.text()) + JSON.stringify(provider.rejection)).toBe(200);
	expect(await bound.json()).toEqual({ completed: 'binding' });
}
