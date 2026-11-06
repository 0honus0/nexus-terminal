import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import { readAgentAppPath } from '@nexus-terminal/shared/agent/scope/http-codec';
import { readAgentCloseResourcesRequest } from '@nexus-terminal/shared/agent/runs/http-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
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
		url: '/api/v1/agent/apps/:appId/resources/close',
		bodyLimit: AGENT_MAX_JSON_BODY_BYTES,

		async handler(request, reply) {
			const input = new AgentHttpInput(request);
			try {
				if ([...request.query.keys()].length) {
					throw new InvalidAgentPayload();
				}
				const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (!token || !identity) {
					reply.code(401).send({ code: 'unauthenticated' });
					return;
				}
				if (identity.userId !== 1) {
					reply.code(403).send({ code: 'forbidden' });
					return;
				}
				const result = await boundary(() =>
					input.normalize(async () => {
						const appId = readAgentAppPath({ appId: request.params.appId }).appId;
						const decoded = await input.read(readAgentCloseResourcesRequest);
						return threads.withAdmission(
							{
								kind: 'session',
								userId: identity.userId,
								appId,
								appVersion: decoded.appVersion,
								token,

								assertCurrent: () => {
									if (reply.raw.destroyed) {
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
				reply.code(200).send(result);
			} catch (error) {
				if (error instanceof InvalidAgentPayload) {
					reply.code(400).send({ code: 'invalid_input' });
				} else if (error instanceof AgentOperationError) {
					reply.code(agentErrorStatus(error.code)).send({ code: error.code });
				} else if (error instanceof AccessOperationError && error.code === 'storage_unavailable') {
					reply.code(503).send({ code: 'storage_unavailable' });
				} else {
					reply.code(500).send({ code: 'internal_failure' });
				}
			}
		},
	};
}
