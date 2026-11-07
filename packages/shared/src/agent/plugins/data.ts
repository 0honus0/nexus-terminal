import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from './values.js';
import { agentInteger, agentRecord, InvalidAgentPayload } from '../http-codec.js';
import { pluginContractText } from './registry-codec.js';

/** Private to one logical plugin instance; namespace revisions belong to the plugin. */
export interface AgentPluginDataRecord {
	key: string;
	revision: number;
	/** Null is a deletion tombstone. Recreating a key never resets its revision. */
	documentJson: string | null;
}

export interface AgentPluginDataPage {
	items: { key: string; revision: number; deleted: boolean }[];
	nextCursor: string | null;
}

export interface AgentPluginDataWrite {
	operationKey: string;
	namespace: string;
	key: string;
	expectedRevision: number;
	documentJson: string | null;
}

export function readAgentPluginDataRecord(input: unknown): AgentPluginDataRecord {
	const row = agentRecord(input, ['key', 'revision', 'documentJson'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	if (row.documentJson !== null && typeof row.documentJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	if (row.documentJson !== null) {
		try {
			JSON.parse(row.documentJson);
		} catch {
			throw new InvalidAgentPayload();
		}
	}
	return {
		key: pluginContractText(row.key),
		revision: agentInteger(row.revision, 1),
		documentJson: row.documentJson,
	};
}

export function readAgentPluginDataWrite(input: unknown): AgentPluginDataWrite {
	const row = agentRecord(
		input,
		['operationKey', 'namespace', 'key', 'expectedRevision', 'documentJson'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	if (row.documentJson !== null && typeof row.documentJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	if (row.documentJson !== null) {
		try {
			JSON.parse(row.documentJson);
		} catch {
			throw new InvalidAgentPayload();
		}
	}
	return {
		operationKey: pluginContractText(row.operationKey),
		namespace: pluginContractText(row.namespace),
		key: pluginContractText(row.key),
		expectedRevision: agentInteger(row.expectedRevision),
		documentJson: row.documentJson,
	};
}

export function readAgentPluginDataPage(input: unknown): AgentPluginDataPage {
	const row = agentRecord(input, ['items', 'nextCursor'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	if (!Array.isArray(row.items)) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map((item) => {
		const entry = agentRecord(item, ['key', 'revision', 'deleted'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		if (typeof entry.deleted !== 'boolean') {
			throw new InvalidAgentPayload();
		}
		return {
			key: pluginContractText(entry.key),
			revision: agentInteger(entry.revision, 1),
			deleted: entry.deleted,
		};
	});
	const nextCursor = row.nextCursor === null ? null : pluginContractText(row.nextCursor);
	if (
		new Set(items.map((item) => item.key)).size !== items.length ||
		(nextCursor !== null && nextCursor !== items.at(-1)?.key)
	) {
		throw new InvalidAgentPayload();
	}
	return { items, nextCursor };
}
