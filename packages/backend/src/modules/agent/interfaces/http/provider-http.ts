import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import type { AgentProviderApi } from '../../providers/model/provider-api-types.js';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import {
	readAgentProviderCreateRequest,
	readAgentProviderUpdateRequest,
	readAgentProviderDeleteQuery,
	readAgentRegistryResolveQuery,
	readAgentProviderId,
	readAgentProviderEndpointRequest,
	readAgentProviderTestRequest,
	readAgentProviderEmptyRequest,
} from '@nexus-terminal/shared/agent/providers/http-codec';
import { InvalidAgentPayload, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_PROVIDER_MAX_BODY_BYTES,
	AGENT_PROVIDER_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/providers/values';
import { AgentOperationError } from '../../public-errors.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import {
	appProvider,
	appProviderPatch,
	wireProvider,
	wireAvailable,
	wireDiscovered,
	wireTest,
	wireRegistryResolution,
	wireRegistryStatus,
} from './provider-mapper.js';

const ROOT = '/api/v1/agent';
type Handler = (ctx: HttpRouteContext, userId: number) => Promise<void>;

function send(ctx: HttpRouteContext, status: number, value: unknown): void {
	try {
		encodeAgentJson(value, AGENT_PROVIDER_MAX_RESPONSE_BYTES);
	} catch {
		throw new AgentOperationError('limit_exceeded');
	}
	ctx.send(status, value);
}

function errorStatus(code: AgentOperationError['code']): number {
	switch (code) {
		case 'invalid_input':
			return 400;
		case 'not_found':
		case 'model_not_found':
			return 404;
		case 'version_conflict':
		case 'provider_in_use':
		case 'provider_configuration_stale':
			return 409;
		case 'limit_exceeded':
			return 413;
		case 'storage_unavailable':
		case 'provider_unavailable':
		case 'provider_request_failed':
		case 'operation_unknown':
			return 503;
		default:
			return 500;
	}
}

function failed(ctx: HttpRouteContext, e: unknown): void {
	if (ctx.response.destroyed) {
		return;
	}
	if (e instanceof HttpInputFailure) {
		throw e;
	}
	if (e instanceof InvalidAgentPayload) {
		send(ctx, 400, { code: 'invalid_input' });
		return;
	}
	if (e instanceof AgentOperationError) {
		const c = e.code;
		send(ctx, errorStatus(c), { code: c });
		return;
	}
	if (e instanceof AccessOperationError) {
		send(ctx, e.code === 'storage_unavailable' ? 503 : 500, {
			code: e.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
		});
		return;
	}
	send(ctx, 500, { code: 'internal_failure' });
}

