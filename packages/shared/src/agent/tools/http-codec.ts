import { AGENT_RUN_STEP_MAX_COUNT } from '../runs/values.js';
import { agentRecord, agentInteger, agentText, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_CAPABILITIES,
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_MAX_TOOL_NAME_BYTES,
	AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES,
} from '../governance/values.js';
import { AGENT_TOOL_STATES, AGENT_TOOL_EVENT_MAX_LIMIT, AGENT_TOOL_MAX_RESPONSE_BYTES } from './values.js';
import type { AgentToolState } from './values.js';
import type { AgentToolPath, AgentToolEventsQuery, AgentToolEventsResponse } from './http.js';
import type { AgentToolView, AgentToolEventView } from './model.js';

function state(input: unknown): AgentToolState {
	const result = AGENT_TOOL_STATES.find((value) => value === input);
	if (result === undefined) {
		throw new InvalidAgentPayload();
	}
	return result;
}

function hash(input: unknown): string {
	const result = agentText(input, 64);
	if (!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(result)) {
		throw new InvalidAgentPayload();
	}
	return result;
}

export function readAgentToolPath(input: unknown): AgentToolPath {
	const row = agentRecord(input, ['appId', 'runId', 'toolCallId']);
	return { appId: readAgentId(row.appId), runId: readAgentId(row.runId), toolCallId: readAgentId(row.toolCallId) };
}

export function readAgentToolEventsQuery(input: URLSearchParams): AgentToolEventsQuery {
	if ([...input.keys()].some((key) => key !== 'after' && key !== 'limit')) {
		throw new InvalidAgentPayload();
	}

	function value(key: string, fallback: number, maximum: number): number {
		const entries = input.getAll(key);
		if (entries.length === 0) {
			return fallback;
		}
		if (entries.length !== 1 || !/^(0|[1-9][0-9]*)$/u.test(entries[0])) {
			throw new InvalidAgentPayload();
		}
		return agentInteger(Number(entries[0]), key === 'limit' ? 1 : 0, maximum);
	}

	return { after: value('after', 0, Number.MAX_SAFE_INTEGER), limit: value('limit', 50, AGENT_TOOL_EVENT_MAX_LIMIT) };
}

export function readAgentToolResponse(input: unknown): AgentToolView {
	const row = agentRecord(
		input,
		[
			'id',
			'appId',
			'runId',
			'modelStepIndex',
			'toolName',
			'toolVersion',
			'capability',
			'targetId',
			'targetVersion',
			'risk',
			'mutation',
			'operationHash',
			'operationRevision',
			'revision',
			'state',
			'createdAt',
			'updatedAt',
		],
		AGENT_TOOL_MAX_RESPONSE_BYTES,
	);
	const capability = AGENT_CAPABILITIES.find((value) => value === row.capability);
	const risk = AGENT_APPROVAL_RISKS.find((value) => value === row.risk);
	if (capability === undefined || risk === undefined || typeof row.mutation !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	const targetId = row.targetId === null ? null : agentInteger(row.targetId, 1);
	const targetVersion = row.targetVersion === null ? null : agentInteger(row.targetVersion, 1);
	if ((targetId === null) !== (targetVersion === null)) {
		throw new InvalidAgentPayload();
	}
	const operationRevision = agentInteger(row.operationRevision, 1);
	const createdAt = agentInteger(row.createdAt);
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		runId: readAgentId(row.runId),
		modelStepIndex: agentInteger(row.modelStepIndex, 1, AGENT_RUN_STEP_MAX_COUNT),
		toolName: agentText(row.toolName, AGENT_APPROVAL_MAX_TOOL_NAME_BYTES),
		toolVersion: agentText(row.toolVersion, AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES),
		capability,
		targetId,
		targetVersion,
		risk,
		mutation: row.mutation,
		operationHash: hash(row.operationHash),
		operationRevision,
		revision: agentInteger(row.revision, operationRevision),
		state: state(row.state),
		createdAt,
		updatedAt: agentInteger(row.updatedAt, createdAt),
	};
}

function readEvent(input: unknown): AgentToolEventView {
	const row = agentRecord(input, [
		'toolCallId',
		'runId',
		'revision',
		'operationRevision',
		'state',
		'operationHash',
		'createdAt',
	]);
	const operationRevision = agentInteger(row.operationRevision, 1);
	return {
		toolCallId: readAgentId(row.toolCallId),
		runId: readAgentId(row.runId),
		revision: agentInteger(row.revision, operationRevision),
		operationRevision,
		state: state(row.state),
		operationHash: hash(row.operationHash),
		createdAt: agentInteger(row.createdAt),
	};
}

export function readAgentToolEventsResponse(input: unknown): AgentToolEventsResponse {
	const row = agentRecord(input, ['items', 'nextCursor'], AGENT_TOOL_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > AGENT_TOOL_EVENT_MAX_LIMIT) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readEvent);
	for (let index = 1; index < items.length; index++) {
		const previous = items[index - 1];
		const current = items[index];
		if (
			current.runId !== previous.runId ||
			current.toolCallId !== previous.toolCallId ||
			current.revision !== previous.revision + 1 ||
			current.operationRevision < previous.operationRevision ||
			current.operationRevision > previous.operationRevision + 1 ||
			(current.operationRevision === previous.operationRevision &&
				current.operationHash !== previous.operationHash)
		) {
			throw new InvalidAgentPayload();
		}
	}
	const nextCursor = agentInteger(row.nextCursor);
	if (items.length !== 0 && nextCursor !== items[items.length - 1].revision) {
		throw new InvalidAgentPayload();
	}
	return { items, nextCursor };
}
