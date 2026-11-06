import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import { OperationsFailure } from '../../operations-failure.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { randomUUID } from 'node:crypto';
import type { HttpRoute, HttpRequest } from '../../../../platform/http/http-types.js';
import type { AuditNotice } from '../../audit/model/audit-types.js';
import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';

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

function event(route: HttpRoute, status: number, responseUserId: number | null): OperationEvent | null {
	const successful = status >= 200 && status < 300;
	if (
		route.url === '/api/v1/targets/connections/:id/test' ||
		route.url === '/api/v1/targets/connections/test-unsaved'
	) {
		return successful ? 'SSH_CONNECT_SUCCESS' : 'SSH_CONNECT_FAILURE';
	}
	if (route.url === '/api/v1/auth/login' || route.url === '/api/v1/auth/login/2fa') {
		if (successful && responseUserId !== null) {
			return 'LOGIN_SUCCESS';
		}
		return successful ? null : 'LOGIN_FAILURE';
	}
	if (route.url === '/api/v1/auth/passkey/authenticate') {
		return successful ? (responseUserId === null ? null : 'PASSKEY_AUTH_SUCCESS') : 'PASSKEY_AUTH_FAILURE';
	}
	if (route.url === '/api/v1/auth/passkey/register' && successful) {
		return 'PASSKEY_REGISTERED';
	}
	if (route.url === '/api/v1/auth/user/passkeys/:credentialID' && route.method === 'DELETE') {
		return successful ? 'PASSKEY_DELETED' : 'PASSKEY_DELETE_UNAUTHORIZED';
	}
	if (route.url === '/api/v1/auth/user/passkeys/:credentialID/name') {
		return successful ? 'PASSKEY_NAME_UPDATED' : 'PASSKEY_NAME_UPDATE_UNAUTHORIZED';
	}
	if (route.method === 'GET' || route.method === 'HEAD') {
		return null;
	}
	if (!successful) {
		return 'HTTP_MUTATION_FAILED';
	}
	if (route.url === '/api/v1/auth/setup') {
		return 'ADMIN_SETUP_COMPLETE';
	}
	if (route.url === '/api/v1/auth/logout') {
		return 'LOGOUT';
	}
	if (route.url === '/api/v1/auth/password') {
		return 'PASSWORD_CHANGED';
	}
	if (route.url === '/api/v1/settings/captcha') {
		return 'CAPTCHA_SETTINGS_UPDATED';
	}
	if (route.url === '/api/v1/settings/logging' || route.url === '/api/v1/settings') {
		return 'SETTINGS_UPDATED';
	}
	if (
		route.url === '/api/v1/agent/execution-settings' ||
		route.url === '/api/v1/agent/execution-settings/hard-limits/confirm'
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
		if (route.url === domain.path && route.method === 'POST') {
			return domain.create;
		}
		if (route.url === domain.path + '/:id') {
			return route.method === 'DELETE' ? domain.remove : domain.update;
		}
	}
	return 'HTTP_MUTATION';
}

interface OperationRequestState {
	actor: number | null;
	responseUserId: number | null;
	handler: Promise<void> | null;
	completeResponse(): void;
}

/** Observe safe response decisions, not receipt by the client; never inspect request secrets. */
export function observeOperationRoutes(
	routes: readonly HttpRoute[],
	publish: (notice: AuditNotice) => Promise<void>,
	admit: (work: () => Promise<void>) => Promise<void>,
	identifySession: (token: string) => Promise<number | null>,
): HttpRoute[] {
	const requests = new WeakMap<HttpRequest, OperationRequestState>();
	return routes.map((route) => {
		const handler = route.handler;
		return {
			...route,
			onRequest: [
				async (request, reply) => {
					let ready: () => void = () => undefined;

					let refused: (error: unknown) => void = () => undefined;

					const admitted = new Promise<void>((resolve, reject) => {
						ready = resolve;
						refused = reject;
					});

					let completeResponse: () => void = () => undefined;

					const completed = new Promise<void>((resolve) => {
						completeResponse = resolve;
					});

					// Parser rejection may prevent the handler from starting; transport closure
					// releases that wait while the admitted owner still awaits any real handler.
					reply.raw.once('close', completeResponse);
					void admit(async () => {
						const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
						const state: OperationRequestState = {
							actor:
								route.method !== 'GET' &&
								route.method !== 'HEAD' &&
								route.url !== '/api/v1/auth/login' &&
								token !== null
									? await identifySession(token)
									: null,
							responseUserId: null,
							handler: null,
							completeResponse,
						};
						requests.set(request, state);
						ready();
						await completed;
						await state.handler;
					})
						.catch(refused)
						.finally(() => reply.raw.off('close', completeResponse));
					try {
						await admitted;
					} catch (error) {
						if (error instanceof OperationsFailure && error.code === 'shutting_down') {
							reply.code(503).send({ code: error.code });
							return;
						}
						throw error;
					}
				},
				...(Array.isArray(route.onRequest) ? route.onRequest : route.onRequest ? [route.onRequest] : []),
			],
			preSerialization: [
				...(Array.isArray(route.preSerialization)
					? route.preSerialization
					: route.preSerialization
						? [route.preSerialization]
						: []),
				async (request, _reply, payload) => {
					const state = requests.get(request);
					if (state) {
						state.responseUserId = userId(payload);
					}
					return payload;
				},
			],
			onResponse: [
				async (request, reply) => {
					const state = requests.get(request);
					if (!state) {
						return;
					}
					try {
						// Read the terminal status, including parser rejection and failed onSend
						// hooks. A previous serialization attempt is not the final decision.
						const status = reply.raw.statusCode;
						const notice = event(route, status, state.responseUserId);
						if (notice !== null) {
							await publish({
								key: randomUUID(),
								event: notice,
								userId: state.responseUserId ?? state.actor,
								subjectId:
									request.params.id ?? request.params.appId ?? request.params.credentialID ?? null,
								sourceIp: request.ip,
								route: route.url,
								statusCode: status,
							});
						}
					} finally {
						state.completeResponse();
					}
				},
				...(Array.isArray(route.onResponse) ? route.onResponse : route.onResponse ? [route.onResponse] : []),
			],

			async handler(request, reply) {
				const state = requests.get(request);
				if (!state) {
					throw new Error('Operation request was not admitted');
				}
				state.handler = Promise.resolve().then(async () => {
					try {
						const result = await handler.call(this, request, reply);
						if (result !== undefined && result !== reply && !reply.sent) {
							reply.send(result);
						}
					} catch (error) {
						if (
							!(error instanceof HttpInputFailure) ||
							error.status >= 500 ||
							reply.raw.headersSent ||
							reply.raw.destroyed ||
							reply.raw.writableEnded
						) {
							throw error;
						}
						reply.code(error.status).send({ code: error.code });
					}
				});
				return state.handler;
			},
		};
	});
}
