import { OperationsFailure } from '../../operations-failure.js';
import { randomUUID } from 'node:crypto';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { OperationsEvents } from '../../public.js';
import type { OperationEvent } from '@nexus-terminal/shared/operations/values';

function userId(value: unknown): number | null {
	if (value === null || typeof value !== 'object' || !('user' in value)) {
		return null;
	}
	const user = value.user;
	return user !== null &&
		typeof user === 'object' &&
		'id' in user &&
		typeof user.id === 'number' &&
		Number.isSafeInteger(user.id) &&
		user.id > 0
		? user.id
		: null;
}

function event(route: HttpRoute, status: number, body: unknown): OperationEvent | null {
	const successful = status >= 200 && status < 300;
	if (route.path === '/api/v1/auth/login' || route.path === '/api/v1/auth/login/2fa') {
		if (successful && userId(body) !== null) {
			return 'LOGIN_SUCCESS';
		}
		return successful ? null : 'LOGIN_FAILURE';
	}
	if (route.path === '/api/v1/auth/passkey/authenticate') {
		return successful ? (userId(body) === null ? null : 'PASSKEY_AUTH_SUCCESS') : 'PASSKEY_AUTH_FAILURE';
	}
	if (route.path === '/api/v1/auth/passkey/register' && successful) {
		return 'PASSKEY_REGISTERED';
	}
	if (route.path === '/api/v1/auth/user/passkeys/:credentialID' && route.method === 'DELETE') {
		return successful ? 'PASSKEY_DELETED' : 'PASSKEY_DELETE_UNAUTHORIZED';
	}
	if (route.path === '/api/v1/auth/user/passkeys/:credentialID/name') {
		return successful ? 'PASSKEY_NAME_UPDATED' : 'PASSKEY_NAME_UPDATE_UNAUTHORIZED';
	}
	if (route.method === 'GET' || route.method === 'HEAD') {
		return null;
	}
	if (!successful) {
		return 'HTTP_MUTATION_FAILED';
	}
	if (route.path === '/api/v1/auth/setup') {
		return 'ADMIN_SETUP_COMPLETE';
	}
	if (route.path === '/api/v1/auth/logout') {
		return 'LOGOUT';
	}
	if (route.path === '/api/v1/auth/password') {
		return 'PASSWORD_CHANGED';
	}
	if (route.path === '/api/v1/settings/captcha') {
		return 'CAPTCHA_SETTINGS_UPDATED';
	}
	if (route.path === '/api/v1/settings/logging' || route.path === '/api/v1/settings') {
		return 'SETTINGS_UPDATED';
	}
	if (
		route.path === '/api/v1/agent/execution-settings' ||
		route.path === '/api/v1/agent/execution-settings/hard-limits/confirm'
	) {
		return 'AGENT_EXECUTION_SETTINGS_UPDATED';
	}
	const domains: { path: string; create: OperationEvent; update: OperationEvent; remove: OperationEvent }[] = [
		{
			path: '/api/v1/targets/connections',
			create: 'CONNECTION_CREATED',
			update: 'CONNECTION_UPDATED',
			remove: 'CONNECTION_DELETED',
		},
		{ path: '/api/v1/targets/proxies', create: 'PROXY_CREATED', update: 'PROXY_UPDATED', remove: 'PROXY_DELETED' },
		{
			path: '/api/v1/targets/ssh-keys',
			create: 'SSH_KEY_CREATED',
			update: 'SSH_KEY_UPDATED',
			remove: 'SSH_KEY_DELETED',
		},
		{ path: '/api/v1/targets/tags', create: 'TAG_CREATED', update: 'TAG_UPDATED', remove: 'TAG_DELETED' },
		{
			path: '/api/v1/settings/notifications',
			create: 'NOTIFICATION_SETTING_CREATED',
			update: 'NOTIFICATION_SETTING_UPDATED',
			remove: 'NOTIFICATION_SETTING_DELETED',
		},
	];
	for (const domain of domains) {
		if (route.path === domain.path && route.method === 'POST') {
			return domain.create;
		}
		if (route.path === domain.path + '/:id') {
			return route.method === 'DELETE' ? domain.remove : domain.update;
		}
	}
	return 'HTTP_MUTATION';
}

/** Observe delivered safe protocol facts; never inspect request bodies, cookies or headers. */
export function observeOperationRoutes(
	routes: readonly HttpRoute[],
	events: OperationsEvents,
	admit: (work: () => Promise<void>) => Promise<void>,
): HttpRoute[] {
	return routes.map((route) => ({
		method: route.method,
		path: route.path,
		...(route.maxBodyBytes === undefined ? {} : { maxBodyBytes: route.maxBodyBytes }),
		...(route.maxPathParameterBytes === undefined ? {} : { maxPathParameterBytes: route.maxPathParameterBytes }),
		...(route.pathParameterAlphabet === undefined ? {} : { pathParameterAlphabet: route.pathParameterAlphabet }),

		async handle(context) {
			const observeRequest = async () => {
				let status: number | null = null;
				let identity: number | null = null;
				let notice: OperationEvent | null = null;
				const observed: HttpRouteContext = {
					origin: context.origin,
					method: context.method,
					path: context.path,
					query: context.query,
					params: context.params,
					request: context.request,
					response: context.response,
					sourceIp: context.sourceIp,

					json: (signal) => context.json(signal),

					cookie: (name) => context.cookie(name),

					send: (code, body, headers) => {
						context.send(code, body, headers);
						status = code;
						identity = userId(body);
						notice = event(route, code, body);
					},
				};
				await route.handle(observed);
				if (status !== null && notice !== null) {
					await events.publish({
						key: randomUUID(),
						event: notice,
						userId: identity,
						subjectId: context.params.id ?? context.params.appId ?? context.params.credentialID ?? null,
						sourceIp: context.sourceIp,
						route: route.path,
						statusCode: status,
					});
				}
			};

			try {
				await admit(observeRequest);
			} catch (error) {
				if (error instanceof OperationsFailure && error.code === 'shutting_down') {
					context.send(503, { code: error.code });
					return;
				}
				throw error;
			}
		},
	}));
}
