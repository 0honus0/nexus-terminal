import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
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

async function authenticate(context: HttpRouteContext, access: AccessPublicApi): Promise<FavoriteActor> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (!token || !identity) {
		throw new FavoriteFailure('unauthenticated');
	}
	return { userId: identity.userId, token };
}

async function revalidate(context: HttpRouteContext, access: AccessPublicApi, actor: FavoriteActor): Promise<void> {
	const current = await authenticate(context, access);
	if (current.userId !== actor.userId || current.token !== actor.token) {
		throw new FavoriteFailure('forbidden');
	}
}

function ready(context: HttpRouteContext): void {
	if (context.response.destroyed || context.response.writableEnded) {
		throw new FavoriteFailure('unavailable');
	}
}

function send(context: HttpRouteContext, status: number, body: unknown): void {
	if (Buffer.byteLength(JSON.stringify(body), 'utf8') > FAVORITE_RESPONSE_MAX_BYTES) {
		throw new FavoriteFailure('limit_exceeded');
	}
	ready(context);
	context.send(status, body);
}

async function deliver(
	context: HttpRouteContext,
	access: AccessPublicApi,
	actor: FavoriteActor,
	status: number,
	project: () => FavoritePathMutationResponse | FavoritePathDeleteResponse,
): Promise<void> {
	try {
		await revalidate(context, access, actor);
		send(context, status, project());
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

async function handle(context: HttpRouteContext, work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		const code = failureCode(error);
		if (context.response.headersSent) {
			context.response.destroy();
		} else if (!context.response.destroyed && !context.response.writableEnded) {
			context.send(error instanceof HttpInputFailure ? error.status : ERROR_STATUS[code], { code });
		}
	}
}

function noQuery(context: HttpRouteContext): void {
	if (context.query.size) {
		throw new InvalidFavoritePayload();
	}
}

export function createFavoriteRoutes(service: FavoriteService, access: AccessPublicApi): HttpRoute[] {
	const path = '/api/v1/favorite-paths';
	return [
		{
			method: 'GET',
			path,

			handle: (context) =>
				handle(context, async () => {
					const actor = await authenticate(context, access);
					const query = readFavoriteQuery(context.query);
					const page = await service.list(actor, {
						sortBy: query.sortBy,
						offset: query.offset,
						limit: query.limit,
					});
					await revalidate(context, access, actor);
					const body: FavoritePathListResponse = {
						entries: page.entries.map(toWire),
						nextOffset: page.nextOffset,
					};
					send(context, 200, body);
				}),
		},
		{
			method: 'GET',
			path: path + '/:id',

			handle: (context) =>
				handle(context, async () => {
					noQuery(context);
					const actor = await authenticate(context, access);
					const item = await service.get(actor, readFavoriteId(context.params.id));
					await revalidate(context, access, actor);
					send(context, 200, toWire(item));
				}),
		},
		{
			method: 'POST',
			path,
			maxBodyBytes: FAVORITE_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					noQuery(context);
					const actor = await authenticate(context, access);
					const input = readFavoriteCreate(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					const item = await service.create(actor, { name: input.name, path: input.path });
					await deliver(context, access, actor, 201, () => ({ favoritePath: toWire(item) }));
				}),
		},
		{
			method: 'PUT',
			path: path + '/:id',
			maxBodyBytes: FAVORITE_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					noQuery(context);
					const actor = await authenticate(context, access);
					const id = readFavoriteId(context.params.id);
					const input = readFavoriteUpdate(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					const item = await service.update(actor, {
						id,
						expectedVersion: input.expectedVersion,
						input: { name: input.name, path: input.path },
					});
					await deliver(context, access, actor, 200, () => ({ favoritePath: toWire(item) }));
				}),
		},
		{
			method: 'PUT',
			path: path + '/:id/update-last-used',
			maxBodyBytes: FAVORITE_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					noQuery(context);
					const actor = await authenticate(context, access);
					const id = readFavoriteId(context.params.id);
					const input = readFavoriteVersion(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					const item = await service.touch(actor, id, input.expectedVersion);
					await deliver(context, access, actor, 200, () => ({ favoritePath: toWire(item) }));
				}),
		},
		{
			method: 'DELETE',
			path: path + '/:id',
			maxBodyBytes: FAVORITE_REQUEST_MAX_BYTES,

			handle: (context) =>
				handle(context, async () => {
					noQuery(context);
					const actor = await authenticate(context, access);
					const id = readFavoriteId(context.params.id);
					const input = readFavoriteVersion(await context.json());
					await revalidate(context, access, actor);
					ready(context);
					await service.delete(actor, id, input.expectedVersion);
					await deliver(context, access, actor, 200, () => ({ deleted: true }));
				}),
		},
	];
}
