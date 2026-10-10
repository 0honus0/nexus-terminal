import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-server.js';
import type { AccessService } from '../../authentication/service/access-service.js';
import { AccessOperationError, accessBoundary } from '../../authentication/model/access-errors.js';
import type { AuthenticatedIdentity } from '../../authentication/model/access-types.js';
import {
	InvalidAccessPayload,
	readAccessSetupRequest,
	readAccessLoginRequest,
	readAccessPasswordRequest,
	type AccessUserView,
} from '@nexus-terminal/shared/access/api';

const COOKIE_NAME = 'nexus_session';
const REMEMBER_SECONDS = 30 * 24 * 60 * 60;

function readSession(context: HttpRouteContext): string | null {
	return context.cookie(COOKIE_NAME);
}

function cookieHeader(token: string, rememberMe: boolean, secure: boolean): string {
	const attributes = [COOKIE_NAME + '=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
	if (secure) {
		attributes.push('Secure');
	}
	if (rememberMe) {
		attributes.push('Max-Age=' + REMEMBER_SECONDS);
	}
	return attributes.join('; ');
}

function clearedCookie(secure: boolean): string {
	return [COOKIE_NAME + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join(
		'; ',
	);
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
		context.send(401, { code: 'unauthenticated' });
		return null;
	}
	return identity;
}

function errorResponse(context: HttpRouteContext, error: unknown): void {
	if (!(error instanceof AccessOperationError)) {
		context.send(500, { code: 'internal_failure' });
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
		case 'invalid_credentials':
			status = 401;
			break;
		case 'storage_unavailable':
			status = 503;
			break;
		default:
			status = 500;
	}
	context.send(status, { code });
}

async function handle(context: HttpRouteContext, action: () => Promise<void>): Promise<void> {
	try {
		// No Access route accepts query parameters. Other modules validate their own.
		if (context.query.size > 0) {
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
			path: '/api/v1/auth/needs-setup',

			handle: (context) =>
				handle(context, async () => {
					const needsSetup = await accessBoundary(() => access.needsSetup());
					context.send(200, { needsSetup: Boolean(needsSetup) });
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/setup',

			handle: (context) =>
				handle(context, async () => {
					const data = readAccessSetupRequest(await context.json());
					const identity = await accessBoundary(() => access.setupAdmin(data.username, data.password));
					context.send(201, { user: toUser(identity) });
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/login',

			handle: (context) =>
				handle(context, async () => {
					const data = readAccessLoginRequest(await context.json());
					const result = await accessBoundary(() =>
						access.login({
							username: data.username,
							password: data.password,
							rememberMe: data.rememberMe === true,
							source: context.sourceIp,
							previousToken: readSession(context),
						}),
					);
					if (result.status !== 'authenticated') {
						const code = result.status;
						context.send(code === 'rate_limited' ? 429 : code === 'factor_unavailable' ? 403 : 401, {
							code,
						});
						return;
					}
					context.send(
						200,
						{ user: toUser(result.identity), requiresTwoFactor: false },
						{ 'Set-Cookie': cookieHeader(result.token, result.rememberMe, secureCookies) },
					);
				}),
		},
		{
			method: 'GET',
			path: '/api/v1/auth/status',

			handle: (context) =>
				handle(context, async () => {
					const identity = await requireIdentity(context, access);
					if (identity !== null) {
						context.send(200, { isAuthenticated: true, user: toUser(identity) });
					}
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/logout',

			handle: (context) =>
				handle(context, async () => {
					const token = readSession(context);
					const identity = await requireIdentity(context, access);
					if (identity !== null) {
						await accessBoundary(() => access.logout(token));
						context.send(200, { loggedOut: true }, { 'Set-Cookie': clearedCookie(secureCookies) });
					}
				}),
		},
		{
			method: 'PUT',
			path: '/api/v1/auth/password',

			handle: (context) =>
				handle(context, async () => {
					const identity = await requireIdentity(context, access);
					if (!identity) {
						return;
					}
					const data = readAccessPasswordRequest(await context.json());
					await accessBoundary(() =>
						access.changePassword(readSession(context), data.currentPassword, data.newPassword),
					);
					context.send(200, { passwordChanged: true }, { 'Set-Cookie': clearedCookie(secureCookies) });
				}),
		},
	];
}
