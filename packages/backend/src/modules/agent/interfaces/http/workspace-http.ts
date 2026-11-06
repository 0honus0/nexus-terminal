import { agentHttpSerializer, agentHttpErrorHandler } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_WORKSPACE_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { readAgentAppPath } from '@nexus-terminal/shared/agent/scope/http-codec';
import {
	readAgentWorkspaceRequest,
	isAgentWorkspaceMutation,
} from '@nexus-terminal/shared/agent/scope/workspace-http-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import { AgentOperationError } from '../../public-errors.js';
import { AgentFailure } from '../../agent-failure.js';
import type { ThreadService } from '../../scope/service/thread-service.js';
import type { WorkspaceService } from '../../scope/service/workspace-service.js';
import type { SessionThreadAccess } from '../../scope/model/thread-types.js';
import { AgentHttpInput } from './agent-input.js';
import { agentErrorStatus } from './agent-http-status.js';
import { fromWorkspace, toWorkspace } from './workspace-mapper.js';

export function createWorkspaceHttpRoute(
	access: AccessPublicApi,
	threads: ThreadService,
	workspace: WorkspaceService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute {
	return {
		method: 'POST',
		url: '/api/v1/agent/apps/:appId/workspace',
		bodyLimit: AGENT_WORKSPACE_MAX_RESPONSE_BYTES,
		errorHandler: agentHttpErrorHandler,

		async handler(request, reply) {
			const input = new AgentHttpInput(request);
			let committed = false;
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
						const decoded = await input.read(readAgentWorkspaceRequest);
						const actor: SessionThreadAccess = {
							kind: 'session',
							userId: identity.userId,
							appId,
							token,
							appVersion: decoded.appVersion,

							assertCurrent: () => {
								if (reply.raw.destroyed) {
									throw new AgentFailure('provider_unavailable');
								}
							},
						};
						const value = await threads.withAdmission(actor, async () => {
							const value = await workspace.rpc(actor, fromWorkspace(decoded.request), (work) => work());
							committed = isAgentWorkspaceMutation(decoded.request);
							return value;
						});
						return { appId, appVersion: decoded.appVersion, result: toWorkspace(value) };
					}),
				);
				reply
					.type('application/json; charset=utf-8')
					.serializer(
						agentHttpSerializer(
							AGENT_WORKSPACE_MAX_RESPONSE_BYTES,
							committed ? 'operation_unknown' : 'limit_exceeded',
						),
					);
				reply.code(200).send(result);
			} catch (error) {
				if (committed) {
					reply.code(503).send({ code: 'operation_unknown' });
					return;
				}
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
