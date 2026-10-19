import { agentRecord, agentInteger, readAgentId, readAgentErrorResponse, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from './values.js';
import { readAgentPluginRpcInput, readAgentPluginRpcResult } from './rpc-codec.js';
import { readAgentWorkspaceInput, readAgentWorkspaceResult } from '../scope/workspace-http-codec.js';
import type { AgentWorkspaceInput } from '../scope/workspace-http.js';
import type {
	AgentPluginInit,
	AgentPluginFrontendInput,
	AgentPluginFrontendResult,
	AgentPluginRpcEnvelope,
	AgentPluginRpcResponse,
	AgentPluginFrontendRpcRequest,
} from './frontend-events.js';

export function isAgentPluginAgentInput(value: AgentPluginFrontendInput): value is AgentWorkspaceInput {
	return value.method.startsWith('agent.');
}

export function readAgentPluginFrontendInput(input: unknown): AgentPluginFrontendInput {
	const row = agentRecord(input, ['method', 'params'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	return typeof row.method === 'string' && row.method.startsWith('agent.')
		? readAgentWorkspaceInput(input)
		: readAgentPluginRpcInput(input);
}

export function readAgentPluginFrontendResult(
	input: unknown,
	request: AgentPluginFrontendInput,
): AgentPluginFrontendResult {
	return isAgentPluginAgentInput(request)
		? readAgentWorkspaceResult(input, request)
		: readAgentPluginRpcResult(input, request);
}

export function readAgentPluginRpcEnvelope(input: unknown): AgentPluginRpcEnvelope {
	const row = agentRecord(
		input,
		['type', 'protocol', 'nonce', 'id', 'seq', 'request'],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (row.type !== 'nexus.plugin.request' || row.protocol !== 1) {
		throw new InvalidAgentPayload();
	}
	return {
		type: 'nexus.plugin.request',
		protocol: 1,
		nonce: readAgentId(row.nonce),
		id: readAgentId(row.id),
		seq: agentInteger(row.seq, 1),
		request: readAgentPluginFrontendInput(row.request),
	};
}

export function readAgentPluginFrontendRpc(input: unknown): AgentPluginFrontendRpcRequest {
	const row = agentRecord(input, ['grant', 'envelope'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	return { grant: readAgentId(row.grant), envelope: readAgentPluginRpcEnvelope(row.envelope) };
}

export function readAgentPluginRpcResponse(input: unknown, request: AgentPluginRpcEnvelope): AgentPluginRpcResponse {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		Object.hasOwn(input, 'result')
			? ['type', 'protocol', 'nonce', 'id', 'seq', 'ok', 'result']
			: ['type', 'protocol', 'nonce', 'id', 'seq', 'ok', 'error'],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (
		row.type !== 'nexus.plugin.response' ||
		row.protocol !== 1 ||
		row.nonce !== request.nonce ||
		row.id !== request.id ||
		row.seq !== request.seq
	) {
		throw new InvalidAgentPayload();
	}
	if (row.ok === true) {
		return {
			type: 'nexus.plugin.response',
			protocol: 1,
			nonce: request.nonce,
			id: request.id,
			seq: request.seq,
			ok: true,
			result: readAgentPluginFrontendResult(row.result, request.request),
		};
	}
	if (row.ok === false) {
		return {
			type: 'nexus.plugin.response',
			protocol: 1,
			nonce: request.nonce,
			id: request.id,
			seq: request.seq,
			ok: false,
			error: readAgentErrorResponse(row.error),
		};
	}
	throw new InvalidAgentPayload();
}

export function readAgentPluginInit(input: unknown): AgentPluginInit {
	const row = agentRecord(input, ['type', 'protocol', 'nonce', 'appId']);
	if (row.type !== 'nexus.plugin.init' || row.protocol !== 1) {
		throw new InvalidAgentPayload();
	}
	return { type: 'nexus.plugin.init', protocol: 1, nonce: readAgentId(row.nonce), appId: readAgentId(row.appId) };
}
