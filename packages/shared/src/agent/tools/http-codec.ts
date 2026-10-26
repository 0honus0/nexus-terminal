import { AGENT_RUN_STEP_MAX_COUNT } from '../runs/values.js';
import { agentRecord, agentInteger, agentText, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import {
	AGENT_CAPABILITIES,
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_MAX_SUMMARY_BYTES,
	AGENT_APPROVAL_MAX_TOOL_NAME_BYTES,
	AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES,
} from '../governance/values.js';
import {
	AGENT_TOOL_STATES,
	AGENT_TOOL_LIST_DEFAULT_LIMIT,
	AGENT_TOOL_LIST_MAX_LIMIT,
	AGENT_TOOL_MAX_RESPONSE_BYTES,
} from './values.js';
import type { AgentToolState } from './values.js';
import type { AgentThreadToolsPath, AgentThreadToolsQuery, AgentThreadToolsResponse } from './http.js';
import type { AgentToolView } from './model.js';

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

export function readAgentThreadToolsPath(input: unknown): AgentThreadToolsPath {
	const row = agentRecord(input, ['appId', 'threadId']);
	return { appId: readAgentId(row.appId), threadId: readAgentId(row.threadId) };
}

export function parseAgentToolListCursor(input: unknown): { createdAt: number; id: string } {
	const value = agentText(input, 64);
	const separator = value.indexOf(':');
	if (separator <= 0 || separator !== value.lastIndexOf(':')) {
		throw new InvalidAgentPayload();
	}
	const createdAt = value.slice(0, separator);
	if (!/^(0|[1-9][0-9]{0,15})$/u.test(createdAt) || !Number.isSafeInteger(Number(createdAt))) {
		throw new InvalidAgentPayload();
	}
	return { createdAt: Number(createdAt), id: readAgentId(value.slice(separator + 1)) };
}

function readToolListCursor(input: unknown): string {
	const cursor = parseAgentToolListCursor(input);
	return encodeAgentToolListCursor(cursor.createdAt, cursor.id);
}

export function encodeAgentToolListCursor(createdAt: number, id: string): string {
	if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
		throw new InvalidAgentPayload();
	}
	readAgentId(id);
	return String(createdAt) + ':' + id;
}

export function readAgentThreadToolsQuery(input: URLSearchParams): AgentThreadToolsQuery {
	if ([...input.keys()].some((key) => key !== 'before' && key !== 'limit')) {
		throw new InvalidAgentPayload();
	}
	const before = input.getAll('before');
	const limits = input.getAll('limit');
	if (before.length > 1 || limits.length > 1) {
		throw new InvalidAgentPayload();
	}
	const rawLimit = limits.length === 0 ? String(AGENT_TOOL_LIST_DEFAULT_LIMIT) : limits[0];
	if (!/^(0|[1-9][0-9]{0,15})$/u.test(rawLimit)) {
		throw new InvalidAgentPayload();
	}
	const limit = agentInteger(Number(rawLimit), 1, AGENT_TOOL_LIST_MAX_LIMIT);
	return { before: before.length === 0 ? null : readToolListCursor(before[0]), limit };
}

function readTool(input: unknown): AgentToolView {
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
			'summary',
			'operationHash',
			'operationRevision',
			'revision',
			'state',
			'generatedImageId',
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
	const generatedImageId = row.generatedImageId === null ? null : readAgentId(row.generatedImageId);
	if (generatedImageId !== null && (row.toolName !== 'image_generate' || row.state !== 'completed')) {
		throw new InvalidAgentPayload();
	}
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
		summary: agentText(row.summary, AGENT_APPROVAL_MAX_SUMMARY_BYTES),
		operationHash: hash(row.operationHash),
		operationRevision,
		revision: agentInteger(row.revision, operationRevision),
		state: state(row.state),
		generatedImageId,
		createdAt,
		updatedAt: agentInteger(row.updatedAt, createdAt),
	};
}

export function readAgentThreadToolsResponse(
	input: unknown,
	appId: string,
	before: string | null,
	limit: number,
): AgentThreadToolsResponse {
	const row = agentRecord(input, ['items', 'nextCursor'], AGENT_TOOL_MAX_RESPONSE_BYTES);
	if (!Array.isArray(row.items) || row.items.length > limit) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readTool);
	for (const item of items) {
		if (item.appId !== appId) {
			throw new InvalidAgentPayload();
		}
	}
	for (let index = 1; index < items.length; index++) {
		const previous = items[index - 1];
		const current = items[index];
		if (
			current.createdAt < previous.createdAt ||
			(current.createdAt === previous.createdAt && current.id <= previous.id)
		) {
			throw new InvalidAgentPayload();
		}
	}
	if (before !== null) {
		const boundary = parseAgentToolListCursor(before);
		if (
			items.some(
				(item) =>
					item.createdAt > boundary.createdAt ||
					(item.createdAt === boundary.createdAt && item.id >= boundary.id),
			)
		) {
			throw new InvalidAgentPayload();
		}
	}
	const nextCursor = row.nextCursor === null ? null : readToolListCursor(row.nextCursor);
	if (
		nextCursor !== null &&
		(items.length !== limit || encodeAgentToolListCursor(items[0].createdAt, items[0].id) !== nextCursor)
	) {
		throw new InvalidAgentPayload();
	}
	return { items, nextCursor };
}
