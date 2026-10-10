import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { TargetsPublicApi } from '../../public.js';
import { TargetOperationError } from '../../public-errors.js';
import { urlId } from './target-http-codec.js';
import {
	InvalidTargetPayload,
	targetHttpBodyLimit,
	type TargetDeleteResponse,
	type TargetErrorResponse,
} from '@nexus-terminal/shared/targets/http';
import type { TargetConnectionImportResponse } from '@nexus-terminal/shared/targets/connections/http';
import type { TargetHostKeyRemoveResponse } from '@nexus-terminal/shared/targets/host-keys/http';
import {
	toHostKeyDto,
	toConnectionDto,
	toConnectionMutation,
	toCredentialMutation,
	toImportItems,
	toProxyDto,
	toProxyMutation,
	toSshKeyDto,
	toSshKeyMutation,
	toTagDto,
	toTagMutation,
} from './target-http-view.js';

import {
	readConnectionInput,
	readConnectionImportRequest,
	readConnectionUpdateRequest,
	readConnectionTagsRequest,
	readConnectionCloneRequest,
	readCredentialSetRequest,
	readCredentialClearRequest,
} from '@nexus-terminal/shared/targets/connections/http-codec';
import { readProxyInput, readProxyUpdateRequest } from '@nexus-terminal/shared/targets/proxies/http-codec';
import { readSshKeyInput, readSshKeyUpdateRequest } from '@nexus-terminal/shared/targets/ssh-keys/http-codec';
import { readTagCreateRequest, readTagRenameRequest } from '@nexus-terminal/shared/targets/tags/http-codec';
import { readHostKeyConfirmRequest, readHostKeyRequest } from '@nexus-terminal/shared/targets/host-keys/http-codec';

type Method = HttpRoute['method'];
type Handler = (context: HttpRouteContext) => Promise<void>;
const ROOT = '/api/v1/targets';

function errorStatus(code: TargetOperationError['code']): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'reference_not_found':
			return 404;
		case 'reference_in_use':
		case 'conflict':
			return 409;
		case 'unresolvable':
			return 422;
		case 'storage_unavailable':
			return 503;
		default:
			return 500;
	}
}

