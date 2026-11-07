import { isAgentPluginUiMethod, readAgentPluginUiInput, readAgentPluginUiResult } from './ui-http-codec.js';
import type { AgentPluginUiInput } from './ui-http.js';
import { readAgentRunEventsResponse } from '../runs/http-codec.js';
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
	return value.method.startsWith('agent.') && !isAgentPluginUiMethod(value.method);
}

export function isAgentPluginUiInput(value: AgentPluginFrontendInput): value is AgentPluginUiInput {
	return isAgentPluginUiMethod(value.method);
}

export function readAgentPluginFrontendInput(input: unknown): AgentPluginFrontendInput {
	const row = agentRecord(input, ['method', 'params'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	if (isAgentPluginUiMethod(row.method)) {
		return readAgentPluginUiInput(input);
	}
	return typeof row.method === 'string' && row.method.startsWith('agent.')
		? readAgentWorkspaceInput(input)
		: readAgentPluginRpcInput(input);
}

export function readAgentPluginFrontendResult(
	input: unknown,
	request: AgentPluginFrontendInput,
): AgentPluginFrontendResult {
	if (isAgentPluginUiInput(request)) {
		return readAgentPluginUiResult(input, request);
	}
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
	if (row.type !== 'nexus.plugin.request' || row.protocol !== 4) {
		throw new InvalidAgentPayload();
	}
	return {
		type: 'nexus.plugin.request',
		protocol: 4,
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
		row.protocol !== 4 ||
		row.nonce !== request.nonce ||
		row.id !== request.id ||
		row.seq !== request.seq
	) {
		throw new InvalidAgentPayload();
	}
	if (row.ok === true) {
		return {
			type: 'nexus.plugin.response',
			protocol: 4,
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
			protocol: 4,
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
	const row = agentRecord(input, ['type', 'protocol', 'nonce', 'appId', 'expiresAt']);
	if (row.type !== 'nexus.plugin.init' || row.protocol !== 4) {
		throw new InvalidAgentPayload();
	}
	return {
		type: 'nexus.plugin.init',
		protocol: 4,
		nonce: readAgentId(row.nonce),
		appId: readAgentId(row.appId),
		expiresAt: agentInteger(row.expiresAt, 1),
	};
}

export function readAgentPluginStreamCommand(input: unknown): import('./frontend-events.js').AgentPluginStreamCommand {
	if (input === null || typeof input !== 'object' || Array.isArray(input) || !('command' in input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		input.command === 'subscribe'
			? ['type', 'protocol', 'nonce', 'seq', 'subscriptionId', 'generation', 'command', 'source']
			: input.command === 'ack'
				? ['type', 'protocol', 'nonce', 'seq', 'subscriptionId', 'generation', 'command', 'revision']
				: ['type', 'protocol', 'nonce', 'seq', 'subscriptionId', 'generation', 'command'],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (row.type !== 'nexus.plugin.stream' || row.protocol !== 4) {
		throw new InvalidAgentPayload();
	}
	const base = {
		type: 'nexus.plugin.stream' as const,
		protocol: 4 as const,
		nonce: readAgentId(row.nonce),
		seq: agentInteger(row.seq, 1),
		subscriptionId: readAgentId(row.subscriptionId),
		generation: agentInteger(row.generation, 1),
	};
	if (row.command === 'subscribe') {
		const source = agentRecord(row.source, ['kind', 'runId', 'after'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		if (source.kind !== 'run-events') {
			throw new InvalidAgentPayload();
		}
		return {
			type: base.type,
			protocol: base.protocol,
			nonce: base.nonce,
			seq: base.seq,
			subscriptionId: base.subscriptionId,
			generation: base.generation,
			command: 'subscribe',
			source: { kind: 'run-events', runId: readAgentId(source.runId), after: agentInteger(source.after) },
		};
	}
	if (row.command === 'ack') {
		return {
			type: base.type,
			protocol: base.protocol,
			nonce: base.nonce,
			seq: base.seq,
			subscriptionId: base.subscriptionId,
			generation: base.generation,
			command: 'ack',
			revision: agentInteger(row.revision, 1),
		};
	}
	if (row.command === 'unsubscribe') {
		return {
			type: base.type,
			protocol: base.protocol,
			nonce: base.nonce,
			seq: base.seq,
			subscriptionId: base.subscriptionId,
			generation: base.generation,
			command: 'unsubscribe',
		};
	}
	throw new InvalidAgentPayload();
}

export function readAgentPluginStreamEvent(
	input: unknown,
	context: { nonce: string; subscriptionId: string; generation: number; runId: string; after: number },
): import('./frontend-events.js').AgentPluginStreamEvent {
	if (input === null || typeof input !== 'object' || Array.isArray(input) || !('ok' in input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		input.ok === true
			? ['type', 'protocol', 'nonce', 'subscriptionId', 'generation', 'ok', 'revision', 'value']
			: ['type', 'protocol', 'nonce', 'subscriptionId', 'generation', 'ok', 'error'],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (
		row.type !== 'nexus.plugin.stream-event' ||
		row.protocol !== 4 ||
		row.nonce !== context.nonce ||
		row.subscriptionId !== context.subscriptionId ||
		row.generation !== context.generation
	) {
		throw new InvalidAgentPayload();
	}
	if (row.ok === true) {
		const value = readAgentRunEventsResponse(row.value);
		if (
			value.items.some((event) => event.runId !== context.runId || event.sequence <= context.after) ||
			(value.items.length === 0 && value.nextCursor !== context.after)
		) {
			throw new InvalidAgentPayload();
		}
		return {
			type: 'nexus.plugin.stream-event',
			protocol: 4,
			nonce: context.nonce,
			subscriptionId: context.subscriptionId,
			generation: context.generation,
			ok: true,
			revision: agentInteger(row.revision, 1),
			value,
		};
	}
	if (row.ok === false) {
		return {
			type: 'nexus.plugin.stream-event',
			protocol: 4,
			nonce: context.nonce,
			subscriptionId: context.subscriptionId,
			generation: context.generation,
			ok: false,
			error: readAgentErrorResponse(row.error),
		};
	}
	throw new InvalidAgentPayload();
}

export function readAgentPluginControl(input: unknown): import('./frontend-events.js').AgentPluginControl {
	if (input === null || typeof input !== 'object' || !('type' in input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		input.type === 'nexus.plugin.cancel'
			? ['type', 'protocol', 'nonce', 'seq', 'id']
			: ['type', 'protocol', 'nonce', 'seq'],
		AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	);
	if (row.protocol !== 4) {
		throw new InvalidAgentPayload();
	}
	const nonce = readAgentId(row.nonce),
		seq = agentInteger(row.seq, 1);
	if (row.type === 'nexus.plugin.cancel') {
		return { type: 'nexus.plugin.cancel', protocol: 4, nonce, seq, id: readAgentId(row.id) };
	}
	if (row.type === 'nexus.plugin.close') {
		return { type: 'nexus.plugin.close', protocol: 4, nonce, seq };
	}
	throw new InvalidAgentPayload();
}

export function readAgentPluginCancelled(
	input: unknown,
	request: AgentPluginRpcEnvelope,
): import('./frontend-events.js').AgentPluginCancelled {
	const row = agentRecord(input, ['type', 'protocol', 'nonce', 'id', 'seq'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	if (
		row.type !== 'nexus.plugin.cancelled' ||
		row.protocol !== 4 ||
		row.nonce !== request.nonce ||
		row.id !== request.id ||
		row.seq !== request.seq
	) {
		throw new InvalidAgentPayload();
	}
	return { type: 'nexus.plugin.cancelled', protocol: 4, nonce: request.nonce, id: request.id, seq: request.seq };
}
