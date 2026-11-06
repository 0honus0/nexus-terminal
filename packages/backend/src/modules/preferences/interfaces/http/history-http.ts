import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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

async function authenticate(request: HttpRequest, reply: HttpReply, access: AccessPublicApi): Promise<HistoryActor> {
	const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new HistoryFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

function send(request: HttpRequest, reply: HttpReply, status: number, value: unknown, mutation = false): void {
	if (reply.raw.destroyed || reply.raw.writableEnded) {
		throw new HistoryFailure('unavailable');
	}
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new HistoryFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > HISTORY_RESPONSE_MAX_BYTES) {
				throw new HistoryFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new HistoryFailure(
				mutation ? 'operation_unknown' : cause instanceof HistoryFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(status).send(value);
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

async function revalidate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: HistoryActor,
): Promise<void> {
	const current = await authenticate(request, reply, access);
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

function sendFailure(error: unknown, request: HttpRequest, reply: HttpReply): void {
	const code = failureCode(error);
	const status = error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code];
	if (reply.sent || reply.raw.headersSent) {
		reply.raw.destroy();
	} else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
		reply
			.removeHeader('Content-Length')
			.type('application/json; charset=utf-8')
			.serializer(JSON.stringify)
			.code(status)
			.send({ code });
	}
}

function httpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof HistoryFailure)) {
		throw error;
	}
	sendFailure(error, request, reply);
}

async function handle(request: HttpRequest, reply: HttpReply, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		sendFailure(error, request, reply);
	}
}

async function deliver(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: HistoryActor,
	status: number,
	result: unknown,
): Promise<void> {
	try {
		await revalidate(request, reply, access, actor);
		send(request, reply, status, result, true);
	} catch (cause) {
		throw new HistoryFailure('operation_unknown', { cause });
	}
}

function requireNoQuery(request: HttpRequest, reply: HttpReply): void {
	if (request.query.size) {
		throw new InvalidHistoryPayload();
	}
}

function routes(kind: HistoryKind, service: HistoryService, access: AccessPublicApi): HttpRoute[] {
	const path = kind === 'command' ? '/api/v1/command-history' : '/api/v1/path-history';
	return [
		{
			method: 'GET',
			url: path,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const query = readHistoryListQuery(request.query);
					const page = await service.list(actor, { kind, offset: query.offset, limit: query.limit });
					await revalidate(request, reply, access, actor);
					send(request, reply, 200, toWire(kind, page));
				}),
		},
		{
			method: 'POST',
			url: path,
			bodyLimit: HISTORY_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					requireNoQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const input = request.body;
					const text =
						kind === 'command' ? readCommandHistoryAdd(input).command : readPathHistoryAdd(input).path;
					await revalidate(request, reply, access, actor);
					if (reply.raw.destroyed || reply.raw.writableEnded) {
						throw new HistoryFailure('unavailable');
					}
					const saved = await service.add(actor, { kind, text });
					const result: HistoryAddResponse = { id: saved.id };
					await deliver(request, reply, access, actor, 201, result);
				}),
		},
		{
			method: 'DELETE',
			url: path + '/:id',

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					requireNoQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const id = readHistoryId(request.params.id);
					if (reply.raw.destroyed || reply.raw.writableEnded) {
						throw new HistoryFailure('unavailable');
					}
					await service.delete(actor, kind, id);
					const result: HistoryDeleteResponse = { deleted: true };
					await deliver(request, reply, access, actor, 200, result);
				}),
		},
		{
			method: 'DELETE',
			url: path,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					requireNoQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					if (reply.raw.destroyed || reply.raw.writableEnded) {
						throw new HistoryFailure('unavailable');
					}
					const count = await service.clear(actor, kind);
					const result: HistoryClearResponse = { count };
					await deliver(request, reply, access, actor, 200, result);
				}),
		},
	];
}

export function createHistoryRoutes(service: HistoryService, access: AccessPublicApi): HttpRoute[] {
	return HISTORY_KINDS.flatMap((kind) => routes(kind, service, access));
}