function addRoute(routes: HttpRoute[], method: Method, suffix: string, access: AccessPublicApi, action: Handler): void {
	routes.push({
		method,
		path: ROOT + suffix,
		maxBodyBytes: targetHttpBodyLimit(suffix),

		async handle(context): Promise<void> {
			try {
				// Bootstrap supports only initial administrator (row 1) until Access adds
				// explicit roles. Never treat a caller-supplied user ID as authority.
				const identity = await access.authenticate(context.cookie('nexus_session'));
				if (!identity) {
					context.send(401, { code: 'unauthenticated' } satisfies TargetErrorResponse);
					return;
				}
				if (identity.userId !== 1) {
					context.send(403, { code: 'forbidden' } satisfies TargetErrorResponse);
					return;
				}
				if (context.query.size !== 0) {
					throw new InvalidTargetPayload();
				}
				await action(context);
			} catch (error) {
				if (error instanceof InvalidTargetPayload) {
					context.send(400, { code: 'invalid_input' } satisfies TargetErrorResponse);
				} else if (error instanceof AccessOperationError) {
					context.send(error.code === 'storage_unavailable' ? 503 : 500, {
						code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					} satisfies TargetErrorResponse);
				} else if (error instanceof TargetOperationError) {
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

export function createTargetsRoutes(access: AccessPublicApi, targets: TargetsPublicApi): HttpRoute[] {
	const routes: HttpRoute[] = [];
	addRoute(routes, 'GET', '/host-keys', access, async (ctx) => {
		ctx.send(200, (await targets.hostKeys.list()).map(toHostKeyDto));
	});
	addRoute(routes, 'POST', '/host-keys/confirm', access, async (ctx) => {
		const confirmed = await targets.hostKeys.confirm(readHostKeyConfirmRequest(await ctx.json()));
		ctx.send(201, toHostKeyDto(confirmed));
	});
	addRoute(routes, 'POST', '/host-keys/remove', access, async (ctx) => {
		const row = readHostKeyRequest(await ctx.json());
		const removed = await targets.hostKeys.remove(row.host, row.port);
		ctx.send(
			removed ? 200 : 404,
			removed
				? ({ removed: true } satisfies TargetHostKeyRemoveResponse)
				: ({ code: 'not_found' } satisfies TargetErrorResponse),
		);
	});
	addRoute(routes, 'GET', '/connections', access, async (ctx) =>
		ctx.send(200, (await targets.list()).map(toConnectionDto)),
	);
	addRoute(routes, 'GET', '/connections/:id', access, async (ctx) => {
		const result = await targets.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toConnectionDto(result),
		);
	});
	addRoute(routes, 'POST', '/connections', access, async (ctx) => {
		const command = readConnectionInput(await ctx.json());
		ctx.send(201, toConnectionDto(await targets.create(command)));
	});
	addRoute(routes, 'PUT', '/connections/:id', access, async (ctx) => {
		const row = readConnectionUpdateRequest(await ctx.json());
		const result = await targets.update(id(ctx), row.version, row.changes);
		status(ctx, result, toConnectionMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id', access, async (ctx) => {
		const deleted = await targets.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});
	addRoute(routes, 'POST', '/connections/:id/clone', access, async (ctx) => {
		const input = readConnectionCloneRequest(await ctx.json());
		const result = await targets.clone(id(ctx), input.name);
		ctx.send(
			result === null ? 404 : 201,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toConnectionDto(result),
		);
	});
	addRoute(routes, 'PUT', '/connections/:id/tags', access, async (ctx) => {
		const row = readConnectionTagsRequest(await ctx.json());
		const result = await targets.setTags(id(ctx), row.version, row.tagIds);
		status(ctx, result, toConnectionMutation(result));
	});
	addRoute(routes, 'POST', '/connections/import', access, async (ctx) => {
		const { items } = readConnectionImportRequest(await ctx.json());
		ctx.send(200, {
			items: toImportItems(await targets.importMany(items)),
		} satisfies TargetConnectionImportResponse);
	});
	addRoute(routes, 'PUT', '/connections/:id/credential', access, async (ctx) => {
		const row = readCredentialSetRequest(await ctx.json());
		const result = await targets.credentials.set(id(ctx), row.version, row.credential);
		status(ctx, result, toCredentialMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id/credential', access, async (ctx) => {
		const row = readCredentialClearRequest(await ctx.json());
		const result = await targets.credentials.clear(id(ctx), row.version);
		status(ctx, result, toCredentialMutation(result));
	});

	addRoute(routes, 'GET', '/proxies', access, async (ctx) =>
		ctx.send(200, (await targets.proxies.list()).map(toProxyDto)),
	);
	addRoute(routes, 'GET', '/proxies/:id', access, async (ctx) => {
		const result = await targets.proxies.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toProxyDto(result),
		);
	});
	addRoute(routes, 'POST', '/proxies', access, async (ctx) =>
		ctx.send(201, toProxyDto(await targets.proxies.create(readProxyInput(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/proxies/:id', access, async (ctx) => {
		const row = readProxyUpdateRequest(await ctx.json());
		const result = await targets.proxies.update(id(ctx), row.version, row.changes);
		status(ctx, result, toProxyMutation(result));
	});
	addRoute(routes, 'DELETE', '/proxies/:id', access, async (ctx) => {
		const deleted = await targets.proxies.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});

	addRoute(routes, 'GET', '/tags', access, async (ctx) => ctx.send(200, (await targets.tags.list()).map(toTagDto)));
	addRoute(routes, 'GET', '/tags/:id', access, async (ctx) => {
		const result = await targets.tags.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toTagDto(result),
		);
	});
	addRoute(routes, 'POST', '/tags', access, async (ctx) =>
		ctx.send(201, toTagDto(await targets.tags.create(readTagCreateRequest(await ctx.json()).name))),
	);
	addRoute(routes, 'PUT', '/tags/:id', access, async (ctx) => {
		const row = readTagRenameRequest(await ctx.json());
		const result = await targets.tags.rename(id(ctx), row.version, row.name);
		status(ctx, result, toTagMutation(result));
	});
	addRoute(routes, 'DELETE', '/tags/:id', access, async (ctx) => {
		const deleted = await targets.tags.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});

	addRoute(routes, 'GET', '/ssh-keys', access, async (ctx) =>
		ctx.send(200, (await targets.sshKeys.list()).map(toSshKeyDto)),
	);
	addRoute(routes, 'GET', '/ssh-keys/:id', access, async (ctx) => {
		const result = await targets.sshKeys.get(id(ctx));
		ctx.send(
			result === null ? 404 : 200,
			result === null ? ({ code: 'not_found' } satisfies TargetErrorResponse) : toSshKeyDto(result),
		);
	});
	addRoute(routes, 'POST', '/ssh-keys', access, async (ctx) =>
		ctx.send(201, toSshKeyDto(await targets.sshKeys.create(readSshKeyInput(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/ssh-keys/:id', access, async (ctx) => {
		const row = readSshKeyUpdateRequest(await ctx.json());
		const result = await targets.sshKeys.update(id(ctx), row.version, row.changes);
		status(ctx, result, toSshKeyMutation(result));
	});
	addRoute(routes, 'DELETE', '/ssh-keys/:id', access, async (ctx) => {
		const deleted = await targets.sshKeys.delete(id(ctx));
		sendDeleted(ctx, deleted);
	});
	return routes;
}
