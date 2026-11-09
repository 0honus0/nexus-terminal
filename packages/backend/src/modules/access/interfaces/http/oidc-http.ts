import { InvalidPayload } from '@nexus-terminal/shared/common/http-codec';
import {
	readOidcSettingsRequest,
	readOidcBindingRequest,
	readOidcStartRequest,
	readOidcFinishRequest,
} from '@nexus-terminal/shared/access/oidc/http-codec';
import type {
	OidcSettingsResponse,
	OidcStartResponse,
	OidcFinishResponse,
	OidcChangedResponse,
} from '@nexus-terminal/shared/access/oidc/http';
import { ACCESS_OIDC_CALLBACK_PATH, ACCESS_OIDC_FLOW_COOKIE } from '@nexus-terminal/shared/access/oidc/values';
import {
	ACCESS_AUTH_REQUEST_MAX_BYTES,
	ACCESS_AUTH_RESPONSE_MAX_BYTES,
	ACCESS_SESSION_COOKIE_NAME,
	ACCESS_REMEMBER_SECONDS,
	ACCESS_PARTIAL_SECONDS,
} from '@nexus-terminal/shared/access/values';
import type { HttpRequest, HttpReply, HttpRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AccessOperationError, accessBoundary } from '../../access-errors.js';
import type { OidcService } from '../../oidc/service/oidc-service.js';
import { serializeAccessCookie } from './access-cookie.js';
import { deliverAccessResult } from './access-delivery.js';

function session(request: HttpRequest): string | null {
	return readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
}

function flowCookie(request: HttpRequest): string | null {
	return readRequestCookie(request.raw, ACCESS_OIDC_FLOW_COOKIE);
}

function callback(request: HttpRequest): string {
	return new URL(ACCESS_OIDC_CALLBACK_PATH, request.origin).href;
}

function errorHandler(error: unknown, _request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof AccessOperationError) && !(error instanceof InvalidPayload)) {
		throw error;
	}
	const code = error instanceof InvalidPayload ? 'invalid_input' : error.code;
	const status =
		code === 'invalid_input'
			? 400
			: code === 'unauthenticated' || code === 'invalid_credentials'
				? 401
				: code === 'forbidden'
					? 403
					: code === 'conflict'
						? 409
						: code === 'challenge_expired'
							? 410
							: code === 'limit_exceeded'
								? 429
								: code === 'internal_failure'
									? 500
									: 503;
	reply.removeHeader('Set-Cookie');
	reply.code(status).send({ code });
}

export function createOidcRoutes(service: OidcService, secure: boolean): HttpRoute[] {
	const routes: HttpRoute[] = [
		{
			method: 'GET',
			url: '/api/v1/auth/oidc/settings',

			handler: async (request, reply) => {
				const result = await accessBoundary(() => service.settings(session(request)));
				reply.send({
					revision: result.revision,
					label: result.label,
					issuer: result.issuer,
					clientId: result.clientId,
					clientAuthentication: result.clientAuthentication,
					hasSecret: result.hasSecret,
					bound: result.bound,
					callbackUrl: callback(request),
				} satisfies OidcSettingsResponse);
			},
		},
		{
			method: 'PUT',
			url: '/api/v1/auth/oidc/settings',

			handler: async (request, reply) => {
				const input = readOidcSettingsRequest(request.body);
				await accessBoundary(() =>
					service.save(session(request), input.password, {
						revision: input.revision,
						label: input.label,
						issuer: input.issuer,
						clientId: input.clientId,
						clientAuthentication: input.clientAuthentication,
						secret:
							input.secret.action === 'replace'
								? { action: 'replace', value: input.secret.value }
								: { action: input.secret.action },
					}),
				);
				reply.send({ changed: true } satisfies OidcChangedResponse);
			},
		},
		{
			method: 'DELETE',
			url: '/api/v1/auth/oidc/binding',

			handler: async (request, reply) => {
				const input = readOidcBindingRequest(request.body);
				await accessBoundary(() => service.unbind(session(request), input.password, input.revision));
				reply.send({ changed: true } satisfies OidcChangedResponse);
			},
		},
	];
	for (const purpose of ['login', 'binding'] as const) {
		routes.push({
			method: 'POST',
			url: '/api/v1/auth/oidc/' + purpose + '/start',

			handler: async (request, reply) => {
				const binding = purpose === 'binding' ? readOidcBindingRequest(request.body) : null;
				const login = purpose === 'login' ? readOidcStartRequest(request.body) : null;
				await deliverAccessResult(
					request,
					reply,
					(signal) =>
						service.start(
							{
								purpose,
								token: session(request),
								previousCookie: flowCookie(request),
								revision: binding?.revision ?? null,
								redirectUri: callback(request),
								rememberMe: login?.rememberMe ?? false,
								source: request.ip,
								signal,
							},
							binding?.password ?? null,
						),
					(result) => {
						reply
							.header(
								'Set-Cookie',
								serializeAccessCookie(reply, ACCESS_OIDC_FLOW_COOKIE, result.cookie, {
									secure,
									maxAge: ACCESS_PARTIAL_SECONDS,
								}),
							)
							.send({ authorizationUrl: result.authorizationUrl } satisfies OidcStartResponse);
					},
					(result) => service.discard(result.cookie),
				);
			},
		});
		routes.push({
			method: 'POST',
			url: '/api/v1/auth/oidc/' + purpose + '/finish',

			handler: async (request, reply) => {
				const input = readOidcFinishRequest(request.body);
				await deliverAccessResult(
					request,
					reply,
					(signal) =>
						service.finish(
							flowCookie(request),
							session(request),
							callback(request),
							{ code: input.code, state: input.state, issuer: input.issuer, error: input.error },
							request.ip,
							signal,
							purpose,
						),
					(result) => {
						const cookies = [
							serializeAccessCookie(reply, ACCESS_OIDC_FLOW_COOKIE, '', { secure, maxAge: 0 }),
						];
						if (result.purpose === 'login') {
							cookies.push(
								serializeAccessCookie(reply, ACCESS_SESSION_COOKIE_NAME, result.token, {
									secure,
									maxAge: result.rememberMe ? ACCESS_REMEMBER_SECONDS : undefined,
								}),
							);
						}
						reply
							.header('Set-Cookie', cookies)
							.send({ completed: result.purpose } satisfies OidcFinishResponse);
					},
					async (result) => {
						if (result.purpose === 'login') {
							await service.revoke(result.token);
						}
					},
				);
			},
		});
	}
	for (const route of routes) {
		const handler = route.handler;
		route.handler = async function (request, reply) {
			try {
				return await handler.call(this, request, reply);
			} catch (error) {
				if (reply.sent || reply.raw.destroyed) {
					throw error;
				}
				if (error instanceof InvalidPayload || error instanceof AccessOperationError) {
					errorHandler(error, request, reply);
					return;
				}
				throw error;
			}
		};
		route.bodyLimit = ACCESS_AUTH_REQUEST_MAX_BYTES;
		route.errorHandler = errorHandler;
		route.preHandler = async (request, reply) => {
			if (request.query.size !== 0) {
				throw new InvalidPayload();
			}
			reply.header('Cache-Control', 'no-store').type('application/json; charset=utf-8');
			reply.serializer((value) => {
				const encoded = JSON.stringify(value);
				if (Buffer.byteLength(encoded) > ACCESS_AUTH_RESPONSE_MAX_BYTES) {
					throw new AccessOperationError('limit_exceeded');
				}
				return encoded;
			});
		};
	}
	return routes;
}
