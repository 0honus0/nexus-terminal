import {
	agentRecord,
	agentInteger,
	agentText,
	readAgentId,
	isAgentRecord,
	InvalidAgentPayload,
} from '../http-codec.js';
import {
	AGENT_RESOURCE_SESSION_STATES,
	AGENT_APPROVAL_MODES,
	AGENT_RUN_FAILURE_CODES,
	AGENT_RUN_EVENT_DEFAULT_AFTER,
	AGENT_RUN_EVENT_DEFAULT_LIMIT,
	AGENT_RUN_EVENT_MAX_LIMIT,
	AGENT_RUN_MAX_PROMPT_BYTES,
	AGENT_RUN_MAX_JSON_BODY_BYTES,
} from './values.js';
import { AGENT_MAX_JSON_BODY_BYTES } from '../values.js';
import { readAgentPluginContentReference } from '../plugins/content.js';
import type { AgentResumeRunRequest, AgentResumeRunResponse, AgentRunSuspensionView } from './http.js';
import type { AgentRunFailureView, AgentRunUsageView, AgentRunView, AgentRunEventView } from './model.js';
import type {
	AgentCreateRunRequest,
	AgentCancelRunRequest,
	AgentRunCommandHeaders,
	AgentCreateRunPath,
	AgentRunPath,
	AgentRunEventsQuery,
	AgentCreateRunResponse,
	AgentCancelRunResponse,
	AgentRunEventsResponse,
} from './http.js';

function invalidRunInput(): never {
	throw new InvalidAgentPayload();
}

export function readAgentResumeRunRequest(input: unknown): AgentResumeRunRequest {
	const row = agentRecord(input, ['expectedVersion', 'inputJson'], AGENT_RUN_MAX_JSON_BODY_BYTES);
	if (typeof row.inputJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		JSON.parse(row.inputJson);
	} catch {
		throw new InvalidAgentPayload();
	}
	return {
		expectedVersion: agentInteger(row.expectedVersion, 1, Number.MAX_SAFE_INTEGER - 2),
		inputJson: row.inputJson,
	};
}

export function readAgentResumeRunResponse(input: unknown): AgentResumeRunResponse {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	const row = agentRecord(
		input,
		input.status === 'replayed' ? ['status', 'originalStatus', 'run'] : ['status', 'run'],
	);
	const run = readAgentRunResponse(row.run);
	if (run.status !== 'pending' || run.version < 2) {
		throw new InvalidAgentPayload();
	}
	if (row.status === 'resumed') {
		return { status: 'resumed', run };
	}
	if (row.status !== 'replayed' || row.originalStatus !== 'resumed') {
		throw new InvalidAgentPayload();
	}
	return { status: 'replayed', originalStatus: 'resumed', run };
}

export function readAgentRunSuspension(input: unknown): AgentRunSuspensionView {
	const row = agentRecord(input, ['runId', 'runVersion', 'checkpointVersion', 'inputRequest', 'suspendedAt']);
	return {
		runId: readAgentId(row.runId),
		runVersion: agentInteger(row.runVersion, 1),
		checkpointVersion: agentInteger(row.checkpointVersion, 1),
		inputRequest: readAgentPluginContentReference(row.inputRequest),
		suspendedAt: agentInteger(row.suspendedAt),
	};
}

export function readAgentCreateRunRequest(input: unknown): AgentCreateRunRequest {
	const fields = agentRecord(
		input,
		['prompt', 'inputJson', 'connectionIds', 'approvalMode'],
		AGENT_RUN_MAX_JSON_BODY_BYTES,
	);
	if (!Array.isArray(fields.connectionIds)) {
		throw new InvalidAgentPayload();
	}
	const approvalMode = AGENT_APPROVAL_MODES.find((mode) => mode === fields.approvalMode);
	if (!approvalMode) {
		throw new InvalidAgentPayload();
	}
	const connectionIds = fields.connectionIds.map((id: unknown) => agentInteger(id, 1));
	if (new Set(connectionIds).size !== connectionIds.length) {
		throw new InvalidAgentPayload();
	}
	if (typeof fields.inputJson !== 'string') {
		throw new InvalidAgentPayload();
	}
	try {
		JSON.parse(fields.inputJson);
	} catch {
		throw new InvalidAgentPayload();
	}
	return {
		approvalMode,
		prompt:
			typeof fields.prompt === 'string' &&
			new TextEncoder().encode(fields.prompt).byteLength <= AGENT_RUN_MAX_PROMPT_BYTES
				? fields.prompt
				: invalidRunInput(),
		connectionIds,
		inputJson: fields.inputJson,
	};
}

export function readAgentCancelRunRequest(input: unknown): AgentCancelRunRequest {
	return {
		expectedVersion: agentInteger(
			agentRecord(input, ['expectedVersion'], AGENT_MAX_JSON_BODY_BYTES).expectedVersion,
			1,
		),
	};
}

export function readAgentRunCommandHeaders(idempotencyKey: unknown): AgentRunCommandHeaders {
	return { operationKey: readAgentId(idempotencyKey) };
}