function add(
	routes: HttpRoute[],
	method: HttpRoute['method'],
	path: string,
	access: AccessPublicApi,
	action: Handler,
	queryKeys: readonly string[] = [],
	maxBodyBytes = AGENT_MAX_JSON_BODY_BYTES,
): void {
	routes.push({
		method,
		path: ROOT + path,
		maxBodyBytes,

		async handle(ctx) {
			try {
				if ([...ctx.query.keys()].some((key) => !queryKeys.includes(key))) {
					throw new AgentOperationError('invalid_input');
				}
				const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (!identity) {
					send(ctx, 401, { code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					send(ctx, 403, { code: 'forbidden' });
					return;
				}
				await action(ctx, identity.userId);
			} catch (e) {
				failed(ctx, e);
			}
		},
	});
}

function providerId(ctx: HttpRouteContext): string {
	return readAgentProviderId(ctx.params.providerId);
}

function externalSignal(ctx: HttpRouteContext): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();

	const abort = () => controller.abort();

	ctx.response.once('close', abort);
	if (ctx.response.destroyed) {
		abort();
	}
	return {
		signal: controller.signal,

		dispose: () => ctx.response.off('close', abort),
	};
}

async function verifyAuthorized(ctx: HttpRouteContext, access: AccessPublicApi, userId: number): Promise<void> {
	let identity;
	try {
		identity = await access.authenticate(ctx.cookie(ACCESS_SESSION_COOKIE_NAME));
	} catch (e) {
		if (e instanceof AccessOperationError) {
			throw new AgentOperationError(
				e.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
			);
		}
		throw e;
	}
	if (!identity || identity.userId !== userId) {
		throw new AgentOperationError('provider_configuration_stale');
	}
	if (ctx.response.destroyed) {
		throw new AgentOperationError('provider_configuration_stale');
	}
}

async function authorizedSend(
	ctx: HttpRouteContext,
	access: AccessPublicApi,
	userId: number,
	status: number,
	value: unknown,
): Promise<void> {
	if (ctx.response.destroyed) {
		return;
	}
	await verifyAuthorized(ctx, access, userId);
	if (ctx.response.destroyed) {
		return;
	}
	send(ctx, status, value);
}

async function mutationSend(
	ctx: HttpRouteContext,
	access: AccessPublicApi,
	userId: number,
	status: number,
	project: () => unknown,
): Promise<void> {
	try {
		await authorizedSend(ctx, access, userId, status, project());
	} catch {
		throw new AgentOperationError('operation_unknown');
	}
}

export function createAgentProviderHttpRoutes(access: AccessPublicApi, providers: AgentProviderApi): HttpRoute[] {
	const routes: HttpRoute[] = [];
	add(routes, 'GET', '/ai/model-registry', access, async (ctx, userId) =>
		authorizedSend(ctx, access, userId, 200, wireRegistryStatus(await providers.registryStatus(userId))),
	);
	add(
		routes,
		'GET',
		'/ai/model-registry/resolve',
		access,
		async (ctx, userId) => {
			const query = readAgentRegistryResolveQuery(ctx.query);
			await authorizedSend(
				ctx,
				access,
				userId,
				200,
				wireRegistryResolution(await providers.registryResolve(userId, query.modelId)),
			);
		},
		['modelId'],
	);
	add(routes, 'POST', '/ai/model-registry/refresh', access, async (ctx, userId) => {
		readAgentProviderEmptyRequest(await ctx.json());
		await verifyAuthorized(ctx, access, userId);
		const cancellable = externalSignal(ctx);
		try {
			const result = await providers.registryRefresh(userId, cancellable.signal);
			await mutationSend(ctx, access, userId, 200, () => wireRegistryStatus(result));
		} finally {
			cancellable.dispose();
		}
	});
	add(routes, 'GET', '/ai/providers', access, async (ctx, userId) =>
		authorizedSend(ctx, access, userId, 200, (await providers.list(userId)).map(wireProvider)),
	);
	add(routes, 'GET', '/ai/providers/:providerId', access, async (ctx, userId) =>
		authorizedSend(ctx, access, userId, 200, wireProvider(await providers.get(userId, providerId(ctx)))),
	);
	add(routes, 'GET', '/ai/models', access, async (ctx, userId) =>
		authorizedSend(ctx, access, userId, 200, (await providers.available(userId)).map(wireAvailable)),
	);
	add(
		routes,
		'POST',
		'/ai/providers',
		access,
		async (ctx, userId) => {
			const input = appProvider(readAgentProviderCreateRequest(await ctx.json()));
			await verifyAuthorized(ctx, access, userId);
			const result = await providers.create(userId, input);
			await mutationSend(ctx, access, userId, 201, () => wireProvider(result));
		},
		[],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	add(
		routes,
		'PATCH',
		'/ai/providers/:providerId',
		access,
		async (ctx, userId) => {
			const body = readAgentProviderUpdateRequest(await ctx.json());
			await verifyAuthorized(ctx, access, userId);
			const result = await providers.update(
				userId,
				providerId(ctx),
				body.expectedVersion,
				appProviderPatch(body),
			);
			await mutationSend(ctx, access, userId, 200, () => wireProvider(result));
		},
		[],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	add(
		routes,
		'DELETE',
		'/ai/providers/:providerId',
		access,
		async (ctx, userId) => {
			const { expectedVersion } = readAgentProviderDeleteQuery(ctx.query);
			await verifyAuthorized(ctx, access, userId);
			await providers.remove(userId, providerId(ctx), expectedVersion);
			await mutationSend(ctx, access, userId, 200, () => ({ deleted: true }));
		},
		['expectedVersion'],
	);
	add(
		routes,
		'POST',
		'/ai/providers/discover-endpoint-models',
		access,
		async (ctx, userId) => {
			const input = readAgentProviderEndpointRequest(await ctx.json());
			const cancellable = externalSignal(ctx);
			try {
				const found = await providers.discoverEndpoint(
					userId,
					input.baseUrl,
					input.credential,
					cancellable.signal,
				);
				await authorizedSend(ctx, access, userId, 200, found.map(wireDiscovered));
			} finally {
				cancellable.dispose();
			}
		},
		[],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	add(routes, 'POST', '/ai/providers/:providerId/discover-models', access, async (ctx, userId) => {
		readAgentProviderEmptyRequest(await ctx.json());
		const id = providerId(ctx);
		const cancellable = externalSignal(ctx);
		try {
			const found = await providers.discover(
				userId,
				id,
				() => verifyAuthorized(ctx, access, userId),
				cancellable.signal,
			);
			await mutationSend(ctx, access, userId, 200, () => found.map(wireDiscovered));
		} finally {
			cancellable.dispose();
		}
	});
	add(routes, 'POST', '/ai/providers/:providerId/test', access, async (ctx, userId) => {
		const body = readAgentProviderTestRequest(await ctx.json());
		const id = providerId(ctx);
		const cancellable = externalSignal(ctx);
		try {
			const result = await providers.test(userId, id, body.modelId, cancellable.signal);
			await authorizedSend(ctx, access, userId, 200, wireTest(result));
		} finally {
			cancellable.dispose();
		}
	});
	return routes;
}
