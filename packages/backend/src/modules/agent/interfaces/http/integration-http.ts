import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentIntegrationCreate,
	readAgentIntegrationCreateHeaders,
	readAgentIntegrationUpdate,
	readAgentIntegrationVersion,
} from '@nexus-terminal/shared/agent/integrations/http-codec';
import {
	AGENT_INTEGRATION_MAX_BODY_BYTES,
	AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/integrations/values';
import type { HttpRoute, HttpRequest } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import type { IntegrationService } from '../../integrations/service/integration-service.js';
import type { IntegrationActor } from '../../integrations/model/integration-types.js';
import { toIntegrationInput, toIntegrationView, toIntegrationDiscovery } from './integration-mapper.js';
import { agentErrorStatus } from './agent-http-status.js';

export function createIntegrationHttpRoutes(
	access: AccessPublicApi,
	service: IntegrationService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	const routes: HttpRoute[] = [];

	function add(
		method: HttpRoute['method'],
		suffix: string,
		action: (request: HttpRequest, actor: IntegrationActor) => Promise<unknown>,
	): void {
		routes.push({
			method,
			url: '/api/v1/apps/:appId/integrations' + suffix,
			bodyLimit: AGENT_INTEGRATION_MAX_BODY_BYTES,
			errorHandler: agentHttpErrorHandler,

			async handler(request, reply) {
				const inputBoundary = new AgentHttpInput(request);
				let completed = false;
				try {
					if ([...request.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
						identity = await access.authenticate(token);
					if (!token || !identity) {
						reply.code(401).send({ code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						reply.code(403).send({ code: 'forbidden' });
						return;
					}
					const actor = { userId: identity.userId, appId: readAgentId(request.params.appId), token };
					const result = await boundary(() => inputBoundary.normalize(() => action(request, actor)));
					completed = method !== 'GET';
					const current = await access.authenticate(token);
					if (current?.userId !== actor.userId) {
						reply
							.code(completed ? 503 : 401)
							.send({ code: completed ? 'operation_unknown' : 'unauthenticated' });
						return;
					}
					reply
						.type('application/json; charset=utf-8')
						.serializer(
							agentHttpSerializer(
								AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
								completed ? 'operation_unknown' : 'limit_exceeded',
							),
						);
					reply.code(method === 'POST' && suffix === '' ? 201 : 200).send(result);
				} catch (error) {
					if (completed) {
						reply.code(503).send({ code: 'operation_unknown' });
						return;
					}
					if (error instanceof InvalidAgentPayload) {
						reply.code(400).send({ code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						reply.code(agentErrorStatus(error.code)).send({ code: error.code });
					} else if (error instanceof AccessOperationError) {
						const unavailable = error.code === 'storage_unavailable';
						reply.code(unavailable ? 503 : 500).send({
							code: unavailable ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						reply.code(500).send({ code: 'internal_failure' });
					}
				}
			},
		});
	}

	add('GET', '', async (_ctx, actor) => ({ items: (await service.list(actor)).map(toIntegrationView) }));
	add('POST', '', async (request, actor) =>
		toIntegrationView(
			await service.create(
				actor,
				readAgentIntegrationCreateHeaders({ idempotencyKey: request.headers['idempotency-key'] })
					.idempotencyKey,
				toIntegrationInput(readAgentIntegrationCreate(request.body)),
			),
		),
	);
	add('GET', '/:integrationId', async (request, actor) =>
		toIntegrationView(await service.get(actor, readAgentId(request.params.integrationId))),
	);
	add('PATCH', '/:integrationId', async (request, actor) => {
		const input = readAgentIntegrationUpdate(request.body);
		return toIntegrationView(
			await service.update(
				actor,
				readAgentId(request.params.integrationId),
				input.expectedVersion,
				toIntegrationInput(input),
			),
		);
	});
	add('DELETE', '/:integrationId', async (request, actor) => {
		await service.remove(
			actor,
			readAgentId(request.params.integrationId),
			readAgentIntegrationVersion(request.body),
		);
		return { status: 'deleted' };
	});
	add('POST', '/:integrationId/refresh', async (request, actor) =>
		toIntegrationDiscovery(
			await service.refresh(
				actor,
				readAgentId(request.params.integrationId),
				readAgentIntegrationVersion(request.body),
			),
		),
	);
	return routes;
}
