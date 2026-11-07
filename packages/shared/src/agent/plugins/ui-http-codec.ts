import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { readAgentRunUsageResponse } from '../runs/http-codec.js';
import {
	readAgentThreadToolsQuery,
	readAgentThreadToolsResponse,
	readAgentToolCallDetails,
} from '../tools/http-codec.js';
import {
	readAgentMemoryListQuery,
	readAgentMemoryListResponse,
	readAgentMemoryResponse,
	readAgentMemoryReview,
} from '../memory/http-codec.js';
import {
	readAgentArtifactQuery,
	readAgentArtifactBegin,
	readAgentArtifactResponse,
	readAgentArtifactListResponse,
	readAgentArtifactRetain,
	readAgentArtifactVersion,
	readAgentArtifactAttachResponse,
	readAgentArtifactDeleteResponse,
} from '../artifacts/http-codec.js';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from './values.js';
import type { AgentPluginUiInput, AgentPluginUiResult } from './ui-http.js';

const methods = new Set([
	'agent.runs.usage',
	'agent.tools.list',
	'agent.tools.details',
	'agent.memories.list',
	'agent.memories.get',
	'agent.memories.review',
	'agent.artifacts.list',
	'agent.artifacts.get',
	'agent.artifacts.begin',
	'agent.artifacts.retain',
	'agent.artifacts.delete',
	'agent.artifacts.attach',
	'agent.artifacts.readRange',
]);

export function isAgentPluginUiMethod(method: unknown): boolean {
	return typeof method === 'string' && methods.has(method);
}

