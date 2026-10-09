import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-server.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { TargetsPublicApi } from '../../public.js';
import { TargetOperationError } from '../../public-errors.js';
import {
	InvalidTargetsInput,
	connection,
	connectionChanges,
	credential,
	fields,
	ids,
	importBatch,
	keyChanges,
	named,
	numberField,
	proxy,
	proxyChanges,
	sshKey,
	stringField,
	urlId,
	versioned,
} from './target-http-codec.js';
import {
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

		async handle(context): Promise<void> {
			try {
				// Bootstrap supports only initial administrator (row 1) until Access adds
				// explicit roles. Never treat a caller-supplied user ID as authority.
				const identity = await access.authenticate(context.cookie('nexus_session'));
				if (!identity) {
					context.send(401, { code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					context.send(403, { code: 'forbidden' });
					return;
				}
				if (context.query.size !== 0) throw new InvalidTargetsInput();
				await action(context);
			} catch (error) {
				if (error instanceof InvalidTargetsInput) {
					context.send(400, { code: 'invalid_input' });
				} else if (error instanceof AccessOperationError) {
					context.send(error.code === 'storage_unavailable' ? 503 : 500, {
						code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					});
				} else if (error instanceof TargetOperationError) {
					context.send(errorStatus(error.code), { code: error.code });
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

function status(context: HttpRouteContext, result: { status: string }, value: unknown): void {
	if (result.status === 'not_found') {
		context.send(404, { code: 'not_found' });
	} else if (result.status === 'version_conflict') {
		context.send(409, { code: 'version_conflict' });
	} else {
		context.send(200, value);
	}
}

export function createTargetsRoutes(access: AccessPublicApi, targets: TargetsPublicApi): HttpRoute[] {
	const routes: HttpRoute[] = [];
	addRoute(routes, 'GET', '/connections', access, async (ctx) =>
		ctx.send(200, (await targets.list()).map(toConnectionDto)),
	);
	addRoute(routes, 'GET', '/connections/:id', access, async (ctx) => {
		const result = await targets.get(id(ctx));
		ctx.send(result === null ? 404 : 200, result === null ? { code: 'not_found' } : toConnectionDto(result));
	});
	addRoute(routes, 'POST', '/connections', access, async (ctx) => {
		const command = connection(await ctx.json());
		ctx.send(201, toConnectionDto(await targets.create(command)));
	});
	addRoute(routes, 'PUT', '/connections/:id', access, async (ctx) => {
		const row = versioned(await ctx.json(), 'changes');
		const result = await targets.update(id(ctx), row.version, connectionChanges(row.payload));
		status(ctx, result, toConnectionMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id', access, async (ctx) => {
		const deleted = await targets.delete(id(ctx));
		ctx.send(deleted ? 200 : 404, deleted ? { deleted: true } : { code: 'not_found' });
	});
	addRoute(routes, 'POST', '/connections/:id/clone', access, async (ctx) => {
		const name = named(await ctx.json());
		const result = await targets.clone(id(ctx), name);
		ctx.send(result === null ? 404 : 201, result === null ? { code: 'not_found' } : toConnectionDto(result));
	});
	addRoute(routes, 'PUT', '/connections/:id/tags', access, async (ctx) => {
		const row = versioned(await ctx.json(), 'tagIds');
		const result = await targets.setTags(id(ctx), row.version, ids(row.payload));
		status(ctx, result, toConnectionMutation(result));
	});
	addRoute(routes, 'POST', '/connections/import', access, async (ctx) => {
		const items = importBatch(await ctx.json());
		ctx.send(200, { items: toImportItems(await targets.importMany(items)) });
	});
	addRoute(routes, 'PUT', '/connections/:id/credential', access, async (ctx) => {
		const row = versioned(await ctx.json(), 'credential');
		const result = await targets.credentials.set(id(ctx), row.version, credential(row.payload));
		status(ctx, result, toCredentialMutation(result));
	});
	addRoute(routes, 'DELETE', '/connections/:id/credential', access, async (ctx) => {
		const row = fields(await ctx.json(), ['version'], ['version']);
		const result = await targets.credentials.clear(id(ctx), numberField(row.version));
		status(ctx, result, toCredentialMutation(result));
	});

	addRoute(routes, 'GET', '/proxies', access, async (ctx) =>
		ctx.send(200, (await targets.proxies.list()).map(toProxyDto)),
	);
	addRoute(routes, 'GET', '/proxies/:id', access, async (ctx) => {
		const result = await targets.proxies.get(id(ctx));
		ctx.send(result === null ? 404 : 200, result === null ? { code: 'not_found' } : toProxyDto(result));
	});
	addRoute(routes, 'POST', '/proxies', access, async (ctx) =>
		ctx.send(201, toProxyDto(await targets.proxies.create(proxy(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/proxies/:id', access, async (ctx) => {
		const row = versioned(await ctx.json(), 'changes');
		const result = await targets.proxies.update(id(ctx), row.version, proxyChanges(row.payload));
		status(ctx, result, toProxyMutation(result));
	});
	addRoute(routes, 'DELETE', '/proxies/:id', access, async (ctx) => {
		const deleted = await targets.proxies.delete(id(ctx));
		ctx.send(deleted ? 200 : 404, deleted ? { deleted: true } : { code: 'not_found' });
	});

	addRoute(routes, 'GET', '/tags', access, async (ctx) => ctx.send(200, (await targets.tags.list()).map(toTagDto)));
	addRoute(routes, 'GET', '/tags/:id', access, async (ctx) => {
		const result = await targets.tags.get(id(ctx));
		ctx.send(result === null ? 404 : 200, result === null ? { code: 'not_found' } : toTagDto(result));
	});
	addRoute(routes, 'POST', '/tags', access, async (ctx) =>
		ctx.send(201, toTagDto(await targets.tags.create(named(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/tags/:id', access, async (ctx) => {
		const row = versioned(await ctx.json(), 'name');
		const result = await targets.tags.rename(id(ctx), row.version, stringField(row.payload, 128));
		status(ctx, result, toTagMutation(result));
	});
	addRoute(routes, 'DELETE', '/tags/:id', access, async (ctx) => {
		const deleted = await targets.tags.delete(id(ctx));
		ctx.send(deleted ? 200 : 404, deleted ? { deleted: true } : { code: 'not_found' });
	});

	addRoute(routes, 'GET', '/ssh-keys', access, async (ctx) =>
		ctx.send(200, (await targets.sshKeys.list()).map(toSshKeyDto)),
	);
	addRoute(routes, 'GET', '/ssh-keys/:id', access, async (ctx) => {
		const result = await targets.sshKeys.get(id(ctx));
		ctx.send(result === null ? 404 : 200, result === null ? { code: 'not_found' } : toSshKeyDto(result));
	});
	addRoute(routes, 'POST', '/ssh-keys', access, async (ctx) =>
		ctx.send(201, toSshKeyDto(await targets.sshKeys.create(sshKey(await ctx.json())))),
	);
	addRoute(routes, 'PUT', '/ssh-keys/:id', access, async (ctx) => {
		const row = versioned(await ctx.json(), 'changes');
		const result = await targets.sshKeys.update(id(ctx), row.version, keyChanges(row.payload));
		status(ctx, result, toSshKeyMutation(result));
	});
	addRoute(routes, 'DELETE', '/ssh-keys/:id', access, async (ctx) => {
		const deleted = await targets.sshKeys.delete(id(ctx));
		ctx.send(deleted ? 200 : 404, deleted ? { deleted: true } : { code: 'not_found' });
	});
	return routes;
}
