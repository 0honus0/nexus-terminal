import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { AccessService } from '../../authentication/service/access-service.js';
import { AccessOperationError, accessBoundary } from '../../access-errors.js';
import type { AuthenticatedIdentity } from '../../authentication/model/access-types.js';
import {
	type AccessNeedsSetupResponse,
	type AccessSetupResponse,
	type AccessLoginResponse,
	type AccessStatusResponse,
	type AccessLogoutResponse,
	type AccessPasswordResponse,
	type AccessHttpErrorResponse,
	type AccessCaptchaConfigResponse,
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
import { ACCESS_SESSION_COOKIE_NAME, ACCESS_REMEMBER_SECONDS } from '@nexus-terminal/shared/access/values';

function readSession(context: HttpRouteContext): string | null {
	return context.cookie(ACCESS_SESSION_COOKIE_NAME);
}

function cookieHeader(token: string, rememberMe: boolean, secure: boolean): string {
	const attributes = [ACCESS_SESSION_COOKIE_NAME + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
	if (secure) {
		attributes.push('Secure');
	}
	if (rememberMe) {
		attributes.push('Max-Age=' + ACCESS_REMEMBER_SECONDS);
	}
	return attributes.join('; ');
}

function clearedCookie(secure: boolean): string {
	return [
		ACCESS_SESSION_COOKIE_NAME + '=',
		'Path=/',
		'HttpOnly',
		'SameSite=Lax',
		'Max-Age=0',
		...(secure ? ['Secure'] : []),
	].join('; ');
}

function toUser(identity: AuthenticatedIdentity): AccessUserView {
	return { id: identity.userId, username: identity.username, twoFactorEnabled: identity.twoFactorEnabled };
}

async function requireIdentity(
	context: HttpRouteContext,
	access: AccessService,
): Promise<AuthenticatedIdentity | null> {
	const identity = await accessBoundary(() => access.authenticate(readSession(context)));
	if (identity === null) {
		context.send(401, { code: 'unauthenticated' } satisfies AccessHttpErrorResponse);
		return null;
	}
	return identity;
}

function errorResponse(context: HttpRouteContext, error: unknown): void {
	if (!(error instanceof AccessOperationError)) {
		context.send(500, { code: 'internal_failure' } satisfies AccessHttpErrorResponse);
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
		case 'unauthenticated':
		case 'invalid_credentials':
			status = 401;
			break;
		case 'forbidden':
			status = 403;
			break;
		case 'captcha_unavailable':
		case 'operation_unknown':
		case 'storage_unavailable':
			status = 503;
			break;
		default:
			status = 500;
	}
	context.send(status, { code } satisfies AccessHttpErrorResponse);
}

async function handle(context: HttpRouteContext, action: () => Promise<void>, acceptsQuery = false): Promise<void> {
	try {
		// Only the blacklist list endpoint accepts query parameters.
		if (!acceptsQuery && context.query.size > 0) {
			throw new AccessOperationError('invalid_input');
		}
		await action();
	} catch (error) {
		if (error instanceof InvalidAccessPayload || error instanceof AccessOperationError) {
			errorResponse(
				context,
				error instanceof InvalidAccessPayload ? new AccessOperationError('invalid_input') : error,
			);
			return;
		}
		// HTTP parsing/size/content-type failures belong to the HTTP runtime.
		throw error;
	}
}

/** Access owns its own endpoints; HTTP runtime never receives Access storage or SQL ports. */
export function createAccessRoutes(access: AccessService, secureCookies: boolean): HttpRoute[] {
	return [
		{
			method: 'GET',
			path: '/api/v1/auth/captcha/config',

			handle: (context) =>
				handle(context, async () => {
					const config = access.captchaConfig();
					context.send(200, {
						enabled: config.enabled,
						provider: config.provider,
						hcaptchaSiteKey: config.hcaptchaSiteKey,
						recaptchaSiteKey: config.recaptchaSiteKey,
					} satisfies AccessCaptchaConfigResponse);
				}),
		},
		{
			method: 'GET',
			path: '/api/v1/auth/needs-setup',

			handle: (context) =>
				handle(context, async () => {
					const needsSetup = await accessBoundary(() => access.needsSetup());
					context.send(200, { needsSetup: Boolean(needsSetup) } satisfies AccessNeedsSetupResponse);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/setup',

			handle: (context) =>
				handle(context, async () => {
					const data = readAccessSetupRequest(await context.json());
					const identity = await accessBoundary(() => access.setupAdmin(data.username, data.password));
					context.send(201, { user: toUser(identity) } satisfies AccessSetupResponse);
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/login',

			handle: (context) =>
				handle(context, async () => {
					const data = readAccessLoginRequest(await context.json());
					const cancelled = new AbortController();

					const onClose = () => {
						if (!context.response.writableFinished) {
							cancelled.abort();
						}
					};

					context.response.once('close', onClose);
					if (context.response.destroyed || context.request.aborted) {
						cancelled.abort();
					}
					try {
						const result = await accessBoundary(() =>
							access.login({
								username: data.username,
								password: data.password,
								rememberMe: data.rememberMe === true,
								source: context.sourceIp,
								captchaToken: data.captchaToken,
								signal: cancelled.signal,
							}),
						);
						if (cancelled.signal.aborted) {
							if (result.status === 'authenticated') {
								await accessBoundary(() => access.logout(result.token));
							}
							return;
						}
						if (result.status !== 'authenticated') {
							const code = result.status;
							context.send(code === 'rate_limited' ? 429 : code === 'factor_unavailable' ? 403 : 401, {
								code,
							} satisfies AccessHttpErrorResponse);
							return;
						}
						context.send(
							200,
							{ user: toUser(result.identity), requiresTwoFactor: false } satisfies AccessLoginResponse,
							{ 'Set-Cookie': cookieHeader(result.token, result.rememberMe, secureCookies) },
						);
					} finally {
						context.response.off('close', onClose);
					}
				}),
		},
		{
			method: 'GET',
			path: '/api/v1/auth/status',

			handle: (context) =>
				handle(context, async () => {
					const identity = await accessBoundary(() => access.authenticate(readSession(context)));
					if (identity === null) {
						context.send(401, { code: 'unauthenticated' } satisfies AccessHttpErrorResponse);
					} else {
						context.send(200, {
							isAuthenticated: true,
							user: toUser(identity),
						} satisfies AccessStatusResponse);
					}
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/logout',

			handle: (context) =>
				handle(context, async () => {
					const token = readSession(context);
					await accessBoundary(() => access.logout(token));
					context.send(200, { loggedOut: true } satisfies AccessLogoutResponse, {
						'Set-Cookie': clearedCookie(secureCookies),
					});
				}),
		},
		{
			method: 'PUT',
			path: '/api/v1/auth/password',

			handle: (context) =>
				handle(context, async () => {
					const data = readAccessPasswordRequest(await context.json());
					await accessBoundary(() =>
						access.changePassword(readSession(context), data.currentPassword, data.newPassword),
					);
					context.send(200, { passwordChanged: true } satisfies AccessPasswordResponse, {
						'Set-Cookie': clearedCookie(secureCookies),
					});
				}),
		},
		{
			method: 'GET',
			path: '/api/v1/settings/ip-blacklist',

			handle: (context) =>
				handle(
					context,
					async () => {
						const identity = await requireIdentity(context, access);
						if (!identity) {
							return;
						}
						const { limit, offset } = readAccessIpBlacklistQuery(context.query);
						const page = await accessBoundary(() =>
							access.listLoginFailures(identity.userId, limit, offset),
						);
						context.send(200, {
							entries: page.entries.map((entry) => ({
								ip: entry.sourceIp,
								attempts: entry.attempts,
								lastAttemptAt: Math.floor(entry.lastAttemptAt / 1000),
								blockedUntil:
									entry.blockedUntil === null ? null : Math.floor(entry.blockedUntil / 1000),
							})),
							total: page.total,
						} satisfies AccessIpBlacklistResponse);
					},
					true,
				),
		},
		{
			method: 'DELETE',
			path: '/api/v1/settings/ip-blacklist',

			handle: (context) =>
				handle(context, async () => {
					const identity = await requireIdentity(context, access);
					if (!identity) {
						return;
					}
					const input = readAccessIpBlacklistRemoveRequest(await context.json());
					const removed = await accessBoundary(() => access.clearLoginFailure(identity.userId, input.ip));
					context.send(200, { removed } satisfies AccessIpBlacklistRemoveResponse);
				}),
		},
	];
}
