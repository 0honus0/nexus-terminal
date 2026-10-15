import { PluginHttpInput } from './plugin-input.js';
import { ACCESS_SESSION_COOKIE_NAME } from '@nexus-terminal/shared/access/values';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import type {
	AgentPluginFrontendRpcRequest,
	AgentPluginRpcResponse,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import { readAgentPluginFrontendRpc } from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import { encodeAgentJson, readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { HttpInputFailure } from '../../../../platform/http/http-errors.js';
import type { AccessPublicApi } from '../../../access/public.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import { AgentOperationError } from '../../public-errors.js';
import { agentErrorStatus } from './agent-http-status.js';
import { fromPluginRpc, toPluginRpc } from './plugin-mapper.js';

export function createPluginRpcHttpRoute(
	access: AccessPublicApi,
	service: PluginService,
	boundary: <T>(work: () => Promise<T>) => Promise<T>,
): HttpRoute {
	return {
		method: 'POST',
		path: '/api/v1/agent/plugins/installations/:appId/frontend/rpc',
		maxBodyBytes: AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,

		async handle(ctx) {
			const exchange: { request: AgentPluginFrontendRpcRequest | null } = { request: null };
			const input = new PluginHttpInput(ctx);
			let committed = false;
			try {
				if ([...ctx.query.keys()].length) {
					throw new InvalidAgentPayload();
				}
				const token = ctx.cookie(ACCESS_SESSION_COOKIE_NAME),
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
							readAgentId(ctx.params.appId),
							async (signal) => {
								const decoded = await input.read(readAgentPluginFrontendRpc, signal);
								exchange.request = decoded;
								return { grant: decoded.grant, input: fromPluginRpc(decoded.envelope.request) };
							},
						),
					),
				);
				committed =
					result.method === 'storage.put' ||
					result.method === 'storage.delete' ||
					result.method === 'intents.create' ||
					result.method === 'intents.revoke' ||
					result.method === 'agent.threads.create' ||
					result.method === 'agent.threads.rename' ||
					result.method === 'agent.runs.create' ||
					result.method === 'agent.runs.appendInput' ||
					result.method === 'agent.runs.cancel' ||
					result.method === 'agent.subagents.cancel' ||
					result.method === 'agent.approvals.resolve';
				if (exchange.request === null) {
					throw new AgentOperationError('internal_failure');
				}
				if ((await access.authenticate(token))?.userId !== identity.userId) {
					throw new AgentOperationError(committed ? 'operation_unknown' : 'unauthenticated');
				}
				const response: AgentPluginRpcResponse = {
					type: 'nexus.plugin.response',
					protocol: 1,
					nonce: exchange.request.envelope.nonce,
					id: exchange.request.envelope.id,
					seq: exchange.request.envelope.seq,
					ok: true,
					result: toPluginRpc(result),
				};
				try {
					encodeAgentJson(response, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
				} catch {
					throw new AgentOperationError(committed ? 'operation_unknown' : 'limit_exceeded');
				}
				ctx.send(200, response);
			} catch (error) {
				if (input.transportFailure) {
					throw input.transportFailure;
				}
				if (error instanceof HttpInputFailure) {
					throw error;
				}
				const code = committed
					? 'operation_unknown'
					: error instanceof InvalidAgentPayload
						? 'invalid_input'
						: error instanceof AgentOperationError
							? error.code
							: 'internal_failure';
				if (exchange.request === null) {
					ctx.send(agentErrorStatus(code), { code });
					return;
				}
				const response: AgentPluginRpcResponse = {
					type: 'nexus.plugin.response',
					protocol: 1,
					nonce: exchange.request.envelope.nonce,
					id: exchange.request.envelope.id,
					seq: exchange.request.envelope.seq,
					ok: false,
					error: { code },
				};
				ctx.send(agentErrorStatus(code), response);
			}
		},
	};
}
