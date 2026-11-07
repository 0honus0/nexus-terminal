import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from './values.js';
import { isWellFormedFileText } from '../../remote/files/text-codec.js';

/** Keeps worst-case escaped text well inside one finite IPC envelope. */
export const AGENT_PLUGIN_CONTENT_CHUNK_BYTES = 64 * 1024;

export interface AgentPluginContentDraft {
	id: string;
	chunks: number;
	sealed: boolean;
}

export function readAgentPluginContentDraft(input: unknown): AgentPluginContentDraft {
	const row = agentRecord(input, ['id', 'chunks', 'sealed']);
	if (typeof row.sealed !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return { id: readAgentId(row.id), chunks: agentInteger(row.chunks), sealed: row.sealed };
}

/** Immutable Run-owned content; an opaque reference conveys no authority outside its original scope. */
export interface AgentPluginContentReference {
	id: string;
	sha256: string;
	sizeBytes: number;
	mediaType: string;
}

export interface AgentPluginContentPage {
	reference: AgentPluginContentReference;
	index: number;
	text: string;
	nextIndex: number | null;
}

export function readAgentPluginContentReference(input: unknown): AgentPluginContentReference {
	const row = agentRecord(input, ['id', 'sha256', 'sizeBytes', 'mediaType']);
	if (
		typeof row.sha256 !== 'string' ||
		!/^[0-9a-f]{64}$/u.test(row.sha256) ||
		typeof row.mediaType !== 'string' ||
		!row.mediaType.trim() ||
		row.mediaType.includes('\0')
	) {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(row.id),
		sha256: row.sha256,
		sizeBytes: agentInteger(row.sizeBytes),
		mediaType: row.mediaType,
	};
}

export function readAgentPluginContentPage(input: unknown): AgentPluginContentPage {
	const row = agentRecord(input, ['reference', 'index', 'text', 'nextIndex'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	if (
		typeof row.text !== 'string' ||
		!isWellFormedFileText(row.text) ||
		new TextEncoder().encode(row.text).byteLength > AGENT_PLUGIN_CONTENT_CHUNK_BYTES
	) {
		throw new InvalidAgentPayload();
	}
	const index = agentInteger(row.index);
	const nextIndex = row.nextIndex === null ? null : agentInteger(row.nextIndex, index + 1, index + 1);
	return { reference: readAgentPluginContentReference(row.reference), index, text: row.text, nextIndex };
}
