import { agentHttpErrorHandler, AgentRpcHttpSerializationFailure } from './agent-http-response.js';
import { readRequestCookie } from '../../../../platform/http/http-request.js';
import { AgentHttpInput } from './agent-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import {
	AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	AGENT_PLUGIN_PROTOCOL_VERSION,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	AgentPluginFrontendRpcRequest,
	AgentPluginRpcResponse,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import { readAgentPluginFrontendRpc } from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import { encodeAgentJson, readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';
import { fromPluginRpc, toPluginRpc } from './plugin-mapper.js';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';

function failureCode(error: unknown, committed: boolean): AgentOperationErrorCode {
	if (committed) {
		return 'operation_unknown';
	}
	if (error instanceof InvalidAgentPayload) {
		return 'invalid_input';
	}
	if (error instanceof AgentOperationError) {
		return error.code;
	}
	if (error instanceof AccessOperationError && error.code === 'storage_unavailable') {
		return 'storage_unavailable';
	}
	return 'internal_failure';
}

export function createPluginRpcHttpRoute(
	access: AccessPublicApi,
	service: PluginService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute {
	return {
		method: 'POST',
		url: '/api/v1/agent/plugins/installations/:appId/frontend/rpc',
		bodyLimit: AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
		errorHandler: agentHttpErrorHandler,

		async handler(request, reply) {
			const exchange: { request: AgentPluginFrontendRpcRequest | null } = { request: null };
			const input = new AgentHttpInput(request);
			let committed = false;
			try {
				if ([...request.query.keys()].length) {
					throw new InvalidAgentPayload();
				}
				const token = readRequestCookie(request.raw, ACCESS_SESSION_COOKIE_NAME),
					identity = await access.authenticate(token);
				if (!token || !identity) {
					throw new AgentOperationError('unauthenticated');
				}
				if (identity.userId !== 1) {
					throw new AgentOperationError('forbidden');
				}
				const result = await boundary(() =>
					input.normalize(() =>
						service.rpc(
							{ userId: identity.userId, token },
							readAgentId(request.params.appId),
							async (signal) => {
								const decoded = await input.read(readAgentPluginFrontendRpc, signal);
								exchange.request = decoded;
								return { grant: decoded.grant, input: fromPluginRpc(decoded.envelope.request) };
							},
						),
					),
				);
				committed =
					result.method === 'settings.write' ||
					result.method === 'storage.put' ||
					result.method === 'storage.delete' ||
					result.method === 'intents.create' ||
					result.method === 'intents.revoke' ||
					result.method === 'agent.threads.create' ||
					result.method === 'agent.threads.rename' ||
					result.method === 'agent.threads.delete' ||
					result.method === 'agent.runs.create' ||
					result.method === 'agent.runs.appendInput' ||
					result.method === 'agent.runs.resume' ||
					result.method === 'agent.runs.cancel' ||
					result.method === 'agent.subagents.cancel' ||
					result.method === 'agent.approvals.resolve' ||
					result.method === 'agent.memories.review' ||
					result.method === 'agent.artifacts.begin' ||
					result.method === 'agent.artifacts.retain' ||
					result.method === 'agent.artifacts.delete' ||
					result.method === 'agent.artifacts.attach';
				if (exchange.request === null) {
					throw new AgentOperationError('internal_failure');
				}
				if ((await access.authenticate(token))?.userId !== identity.userId) {
					throw new AgentOperationError(committed ? 'operation_unknown' : 'unauthenticated');
				}
				const response: AgentPluginRpcResponse = {
					type: 'nexus.plugin.response',
					protocol: AGENT_PLUGIN_PROTOCOL_VERSION,
					nonce: exchange.request.envelope.nonce,
					id: exchange.request.envelope.id,
					seq: exchange.request.envelope.seq,
					ok: true,
					result: toPluginRpc(result),
				};
				const envelope = exchange.request.envelope;
				reply.type('application/json; charset=utf-8').serializer((payload) => {
					try {
						return encodeAgentJson(payload, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
					} catch (cause) {
						throw new AgentRpcHttpSerializationFailure(
							committed ? 'operation_unknown' : 'limit_exceeded',
							cause,
							envelope.nonce,
							envelope.id,
							envelope.seq,
						);
					}
				});
				reply.code(200).send(response);
			} catch (error) {
				if (reply.sent || reply.raw.headersSent || reply.raw.destroyed || reply.raw.writableEnded) {
					reply.raw.destroy();
					return;
				}
				const code = failureCode(error, committed);
				if (exchange.request === null) {
					reply.code(agentErrorStatus(code)).send({ code });
					return;
				}
				const response: AgentPluginRpcResponse = {
					type: 'nexus.plugin.response',
					protocol: AGENT_PLUGIN_PROTOCOL_VERSION,
					nonce: exchange.request.envelope.nonce,
					id: exchange.request.envelope.id,
					seq: exchange.request.envelope.seq,
					ok: false,
					error: { code },
				};
				reply.code(agentErrorStatus(code)).send(response);
			}
		},
	};
}
