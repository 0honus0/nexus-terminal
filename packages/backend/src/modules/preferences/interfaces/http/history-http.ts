import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	HISTORY_KINDS,
	HISTORY_REQUEST_MAX_BYTES,
	HISTORY_RESPONSE_MAX_BYTES,
	type HistoryKind,
	type HistoryErrorCode,
} from '@nexus-terminal/shared/preferences/history/values';
import {
	readCommandHistoryAdd,
	readPathHistoryAdd,
	readHistoryListQuery,
	readHistoryId,
	InvalidHistoryPayload,
} from '@nexus-terminal/shared/preferences/history/http-codec';
import type {
	CommandHistoryListResponse,
	PathHistoryListResponse,
	HistoryAddResponse,
	HistoryClearResponse,
	HistoryDeleteResponse,
} from '@nexus-terminal/shared/preferences/history/http';
import type { HistoryService } from '../../history/service/history-service.js';
import type { HistoryActor, HistoryPage } from '../../history/model/history-types.js';
import { HistoryFailure } from '../../history-failure.js';

const ERROR_STATUS: Record<HistoryErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
};

async function authenticate(context: HttpRouteContext, access: AccessPublicApi): Promise<HistoryActor> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new HistoryFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

function send(context: HttpRouteContext, status: number, value: unknown): void {
	if (Buffer.byteLength(JSON.stringify(value), 'utf8') > HISTORY_RESPONSE_MAX_BYTES) {
		throw new HistoryFailure('limit_exceeded');
	}
	if (context.response.destroyed || context.response.writableEnded) {
		throw new HistoryFailure('unavailable');
	}
	context.send(status, value);
}

function toWire(kind: HistoryKind, value: HistoryPage): CommandHistoryListResponse | PathHistoryListResponse {
	if (kind === 'command') {
		return {
			entries: value.entries.map((row) => ({ id: row.id, command: row.text, timestamp: row.recordedAt })),
			nextOffset: value.nextOffset,
		};
	}
	return {
		entries: value.entries.map((row) => ({ id: row.id, path: row.text, timestamp: row.recordedAt })),
		nextOffset: value.nextOffset,
	};
}

async function revalidate(context: HttpRouteContext, access: AccessPublicApi, actor: HistoryActor): Promise<void> {
	const current = await authenticate(context, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new HistoryFailure('forbidden');
	}
}

function failureCode(error: unknown): HistoryErrorCode {
	if (error instanceof HistoryFailure) {
		return error.code;
	}
	if (error instanceof HttpInputFailure) {
		return error.status === 413 ? 'limit_exceeded' : 'invalid_input';
	}
	if (error instanceof InvalidHistoryPayload) {
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

async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		const code = failureCode(error);
		const status = error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code];
		if (context.response.headersSent) {
			context.response.destroy();
		} else if (!context.response.destroyed && !context.response.writableEnded) {
			context.send(status, { code });
		}
	}
}

async function deliver(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: HistoryActor,
	status: number,
	result: unknown,
): Promise<void> {
	try {
		await revalidate(context, access, actor);
		send(context, status, result);
	} catch (cause) {
		throw new HistoryFailure('operation_unknown', { cause });
	}
}

function requireNoQuery(context: HttpRouteContext): void {
	if (context.query.size) {
		throw new InvalidHistoryPayload();
	}
}

function routes(kind: HistoryKind, service: HistoryService, access: AccessPublicApi): HttpRoute[] {
	const path = kind === 'command' ? '/api/v1/command-history' : '/api/v1/path-history';
	return [
		{
			method: 'GET',
			path,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const query = readHistoryListQuery(context.query);
					const page = await service.list(actor, { kind, offset: query.offset, limit: query.limit });
					await revalidate(context, access, actor);
					send(context, 200, toWire(kind, page));
				}),
		},
		{
			method: 'POST',
			path,
			maxBodyBytes: HISTORY_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					requireNoQuery(context);
					const actor = await authenticate(context, access);
					const input = await context.json();
					const text =
						kind === 'command' ? readCommandHistoryAdd(input).command : readPathHistoryAdd(input).path;
					await revalidate(context, access, actor);
					if (context.response.destroyed || context.response.writableEnded) {
						throw new HistoryFailure('unavailable');
					}
					const saved = await service.add(actor, { kind, text });
					const result: HistoryAddResponse = { id: saved.id };
					await deliver(context, access, actor, 201, result);
				}),
		},
		{
			method: 'DELETE',
			path: path + '/:id',

			handle: (context) =>
				handle(context, async () => {
					requireNoQuery(context);
					const actor = await authenticate(context, access);
					const id = readHistoryId(context.params.id);
					if (context.response.destroyed || context.response.writableEnded) {
						throw new HistoryFailure('unavailable');
					}
					await service.delete(actor, kind, id);
					const result: HistoryDeleteResponse = { deleted: true };
					await deliver(context, access, actor, 200, result);
				}),
		},
		{
			method: 'DELETE',
			path,

			handle: (context) =>
				handle(context, async () => {
					requireNoQuery(context);
					const actor = await authenticate(context, access);
					if (context.response.destroyed || context.response.writableEnded) {
						throw new HistoryFailure('unavailable');
					}
					const count = await service.clear(actor, kind);
					const result: HistoryClearResponse = { count };
					await deliver(context, access, actor, 200, result);
				}),
		},
	];
}

export function createHistoryRoutes(service: HistoryService, access: AccessPublicApi): HttpRoute[] {
	return HISTORY_KINDS.flatMap((kind) => routes(kind, service, access));
}
