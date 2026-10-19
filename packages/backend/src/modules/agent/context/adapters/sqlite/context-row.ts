import { createHash } from 'node:crypto';
import { AGENT_RUN_STATUSES } from '@nexus-terminal/shared/agent/runs/values';
import { MODEL_REASONING_MAX_BYTES } from '../../../../../platform/ai/model-port.js';
import { readStepProposals } from '../../../runs/adapters/sqlite/run-step-proposals.js';
import { TOOL_PROVIDER_CALL_ID_MAX_BYTES } from '../../../runs/run-tool-limits.js';
import { storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import {
	CONTEXT_MAX_BYTES,
	CONTEXT_MAX_MESSAGES,
	CONTEXT_MAX_SOURCES,
	CONTEXT_SNAPSHOT_MAX_BYTES,
} from '../../context-limits.js';
import type { StoredContextMessage, StoredContextSnapshot } from '../../storage/context-storage.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
		throw new Error('Corrupt context fields');
	}
	return value;
}

function reasoning(value: unknown): { id: string; encryptedContent: string; summary: string[] }[] {
	if (!Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > MODEL_REASONING_MAX_BYTES) {
		throw new Error('Corrupt context reasoning capacity');
	}
	const ids = new Set<string>();
	return value.map((raw: unknown) => {
		const item = object(raw, ['id', 'encryptedContent', 'summary']);
		const id = storedText(item.id);
		const encryptedContent = storedText(item.encryptedContent);
		if (!id || !encryptedContent || ids.has(id) || !Array.isArray(item.summary)) {
			throw new Error('Corrupt context reasoning');
		}
		ids.add(id);
		return { id, encryptedContent, summary: item.summary.map((text: unknown) => storedText(text)) };
	});
}

function message(raw: unknown): StoredContextMessage {
	if (!isRecord(raw)) {
		throw new Error('Corrupt context message');
	}
	if (raw.role === 'user') {
		const item = object(raw, ['role', 'content']);
		return { role: 'user', content: storedText(item.content) };
	}
	if (raw.role === 'tool') {
		const item = object(raw, ['role', 'providerCallId', 'content']);
		const providerCallId = storedText(item.providerCallId);
		if (!providerCallId.trim() || Buffer.byteLength(providerCallId) > TOOL_PROVIDER_CALL_ID_MAX_BYTES) {
			throw new Error('Corrupt context tool identity');
		}
		return { role: 'tool', providerCallId, content: storedText(item.content) };
	}
	if (raw.role !== 'assistant') {
		throw new Error('Corrupt context role');
	}
	const item = object(raw, ['role', 'content', 'proposals', 'reasoning']);
	return {
		role: 'assistant',
		content: storedText(item.content),
		proposals: readStepProposals(JSON.stringify(item.proposals)),
		reasoning: reasoning(item.reasoning),
	};
}

/** Private stored JSON is never decoded in a Service or application Model. */
export function decodeContextSnapshot(json: unknown): StoredContextSnapshot {
	if (typeof json !== 'string' || Buffer.byteLength(json) > CONTEXT_SNAPSHOT_MAX_BYTES) {
		throw new Error('Corrupt context snapshot capacity');
	}
	const parsed: unknown = JSON.parse(json);
	const value = object(parsed, ['messages', 'sources']);
	if (
		!Array.isArray(value.messages) ||
		value.messages.length === 0 ||
		value.messages.length > CONTEXT_MAX_MESSAGES ||
		!Array.isArray(value.sources) ||
		value.sources.length > CONTEXT_MAX_SOURCES
	) {
		throw new Error('Corrupt context snapshot shape');
	}
	const messages = value.messages.map((raw: unknown) => message(raw));
	if (messages[0].role !== 'user' || Buffer.byteLength(JSON.stringify(messages)) > CONTEXT_MAX_BYTES) {
		throw new Error('Corrupt context message bounds');
	}
	const pending = new Set<string>();
	for (const item of messages) {
		if (item.role === 'tool') {
			if (!pending.delete(item.providerCallId)) {
				throw new Error('Corrupt context result identity');
			}
		} else {
			if (pending.size) {
				throw new Error('Incomplete context exchange');
			}
			if (item.role === 'assistant') {
				if (!item.content.trim() && item.proposals.length === 0) {
					throw new Error('Empty context assistant message');
				}
				for (const proposal of item.proposals) {
					pending.add(proposal.providerCallId);
				}
			}
		}
	}
	if (pending.size) {
		throw new Error('Incomplete context exchange');
	}
	const ids = new Set<string>();
	let sequence = 0;
	const sources = value.sources.map((raw: unknown) => {
		const item = object(raw, ['runId', 'version', 'sequence', 'status']);
		const runId = storedText(item.runId);
		const next = storedInteger(item.sequence, 1);
		if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(runId) || ids.has(runId) || next <= sequence) {
			throw new Error('Corrupt context source identity');
		}
		ids.add(runId);
		sequence = next;
		const status = AGENT_RUN_STATUSES.find((state) => state === item.status);
		if (!status) {
			throw new Error('Corrupt context source status');
		}
		return { runId, version: storedInteger(item.version, 1), sequence: next, status };
	});
	return { messages, sources };
}

export function contextContentHash(json: string): string {
	return createHash('sha256').update(json).digest('hex');
}

export function readContextSnapshot(row: Record<string, unknown>): StoredContextSnapshot {
	if (
		typeof row.content_json !== 'string' ||
		Buffer.byteLength(row.content_json) > CONTEXT_SNAPSHOT_MAX_BYTES ||
		row.content_hash !== contextContentHash(row.content_json)
	) {
		throw new Error('Corrupt context content hash');
	}
	return decodeContextSnapshot(row.content_json);
}
