import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { readAgentPluginContentReference } from './content.js';
import type { AgentPluginContentReference } from './content.js';
import { pluginContractText } from './registry-codec.js';
import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from './values.js';

export interface AgentPluginRunInfo {
	runId: string;
	threadId: string;
	threadVersion: number;
	autoTitle: boolean;
	inputJson: string;
	resumeInputJson: string | null;
	prompt: string;
	sequence: number;
	deadlineUnixMs: number;
	outputPreviewBytes: number;
}

export interface AgentPluginPendingIntent {
	operationKey: string;
	requestSha256: string;
}

export interface AgentPluginCheckpoint {
	version: number;
	state: AgentPluginContentReference;
	consumedOperationIds: string[];
	pendingIntents: AgentPluginPendingIntent[];
}

export interface AgentPluginCheckpointWrite {
	expectedVersion: number;
	state: AgentPluginContentReference;
	consumedOperationIds: string[];
	pendingIntents: AgentPluginPendingIntent[];
}

export interface AgentPluginRunHistory {
	items: { runId: string; sequence: number; checkpoint: AgentPluginCheckpoint }[];
	nextBefore: number | null;
}

export interface AgentPluginTitleResult {
	operationId: string;
	updated: boolean;
}

export function readAgentPluginTitleResult(input: unknown): AgentPluginTitleResult {
	const row = agentRecord(input, ['operationId', 'updated'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	if (typeof row.updated !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return { operationId: readAgentId(row.operationId), updated: row.updated };
}

export function readAgentPluginRunInfo(input: unknown): AgentPluginRunInfo {
	const row = agentRecord(
		input,
		[
			'runId',
			'threadId',
			'threadVersion',
			'autoTitle',
			'inputJson',
			'resumeInputJson',
			'prompt',
			'sequence',
			'deadlineUnixMs',
			'outputPreviewBytes',
		],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	if (
		typeof row.prompt !== 'string' ||
		typeof row.autoTitle !== 'boolean' ||
		typeof row.inputJson !== 'string' ||
		(row.resumeInputJson !== null && typeof row.resumeInputJson !== 'string')
	) {
		throw new InvalidAgentPayload();
	}
	JSON.parse(row.inputJson);
	if (row.resumeInputJson !== null) {
		JSON.parse(row.resumeInputJson);
	}
	return {
		runId: readAgentId(row.runId),
		threadId: readAgentId(row.threadId),
		prompt: row.prompt,
		threadVersion: agentInteger(row.threadVersion, 1),
		autoTitle: row.autoTitle,
		inputJson: row.inputJson,
		resumeInputJson: row.resumeInputJson,
		sequence: agentInteger(row.sequence, 1),
		deadlineUnixMs: agentInteger(row.deadlineUnixMs, 1),
		outputPreviewBytes: agentInteger(row.outputPreviewBytes, 1),
	};
}

function checkpointFields(row: Record<string, unknown>) {
	if (!Array.isArray(row.consumedOperationIds) || !Array.isArray(row.pendingIntents)) {
		throw new InvalidAgentPayload();
	}
	const consumedOperationIds = row.consumedOperationIds.map(readAgentId);
	const pendingIntents = row.pendingIntents.map((item) => {
		const intent = agentRecord(item, ['operationKey', 'requestSha256'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		if (typeof intent.requestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(intent.requestSha256)) {
			throw new InvalidAgentPayload();
		}
		return { operationKey: pluginContractText(intent.operationKey), requestSha256: intent.requestSha256 };
	});
	if (
		new Set(consumedOperationIds).size !== consumedOperationIds.length ||
		new Set(pendingIntents.map((intent) => intent.operationKey)).size !== pendingIntents.length
	) {
		throw new InvalidAgentPayload();
	}
	return { state: readAgentPluginContentReference(row.state), consumedOperationIds, pendingIntents };
}

export function readAgentPluginCheckpoint(input: unknown): AgentPluginCheckpoint {
	const row = agentRecord(
		input,
		['version', 'state', 'consumedOperationIds', 'pendingIntents'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const fields = checkpointFields(row);
	return {
		version: agentInteger(row.version, 1),
		state: fields.state,
		consumedOperationIds: fields.consumedOperationIds,
		pendingIntents: fields.pendingIntents,
	};
}

export function readAgentPluginCheckpointWrite(input: unknown): AgentPluginCheckpointWrite {
	const row = agentRecord(
		input,
		['expectedVersion', 'state', 'consumedOperationIds', 'pendingIntents'],
		AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	);
	const fields = checkpointFields(row);
	return {
		expectedVersion: agentInteger(row.expectedVersion),
		state: fields.state,
		consumedOperationIds: fields.consumedOperationIds,
		pendingIntents: fields.pendingIntents,
	};
}

export function readAgentPluginRunHistory(input: unknown): AgentPluginRunHistory {
	const row = agentRecord(input, ['items', 'nextBefore'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
	if (!Array.isArray(row.items)) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map((item) => {
		const value = agentRecord(item, ['runId', 'sequence', 'checkpoint'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		return {
			runId: readAgentId(value.runId),
			sequence: agentInteger(value.sequence, 1),
			checkpoint: readAgentPluginCheckpoint(value.checkpoint),
		};
	});
	if (
		items.some((item, index) => index > 0 && item.sequence >= items[index - 1].sequence) ||
		(row.nextBefore !== null && (items.length === 0 || row.nextBefore !== items.at(-1)?.sequence))
	) {
		throw new InvalidAgentPayload();
	}
	return { items, nextBefore: row.nextBefore === null ? null : agentInteger(row.nextBefore, 1) };
}
