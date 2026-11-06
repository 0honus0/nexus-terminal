import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import type { AgentProviderApi } from '../../providers/model/provider-api-types.js';
import type { HttpRoute, HttpRequest, HttpReply } from '../../../../platform/http/http-types.js';
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
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_PROVIDER_MAX_BODY_BYTES,
	AGENT_PROVIDER_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/providers/values';
import { AgentOperationError } from '../../public-errors.js';
import { AccessOperationError } from '../../../access/public-errors.js';
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
type Handler = (request: HttpRequest, reply: HttpReply, userId: number) => Promise<void>;

function send(
	reply: HttpReply,
	status: number,
	value: unknown,
	failureCode: AgentOperationErrorCode = 'limit_exceeded',
): void {
	reply
		.type('application/json; charset=utf-8')
		.serializer(agentHttpSerializer(AGENT_PROVIDER_MAX_RESPONSE_BYTES, failureCode))
		.code(status)
		.send(value);
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

function failed(reply: HttpReply, e: unknown): void {
	if (reply.raw.destroyed) {
		return;
	}
	if (e instanceof InvalidAgentPayload) {
		send(reply, 400, { code: 'invalid_input' });
		return;
	}
	if (e instanceof AgentOperationError) {
		const c = e.code;
		send(reply, errorStatus(c), { code: c });
		return;
	}
	if (e instanceof AccessOperationError) {
		send(reply, e.code === 'storage_unavailable' ? 503 : 500, {
			code: e.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
		});
		return;
	}
	send(reply, 500, { code: 'internal_failure' });
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
		url: ROOT + path,
		bodyLimit: maxBodyBytes,
		errorHandler: agentHttpErrorHandler,

		async handler(request, reply) {
			try {
				if ([...request.query.keys()].some((key) => !queryKeys.includes(key))) {
					throw new AgentOperationError('invalid_input');
				}
				const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (!identity) {
					send(reply, 401, { code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					send(reply, 403, { code: 'forbidden' });
					return;
				}
				await action(request, reply, identity.userId);
			} catch (e) {
				failed(reply, e);
			}
		},
	});
}

function providerId(request: HttpRequest): string {
	return readAgentProviderId(request.params.providerId);
}

function externalSignal(reply: HttpReply): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();

	const abort = () => controller.abort();

	reply.raw.once('close', abort);
	if (reply.raw.destroyed) {
		abort();
	}
	return {
		signal: controller.signal,

		dispose: () => reply.raw.off('close', abort),
	};
}

async function verifyAuthorized(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	userId: number,
): Promise<void> {
	let identity;
	try {
		identity = await access.authenticate(readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME));
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
	if (reply.raw.destroyed) {
		throw new AgentOperationError('provider_configuration_stale');
	}
}

async function authorizedSend(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	userId: number,
	status: number,
	value: unknown,
	failureCode: AgentOperationErrorCode = 'limit_exceeded',
): Promise<void> {
	if (reply.raw.destroyed) {
		return;
	}
	await verifyAuthorized(request, reply, access, userId);
	if (reply.raw.destroyed) {
		return;
	}
	send(reply, status, value, failureCode);
}

async function mutationSend(
	request: HttpRequest,
	reply: HttpReply,
	access: AccessPublicApi,
	userId: number,
	status: number,
	project: () => unknown,
): Promise<void> {
	try {
		await authorizedSend(request, reply, access, userId, status, project(), 'operation_unknown');
	} catch {
		throw new AgentOperationError('operation_unknown');
	}
}

