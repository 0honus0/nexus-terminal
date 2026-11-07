import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	AGENT_ARTIFACT_MAX_BODY_BYTES,
	AGENT_ARTIFACT_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/artifacts/values';
import { readAgentArtifactUploadHeaders } from '@nexus-terminal/shared/agent/artifacts/http-codec';
import { readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { AccessPublicApi } from '../../../access/public.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentHttpErrorHandler, agentHttpSerializer } from './agent-http-response.js';
import { agentErrorStatus } from './agent-http-status.js';
import { toArtifactView } from './artifact-mapper.js';

export function createPluginUploadHttpRoute(
	access: AccessPublicApi,
	plugins: PluginService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute {
	return {
		method: 'PUT',
		url: '/api/v1/agent/plugins/installations/:appId/frontend/artifacts/:artifactId/content',
		bodyLimit: AGENT_ARTIFACT_MAX_BODY_BYTES,
		config: { rawBody: true },
		errorHandler: agentHttpErrorHandler,

		async handler(request, reply) {
			const stop = new AbortController();

			const disconnect = () => stop.abort();

			const closed = () => {
				if (!reply.raw.writableEnded) {
					stop.abort();
				}
			};

			request.raw.once('aborted', disconnect);
			reply.raw.once('close', closed);
			let committed = false;
			try {
				if (
					[...request.query.keys()].some((key) => key !== 'grant') ||
					request.query.getAll('grant').length !== 1
				) {
					throw new InvalidAgentPayload();
				}
				const grant = readAgentId(request.query.get('grant'));
				const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME);
				const identity = await access.authenticate(token);
				if (!token || !identity) {
					throw new AgentOperationError('unauthenticated');
				}
				if (identity.userId !== 1) {
					throw new AgentOperationError('forbidden');
				}
				const { expectedVersion } = readAgentArtifactUploadHeaders(
					request.headers['if-match'],
					request.headers['content-type'],
				);

				async function* source(): AsyncIterable<Uint8Array> {
					for await (const chunk of request.raw) {
						stop.signal.throwIfAborted();
						if (!Buffer.isBuffer(chunk)) {
							throw new InvalidAgentPayload();
						}
						yield Uint8Array.from(chunk);
					}
				}

				const value = await boundary(() =>
					plugins.uploadFrontendArtifact(
						{ userId: identity.userId, token },
						readAgentId(request.params.appId),
						grant,
						readAgentId(request.params.artifactId),
						expectedVersion,
						source(),
						stop.signal,
					),
				);
				committed = true;
				if ((await access.authenticate(token))?.userId !== identity.userId) {
					throw new AgentOperationError('operation_unknown');
				}
				reply
					.type('application/json; charset=utf-8')
					.serializer(agentHttpSerializer(AGENT_ARTIFACT_MAX_RESPONSE_BYTES, 'operation_unknown'))
					.code(200)
					.send({ artifact: toArtifactView(value) });
			} catch (error) {
				if (reply.sent || reply.raw.headersSent || reply.raw.destroyed) {
					reply.raw.destroy();
					return;
				}
				const code = committed
					? 'operation_unknown'
					: error instanceof AgentOperationError
						? error.code
						: error instanceof InvalidAgentPayload
							? 'invalid_input'
							: 'internal_failure';
				reply.code(agentErrorStatus(code)).send({ code });
			} finally {
				request.raw.removeListener('aborted', disconnect);
				reply.raw.removeListener('close', closed);
			}
		},
	};
}
