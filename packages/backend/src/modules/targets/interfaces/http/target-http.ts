import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { ManagementService } from '../../management/service/management-service.js';
import type { ManagementActor } from '../../management/model/management-types.js';
import { TargetFailure } from '../../target-failure.js';
import type { TargetsPublicApi } from '../../public.js';
import { TargetOperationError } from '../../public-errors.js';
import { urlId } from './target-http-codec.js';
import { importConnectionRequest } from './connection-import-http.js';
import { TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES } from '@nexus-terminal/shared/targets/connections/values';
import {
	TARGET_MANAGEMENT_MAX_ITEMS,
	TARGET_MANAGEMENT_RESPONSE_MAX_BYTES,
} from '@nexus-terminal/shared/targets/values';
import {
	InvalidTargetPayload,
	targetHttpBodyLimit,
	type TargetDeleteResponse,
	type TargetErrorResponse,
} from '@nexus-terminal/shared/targets/http';
import type { TargetHostKeyRemoveResponse } from '@nexus-terminal/shared/targets/host-keys/http';
import {
	toHostKeyDto,
	toConnectionDto,
	toConnectionMutation,
	toCredentialMutation,
	toCredentialDto,
	toProxyDto,
	toProxyMutation,
	toSshKeyDto,
	toSshKeyMutation,
	toTagDto,
	toTagMutation,
} from './target-http-view.js';