export function createAgentProviderHttpRoutes(access: AccessPublicApi, providers: AgentProviderApi): HttpRoute[] {
	const routes: HttpRoute[] = [];
	add(routes, 'GET', '/ai/model-registry', access, async (request, reply, userId) =>
		authorizedSend(request, reply, access, userId, 200, wireRegistryStatus(await providers.registryStatus(userId))),
	);
	add(
		routes,
		'GET',
		'/ai/model-registry/resolve',
		access,
		async (request, reply, userId) => {
			const query = readAgentRegistryResolveQuery(request.query);
			await authorizedSend(
				request,
				reply,
				access,
				userId,
				200,
				wireRegistryResolution(await providers.registryResolve(userId, query.modelId)),
			);
		},
		['modelId'],
	);
	add(routes, 'POST', '/ai/model-registry/refresh', access, async (request, reply, userId) => {
		readAgentProviderEmptyRequest(request.body);
		await verifyAuthorized(request, reply, access, userId);
		const cancellable = externalSignal(reply);
		try {
			const result = await providers.registryRefresh(userId, cancellable.signal);
			await mutationSend(request, reply, access, userId, 200, () => wireRegistryStatus(result));
		} finally {
			cancellable.dispose();
		}
	});
	add(routes, 'GET', '/ai/providers', access, async (request, reply, userId) =>
		authorizedSend(request, reply, access, userId, 200, (await providers.list(userId)).map(wireProvider)),
	);
	add(routes, 'GET', '/ai/providers/:providerId', access, async (request, reply, userId) =>
		authorizedSend(
			request,
			reply,
			access,
			userId,
			200,
			wireProvider(await providers.get(userId, providerId(request))),
		),
	);
	add(routes, 'GET', '/ai/models', access, async (request, reply, userId) =>
		authorizedSend(request, reply, access, userId, 200, (await providers.available(userId)).map(wireAvailable)),
	);
	add(
		routes,
		'POST',
		'/ai/providers',
		access,
		async (request, reply, userId) => {
			const input = appProvider(readAgentProviderCreateRequest(request.body));
			await verifyAuthorized(request, reply, access, userId);
			const result = await providers.create(userId, input);
			await mutationSend(request, reply, access, userId, 201, () => wireProvider(result));
		},
		[],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	add(
		routes,
		'PATCH',
		'/ai/providers/:providerId',
		access,
		async (request, reply, userId) => {
			const body = readAgentProviderUpdateRequest(request.body);
			await verifyAuthorized(request, reply, access, userId);
			const result = await providers.update(
				userId,
				providerId(request),
				body.expectedVersion,
				appProviderPatch(body),
			);
			await mutationSend(request, reply, access, userId, 200, () => wireProvider(result));
		},
		[],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	add(
		routes,
		'DELETE',
		'/ai/providers/:providerId',
		access,
		async (request, reply, userId) => {
			const { expectedVersion } = readAgentProviderDeleteQuery(request.query);
			await verifyAuthorized(request, reply, access, userId);
			await providers.remove(userId, providerId(request), expectedVersion);
			await mutationSend(request, reply, access, userId, 200, () => ({ deleted: true }));
		},
		['expectedVersion'],
	);
	add(
		routes,
		'POST',
		'/ai/providers/discover-endpoint-models',
		access,
		async (request, reply, userId) => {
			const input = readAgentProviderEndpointRequest(request.body);
			const cancellable = externalSignal(reply);
			try {
				const found = await providers.discoverEndpoint(
					userId,
					input.baseUrl,
					input.credential,
					cancellable.signal,
				);
				await authorizedSend(request, reply, access, userId, 200, found.map(wireDiscovered));
			} finally {
				cancellable.dispose();
			}
		},
		[],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	add(routes, 'POST', '/ai/providers/:providerId/discover-models', access, async (request, reply, userId) => {
		readAgentProviderEmptyRequest(request.body);
		const id = providerId(request);
		const cancellable = externalSignal(reply);
		try {
			const found = await providers.discover(
				userId,
				id,
				() => verifyAuthorized(request, reply, access, userId),
				cancellable.signal,
			);
			await mutationSend(request, reply, access, userId, 200, () => found.map(wireDiscovered));
		} finally {
			cancellable.dispose();
		}
	});
	add(routes, 'POST', '/ai/providers/:providerId/test', access, async (request, reply, userId) => {
		const body = readAgentProviderTestRequest(request.body);
		const id = providerId(request);
		const cancellable = externalSignal(reply);
		try {
			const result = await providers.test(userId, id, body.modelId, cancellable.signal);
			await authorizedSend(request, reply, access, userId, 200, wireTest(result));
		} finally {
			cancellable.dispose();
		}
	});
	return routes;
}
