import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { readAgentBrowserUpdate } from '@nexus-terminal/shared/agent/integrations/browser-http-codec';
import { AGENT_BROWSER_MAX_BODY_BYTES } from '@nexus-terminal/shared/agent/integrations/browser-values';
import { InvalidAgentPayload, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
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
		path: '/api/v1/agent/browser/configuration',
		maxBodyBytes: AGENT_BROWSER_MAX_BODY_BYTES,

		async handle(ctx) {
			const inputBoundary = new AgentHttpInput(ctx);
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
				const actor = { userId: identity.userId, token };
				const value = await boundary(() =>
					inputBoundary.normalize(async () => {
						if (method === 'GET') {
							return service.configuration(actor);
						}
						const input = readAgentBrowserUpdate(await ctx.json());
						encodeAgentJson(
							{ version: input.expectedVersion + 1, targets: input.targets },
							AGENT_BROWSER_MAX_BODY_BYTES,
						);
						return service.update(actor, input.expectedVersion, toBrowserTargets(input.targets));
					}),
				);
				completed = method === 'PUT';
				if ((await access.authenticate(token))?.userId !== actor.userId) {
					ctx.send(completed ? 503 : 401, { code: completed ? 'operation_unknown' : 'unauthenticated' });
					return;
				}
				const result = toBrowserView(value);
				encodeAgentJson(result, AGENT_BROWSER_MAX_BODY_BYTES);
				ctx.send(200, result);
			} catch (error) {
				if (inputBoundary.transportFailure) {
					throw inputBoundary.transportFailure;
				}
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
				} else {
					ctx.send(500, { code: 'internal_failure' });
				}
			}
		},
	}));
}