export function readAgentCreateRunPath(input: unknown): AgentCreateRunPath {
	const row = agentRecord(input, ['appId', 'threadId']);
	return { appId: readAgentId(row.appId), threadId: readAgentId(row.threadId) };
}

export function readAgentRunPath(input: unknown): AgentRunPath {
	const row = agentRecord(input, ['appId', 'runId']);
	return { appId: readAgentId(row.appId), runId: readAgentId(row.runId) };
}

function queryNumber(query: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
	const values = query.getAll(key);
	if (values.length === 0) {
		return fallback;
	}
	if (values.length !== 1 || !/^(0|[1-9][0-9]{0,14})$/u.test(values[0])) {
		throw new InvalidAgentPayload();
	}
	return agentInteger(Number(values[0]), min, max);
}

export function readAgentRunEventsQuery(query: URLSearchParams): AgentRunEventsQuery {
	if ([...query.keys()].some((key) => key !== 'after' && key !== 'limit')) {
		throw new InvalidAgentPayload();
	}
	return {
		after: queryNumber(query, 'after', AGENT_RUN_EVENT_DEFAULT_AFTER, 0, Number.MAX_SAFE_INTEGER),
		limit: queryNumber(query, 'limit', AGENT_RUN_EVENT_DEFAULT_LIMIT, 1, AGENT_RUN_EVENT_MAX_LIMIT),
	};
}

function readRunFailure(input: unknown): AgentRunFailureView | null {
	if (input === null) {
		return null;
	}
	const row = agentRecord(input, ['code', 'toolName']);
	const code = AGENT_RUN_FAILURE_CODES.find((value) => value === row.code);
	if (!code) {
		throw new InvalidAgentPayload();
	}
	const toolName = row.toolName === null ? null : agentText(row.toolName, 128);
	if (code.startsWith('tool_') && toolName === null) {
		throw new InvalidAgentPayload();
	}
	return { code, toolName };
}

export function readAgentRunResponse(input: unknown): AgentRunView {
	const row = agentRecord(input, [
		'id',
		'appId',
		'threadId',
		'status',
		'failure',
		'approvalMode',
		'version',
		'createdAt',
		'updatedAt',
	]);
	if (
		row.status !== 'pending' &&
		row.status !== 'running' &&
		row.status !== 'suspended' &&
		row.status !== 'completed' &&
		row.status !== 'failed' &&
		row.status !== 'unknown' &&
		row.status !== 'cancelled'
	) {
		throw new InvalidAgentPayload();
	}
	const approvalMode = AGENT_APPROVAL_MODES.find((mode) => mode === row.approvalMode);
	if (!approvalMode) {
		throw new InvalidAgentPayload();
	}
	const failure = readRunFailure(row.failure);
	if (failure !== null && row.status !== 'failed' && row.status !== 'unknown') {
		throw new InvalidAgentPayload();
	}
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		threadId: readAgentId(row.threadId),
		approvalMode,
		status: row.status,
		failure,
		version: agentInteger(row.version, 1),
		createdAt: agentInteger(row.createdAt),
		updatedAt: agentInteger(row.updatedAt),
	};
}

export function readAgentRunEvent(input: unknown): AgentRunEventView {
	const row = agentRecord(input, ['runId', 'sequence', 'type', 'runVersion', 'createdAt']);
	if (
		row.type !== 'run.created' &&
		row.type !== 'run.started' &&
		row.type !== 'run.suspended' &&
		row.type !== 'run.resumed' &&
		row.type !== 'run.completed' &&
		row.type !== 'run.failed' &&
		row.type !== 'run.unknown' &&
		row.type !== 'run.cancelled'
	) {
		throw new InvalidAgentPayload();
	}
	return {
		runId: readAgentId(row.runId),
		sequence: agentInteger(row.sequence, 1),
		type: row.type,
		runVersion: agentInteger(row.runVersion, 1),
		createdAt: agentInteger(row.createdAt),
	};
}

function commandResult(input: unknown): Record<string, unknown> {
	if (input !== null && typeof input === 'object' && 'status' in input && input.status === 'replayed') {
		return agentRecord(input, ['status', 'originalStatus', 'run']);
	}
	return agentRecord(input, ['status', 'run']);
}

export function readAgentCreateRunResponse(input: unknown): AgentCreateRunResponse {
	const row = commandResult(input);
	const run = readAgentRunResponse(row.run);
	if (row.status === 'created') {
		return { status: 'created', run };
	}
	if (row.status === 'replayed' && row.originalStatus === 'created') {
		return { status: 'replayed', originalStatus: 'created', run };
	}
	throw new InvalidAgentPayload();
}

export function readAgentCancelRunResponse(input: unknown): AgentCancelRunResponse {
	const row = commandResult(input);
	const run = readAgentRunResponse(row.run);
	if (row.status === 'cancelled' || row.status === 'already_cancelled') {
		return { status: row.status, run };
	}
	if (
		row.status === 'replayed' &&
		(row.originalStatus === 'cancelled' || row.originalStatus === 'already_cancelled')
	) {
		return { status: 'replayed', originalStatus: row.originalStatus, run };
	}
	throw new InvalidAgentPayload();
}

