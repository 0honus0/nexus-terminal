import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentBrowserUpdate } from '@nexus-terminal/shared/agent/integrations/browser-http-codec';
import { AGENT_BROWSER_MAX_BODY_BYTES } from '@nexus-terminal/shared/agent/integrations/browser-values';
import { InvalidAgentPayload, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AgentOperationError } from '../../public-errors.js';
import type { BrowserService } from '../../integrations/service/browser-service.js';
import { agentErrorStatus } from './agent-http-status.js';
import { toBrowserTargets, toBrowserView } from './browser-mapper.js';

export function createBrowserHttpRoutes(
	access: AccessPublicApi,
	service: BrowserService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute[] {
	return (['GET', 'PUT'] as const).map((method) => ({
		method,
		url: '/api/v1/agent/browser/configuration',
		bodyLimit: AGENT_BROWSER_MAX_BODY_BYTES,
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
				const actor = { userId: identity.userId, token };
				const value = await boundary(() =>
					inputBoundary.normalize(async () => {
						if (method === 'GET') {
							return service.configuration(actor);
						}
						const input = readAgentBrowserUpdate(request.body);
						encodeAgentJson(
							{ version: input.expectedVersion + 1, targets: input.targets },
							AGENT_BROWSER_MAX_BODY_BYTES,
						);
						return service.update(actor, input.expectedVersion, toBrowserTargets(input.targets));
					}),
				);
				completed = method === 'PUT';
				if ((await access.authenticate(token))?.userId !== actor.userId) {
					reply
						.code(completed ? 503 : 401)
						.send({ code: completed ? 'operation_unknown' : 'unauthenticated' });
					return;
				}
				const result = toBrowserView(value);
				reply
					.type('application/json; charset=utf-8')
					.serializer(
						agentHttpSerializer(
							AGENT_BROWSER_MAX_BODY_BYTES,
							completed ? 'operation_unknown' : 'invalid_input',
						),
					);
				reply.code(200).send(result);
			} catch (error) {
				if (completed) {
					reply.code(503).send({ code: 'operation_unknown' });
					return;
				}
				if (error instanceof InvalidAgentPayload) {
					reply.code(400).send({ code: 'invalid_input' });
				} else if (error instanceof AgentOperationError) {
					reply.code(agentErrorStatus(error.code)).send({ code: error.code });
				} else {
					reply.code(500).send({ code: 'internal_failure' });
				}
			}
		},
	}));
}
