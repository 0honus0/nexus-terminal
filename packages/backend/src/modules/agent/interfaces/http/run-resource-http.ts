import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import { readAgentAppPath } from '@nexus-terminal/shared/agent/scope/http-codec';
import { readAgentCloseResourcesRequest } from '@nexus-terminal/shared/agent/runs/http-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import { AgentFailure } from '../../agent-failure.js';
import type { ThreadService } from '../../scope/service/thread-service.js';
import type { RunResourceService } from '../../runs/service/run-resource-service.js';
import { AgentHttpInput } from './agent-input.js';
import { agentErrorStatus } from './agent-http-status.js';

export function createRunResourceHttpRoute(
	access: AccessPublicApi,
	threads: ThreadService,
	resources: RunResourceService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute {
	return {
		method: 'POST',
		path: '/api/v1/agent/apps/:appId/resources/close',
		maxBodyBytes: AGENT_MAX_JSON_BODY_BYTES,

		async handle(ctx) {
			const input = new AgentHttpInput(ctx);
			try {
				if ([...ctx.query.keys()].length) {
					throw new InvalidAgentPayload();
				}
				const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (!token || !identity) {
					ctx.send(401, { code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					ctx.send(403, { code: 'forbidden' });
					return;
				}
				const result = await boundary(() =>
					input.normalize(async () => {
						const appId = readAgentAppPath({ appId: ctx.params.appId }).appId;
						const decoded = await input.read(readAgentCloseResourcesRequest);
						return threads.withAdmission(
							{
								kind: 'session',
								userId: identity.userId,
								appId,
								appVersion: decoded.appVersion,
								token,

								assertCurrent: () => {
									if (ctx.response.destroyed) {
										throw new AgentFailure('unauthenticated');
									}
								},
							},
							async () => {
								const target =
									decoded.target.kind === 'app'
										? { kind: 'app' as const }
										: {
												kind: 'session' as const,
												runId: decoded.target.runId,
												sessionId: decoded.target.sessionId,
											};
								const value = await resources.closeResources(identity.userId, appId, {
									target,
									confirmed: decoded.confirmed,
								});
								return {
									status: value.status,
									activeRuns: value.activeRuns,
									activeOperations: value.activeOperations,
									backgroundJobs: value.backgroundJobs,
								};
							},
						);
					}),
				);
				ctx.send(200, result);
			} catch (error) {
				if (input.transportFailure) {
					throw input.transportFailure;
				}
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				if (error instanceof InvalidAgentPayload) {
					ctx.send(400, { code: 'invalid_input' });
				} else if (error instanceof AgentOperationError) {
					ctx.send(agentErrorStatus(error.code), { code: error.code });
				} else if (error instanceof AccessOperationError && error.code === 'storage_unavailable') {
					ctx.send(503, { code: 'storage_unavailable' });
				} else {
					ctx.send(500, { code: 'internal_failure' });
				}
			}
		},
	};
}
