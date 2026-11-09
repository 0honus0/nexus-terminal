import type { LoginOptionsModel } from '../../login-options/model/login-options-model.js';
import type { OidcService } from '../../oidc/service/oidc-service.js';
import { ACCESS_OIDC_FLOW_COOKIE } from '@nexus-terminal/shared/access/oidc/values';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import {
	ACCESS_AUTH_REQUEST_MAX_BYTES,
	ACCESS_LOGIN_OPTIONS_RESPONSE_MAX_BYTES,
	ACCESS_IP_BLACKLIST_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/access/values';
import { deliverAccessResult } from './access-delivery.js';
import { serializeAccessCookie } from './access-cookie.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import type { AccessService } from '../../authentication/service/access-service.js';
import { AccessOperationError, accessBoundary } from '../../access-errors.js';
import type { AuthenticatedIdentity } from '../../authentication/model/access-types.js';
import {
	type AccessNeedsSetupResponse,
	type AccessSetupResponse,
	type AccessLoginResponse,
	type AccessPendingTwoFactorResponse,
	type AccessStatusResponse,
	type AccessLogoutResponse,
	type AccessPasswordResponse,
	type AccessHttpErrorResponse,
	type AccessLoginOptionsResponse,
	type AccessIpBlacklistResponse,
	type AccessIpBlacklistRemoveResponse,
	InvalidAccessPayload,
	readAccessSetupRequest,
	readAccessLoginRequest,
	readAccessPasswordRequest,
	readAccessIpBlacklistQuery,
	readAccessIpBlacklistRemoveRequest,
} from '@nexus-terminal/shared/access/http';
import { type AccessUserView } from '@nexus-terminal/shared/access/model';
import {
	ACCESS_SESSION_COOKIE_NAME,
	ACCESS_REMEMBER_SECONDS,
	ACCESS_PARTIAL_COOKIE_NAME,
	ACCESS_PARTIAL_SECONDS,
} from '@nexus-terminal/shared/access/values';
import { ACCESS_CHALLENGE_COOKIE_NAME, ACCESS_TOTP_SETUP_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { FactorService } from '../../factors/service/factor-service.js';

function readSession(request: HttpRequest): string | null {
	return readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
}

function toUser(identity: AuthenticatedIdentity): AccessUserView {
	return { id: identity.userId, username: identity.username, twoFactorEnabled: identity.twoFactorEnabled };
}

function errorResponse(reply: HttpReply, error: unknown): void {
	if (!(error instanceof AccessOperationError)) {
		reply.code(500).send({ code: 'internal_failure' } satisfies AccessHttpErrorResponse);
		return;
	}
	const code = error.code;
	let status: number;
	switch (code) {
		case 'invalid_input':
			status = 400;
			break;
		case 'already_initialized':
		case 'conflict':
			status = 409;
			break;
		case 'limit_exceeded':
			status = 429;
			break;
		case 'unauthenticated':
		case 'invalid_credentials':
			status = 401;
			break;
		case 'forbidden':
			status = 403;
			break;
		case 'captcha_unavailable':
		case 'factor_unavailable':
		case 'operation_unknown':
		case 'storage_unavailable':
			status = 503;
			break;
		default:
			status = 500;
	}
	reply.code(status).send({ code } satisfies AccessHttpErrorResponse);
}

async function handle(
	request: HttpRequest,
	reply: HttpReply,
	action: () => Promise<void>,
	acceptsQuery = false,
): Promise<void> {
	try {
		// Only the blacklist list endpoint accepts query parameters.
		if (!acceptsQuery && request.query.size > 0) {
			throw new AccessOperationError('invalid_input');
		}
		await action();
	} catch (error) {
		if (error instanceof InvalidAccessPayload || error instanceof AccessOperationError) {
			errorResponse(
				reply,
				error instanceof InvalidAccessPayload ? new AccessOperationError('invalid_input') : error,
			);
			return;
		}
		// HTTP parsing/size/content-type failures belong to the HTTP runtime.
		throw error;
	}
}

/** Access owns its own endpoints; HTTP runtime never receives Access storage or SQL ports. */
export function createAccessRoutes(
	access: AccessService,
	factors: FactorService,
	secureCookies: boolean,
	oidc: OidcService,
	loginOptions: LoginOptionsModel,
): HttpRoute[] {
	return [
		{
			method: 'GET',
			url: '/api/v1/auth/login/options',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const methods = await accessBoundary(() => loginOptions.read());
					const config = access.captchaConfig();
					reply.type('application/json; charset=utf-8');
					reply.serializer((payload) => {
						const encoded = JSON.stringify(payload);
						if (Buffer.byteLength(encoded, 'utf8') > ACCESS_LOGIN_OPTIONS_RESPONSE_MAX_BYTES) {
							throw new AccessOperationError('limit_exceeded');
						}
						return encoded;
					});
					reply.code(200).send({
						captcha: {
							enabled: config.enabled,
							provider: config.provider,
							hcaptchaSiteKey: config.hcaptchaSiteKey,
							recaptchaSiteKey: config.recaptchaSiteKey,
						},
						oidc: methods.oidcLabel === null ? null : { label: methods.oidcLabel },
						hasPasskeys: methods.hasPasskeys,
					} satisfies AccessLoginOptionsResponse);
				}),
		},
		{
			method: 'GET',
			url: '/api/v1/auth/needs-setup',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const needsSetup = await accessBoundary(() => access.needsSetup());
					reply.code(200).send({ needsSetup: Boolean(needsSetup) } satisfies AccessNeedsSetupResponse);
				}),
		},
		{
			method: 'POST',
			url: '/api/v1/auth/setup',
			bodyLimit: ACCESS_AUTH_REQUEST_MAX_BYTES,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const data = readAccessSetupRequest(request.body);
					const identity = await accessBoundary(() => access.setupAdmin(data.username, data.password));
					reply.code(201).send({ user: toUser(identity) } satisfies AccessSetupResponse);
				}),
		},
		{
			method: 'POST',
			url: '/api/v1/auth/login',
			bodyLimit: ACCESS_AUTH_REQUEST_MAX_BYTES,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const data = readAccessLoginRequest(request.body);
					await deliverAccessResult(
						request,
						reply,
						(signal) =>
							access.login({
								username: data.username,
								password: data.password,
								rememberMe: data.rememberMe === true,
								source: request.ip,
								captchaToken: data.captchaToken,
								previousPartialToken: readRequestCookie(request.raw, ACCESS_PARTIAL_COOKIE_NAME),
								signal,
							}),
						(result) => {
							if (result.status === 'requires_two_factor') {
								const cookie = serializeAccessCookie(reply, ACCESS_PARTIAL_COOKIE_NAME, result.token, {
									secure: secureCookies,
									maxAge: ACCESS_PARTIAL_SECONDS,
								});
								reply
									.code(200)
									.headers({ 'Set-Cookie': cookie })
									.send({ requiresTwoFactor: true } satisfies AccessPendingTwoFactorResponse);
								return;
							}
							if (result.status !== 'authenticated') {
								const code = result.status;
								reply
									.code(
										code === 'rate_limited' || code === 'limit_exceeded'
											? 429
											: code === 'factor_unavailable'
												? 403
												: 401,
									)
									.send({ code } satisfies AccessHttpErrorResponse);
								return;
							}
							reply
								.code(200)
								.headers({
									'Set-Cookie': serializeAccessCookie(
										reply,
										ACCESS_SESSION_COOKIE_NAME,
										result.token,
										{
											secure: secureCookies,
											maxAge: result.rememberMe ? ACCESS_REMEMBER_SECONDS : undefined,
										},
									),
								})
								.send({
									user: toUser(result.identity),
									requiresTwoFactor: false,
								} satisfies AccessLoginResponse);
						},
						async (result) => {
							if (result.status === 'authenticated') {
								await access.logout(result.token);
							} else if (result.status === 'requires_two_factor') {
								await factors.logoutFlows(result.token, null, null);
							}
						},
					);
				}),
		},
		{
			method: 'GET',
			url: '/api/v1/auth/status',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const identity = await accessBoundary(() => access.authenticate(readSession(request)));
					if (identity === null) {
						reply.code(401).send({ code: 'unauthenticated' } satisfies AccessHttpErrorResponse);
					} else {
						reply.code(200).send({
							isAuthenticated: true,
							user: toUser(identity),
						} satisfies AccessStatusResponse);
					}
				}),
		},
		{
			method: 'POST',
			url: '/api/v1/auth/logout',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const token = readSession(request);
					const oidcCookie = readRequestCookie(request.raw, ACCESS_OIDC_FLOW_COOKIE);
					const results = await Promise.allSettled([
						accessBoundary(async () => {
							if (oidcCookie !== null) {
								await oidc.discard(oidcCookie);
							}
						}),
						accessBoundary(() => access.logout(token)),
						accessBoundary(() =>
							factors.logoutFlows(
								readRequestCookie(request.raw, ACCESS_PARTIAL_COOKIE_NAME),
								readRequestCookie(request.raw, ACCESS_CHALLENGE_COOKIE_NAME),
								readRequestCookie(request.raw, ACCESS_TOTP_SETUP_COOKIE_NAME),
							),
						),
					]);
					const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
					if (failures.length > 0) {
						throw new AggregateError(failures, 'Access logout cleanup incomplete');
					}
					reply
						.code(200)
						.headers({
							'Set-Cookie': [
								ACCESS_OIDC_FLOW_COOKIE,
								ACCESS_SESSION_COOKIE_NAME,
								ACCESS_PARTIAL_COOKIE_NAME,
								ACCESS_CHALLENGE_COOKIE_NAME,
								ACCESS_TOTP_SETUP_COOKIE_NAME,
							].map((name) =>
								serializeAccessCookie(reply, name, '', { secure: secureCookies, maxAge: 0 }),
							),
						})
						.send({ loggedOut: true } satisfies AccessLogoutResponse);
				}),
		},
		{
			method: 'PUT',
			url: '/api/v1/auth/password',
			bodyLimit: ACCESS_AUTH_REQUEST_MAX_BYTES,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const data = readAccessPasswordRequest(request.body);
					await accessBoundary(() =>
						access.changePassword(readSession(request), data.currentPassword, data.newPassword),
					);
					reply
						.code(200)
						.headers({
							'Set-Cookie': serializeAccessCookie(reply, ACCESS_SESSION_COOKIE_NAME, '', {
								secure: secureCookies,
								maxAge: 0,
							}),
						})
						.send({ passwordChanged: true } satisfies AccessPasswordResponse);
				}),
		},
		{
			method: 'GET',
			url: '/api/v1/settings/ip-blacklist',

			errorHandler(error, _request, reply) {
				if (!(error instanceof AccessOperationError)) {
					throw error;
				}
				reply.removeHeader('Set-Cookie');
				reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
				errorResponse(reply, error);
			},

			handler: (request, reply) =>
				handle(
					request,
					reply,
					async () => {
						const { limit, offset } = readAccessIpBlacklistQuery(request.query);
						const page = await accessBoundary(() =>
							access.listLoginFailures(readSession(request), limit, offset),
						);
						const body = {
							entries: page.entries.map((entry) => ({
								ip: entry.sourceIp,
								attempts: entry.attempts,
								lastAttemptAt: Math.floor(entry.lastAttemptAt / 1000),
								blockedUntil:
									entry.blockedUntil === null ? null : Math.floor(entry.blockedUntil / 1000),
							})),
							total: page.total,
						} satisfies AccessIpBlacklistResponse;
						reply.type('application/json; charset=utf-8').serializer((payload) => {
							let encoded: string;
							try {
								encoded = JSON.stringify(payload);
							} catch {
								throw new AccessOperationError('internal_failure');
							}
							if (Buffer.byteLength(encoded, 'utf8') > ACCESS_IP_BLACKLIST_RESPONSE_MAX_BYTES) {
								throw new AccessOperationError('limit_exceeded');
							}
							return encoded;
						});
						reply.code(200).send(body);
					},
					true,
				),
		},
		{
			method: 'DELETE',
			url: '/api/v1/settings/ip-blacklist',

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const input = readAccessIpBlacklistRemoveRequest(request.body);
					const removed = await accessBoundary(() =>
						access.clearLoginFailure(readSession(request), input.ip),
					);
					reply.code(200).send({ removed } satisfies AccessIpBlacklistRemoveResponse);
				}),
		},
	];
}