import {
	readConnectionAddTagRequest,
	readConnectionInput,
	readConnectionUpdateRequest,
	readConnectionTagsRequest,
	readConnectionCloneRequest,
	readCredentialSetRequest,
	readCredentialClearRequest,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { readProxyInput, readProxyUpdateRequest } from '@nexus-terminal/shared/targets/proxies/http-codec';
import { readSshKeyInput, readSshKeyUpdateRequest } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import type { TargetTagConnectionsResponse } from '@nexus-terminal/shared/targets/tags/http';
import {
	readTagConnectionsRequest,
	readTagCreateRequest,
	readTagRenameRequest,
} from '@nexus-terminal/shared/targets/tags/http-codec';
import { readHostKeyConfirmRequest, readHostKeyRequest } from '@nexus-terminal/shared/targets/host-keys/http-codec';

type Method = HttpRoute['method'];
type Handler = (context: HttpRouteContext) => Promise<void>;
const ROOT = '/api/v1/targets';

function errorStatus(code: TargetOperationError['code']): number {
	switch (code) {
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'invalid_input':
			return 400;
		case 'reference_not_found':
			return 404;
		case 'reference_in_use':
		case 'conflict':
			return 409;
		case 'unresolvable':
			return 422;
		case 'operation_unknown':
		case 'storage_unavailable':
			return 503;
		default:
			return 500;
	}
}

async function readActor(context: HttpRouteContext, access: AccessPublicApi): Promise<ManagementActor | null> {
	const token = context.cookie(ACCESS_SESSION_COOKIE_NAME);
	const identity = await access.authenticate(token);
	if (identity === null || token === null) {
		context.send(401, { code: 'unauthenticated' } satisfies TargetErrorResponse);
		return null;
	}
	return { userId: identity.userId, token };
}

function sendAssociated(context: HttpRouteContext, updated: boolean): void {
	context.send(
		updated ? 200 : 404,
		updated
			? ({ updated: true } satisfies TargetTagConnectionsResponse)
			: ({ code: 'not_found' } satisfies TargetErrorResponse),
	);
}

function addRoute(
	routes: HttpRoute[],
	method: Method,
	suffix: string,
	access: AccessPublicApi,
	management: ManagementService,
	action: Handler,
): void {
	routes.push({
		method,
		path: ROOT + suffix,
		maxBodyBytes:
			suffix === '/connections/import'
				? TARGET_CONNECTION_IMPORT_MULTIPART_MAX_BYTES
				: targetHttpBodyLimit(suffix),

		async handle(context): Promise<void> {
			try {
				// Bootstrap supports only initial administrator (row 1) until Access adds
				// explicit roles. Never treat a caller-supplied user ID as authority.
				const actor = await readActor(context, access);
				if (actor === null) {
					return;
				}
				if (context.query.size !== 0) {
					throw new InvalidTargetPayload();
				}
				await management.run(actor, () => action(context));
			} catch (error) {
				if (error instanceof InvalidTargetPayload) {
					context.send(400, { code: 'invalid_input' } satisfies TargetErrorResponse);
				} else if (error instanceof AccessOperationError) {
					context.send(error.code === 'storage_unavailable' ? 503 : 500, {
						code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					} satisfies TargetErrorResponse);
				} else if (error instanceof TargetOperationError || error instanceof TargetFailure) {
					context.send(errorStatus(error.code), { code: error.code } satisfies TargetErrorResponse);
				} else {
					// Transport failures (including JSON parser 400/413/415) must not be
					// interpreted as business or storage failures.
					throw error;
				}
			}
		},
	});
}

function id(context: HttpRouteContext): number {
	return urlId(context.params.id);
}

function status(
	context: HttpRouteContext,
	result: { status: 'updated' | 'not_found' | 'version_conflict' },
	value: unknown,
): void {
	switch (result.status) {
		case 'not_found':
			context.send(404, { code: 'not_found' } satisfies TargetErrorResponse);
			return;
		case 'version_conflict':
			context.send(409, { code: 'version_conflict' } satisfies TargetErrorResponse);
			return;
		case 'updated':
			context.send(200, value);
			return;
	}
}

function sendDeleted(context: HttpRouteContext, deleted: boolean): void {
	context.send(
		deleted ? 200 : 404,
		deleted
			? ({ deleted: true } satisfies TargetDeleteResponse)
			: ({ code: 'not_found' } satisfies TargetErrorResponse),
	);
}

function sendManagementList(context: HttpRouteContext, items: readonly unknown[], maxBytes: number): void {
	if (items.length > TARGET_MANAGEMENT_MAX_ITEMS || Buffer.byteLength(JSON.stringify(items), 'utf8') > maxBytes) {
		context.send(413, { code: 'limit_exceeded' } satisfies TargetErrorResponse);
		return;
	}
	context.send(200, items);
}

export function createTargetsRoutes(
	access: AccessPublicApi,
	targets: TargetsPublicApi,
	management: ManagementService,
): HttpRoute[] {
	const routes: HttpRoute[] = [];
	addRoute(routes, 'GET', '/host-keys', access, management, async (ctx) => {
		sendManagementList(
			ctx,
			(await targets.hostKeys.list()).map(toHostKeyDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['host-keys'],
		);
	});
	addRoute(routes, 'POST', '/host-keys/confirm', access, management, async (ctx) => {
		const confirmed = await targets.hostKeys.confirm(readHostKeyConfirmRequest(await ctx.json()));
		ctx.send(201, toHostKeyDto(confirmed));
	});
	addRoute(routes, 'POST', '/host-keys/remove', access, management, async (ctx) => {
		const row = readHostKeyRequest(await ctx.json());
		const removed = await targets.hostKeys.remove(row.host, row.port);
		ctx.send(
			removed ? 200 : 404,
			removed
				? ({ removed: true } satisfies TargetHostKeyRemoveResponse)
				: ({ code: 'not_found' } satisfies TargetErrorResponse),
		);
	});
	addRoute(routes, 'GET', '/connections', access, management, async (ctx) =>
		sendManagementList(
			ctx,
			(await targets.list()).map(toConnectionDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.connections,
		),
	);
	addRoute(routes, 'GET', '/connections/:id', access, management, async (ctx) => {
		const result = await targets.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toConnectionDto(result),
		);
	});
	addRoute(routes, 'POST', '/connections', access, management, async (ctx) => {
		const command = readConnectionInput(await ctx.json());
		ctx.send(201, toConnectionDto(await targets.create(command)));
	});
	addRoute(routes, 'PUT', '/connections/:id', access, management, async (ctx) => {
		const row = readConnectionUpdateRequest(await ctx.json());
		const result = await targets.update(id(ctx), row.version, row.changes);
		status(ctx, result, toConnectionMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id', access, management, async (ctx) => {
		const deleted = await targets.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});
	addRoute(routes, 'POST', '/connections/:id/clone', access, management, async (ctx) => {
		const input = readConnectionCloneRequest(await ctx.json());
		const result = await targets.clone(id(ctx), input.name);
		ctx.send(
			result === null ? 404 : 201,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toConnectionDto(result),
		);
	});
	addRoute(routes, 'PUT', '/connections/:id/tags', access, management, async (ctx) => {
		const row = readConnectionTagsRequest(await ctx.json());
		const result = await targets.setTags(id(ctx), row.version, row.tagIds);
		status(ctx, result, toConnectionMutation(result));
	});
	addRoute(routes, 'POST', '/connections/add-tag', access, management, async (ctx) => {
		const command = readConnectionAddTagRequest(await ctx.json());
		sendAssociated(ctx, await targets.tags.addConnections(command.tagId, command.connectionIds));
	});
	addRoute(routes, 'POST', '/connections/import', access, management, async (ctx) => {
		ctx.send(200, await importConnectionRequest(ctx, targets));
	});
	addRoute(routes, 'GET', '/connections/:id/credential', access, management, async (ctx) => {
		const value = await targets.credentials.get(id(ctx));
		ctx.send(
			value === null ? 404 : 200,
			value === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toCredentialDto(value),
		);
	});
	addRoute(routes, 'PUT', '/connections/:id/credential', access, management, async (ctx) => {
		const row = readCredentialSetRequest(await ctx.json());
		const result = await targets.credentials.set(id(ctx), row.version, row.credential);
		status(ctx, result, toCredentialMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id/credential', access, management, async (ctx) => {
		const row = readCredentialClearRequest(await ctx.json());
		const result = await targets.credentials.clear(id(ctx), row.version);
		status(ctx, result, toCredentialMutation(result));
	});

	addRoute(routes, 'GET', '/proxies', access, management, async (ctx) =>
		sendManagementList(
			ctx,
			(await targets.proxies.list()).map(toProxyDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.proxies,
		),
	);
	addRoute(routes, 'GET', '/proxies/:id', access, management, async (ctx) => {
		const result = await targets.proxies.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toProxyDto(result),
		);
	});
	addRoute(routes, 'POST', '/proxies', access, management, async (ctx) =>
		ctx.send(201, toProxyDto(await targets.proxies.create(readProxyInput(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/proxies/:id', access, management, async (ctx) => {
		const row = readProxyUpdateRequest(await ctx.json());
		const result = await targets.proxies.update(id(ctx), row.version, row.changes);
		status(ctx, result, toProxyMutation(result));
	});
	addRoute(routes, 'DELETE', '/proxies/:id', access, management, async (ctx) => {
		const deleted = await targets.proxies.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});

	addRoute(routes, 'GET', '/tags', access, management, async (ctx) =>
		sendManagementList(ctx, (await targets.tags.list()).map(toTagDto), TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.tags),
	);
	addRoute(routes, 'GET', '/tags/:id', access, management, async (ctx) => {
		const result = await targets.tags.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toTagDto(result),
		);
	});
	addRoute(routes, 'POST', '/tags', access, management, async (ctx) =>
		ctx.send(201, toTagDto(await targets.tags.create(readTagCreateRequest(await ctx.json()).name))),
	);
	addRoute(routes, 'PUT', '/tags/:id', access, management, async (ctx) => {
		const row = readTagRenameRequest(await ctx.json());
		const result = await targets.tags.rename(id(ctx), row.version, row.name);
		status(ctx, result, toTagMutation(result));
	});
	addRoute(routes, 'PUT', '/tags/:id/connections', access, management, async (ctx) => {
		const tagId = id(ctx);
		const command = readTagConnectionsRequest(await ctx.json());
		sendAssociated(ctx, await targets.tags.setConnections(tagId, command.connectionIds));
	});
	addRoute(routes, 'DELETE', '/tags/:id', access, management, async (ctx) => {
		const deleted = await targets.tags.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});

	addRoute(routes, 'GET', '/ssh-keys', access, management, async (ctx) =>
		sendManagementList(
			ctx,
			(await targets.sshKeys.list()).map(toSshKeyDto),
			TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['ssh-keys'],
		),
	);
	addRoute(routes, 'GET', '/ssh-keys/:id', access, management, async (ctx) => {
		const result = await targets.sshKeys.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toSshKeyDto(result),
		);
	});
	addRoute(routes, 'POST', '/ssh-keys', access, management, async (ctx) =>
		ctx.send(201, toSshKeyDto(await targets.sshKeys.create(readSshKeyInput(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/ssh-keys/:id', access, management, async (ctx) => {
		const row = readSshKeyUpdateRequest(await ctx.json());
		const result = await targets.sshKeys.update(id(ctx), row.version, row.changes);
		status(ctx, result, toSshKeyMutation(result));
	});
	addRoute(routes, 'DELETE', '/ssh-keys/:id', access, management, async (ctx) => {
		const deleted = await targets.sshKeys.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});
	return routes;
}
