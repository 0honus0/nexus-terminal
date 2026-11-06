import type { HttpRoute, HttpRequest } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	OPERATIONS_BODY_MAX_BYTES,
	OPERATIONS_RESPONSE_MAX_BYTES,
	type OperationsErrorCode,
} from '@nexus-terminal/shared/operations/values';
import {
	readAuditQuery,
	readNotificationCreate,
	readNotificationUnsavedTest,
	readNotificationUpdate,
	readNotificationVersion,
	readBackendLoggingUpdate,
	InvalidOperationsPayload,
} from '@nexus-terminal/shared/operations/http-codec';
import { uuid, record } from '@nexus-terminal/shared/common/http-codec';
import type { AuditService } from '../../audit/service/audit-service.js';
import type { LoggingService } from '../../logging/service/logging-service.js';
import type { NotificationService } from '../../notifications/service/notification-service.js';
import type { NotificationActor } from '../../notifications/model/notification-types.js';
import { OperationsFailure } from '../../operations-failure.js';
import {
	toNotificationChange,
	toNotificationConfigChange,
	toNotificationView,
	toDeliveryView,
	toAuditView,
} from './operations-mapper.js';
const STATUS: Record<OperationsErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	delivery_failed: 502,
	delivery_unknown: 503,
	internal_failure: 503,
	shutting_down: 503,
};

async function authenticate(ctx: HttpRequest, access: AccessPublicApi): Promise<NotificationActor> {
	const token = readRequestCookie(ctx.raw, ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new OperationsFailure('unauthenticated');
	}
	if (identity.userId !== 1) {
		throw new OperationsFailure('forbidden');
	}
	return { userId: identity.userId, token };
}

function code(error: unknown): OperationsErrorCode {
	if (error instanceof OperationsFailure) {
		return error.code;
	}
	if (error instanceof InvalidOperationsPayload) {
		return 'invalid_input';
	}
	if (
		error instanceof AccessOperationError &&
		(error.code === 'storage_unavailable' || error.code === 'operation_unknown')
	) {
		return error.code;
	}
	return 'internal_failure';
}

export function createOperationsRoutes(
	audit: AuditService,
	logging: LoggingService,
	notifications: NotificationService,
	access: AccessPublicApi,
): HttpRoute[] {
	const prefix = '/api/v1/settings';

	function route(
		method: HttpRoute['method'],
		path: string,
		work: (ctx: HttpRequest, actor: NotificationActor) => Promise<unknown>,
	): HttpRoute {
		return {
			method,
			url: path,
			bodyLimit: OPERATIONS_BODY_MAX_BYTES,

			errorHandler(error, _request, reply) {
				if (!(error instanceof OperationsFailure)) {
					throw error;
				}
				reply.removeHeader('Set-Cookie');
				reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
				const value = code(error);
				reply.code(STATUS[value]).send({ code: value });
			},

			handler: async (ctx, reply) => {
				let completed = false;
				try {
					const actor = await authenticate(ctx, access);
					if (
						ctx.query.size &&
						path !== prefix + '/audit-logs' &&
						path !== prefix + '/notification-deliveries'
					) {
						throw new OperationsFailure('invalid_input');
					}
					const body = await work(ctx, actor);
					completed = method !== 'GET';
					const current = await authenticate(ctx, access);
					if (current.userId !== actor.userId || current.token !== actor.token) {
						throw new OperationsFailure('forbidden');
					}
					reply.type('application/json; charset=utf-8').serializer((payload) => {
						let encoded: string;
						try {
							encoded = JSON.stringify(payload);
						} catch {
							throw new OperationsFailure(completed ? 'operation_unknown' : 'internal_failure');
						}
						if (Buffer.byteLength(encoded, 'utf8') > OPERATIONS_RESPONSE_MAX_BYTES) {
							throw new OperationsFailure(completed ? 'operation_unknown' : 'limit_exceeded');
						}
						return encoded;
					});
					if (reply.raw.destroyed || reply.raw.writableEnded) {
						return;
					}
					reply.code(200).send(body);
				} catch (error) {
					if (!completed && error instanceof HttpInputFailure) {
						throw error;
					}
					if (reply.raw.headersSent) {
						reply.raw.destroy();
						return;
					}
					if (!reply.raw.destroyed && !reply.raw.writableEnded) {
						const value = completed ? 'operation_unknown' : code(error);
						reply.code(STATUS[value]).send({ code: value });
					}
				}
			},
		};
	}

	return [
		route('GET', prefix + '/audit-logs', async (ctx) => {
			const query = readAuditQuery(ctx.query);
			const page = await audit.list({
				event: query.event,
				from: query.from,
				to: query.to,
				q: query.q,
				offset: query.offset,
				limit: query.limit,
			});
			return { items: page.items.map(toAuditView), nextOffset: page.nextOffset };
		}),
		route('GET', prefix + '/logging', async () => {
			const value = await logging.get();
			return {
				version: value.version,
				level: value.level,
				effectiveLevel: logging.effective(),
				updatedAt: value.updatedAt,
			};
		}),
		route('PUT', prefix + '/logging', async (ctx, actor) => {
			const input = readBackendLoggingUpdate(ctx.body);
			const value = await logging.update(
				{ userId: actor.userId, token: actor.token },
				input.expectedVersion,
				input.level,
			);
			return {
				version: value.version,
				level: value.level,
				effectiveLevel: logging.effective(),
				updatedAt: value.updatedAt,
			};
		}),
		route('POST', prefix + '/notifications/test-unsaved', async (ctx, actor) => {
			const input = readNotificationUnsavedTest(ctx.body);
			return {
				delivery: toDeliveryView(
					await notifications.testUnsaved(actor, toNotificationConfigChange(input.config)),
				),
			};
		}),
		route('GET', prefix + '/notifications', async () => ({
			items: (await notifications.list()).map(toNotificationView),
		})),
		route('POST', prefix + '/notifications', async (ctx, actor) => ({
			setting: toNotificationView(
				await notifications.change(actor, null, 0, toNotificationChange(readNotificationCreate(ctx.body))),
			),
		})),
		route('PUT', prefix + '/notifications/:id', async (ctx, actor) => {
			const input = readNotificationUpdate(ctx.body);
			return {
				setting: toNotificationView(
					await notifications.change(
						actor,
						uuid(ctx.params.id),
						input.expectedVersion,
						toNotificationChange(input),
					),
				),
			};
		}),
		route('DELETE', prefix + '/notifications/:id', async (ctx, actor) => {
			const input = readNotificationVersion(ctx.body);
			await notifications.delete(actor, uuid(ctx.params.id), input.expectedVersion);
			return { deleted: true };
		}),
		route('POST', prefix + '/notifications/:id/test', async (ctx, actor) => {
			record(ctx.body, []);
			return { delivery: toDeliveryView(await notifications.test(actor, uuid(ctx.params.id))) };
		}),
		route('GET', prefix + '/notification-deliveries', async (ctx) => {
			const query = readAuditQuery(ctx.query);
			if (query.event !== null || query.from !== null || query.to !== null || query.q !== '') {
				throw new OperationsFailure('invalid_input');
			}
			const page = await notifications.deliveries(query.offset, query.limit);
			return { items: page.items.map(toDeliveryView), nextOffset: page.nextOffset };
		}),
	];
}
