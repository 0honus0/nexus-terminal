import {
	agentRecord,
	agentInteger,
	agentText,
	readAgentId,
	readAgentErrorResponse,
	InvalidAgentPayload,
} from '../http-codec.js';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES, AGENT_PLUGIN_MAX_SELECTABLE_MODELS } from './values.js';
import { readAgentPluginRpcInput, readAgentPluginRpcResult } from './rpc-codec.js';
import { AGENT_SCOPE_MAX_NAME_BYTES, AGENT_THREAD_MAX_PAGE } from '../scope/values.js';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '../scope/values.js';
import { readAgentThreadEntryCursor, readAgentThreadEntries } from '../scope/http-codec.js';
import { readAgentCreateThreadResponse, readAgentAppDefinitionListResponse } from '../scope/http-codec.js';
import {
	readAgentRunResponse,
	readAgentRunEventsResponse,
	readAgentCreateRunRequest,
	readAgentCreateRunResponse,
	readAgentCancelRunResponse,
} from '../runs/http-codec.js';
import { AGENT_RUN_EVENT_MAX_LIMIT } from '../runs/values.js';
import { AGENT_PROVIDER_MAX_NAME_BYTES, AGENT_PROVIDER_MAX_MODEL_ID_BYTES } from '../providers/values.js';
import { readAgentChildrenResponse, readAgentMessageMetadataResponse } from '../collaboration/http-codec.js';
import { AGENT_COLLABORATION_MESSAGE_MAX_PAGE } from '../collaboration/values.js';
import {
	readAgentApprovalList,
	readAgentApprovalResolveRequest,
	readAgentApprovalView,
} from '../governance/http-codec.js';
import type {
	AgentPluginInit,
	AgentPluginAgentInput,
	AgentPluginFrontendInput,
	AgentPluginFrontendResult,
	AgentPluginRpcEnvelope,
	AgentPluginRpcResponse,
	AgentPluginFrontendRpcRequest,
	AgentPluginSelectableModel,
} from './frontend-events.js';

export function isAgentPluginAgentInput(value: AgentPluginFrontendInput): value is AgentPluginAgentInput {
	return value.method.startsWith('agent.');
}

