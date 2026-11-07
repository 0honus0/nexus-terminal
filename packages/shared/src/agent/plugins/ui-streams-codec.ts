import { agentRecord, agentInteger, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { readAgentRunStreamCursor, readAgentRunStreamEvent } from '../runs/events.js';
import { readAgentMemoryInvalidation } from '../memory/events.js';
import { AGENT_RUN_STREAM_MAX_JSON_BYTES } from '../runs/values.js';
import type {
	AgentPluginUiStreamSource,
	AgentPluginUiStreamCommand,
	AgentPluginUiStreamPage,
	AgentPluginUiStreamFailure,
} from './ui-streams.js';

export function readAgentPluginUiStreamSource(input: unknown): AgentPluginUiStreamSource {
	const row = agentRecord(input, Object.keys(input !== null && typeof input === 'object' ? input : {}));
	if (row.kind === 'run') {
		agentRecord(row, ['kind', 'runId', 'cursor']);
		return { kind: 'run', runId: readAgentId(row.runId), cursor: readAgentRunStreamCursor(row.cursor) };
	}
	if (row.kind !== 'memory') {
		throw new InvalidAgentPayload();
	}
	agentRecord(row, ['kind', 'threadId']);
	return { kind: 'memory', threadId: row.threadId === null ? null : readAgentId(row.threadId) };
}

export function readAgentPluginUiStreamCommand(input: unknown): AgentPluginUiStreamCommand {
	const row = agentRecord(input, Object.keys(input !== null && typeof input === 'object' ? input : {}));
	const id = readAgentId(row.id);
	if (row.type === 'nexus.ui.stream.subscribe') {
		agentRecord(row, ['type', 'id', 'source']);
		return { type: row.type, id, source: readAgentPluginUiStreamSource(row.source) };
	}
	if (row.type === 'nexus.ui.stream.unsubscribe') {
		agentRecord(row, ['type', 'id']);
		return { type: row.type, id };
	}
	if (row.type !== 'nexus.ui.stream.ack') {
		throw new InvalidAgentPayload();
	}
	agentRecord(row, ['type', 'id', 'generation', 'revision', 'delivery']);
	return {
		type: row.type,
		id,
		generation: agentInteger(row.generation, 1),
		revision: agentInteger(row.revision, 1),
		delivery: agentInteger(row.delivery, 1),
	};
}

export function readAgentPluginUiStreamPage(
	input: unknown,
	source: AgentPluginUiStreamSource,
	appId: string,
	appVersion: number,
): AgentPluginUiStreamPage {
	const row = agentRecord(
		input,
		['type', 'id', 'generation', 'revision', 'delivery', 'value'],
		AGENT_RUN_STREAM_MAX_JSON_BYTES + 1024,
	);
	if (row.type !== 'nexus.ui.stream.page') {
		throw new InvalidAgentPayload();
	}
	const revision = agentInteger(row.revision, 1);
	const value =
		source.kind === 'memory'
			? readAgentMemoryInvalidation(row.value)
			: readAgentRunStreamEvent(row.value, { appId, appVersion, runId: source.runId }, source.cursor);
	if (value.type === 'heartbeat' || value.revision !== revision) {
		throw new InvalidAgentPayload();
	}
	return {
		type: row.type,
		id: readAgentId(row.id),
		generation: agentInteger(row.generation, 1),
		revision,
		delivery: agentInteger(row.delivery, 1),
		value,
	};
}

export function readAgentPluginUiStreamFailure(input: unknown): AgentPluginUiStreamFailure {
	const row = agentRecord(input, ['type', 'id', 'code']);
	if (
		row.type !== 'nexus.ui.stream.failure' ||
		(row.code !== 'forbidden' &&
			row.code !== 'resync_required' &&
			row.code !== 'unavailable' &&
			row.code !== 'protocol_failure')
	) {
		throw new InvalidAgentPayload();
	}
	return { type: row.type, id: readAgentId(row.id), code: row.code };
}
