import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from './values.js';
import { readAgentPluginIntentCreate, readAgentPluginIntentReceipt } from './intent-http-codec.js';
import { AGENT_PLUGIN_INTENT_MAX_PAGE, AGENT_PLUGIN_INTENT_MAX_RANGE_BYTES } from './intent-values.js';
import { readAgentArtifactView } from '../artifacts/http-codec.js';
import {
	readAgentPluginDataKey,
	readAgentPluginDataValue,
	readAgentPluginDataView,
	readAgentPluginInstallation,
} from './http-codec.js';
import type { AgentPluginRpcInput, AgentPluginRpcResult } from './events.js';

export function readAgentPluginRpcInput(input: unknown): AgentPluginRpcInput {
	const row = agentRecord(input, ['method', 'params'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	if (row.method === 'host.appInfo') {
		agentRecord(row.params, []);
		return { method: row.method, params: {} };
	}
	if (row.method === 'storage.get') {
		const params = agentRecord(row.params, ['key']);
		return { method: row.method, params: { key: readAgentPluginDataKey(params.key) } };
	}
	if (row.method === 'storage.put') {
		const params = agentRecord(
			row.params,
			['key', 'expectedVersion', 'operationId', 'valueJson'],
			AGENT_PLUGIN_MAX_MESSAGE_BYTES,
		);
		return {
			method: row.method,
			params: {
				key: readAgentPluginDataKey(params.key),
				expectedVersion: agentInteger(params.expectedVersion, 0, Number.MAX_SAFE_INTEGER - 1),
				operationId: readAgentId(params.operationId),
				valueJson: readAgentPluginDataValue(params.valueJson),
			},
		};
	}
	if (row.method === 'storage.delete') {
		const params = agentRecord(row.params, ['key', 'expectedVersion', 'operationId']);
		return {
			method: row.method,
			params: {
				key: readAgentPluginDataKey(params.key),
				expectedVersion: agentInteger(params.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1),
				operationId: readAgentId(params.operationId),
			},
		};
	}
	if (row.method === 'intents.create') {
		return { method: row.method, params: readAgentPluginIntentCreate(row.params) };
	}
	if (row.method === 'intents.listReceived') {
		const params = agentRecord(row.params, ['limit']);
		return { method: row.method, params: { limit: agentInteger(params.limit, 1, AGENT_PLUGIN_INTENT_MAX_PAGE) } };
	}
	if (row.method === 'intents.revoke') {
		const params = agentRecord(row.params, ['receiptId']);
		return { method: row.method, params: { receiptId: readAgentId(params.receiptId) } };
	}
	if (row.method === 'intents.artifacts.get') {
		const params = agentRecord(row.params, ['receiptId', 'artifactId']);
		return {
			method: row.method,
			params: { receiptId: readAgentId(params.receiptId), artifactId: readAgentId(params.artifactId) },
		};
	}
	if (row.method === 'intents.artifacts.readRange') {
		const params = agentRecord(row.params, ['receiptId', 'artifactId', 'start', 'endInclusive']);
		const start = agentInteger(params.start, 0, Number.MAX_SAFE_INTEGER - 1);
		const endInclusive = agentInteger(params.endInclusive, start, Number.MAX_SAFE_INTEGER - 1);
		if (endInclusive - start + 1 > AGENT_PLUGIN_INTENT_MAX_RANGE_BYTES) {
			throw new InvalidAgentPayload();
		}
		return {
			method: row.method,
			params: {
				receiptId: readAgentId(params.receiptId),
				artifactId: readAgentId(params.artifactId),
				start,
				endInclusive,
			},
		};
	}
	throw new InvalidAgentPayload();
}

export function readAgentPluginRpcResult(input: unknown, request: AgentPluginRpcInput): AgentPluginRpcResult {
	const row = agentRecord(input, ['method', 'value'], AGENT_PLUGIN_MAX_MESSAGE_BYTES);
	if (row.method !== request.method) {
		throw new InvalidAgentPayload();
	}
	if (request.method === 'host.appInfo') {
		return { method: request.method, value: readAgentPluginInstallation(row.value) };
	}
	if (request.method === 'intents.create') {
		const value = readAgentPluginIntentReceipt(row.value),
			expected = request.params;
		if (
			value.id !== expected.operationId ||
			value.receiverAppId !== expected.receiverAppId ||
			value.intentId !== expected.intentId ||
			value.inputJson !== expected.inputJson ||
			JSON.stringify(value.artifactIds) !== JSON.stringify(expected.artifactIds) ||
			value.revokedAt !== null
		) {
			throw new InvalidAgentPayload();
		}
		return { method: request.method, value };
	}
	if (request.method === 'intents.listReceived') {
		if (!Array.isArray(row.value) || row.value.length > request.params.limit) {
			throw new InvalidAgentPayload();
		}
		const value = row.value.map(readAgentPluginIntentReceipt);
		if (new Set(value.map((item) => item.id)).size !== value.length) {
			throw new InvalidAgentPayload();
		}
		return { method: request.method, value };
	}
	if (request.method === 'intents.revoke') {
		if (agentRecord(row.value, ['revoked']).revoked !== true) {
			throw new InvalidAgentPayload();
		}
		return { method: request.method, value: { revoked: true } };
	}
	if (request.method === 'intents.artifacts.get') {
		const value = readAgentArtifactView(row.value);
		if (value.id !== request.params.artifactId || value.status !== 'ready') {
			throw new InvalidAgentPayload();
		}
		return { method: request.method, value };
	}
	if (request.method === 'intents.artifacts.readRange') {
		const value = agentRecord(
			row.value,
			['receiptId', 'artifactId', 'start', 'endInclusive', 'dataBase64'],
			AGENT_PLUGIN_MAX_MESSAGE_BYTES,
		);
		const expected = request.params;
		const bytes = expected.endInclusive - expected.start + 1;
		if (
			value.receiptId !== expected.receiptId ||
			value.artifactId !== expected.artifactId ||
			value.start !== expected.start ||
			value.endInclusive !== expected.endInclusive ||
			typeof value.dataBase64 !== 'string' ||
			value.dataBase64.length !== 4 * Math.ceil(bytes / 3)
		) {
			throw new InvalidAgentPayload();
		}
		// Canonical encoding prevents accepting a correct shape with truncated or ambiguous bytes.
		try {
			const decoded = atob(value.dataBase64);
			if (decoded.length !== bytes || btoa(decoded) !== value.dataBase64) {
				throw new InvalidAgentPayload();
			}
		} catch {
			throw new InvalidAgentPayload();
		}
		return {
			method: request.method,
			value: {
				receiptId: expected.receiptId,
				artifactId: expected.artifactId,
				start: expected.start,
				endInclusive: expected.endInclusive,
				dataBase64: value.dataBase64,
			},
		};
	}
	const value = row.value === null ? null : readAgentPluginDataView(row.value);
	if (value !== null && value.key !== request.params.key) {
		throw new InvalidAgentPayload();
	}
	if (request.method === 'storage.get') {
		return { method: request.method, value };
	}
	if (
		value === null ||
		value.version !== request.params.expectedVersion + 1 ||
		(request.method === 'storage.delete' ? value.valueJson !== null : value.valueJson !== request.params.valueJson)
	) {
		throw new InvalidAgentPayload();
	}
	return { method: request.method, value };
}