export function readAgentPluginFrontendInput(input: unknown): AgentPluginFrontendInput {
	const row = agentRecord(input, ['method', 'params'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	switch (row.method) {
		case 'agent.runs.appendInput': {
			const p = agentRecord(
				row.params,
				['runId', 'expectedVersion', 'threadId', 'operationId', 'input'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			return {
				method: row.method,
				params: {
					runId: readAgentId(p.runId),
					expectedVersion: agentInteger(p.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
					threadId: readAgentId(p.threadId),
					operationId: readAgentId(p.operationId),
					input: readAgentCreateRunRequest(p.input),
				},
			};
		}
		case 'agent.threads.entries': {
			const p = agentRecord(row.params, ['threadId', 'after', 'limit']);
			return {
				method: row.method,
				params: {
					threadId: readAgentId(p.threadId),
					after: readAgentThreadEntryCursor(p.after),
					limit: agentInteger(p.limit, 1, AGENT_THREAD_ENTRY_MAX_PAGE),
				},
			};
		}
		case 'agent.runs.create': {
			const p = agentRecord(
				row.params,
				['threadId', 'operationId', 'input'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			return {
				method: row.method,
				params: {
					threadId: readAgentId(p.threadId),
					operationId: readAgentId(p.operationId),
					input: readAgentCreateRunRequest(p.input),
				},
			};
		}
		case 'agent.runs.cancel': {
			const p = agentRecord(row.params, ['runId', 'operationId', 'expectedVersion']);
			return {
				method: row.method,
				params: {
					runId: readAgentId(p.runId),
					operationId: readAgentId(p.operationId),
					expectedVersion: agentInteger(p.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
				},
			};
		}
		case 'agent.subagents.cancel': {
			const p = agentRecord(row.params, ['runId', 'childId', 'operationId', 'expectedVersion']);
			return {
				method: row.method,
				params: {
					runId: readAgentId(p.runId),
					childId: readAgentId(p.childId),
					operationId: readAgentId(p.operationId),
					expectedVersion: agentInteger(p.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
				},
			};
		}
		case 'agent.approvals.resolve': {
			const p = agentRecord(row.params, ['approvalId', 'operationId', 'input']);
			return {
				method: row.method,
				params: {
					approvalId: readAgentId(p.approvalId),
					operationId: readAgentId(p.operationId),
					input: readAgentApprovalResolveRequest(p.input),
				},
			};
		}
		case 'agent.definitions.list':
		case 'agent.providers.list':
			agentRecord(row.params, []);
			return { method: row.method, params: {} };
		case 'agent.threads.list': {
			const p = agentRecord(row.params, ['after', 'limit']);
			return {
				method: row.method,
				params: {
					after: p.after === null ? null : readAgentId(p.after),
					limit: agentInteger(p.limit, 1, AGENT_THREAD_MAX_PAGE),
				},
			};
		}
		case 'agent.threads.create': {
			const p = agentRecord(row.params, ['title', 'operationId']);
			return {
				method: row.method,
				params: {
					operationId: readAgentId(p.operationId),
					title: agentText(p.title, AGENT_SCOPE_MAX_NAME_BYTES),
				},
			};
		}
		case 'agent.threads.rename': {
			const p = agentRecord(row.params, ['threadId', 'expectedVersion', 'title', 'operationId']);
			return {
				method: row.method,
				params: {
					threadId: readAgentId(p.threadId),
					expectedVersion: agentInteger(p.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
					operationId: readAgentId(p.operationId),
					title: agentText(p.title, AGENT_SCOPE_MAX_NAME_BYTES),
				},
			};
		}
		case 'agent.runs.list': {
			const p = agentRecord(row.params, ['threadId', 'after', 'limit']);
			return {
				method: row.method,
				params: {
					threadId: readAgentId(p.threadId),
					after: agentInteger(p.after, 0, Number.MAX_SAFE_INTEGER - 1),
					limit: agentInteger(p.limit, 1, AGENT_RUN_EVENT_MAX_LIMIT),
				},
			};
		}
		case 'agent.runs.get':
		case 'agent.subagents.list':
		case 'agent.approvals.list': {
			const p = agentRecord(row.params, ['runId']);
			return { method: row.method, params: { runId: readAgentId(p.runId) } };
		}
		case 'agent.runs.events': {
			const p = agentRecord(row.params, ['runId', 'after', 'limit']);
			return {
				method: row.method,
				params: {
					runId: readAgentId(p.runId),
					after: agentInteger(p.after, 0, Number.MAX_SAFE_INTEGER - 1),
					limit: agentInteger(p.limit, 1, AGENT_RUN_EVENT_MAX_LIMIT),
				},
			};
		}
		case 'agent.subagents.messages': {
			const p = agentRecord(row.params, ['runId', 'childId', 'after', 'limit']);
			return {
				method: row.method,
				params: {
					runId: readAgentId(p.runId),
					childId: readAgentId(p.childId),
					after: agentInteger(p.after, 0, Number.MAX_SAFE_INTEGER - 1),
					limit: agentInteger(p.limit, 1, AGENT_COLLABORATION_MESSAGE_MAX_PAGE),
				},
			};
		}
		default:
			return readAgentPluginRpcInput(input);
	}
}

function requireArray(input: unknown, limit: number): unknown[] {
	if (!Array.isArray(input) || input.length > limit) {
		throw new InvalidAgentPayload();
	}
	return input;
}

function uniqueIds(values: { id: string }[]): void {
	if (new Set(values.map((value) => value.id)).size !== values.length) {
		throw new InvalidAgentPayload();
	}
}

export function readAgentPluginFrontendResult(
	input: unknown,
	request: AgentPluginFrontendInput,
): AgentPluginFrontendResult {
	if (!isAgentPluginAgentInput(request)) {
		return readAgentPluginRpcResult(input, request);
	}
	const row = agentRecord(input, ['method', 'value'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	if (row.method !== request.method) {
		throw new InvalidAgentPayload();
	}
	switch (request.method) {
		case 'agent.threads.entries':
			return {
				method: request.method,
				value: readAgentThreadEntries(
					row.value,
					request.params.threadId,
					request.params.after,
					request.params.limit,
				),
			};
		case 'agent.runs.create':
		case 'agent.runs.appendInput': {
			const value = readAgentCreateRunResponse(row.value);
			if (
				value.run.threadId !== request.params.threadId ||
				(request.method === 'agent.runs.appendInput' && value.run.id === request.params.runId)
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.runs.cancel':
		case 'agent.subagents.cancel': {
			const value = readAgentCancelRunResponse(row.value);
			if (
				value.run.id !==
					(request.method === 'agent.runs.cancel' ? request.params.runId : request.params.childId) ||
				(value.status !== 'replayed' &&
					value.status === 'cancelled' &&
					value.run.version !== request.params.expectedVersion + 1)
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.approvals.resolve': {
			const value = readAgentApprovalView(row.value);
			if (
				value.id !== request.params.approvalId ||
				value.operationHash !== request.params.input.operationHash ||
				value.version !== request.params.input.expectedVersion + 1 ||
				value.status !== request.params.input.decision
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.definitions.list':
			return { method: request.method, value: readAgentAppDefinitionListResponse(row.value) };
		case 'agent.providers.list': {
			const value = requireArray(row.value, AGENT_PLUGIN_MAX_SELECTABLE_MODELS).map(
				(raw): AgentPluginSelectableModel => {
					const p = agentRecord(raw, [
						'providerId',
						'providerDisplayName',
						'configurationVersion',
						'modelId',
						'protocol',
					]);
					const protocol =
						p.protocol === 'chat-completions' || p.protocol === 'responses' ? p.protocol : null;
					if (!protocol) {
						throw new InvalidAgentPayload();
					}
					return {
						providerId: readAgentId(p.providerId),
						providerDisplayName: agentText(p.providerDisplayName, AGENT_PROVIDER_MAX_NAME_BYTES),
						configurationVersion: agentInteger(p.configurationVersion, 1),
						modelId: agentText(p.modelId, AGENT_PROVIDER_MAX_MODEL_ID_BYTES),
						protocol,
					};
				},
			);
			if (new Set(value.map((item) => item.providerId + ':' + item.modelId)).size !== value.length) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.threads.list': {
			const p = agentRecord(row.value, ['items', 'nextCursor'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
			const items = requireArray(p.items, request.params.limit).map(readAgentCreateThreadResponse);
			uniqueIds(items);
			const nextCursor = p.nextCursor === null ? null : readAgentId(p.nextCursor);
			if (
				items.some((item, index) => item.id <= (index ? items[index - 1].id : (request.params.after ?? ''))) ||
				(nextCursor !== null &&
					(!items.length ||
						nextCursor !== items[items.length - 1].id ||
						items.length !== request.params.limit))
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value: { items, nextCursor } };
		}
		case 'agent.threads.create':
		case 'agent.threads.rename': {
			const value = readAgentCreateThreadResponse(row.value);
			if (
				value.title !== request.params.title.trim() ||
				(request.method === 'agent.threads.create'
					? value.id !== request.params.operationId || value.version !== 1
					: value.id !== request.params.threadId || value.version !== request.params.expectedVersion + 1)
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.runs.list': {
			const p = agentRecord(
				row.value,
				['threadId', 'items', 'nextCursor'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			const items = requireArray(p.items, request.params.limit).map(readAgentRunResponse);
			const nextCursor = agentInteger(p.nextCursor, request.params.after);
			uniqueIds(items);
			if (
				p.threadId !== request.params.threadId ||
				items.some((item) => item.threadId !== request.params.threadId) ||
				(items.length ? nextCursor <= request.params.after : nextCursor !== request.params.after)
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value: { threadId: request.params.threadId, items, nextCursor } };
		}
		case 'agent.runs.get': {
			const value = row.value === null ? null : readAgentRunResponse(row.value);
			if (value && value.id !== request.params.runId) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.runs.events': {
			const value = readAgentRunEventsResponse(row.value);
			if (
				value.items.length > request.params.limit ||
				value.items.some(
					(item) => item.runId !== request.params.runId || item.sequence <= request.params.after,
				) ||
				(value.items.length
					? value.nextCursor <= request.params.after
					: value.nextCursor !== request.params.after)
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.subagents.list': {
			const value = readAgentChildrenResponse(row.value);
			if (value.items.some((item) => item.parentId !== request.params.runId)) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.subagents.messages': {
			const value = readAgentMessageMetadataResponse(row.value);
			if (
				value.items.length > request.params.limit ||
				value.items.some((item) => item.sequence <= request.params.after) ||
				(value.items.length
					? value.nextCursor <= request.params.after
					: value.nextCursor !== request.params.after)
			) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
		case 'agent.approvals.list': {
			const value = readAgentApprovalList(row.value);
			if (value.some((item) => item.runId !== request.params.runId)) {
				throw new InvalidAgentPayload();
			}
			return { method: request.method, value };
		}
	}
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