export function readAgentRunEventsResponse(input: unknown): AgentRunEventsResponse {
	const row = agentRecord(input, ['items', 'nextCursor']);
	if (!Array.isArray(row.items) || row.items.length > AGENT_RUN_EVENT_MAX_LIMIT) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readAgentRunEvent);
	const nextCursor = agentInteger(row.nextCursor);
	for (let index = 0; index < items.length; index++) {
		if (
			index > 0 &&
			(items[index].runId !== items[0].runId || items[index].sequence <= items[index - 1].sequence)
		) {
			throw new InvalidAgentPayload();
		}
	}
	if (items.length > 0 && nextCursor !== items[items.length - 1].sequence) {
		throw new InvalidAgentPayload();
	}
	return { items, nextCursor };
}

export function readAgentRunUsageResponse(input: unknown): AgentRunUsageView {
	const row = agentRecord(input, [
		'runId',
		'runVersion',
		'inputTokens',
		'outputTokens',
		'reportedModelRequests',
		'modelRequests',
		'toolExecutions',
	]);
	const modelRequests = agentInteger(row.modelRequests, 0);
	const reportedModelRequests = agentInteger(row.reportedModelRequests, 0, modelRequests);
	const inputTokens = row.inputTokens === null ? null : agentInteger(row.inputTokens, 0);
	const outputTokens = row.outputTokens === null ? null : agentInteger(row.outputTokens, 0);
	if (
		(inputTokens === null) !== (outputTokens === null) ||
		(reportedModelRequests === 0) !== (inputTokens === null) ||
		(inputTokens !== null && outputTokens !== null && !Number.isSafeInteger(inputTokens + outputTokens))
	) {
		throw new InvalidAgentPayload();
	}
	return {
		runId: readAgentId(row.runId),
		runVersion: agentInteger(row.runVersion, 1),
		inputTokens,
		outputTokens,
		reportedModelRequests,
		modelRequests,
		toolExecutions: agentInteger(row.toolExecutions, 0),
	};
}

export function readAgentResourceSession(input: unknown): import('./model.js').AgentResourceSessionView {
	const row = agentRecord(input, [
		'id',
		'runId',
		'state',
		'openedAt',
		'sshConnections',
		'sftpChannels',
		'protocolSessions',
		'browserSessions',
		'activeOperations',
		'backgroundJobs',
		'waitingOutputJobs',
		'targetIds',
		'expiresAt',
	]);
	const state = AGENT_RESOURCE_SESSION_STATES.find((state) => state === row.state);
	if (!state || !Array.isArray(row.targetIds)) {
		throw new InvalidAgentPayload();
	}
	const targetIds = row.targetIds.map((id: unknown) => agentInteger(id, 1));
	if (new Set(targetIds).size !== targetIds.length) {
		throw new InvalidAgentPayload();
	}
	const openedAt = agentInteger(row.openedAt);
	return {
		id: readAgentId(row.id),
		runId: readAgentId(row.runId),
		state,
		openedAt,
		sshConnections: agentInteger(row.sshConnections),
		sftpChannels: agentInteger(row.sftpChannels),
		protocolSessions: agentInteger(row.protocolSessions),
		browserSessions: agentInteger(row.browserSessions),
		activeOperations: agentInteger(row.activeOperations),
		backgroundJobs: agentInteger(row.backgroundJobs),
		waitingOutputJobs: agentInteger(row.waitingOutputJobs),
		targetIds,
		expiresAt: row.expiresAt === null ? null : agentInteger(row.expiresAt, openedAt),
	};
}

export function readAgentCloseResourcesRequest(input: unknown): import('./http.js').AgentCloseResourcesRequest {
	const row = agentRecord(input, ['appVersion', 'target', 'confirmed']);
	if (typeof row.confirmed !== 'boolean' || !isAgentRecord(row.target)) {
		throw new InvalidAgentPayload();
	}
	let target: import('./http.js').AgentCloseResourcesRequest['target'];
	if (row.target.kind === 'app') {
		agentRecord(row.target, ['kind']);
		target = { kind: 'app' };
	} else {
		const value = agentRecord(row.target, ['kind', 'runId', 'sessionId']);
		if (value.kind !== 'session') {
			throw new InvalidAgentPayload();
		}
		target = { kind: 'session', runId: readAgentId(value.runId), sessionId: readAgentId(value.sessionId) };
	}
	return { appVersion: agentInteger(row.appVersion, 1), target, confirmed: row.confirmed };
}

export function readAgentCloseResourcesResponse(input: unknown): import('./http.js').AgentCloseResourcesResponse {
	const row = agentRecord(input, ['status', 'activeRuns', 'activeOperations', 'backgroundJobs']);
	if (row.status !== 'closed' && row.status !== 'confirmation_required') {
		throw new InvalidAgentPayload();
	}
	return {
		status: row.status,
		activeRuns: agentInteger(row.activeRuns),
		activeOperations: agentInteger(row.activeOperations),
		backgroundJobs: agentInteger(row.backgroundJobs),
	};
}
