import { readRequestCookie } from '../../../../platform/http/http-request.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { FavoritePath } from '@nexus-terminal/shared/preferences/favorites/model';
import {
	FAVORITE_REQUEST_MAX_BYTES,
	FAVORITE_RESPONSE_MAX_BYTES,
	type FavoriteErrorCode,
} from '@nexus-terminal/shared/preferences/favorites/values';
import {
	readFavoriteCreate,
	readFavoriteUpdate,
	readFavoriteVersion,
	readFavoriteId,
	readFavoriteQuery,
	InvalidFavoritePayload,
} from '@nexus-terminal/shared/preferences/favorites/http-codec';
import type {
	FavoritePathListResponse,
	FavoritePathMutationResponse,
	FavoritePathDeleteResponse,
} from '@nexus-terminal/shared/preferences/favorites/http';
import type { FavoriteService } from '../../favorites/service/favorite-service.js';
import type { FavoriteActor, FavoriteRecord } from '../../favorites/model/favorite-types.js';
import { FavoriteFailure } from '../../favorite-failure.js';

const ERROR_STATUS: Record<FavoriteErrorCode, number> = {
	invalid_input: 400,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	version_conflict: 409,
	limit_exceeded: 413,
	storage_unavailable: 503,
	operation_unknown: 503,
	internal_failure: 503,
	unavailable: 503,
};

function toWire(value: FavoriteRecord): FavoritePath {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		path: value.path,
		lastUsedAt: value.lastUsedAt,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

async function authenticate(request: HttpRequest, reply: HttpReply, access: AccessPublicApi): Promise<FavoriteActor> {
	const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new FavoriteFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

async function revalidate(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: FavoriteActor,
): Promise<void> {
	const current = await authenticate(request, reply, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new FavoriteFailure('forbidden');
	}
}

function ready(request: HttpRequest, reply: HttpReply): void {
	if (reply.raw.destroyed || reply.raw.writableEnded) {
		throw new FavoriteFailure('unavailable');
	}
}

function send(request: HttpRequest, reply: HttpReply, status: number, body: unknown, mutation = false): void {
	ready(request, reply);
	reply.type('application/json; charset=utf-8').serializer((payload) => {
		try {
			const encoded = JSON.stringify(payload);
			if (encoded === undefined) {
				throw new FavoriteFailure('internal_failure');
			}
			if (Buffer.byteLength(encoded, 'utf8') > FAVORITE_RESPONSE_MAX_BYTES) {
				throw new FavoriteFailure('limit_exceeded');
			}
			return encoded;
		} catch (cause) {
			throw new FavoriteFailure(
				mutation ? 'operation_unknown' : cause instanceof FavoriteFailure ? cause.code : 'internal_failure',
				{ cause },
			);
		}
	});
	reply.code(status).send(body);
}

async function deliver(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	actor: FavoriteActor,
	status: number,
	project: () => FavoritePathMutationResponse | FavoritePathDeleteResponse,
): Promise<void> {
	try {
		await revalidate(request, reply, access, actor);
		send(request, reply, status, project(), true);
	} catch (cause) {
		throw new FavoriteFailure('operation_unknown', { cause });
	}
}

function failureCode(error: unknown): FavoriteErrorCode {
	if (error instanceof FavoriteFailure) {
		return error.code;
	}
	if (error instanceof HttpInputFailure) {
		return error.status === 413 ? 'limit_exceeded' : 'invalid_input';
	}
	if (error instanceof InvalidFavoritePayload) {
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
	if (reply.sent || reply.raw.headersSent) {
		reply.raw.destroy();
	} else if (!reply.raw.destroyed && !reply.raw.writableEnded) {
		reply
			.removeHeader('Content-Length')
			.type('application/json; charset=utf-8')
			.serializer(JSON.stringify)
			.code(error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code])
			.send({ code });
	}
}

function httpErrorHandler(error: unknown, request: HttpRequest, reply: HttpReply): void {
	if (!(error instanceof FavoriteFailure)) {
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

function noQuery(request: HttpRequest, reply: HttpReply): void {
	if (request.query.size) {
		throw new InvalidFavoritePayload();
	}
}

export function createFavoriteRoutes(service: FavoriteService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/favorite-paths';
	return [
		{
			method: 'GET',
			url: path,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					const actor = await authenticate(request, reply, access);
					const query = readFavoriteQuery(request.query);
					const page = await service.list(actor, {
						sortBy: query.sortBy,
						offset: query.offset,
						limit: query.limit,
					});
					await revalidate(request, reply, access, actor);
					const body: FavoritePathListResponse = {
						entries: page.entries.map(toWire),
						nextOffset: page.nextOffset,
					};
					send(request, reply, 200, body);
				}),
		},
		{
			method: 'GET',
			url: path + '/:id',

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					noQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const item = await service.get(actor, readFavoriteId(request.params.id));
					await revalidate(request, reply, access, actor);
					send(request, reply, 200, toWire(item));
				}),
		},
		{
			method: 'POST',
			url: path,
			bodyLimit: FAVORITE_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					noQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const input = readFavoriteCreate(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					const item = await service.create(actor, { name: input.name, path: input.path });
					await deliver(request, reply, access, actor, 201, () => ({ favoritePath: toWire(item) }));
				}),
		},
		{
			method: 'PUT',
			url: path + '/:id',
			bodyLimit: FAVORITE_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					noQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const id = readFavoriteId(request.params.id);
					const input = readFavoriteUpdate(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					const item = await service.update(actor, {
						id,
						expectedVersion: input.expectedVersion,
						input: { name: input.name, path: input.path },
					});
					await deliver(request, reply, access, actor, 200, () => ({ favoritePath: toWire(item) }));
				}),
		},
		{
			method: 'PUT',
			url: path + '/:id/update-last-used',
			bodyLimit: FAVORITE_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					noQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const id = readFavoriteId(request.params.id);
					const input = readFavoriteVersion(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					const item = await service.touch(actor, id, input.expectedVersion);
					await deliver(request, reply, access, actor, 200, () => ({ favoritePath: toWire(item) }));
				}),
		},
		{
			method: 'DELETE',
			url: path + '/:id',
			bodyLimit: FAVORITE_REQUEST_MAX_BYTES,

			errorHandler: httpErrorHandler,

			handler: (request, reply) =>
				handle(request, reply, async () => {
					noQuery(request, reply);
					const actor = await authenticate(request, reply, access);
					const id = readFavoriteId(request.params.id);
					const input = readFavoriteVersion(request.body);
					await revalidate(request, reply, access, actor);
					ready(request, reply);
					await service.delete(actor, id, input.expectedVersion);
					await deliver(request, reply, access, actor, 200, () => ({ deleted: true }));
				}),
		},
	];
}
