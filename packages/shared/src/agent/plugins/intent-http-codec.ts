import { agentRecord, agentText, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import type {
	AgentPluginIntentCreateRequest,
	AgentPluginIntentResponse,
	AgentPluginIntentListResponse,
} from './intent-http.js';
import type { AgentPluginIntentReceipt } from './intent-model.js';
import {
	AGENT_PLUGIN_INTENT_MAX_INPUT_BYTES,
	AGENT_PLUGIN_INTENT_MAX_ARTIFACTS,
	AGENT_PLUGIN_INTENT_MAX_PAGE,
	AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,
	AGENT_PLUGIN_INTENT_MAX_RESPONSE_BYTES,
} from './intent-values.js';

const RESERVED_PAYLOAD_FIELDS = new Set([
	'authorization',
	'password',
	'passphrase',
	'secret',
	'secretref',
	'token',
	'accesstoken',
	'refreshtoken',
	'sshhandle',
	'sshsession',
	'sessioncookie',
	'privatehistory',
	'hiddencontext',
	'chainofthought',
]);

/** Intents carry explicit public JSON, never an implicit credential/context transfer. */
function validatePayload(value: unknown, depth = 0): void {
	if (depth > 32 || (typeof value === 'number' && !Number.isFinite(value))) {
		throw new InvalidAgentPayload();
	}
	if (Array.isArray(value)) {
		value.forEach((item) => validatePayload(item, depth + 1));
	} else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			if (RESERVED_PAYLOAD_FIELDS.has(key.toLowerCase().replace(/[^a-z0-9]/gu, ''))) {
				throw new InvalidAgentPayload();
			}
			validatePayload(child, depth + 1);
		}
	}
}

export function readAgentPluginIntentJson(input: unknown): string {
	if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > AGENT_PLUGIN_INTENT_MAX_INPUT_BYTES) {
		throw new InvalidAgentPayload();
	}
	try {
		const value: unknown = JSON.parse(input);
		validatePayload(value);
	} catch {
		throw new InvalidAgentPayload();
	}
	return input;
}

function artifactIds(input: unknown): string[] {
	if (!Array.isArray(input) || input.length > AGENT_PLUGIN_INTENT_MAX_ARTIFACTS) {
		throw new InvalidAgentPayload();
	}
	const ids = input.map(readAgentId);
	if (new Set(ids).size !== ids.length) {
		throw new InvalidAgentPayload();
	}
	return ids;
}

export function readAgentPluginIntentCreate(input: unknown): AgentPluginIntentCreateRequest {
	const row = agentRecord(
		input,
		['operationId', 'receiverAppId', 'intentId', 'inputJson', 'artifactIds', 'confirmed'],
		AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,
	);
	if (row.confirmed !== true) {
		throw new InvalidAgentPayload();
	}
	return {
		operationId: readAgentId(row.operationId),
		receiverAppId: readAgentId(row.receiverAppId),
		intentId: agentText(row.intentId, 128),
		inputJson: readAgentPluginIntentJson(row.inputJson),
		artifactIds: artifactIds(row.artifactIds),
		confirmed: true,
	};
}

export function readAgentPluginIntentQuery(query: URLSearchParams): { limit: number } {
	if ([...query.keys()].some((key) => key !== 'limit' || query.getAll(key).length !== 1)) {
		throw new InvalidAgentPayload();
	}
	const text = query.get('limit');
	if (text !== null && !/^[1-9][0-9]*$/u.test(text)) {
		throw new InvalidAgentPayload();
	}
	return { limit: text === null ? 50 : agentInteger(Number(text), 1, AGENT_PLUGIN_INTENT_MAX_PAGE) };
}

export function readAgentPluginIntentReceipt(input: unknown): AgentPluginIntentReceipt {
	const row = agentRecord(
		input,
		[
			'id',
			'senderAppId',
			'receiverAppId',
			'senderVersion',
			'receiverVersion',
			'senderRevision',
			'receiverRevision',
			'intentId',
			'schemaVersion',
			'inputJson',
			'artifactIds',
			'createdAt',
			'expiresAt',
			'revokedAt',
		],
		AGENT_PLUGIN_INTENT_MAX_BODY_BYTES,
	);
	const createdAt = agentInteger(row.createdAt);
	return {
		id: readAgentId(row.id),
		senderAppId: readAgentId(row.senderAppId),
		receiverAppId: readAgentId(row.receiverAppId),
		senderVersion: agentText(row.senderVersion, 128),
		receiverVersion: agentText(row.receiverVersion, 128),
		senderRevision: agentText(row.senderRevision, 128),
		receiverRevision: agentText(row.receiverRevision, 128),
		intentId: agentText(row.intentId, 128),
		schemaVersion: agentInteger(row.schemaVersion, 1),
		inputJson: readAgentPluginIntentJson(row.inputJson),
		artifactIds: artifactIds(row.artifactIds),
		createdAt,
		expiresAt: agentInteger(row.expiresAt, createdAt + 1),
		revokedAt: row.revokedAt === null ? null : agentInteger(row.revokedAt, createdAt),
	};
}

export function readAgentPluginIntentResponse(input: unknown): AgentPluginIntentResponse {
	const row = agentRecord(input, ['receipt'], AGENT_PLUGIN_INTENT_MAX_BODY_BYTES);
	return { receipt: readAgentPluginIntentReceipt(row.receipt) };
}

export function readAgentPluginIntentListResponse(input: unknown): AgentPluginIntentListResponse {
	const row = agentRecord(input, ['items'], AGENT_PLUGIN_INTENT_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > AGENT_PLUGIN_INTENT_MAX_PAGE) {
		throw new InvalidAgentPayload();
	}
	return { items: row.items.map(readAgentPluginIntentReceipt) };
}
