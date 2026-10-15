import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentId, encodeAgentJson, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentIntegrationCreate,
	readAgentIntegrationUpdate,
	readAgentIntegrationVersion,
} from '@nexus-terminal/shared/agent/integrations/http-codec';
import {
	AGENT_INTEGRATION_MAX_BODY_BYTES,
	AGENT_INTEGRATION_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/integrations/values';
import type { HttpRoute, HttpRouteContext } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
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
		action: (ctx: HttpRouteContext, actor: IntegrationActor) => Promise<unknown>,
	): void {
		routes.push({
			method,
			path: '/api/v1/apps/:appId/integrations' + suffix,
			maxBodyBytes: AGENT_INTEGRATION_MAX_BODY_BYTES,

			async handle(ctx) {
				let completed = false;
				try {
					if ([...ctx.query.keys()].length) {
						throw new InvalidAgentPayload();
					}
					const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
						identity = await access.authenticate(token);
					if (!token || !identity) {
						ctx.send(401, { code: 'unauthenticated' });
						return;
					}
					if (identity.userId !== 1) {
						ctx.send(403, { code: 'forbidden' });
						return;
					}
					const actor = { userId: identity.userId, appId: readAgentId(ctx.params.appId), token };
					const result = await boundary(() => action(ctx, actor));
					completed = method !== 'GET';
					const current = await access.authenticate(token);
					if (current?.userId !== actor.userId) {
						ctx.send(completed ? 503 : 401, { code: completed ? 'operation_unknown' : 'unauthenticated' });
						return;
					}
					try {
						encodeAgentJson(result, AGENT_INTEGRATION_MAX_RESPONSE_BYTES);
					} catch {
						throw new AgentOperationError('limit_exceeded');
					}
					ctx.send(method === 'POST' && suffix === '' ? 201 : 200, result);
				} catch (error) {
					if (completed) {
						ctx.send(503, { code: 'operation_unknown' });
						return;
					}
					if (error instanceof HttpInputFailure) {
						throw error;
					}
					if (error instanceof InvalidAgentPayload) {
						ctx.send(400, { code: 'invalid_input' });
					} else if (error instanceof AgentOperationError) {
						ctx.send(agentErrorStatus(error.code), { code: error.code });
					} else if (error instanceof AccessOperationError) {
						ctx.send(503, {
							code: error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
						});
					} else {
						ctx.send(500, { code: 'internal_failure' });
					}
				}
			},
		});
	}

	add('GET', '', async (_ctx, actor) => ({ items: (await service.list(actor)).map(toIntegrationView) }));
	add('POST', '', async (ctx, actor) =>
		toIntegrationView(
			await service.create(
				actor,
				readAgentId(ctx.request.headers['idempotency-key']),
				toIntegrationInput(readAgentIntegrationCreate(await ctx.json())),
			),
		),
	);
	add('GET', '/:integrationId', async (ctx, actor) =>
		toIntegrationView(await service.get(actor, readAgentId(ctx.params.integrationId))),
	);
	add('PATCH', '/:integrationId', async (ctx, actor) => {
		const input = readAgentIntegrationUpdate(await ctx.json());
		return toIntegrationView(
			await service.update(
				actor,
				readAgentId(ctx.params.integrationId),
				input.expectedVersion,
				toIntegrationInput(input),
			),
		);
	});
	add('DELETE', '/:integrationId', async (ctx, actor) => {
		await service.remove(
			actor,
			readAgentId(ctx.params.integrationId),
			readAgentIntegrationVersion(await ctx.json()),
		);
		return { status: 'deleted' };
	});
	add('POST', '/:integrationId/refresh', async (ctx, actor) =>
		toIntegrationDiscovery(
			await service.refresh(
				actor,
				readAgentId(ctx.params.integrationId),
				readAgentIntegrationVersion(await ctx.json()),
			),
		),
	);
	return routes;
}
