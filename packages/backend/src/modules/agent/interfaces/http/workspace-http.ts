import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_WORKSPACE_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { readAgentAppPath } from '@nexus-terminal/shared/agent/scope/http-codec';
import {
	readAgentWorkspaceRequest,
	isAgentWorkspaceMutation,
} from '@nexus-terminal/shared/agent/scope/workspace-http-codec';
import { encodeAgentJson, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
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
		path: '/api/v1/agent/apps/:appId/workspace',
		maxBodyBytes: AGENT_WORKSPACE_MAX_RESPONSE_BYTES,

		async handle(ctx) {
			const input = new AgentHttpInput(ctx);
			let committed = false;
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
						const decoded = await input.read(readAgentWorkspaceRequest);
						const actor: SessionThreadAccess = {
							kind: 'session',
							userId: identity.userId,
							appId,
							token,
							appVersion: decoded.appVersion,

							assertCurrent: () => {
								if (ctx.response.destroyed) {
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
				try {
					encodeAgentJson(result, AGENT_WORKSPACE_MAX_RESPONSE_BYTES);
				} catch {
					throw new AgentOperationError('limit_exceeded');
				}
				ctx.send(200, result);
			} catch (error) {
				if (input.transportFailure) {
					throw input.transportFailure;
				}
				if (committed) {
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
				} else if (error instanceof AccessOperationError && error.code === 'storage_unavailable') {
					ctx.send(503, { code: 'storage_unavailable' });
				} else {
					ctx.send(500, { code: 'internal_failure' });
				}
			}
		},
	};
}
