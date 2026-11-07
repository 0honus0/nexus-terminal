import { encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_PLUGIN_PROTOCOL_VERSION } from '@nexus-terminal/shared/agent/plugins/values';
import type { AgentPluginRpcResponse } from '@nexus-terminal/shared/agent/plugins/frontend-events';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import type { HttpRoute } from '../../../../platform/http/http-types.js';
import { agentErrorStatus } from './agent-http-status.js';

/** Serialization runs after native preSerialization hooks, outside the handler's catch. */
export class AgentHttpSerializationFailure extends Error {
	constructor(
		readonly code: AgentOperationErrorCode,
		cause: unknown,
	) {
		super('Agent HTTP response serialization failed', { cause });
		this.name = 'AgentHttpSerializationFailure';
	}
}

/** Keep the original validated RPC exchange identity when delivering a serialization refusal. */
export class AgentRpcHttpSerializationFailure extends AgentHttpSerializationFailure {
	constructor(
		code: AgentOperationErrorCode,
		cause: unknown,
		readonly nonce: string,
		readonly id: string,
		readonly seq: number,
	) {
		super(code, cause);
		this.name = 'AgentRpcHttpSerializationFailure';
	}
}

export function agentHttpSerializer(
	maxBytes: number,
	failureCode: AgentOperationErrorCode = 'limit_exceeded',
): (payload: unknown) => string {
	return (payload) => {
		try {
			return encodeAgentJson(payload, maxBytes);
		} catch (cause) {
			throw new AgentHttpSerializationFailure(failureCode, cause);
		}
	};
}

export const agentHttpErrorHandler: NonNullable<HttpRoute['errorHandler']> = function (error, _request, reply) {
	if (!(error instanceof AgentHttpSerializationFailure)) {
		// Fastify advances thrown errors to the parent handler, which owns technical failures.
		throw error;
	}
	if (reply.raw.headersSent || reply.raw.destroyed || reply.raw.writableEnded) {
		reply.raw.destroy();
		return;
	}
	reply.removeHeader('Set-Cookie');
	reply.removeHeader('Content-Length');
	// The failed bounded serializer must not run again while projecting its safe refusal.
	reply.type('application/json; charset=utf-8').serializer(JSON.stringify);
	const payload: AgentPluginRpcResponse | { code: AgentOperationErrorCode } =
		error instanceof AgentRpcHttpSerializationFailure
			? {
					type: 'nexus.plugin.response',
					protocol: AGENT_PLUGIN_PROTOCOL_VERSION,
					nonce: error.nonce,
					id: error.id,
					seq: error.seq,
					ok: false,
					error: { code: error.code },
				}
			: { code: error.code };
	reply.code(agentErrorStatus(error.code)).send(payload);
};
