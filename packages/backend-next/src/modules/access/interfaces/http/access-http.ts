import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-server.js';
import type { AccessService } from '../../authentication/service/access-service.js';
import { AccessOperationError, accessBoundary } from '../../authentication/model/access-errors.js';
import type { AuthenticatedIdentity } from '../../authentication/model/access-types.js';

const COOKIE_NAME = 'nexus_session';
const REMEMBER_SECONDS = 30 * 24 * 60 * 60;

type StrictObject = Record<string, unknown>;

function strictBody(value: unknown, fields: readonly string[]): StrictObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AccessOperationError('invalid_input');
	}
	const data = value as Record<string, unknown>;
	if (Object.keys(data).some((key) => !fields.includes(key))) {
		throw new AccessOperationError('invalid_input');
	}
	return data;
}

function validateText(value: unknown, minimum: number, maximum: number): string {
	if (typeof value !== 'string' || value.length < minimum || Buffer.byteLength(value, 'utf8') > maximum) {
		throw new AccessOperationError('invalid_input');
	}
	return value;
}

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

function toUser(identity: AuthenticatedIdentity): {
	id: number;
	username: string;
	twoFactorEnabled: boolean;
} {
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
	const status =
		code === 'invalid_input'
			? 400
			: code === 'already_initialized' || code === 'conflict'
				? 409
				: code === 'invalid_credentials'
					? 401
					: code === 'storage_unavailable'
						? 503
						: 500;
	context.send(status, { code });
}

async function handle(context: HttpRouteContext, action: () => Promise<void>): Promise<void> {
	try {
		await accessBoundary(action);
	} catch (error) {
		errorResponse(context, error);
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
					const needsSetup = await access.needsSetup();
					context.send(200, { needsSetup: Boolean(needsSetup) });
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/setup',

			handle: (context) =>
				handle(context, async () => {
					const data = strictBody(await context.json(), ['username', 'password', 'confirmPassword']);
					const username = validateText(data.username, 1, 256);
					const password = validateText(data.password, 8, 1024);
					const confirmation = validateText(data.confirmPassword, 8, 1024);
					if (password !== confirmation) {
						throw new AccessOperationError('invalid_input');
					}
					const identity = await access.setupAdmin(username, password);
					context.send(201, { user: toUser(identity) });
				}),
		},
		{
			method: 'POST',
			path: '/api/v1/auth/login',

			handle: (context) =>
				handle(context, async () => {
					const data = strictBody(await context.json(), ['username', 'password', 'rememberMe']);
					const username = validateText(data.username, 1, 256);
					const password = validateText(data.password, 1, 1024);
					if (data.rememberMe !== undefined && typeof data.rememberMe !== 'boolean') {
						throw new AccessOperationError('invalid_input');
					}
					const result = await access.login({
						username,
						password,
						rememberMe: data.rememberMe === true,
						source: context.sourceIp,
						previousToken: readSession(context),
					});
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
						await access.logout(token);
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
					const data = strictBody(await context.json(), ['currentPassword', 'newPassword']);
					await access.changePassword(
						readSession(context),
						validateText(data.currentPassword, 1, 1024),
						validateText(data.newPassword, 8, 1024),
					);
					context.send(200, { passwordChanged: true }, { 'Set-Cookie': clearedCookie(secureCookies) });
				}),
		},
	];
}