export function readAgentPluginUiInput(input: unknown): AgentPluginUiInput {
	const row = agentRecord(input, ['method', 'params'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	switch (row.method) {
		case 'agent.runs.usage': {
			const p = agentRecord(row.params, ['runId']);
			return { method: row.method, params: { runId: readAgentId(p.runId) } };
		}
		case 'agent.tools.list': {
			const p = agentRecord(row.params, ['threadId', 'before', 'limit']);
			const query = new URLSearchParams({ limit: String(agentInteger(p.limit, 1)) });
			if (p.before !== null) {
				if (typeof p.before !== 'string') {
					throw new InvalidAgentPayload();
				}
				query.set('before', p.before);
			}
			const value = readAgentThreadToolsQuery(query);
			return {
				method: row.method,
				params: { threadId: readAgentId(p.threadId), before: value.before, limit: value.limit },
			};
		}
		case 'agent.tools.details': {
			const p = agentRecord(row.params, ['runId', 'toolId']);
			return { method: row.method, params: { runId: readAgentId(p.runId), toolId: readAgentId(p.toolId) } };
		}
		case 'agent.memories.list': {
			const p = agentRecord(row.params, [
				'status',
				'limit',
				'offset',
				...(Object.hasOwn(row.params ?? {}, 'threadId') ? ['threadId'] : []),
			]);
			if (typeof p.status !== 'string') {
				throw new InvalidAgentPayload();
			}
			const query = new URLSearchParams({
				status: p.status,
				limit: String(agentInteger(p.limit, 1)),
				offset: String(agentInteger(p.offset)),
			});
			if (p.threadId !== undefined) {
				query.set('threadId', readAgentId(p.threadId));
			}
			return { method: row.method, params: readAgentMemoryListQuery(query) };
		}
		case 'agent.memories.get': {
			const p = agentRecord(row.params, ['memoryId']);
			return { method: row.method, params: { memoryId: readAgentId(p.memoryId) } };
		}
		case 'agent.memories.review': {
			const p = agentRecord(row.params, ['memoryId', 'input']);
			return {
				method: row.method,
				params: { memoryId: readAgentId(p.memoryId), input: readAgentMemoryReview(p.input) },
			};
		}
		case 'agent.artifacts.list': {
			const p = agentRecord(row.params, ['retained', 'kind', 'q', 'offset', 'limit']);
			if (
				(p.retained !== null && typeof p.retained !== 'boolean') ||
				typeof p.q !== 'string' ||
				(p.kind !== null && typeof p.kind !== 'string')
			) {
				throw new InvalidAgentPayload();
			}
			const query = new URLSearchParams({
				q: p.q,
				offset: String(agentInteger(p.offset)),
				limit: String(agentInteger(p.limit, 1)),
			});
			if (p.retained !== null) {
				query.set('retained', String(p.retained));
			}
			if (p.kind !== null) {
				query.set('kind', p.kind);
			}
			const value = readAgentArtifactQuery(query);
			return {
				method: row.method,
				params: {
					retained: value.retained,
					kind: value.kind,
					q: value.q,
					offset: value.offset,
					limit: value.limit,
				},
			};
		}
		case 'agent.artifacts.get': {
			const p = agentRecord(row.params, ['artifactId']);
			return { method: row.method, params: { artifactId: readAgentId(p.artifactId) } };
		}
		case 'agent.artifacts.begin':
			return { method: row.method, params: readAgentArtifactBegin(row.params) };
		case 'agent.artifacts.retain': {
			const p = agentRecord(row.params, ['artifactId', 'input']);
			return {
				method: row.method,
				params: { artifactId: readAgentId(p.artifactId), input: readAgentArtifactRetain(p.input) },
			};
		}
		case 'agent.artifacts.delete': {
			const p = agentRecord(row.params, ['artifactId', 'input']);
			return {
				method: row.method,
				params: { artifactId: readAgentId(p.artifactId), input: readAgentArtifactVersion(p.input) },
			};
		}
		case 'agent.artifacts.attach': {
			const p = agentRecord(row.params, ['artifactId', 'expectedVersion', 'threadId', 'runId']);
			return {
				method: row.method,
				params: {
					artifactId: readAgentId(p.artifactId),
					expectedVersion: agentInteger(p.expectedVersion, 1),
					threadId: readAgentId(p.threadId),
					runId: p.runId === null ? null : readAgentId(p.runId),
				},
			};
		}
		case 'agent.artifacts.readRange': {
			const p = agentRecord(row.params, ['artifactId', 'expectedVersion', 'start', 'endInclusive']);
			const start = agentInteger(p.start);
			return {
				method: row.method,
				params: {
					artifactId: readAgentId(p.artifactId),
					expectedVersion: agentInteger(p.expectedVersion, 1),
					start,
					endInclusive: agentInteger(p.endInclusive, start),
				},
			};
		}
		default:
			throw new InvalidAgentPayload();
	}
}

export function readAgentPluginUiResult(
	input: unknown,
	request: AgentPluginUiInput,
	expectedAppId?: string,
): AgentPluginUiResult {
	const row = agentRecord(input, ['appId', 'method', 'value'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
	const appId = readAgentId(row.appId);
	if (row.method !== request.method || (expectedAppId !== undefined && appId !== expectedAppId)) {
		throw new InvalidAgentPayload();
	}
	switch (request.method) {
		case 'agent.runs.usage': {
			const value = readAgentRunUsageResponse(row.value);
			if (value.runId !== request.params.runId) {
				throw new InvalidAgentPayload();
			}
			return { appId, method: request.method, value };
		}
		case 'agent.tools.list':
			return {
				appId,
				method: request.method,
				value: readAgentThreadToolsResponse(row.value, appId, request.params.before, request.params.limit),
			};
		case 'agent.tools.details': {
			const value = readAgentToolCallDetails(row.value, {
				appId,
				runId: request.params.runId,
				toolId: request.params.toolId,
			});
			return { appId, method: request.method, value };
		}
		case 'agent.memories.list': {
			const value = readAgentMemoryListResponse(row.value);
			if (
				value.items.length > request.params.limit ||
				value.items.some(
					(item) =>
						item.appId !== appId ||
						(request.params.status !== 'all' && item.status !== request.params.status),
				) ||
				(value.nextOffset !== null &&
					(value.nextOffset !== request.params.offset + request.params.limit ||
						value.items.length !== request.params.limit))
			) {
				throw new InvalidAgentPayload();
			}
			return { appId, method: request.method, value };
		}
		case 'agent.memories.get':
		case 'agent.memories.review': {
			const value = readAgentMemoryResponse(row.value);
			if (value.memory.id !== request.params.memoryId || value.memory.appId !== appId) {
				throw new InvalidAgentPayload();
			}
			if (
				request.method === 'agent.memories.review' &&
				(value.memory.version !== request.params.input.expectedVersion + 1 ||
					value.memory.reviewAction !== request.params.input.decision ||
					value.memory.status !== (request.params.input.decision === 'publish' ? 'published' : 'revoked') ||
					(request.params.input.content !== null && value.memory.content !== request.params.input.content))
			) {
				throw new InvalidAgentPayload();
			}
			return { appId, method: request.method, value };
		}
		case 'agent.artifacts.list': {
			const value = readAgentArtifactListResponse(row.value);
			if (
				value.items.length > request.params.limit ||
				value.items.some(
					(item) =>
						item.appId !== appId ||
						(request.params.kind !== null && item.kind !== request.params.kind) ||
						(request.params.retained !== null && item.retained !== request.params.retained),
				) ||
				(value.nextOffset !== null &&
					(value.nextOffset !== request.params.offset + request.params.limit ||
						value.items.length !== request.params.limit))
			) {
				throw new InvalidAgentPayload();
			}
			return { appId, method: request.method, value };
		}
		case 'agent.artifacts.get':
		case 'agent.artifacts.begin':
		case 'agent.artifacts.retain': {
			const value = readAgentArtifactResponse(row.value);
			if (value.artifact.appId !== appId) {
				throw new InvalidAgentPayload();
			}
			if (request.method === 'agent.artifacts.begin') {
				if (
					value.artifact.name !== request.params.name ||
					value.artifact.mediaType !== request.params.mediaType ||
					value.artifact.sizeBytes !== request.params.declaredBytes ||
					value.artifact.status !== 'staging' ||
					value.artifact.version !== 1
				) {
					throw new InvalidAgentPayload();
				}
			} else if (
				value.artifact.id !== request.params.artifactId ||
				(request.method === 'agent.artifacts.retain' &&
					(value.artifact.version !== request.params.input.expectedVersion + 1 ||
						value.artifact.retained !== request.params.input.retained ||
						value.artifact.status !== 'ready'))
			) {
				throw new InvalidAgentPayload();
			}
			return { appId, method: request.method, value };
		}
		case 'agent.artifacts.delete':
			return { appId, method: request.method, value: readAgentArtifactDeleteResponse(row.value) };
		case 'agent.artifacts.attach': {
			const value = readAgentArtifactAttachResponse(row.value);
			const attachment = value.attachment;
			if (
				attachment.artifact.id !== request.params.artifactId ||
				attachment.artifact.appId !== appId ||
				attachment.artifact.version !== request.params.expectedVersion + 1 ||
				attachment.sourceAppId !== appId ||
				attachment.targetAppId !== appId ||
				attachment.threadId !== request.params.threadId ||
				attachment.runId !== request.params.runId ||
				attachment.crossApp
			) {
				throw new InvalidAgentPayload();
			}
			return { appId, method: request.method, value };
		}
		case 'agent.artifacts.readRange': {
			const p = agentRecord(
				row.value,
				['artifactId', 'start', 'endInclusive', 'dataBase64', 'version', 'totalBytes'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			const artifactId = readAgentId(p.artifactId);
			const start = agentInteger(p.start);
			const endInclusive = agentInteger(p.endInclusive, start);
			if (
				artifactId !== request.params.artifactId ||
				start !== request.params.start ||
				endInclusive !== request.params.endInclusive ||
				p.version !== request.params.expectedVersion ||
				typeof p.dataBase64 !== 'string'
			) {
				throw new InvalidAgentPayload();
			}
			const bytes = endInclusive - start + 1;
			if (p.dataBase64.length !== 4 * Math.ceil(bytes / 3)) {
				throw new InvalidAgentPayload();
			}
			try {
				const decoded = atob(p.dataBase64);
				if (decoded.length !== bytes || btoa(decoded) !== p.dataBase64) {
					throw new InvalidAgentPayload();
				}
			} catch {
				throw new InvalidAgentPayload();
			}
			return {
				appId,
				method: request.method,
				value: {
					artifactId,
					start,
					endInclusive,
					dataBase64: p.dataBase64,
					version: agentInteger(p.version, 1),
					totalBytes: agentInteger(p.totalBytes, endInclusive + 1),
				},
			};
		}
	}
}
