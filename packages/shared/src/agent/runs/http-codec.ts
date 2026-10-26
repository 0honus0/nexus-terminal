import { readAgentOptionalReasoningEffort } from '../providers/http-codec.js';
import {
	agentRecord,
	agentInteger,
	agentText,
	readAgentId,
	isAgentRecord,
	InvalidAgentPayload,
} from '../http-codec.js';
import {
	AGENT_APPROVAL_MODES,
	AGENT_RUN_FAILURE_CODES,
	AGENT_RUN_EVENT_DEFAULT_AFTER,
	AGENT_RUN_EVENT_DEFAULT_LIMIT,
	AGENT_RUN_EVENT_MAX_LIMIT,
	AGENT_RUN_MAX_PROMPT_BYTES,
	AGENT_RUN_MAX_SELECTED_CONNECTIONS,
	AGENT_RUN_MAX_JSON_BODY_BYTES,
	AGENT_RUN_STEP_MAX_TEXT_BYTES,
	AGENT_RUN_STEP_MAX_COUNT,
	AGENT_RUN_STEP_FINISH_REASONS,
} from './values.js';
import { AGENT_MAX_JSON_BODY_BYTES } from '../values.js';
import { AGENT_PROVIDER_MAX_MODEL_ID_BYTES } from '../providers/values.js';
import type {
	AgentRunFailureView,
	AgentRunUsageView,
	AgentRunView,
	AgentRunEventView,
	AgentRunStepView,
	AgentRunStepEventView,
} from './model.js';
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
	AgentRunStepPath,
	AgentRunStepEventsResponse,
} from './http.js';

export function readAgentCreateRunRequest(input: unknown): AgentCreateRunRequest {
	const fields = agentRecord(
		input,
		['prompt', 'model', 'connectionIds', 'approvalMode'],
		AGENT_RUN_MAX_JSON_BODY_BYTES,
	);
	if (!Array.isArray(fields.connectionIds) || fields.connectionIds.length > AGENT_RUN_MAX_SELECTED_CONNECTIONS) {
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
	if (!isAgentRecord(fields.model)) {
		throw new InvalidAgentPayload();
	}
	const optional = Object.hasOwn(fields.model, 'reasoningEffort') ? ['reasoningEffort'] : [];
	const model = agentRecord(fields.model, ['providerId', 'modelId', 'configurationVersion', ...optional]);
	const reasoningEffort = readAgentOptionalReasoningEffort(model.reasoningEffort);
	return {
		approvalMode,
		prompt: agentText(fields.prompt, AGENT_RUN_MAX_PROMPT_BYTES),
		connectionIds,
		model: {
			providerId: readAgentId(model.providerId),
			modelId: agentText(model.modelId, AGENT_PROVIDER_MAX_MODEL_ID_BYTES),
			configurationVersion: agentInteger(model.configurationVersion, 1),
			...(reasoningEffort === undefined ? {} : { reasoningEffort }),
		},
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

export function readAgentRunStepPath(input: unknown): AgentRunStepPath {
	const row = agentRecord(input, ['appId', 'runId', 'stepIndex']);
	if (typeof row.stepIndex !== 'string' || !/^[1-9][0-9]*$/u.test(row.stepIndex)) {
		throw new InvalidAgentPayload();
	}
	return {
		appId: readAgentId(row.appId),
		runId: readAgentId(row.runId),
		stepIndex: agentInteger(Number(row.stepIndex), 1, AGENT_RUN_STEP_MAX_COUNT),
	};
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

export function readAgentRunStepResponse(input: unknown): AgentRunStepView {
	if (!isAgentRecord(input)) {
		throw new InvalidAgentPayload();
	}
	const candidate = input;
	const optional = ['finishReason', 'inputTokens', 'outputTokens', 'failureCode'].filter((key) =>
		Object.hasOwn(candidate, key),
	);
	const row = agentRecord(input, [
		'runId',
		'stepIndex',
		'state',
		'revision',
		'runVersion',
		'textBytes',
		'createdAt',
		'updatedAt',
		...optional,
	]);
	const state = row.state;
	if (
		state !== 'reserved' &&
		state !== 'dispatched' &&
		state !== 'completed' &&
		state !== 'failed' &&
		state !== 'unknown'
	) {
		throw new InvalidAgentPayload();
	}
	if (
		(state === 'reserved' && (row.textBytes !== 0 || row.inputTokens !== undefined)) ||
		(state === 'completed' && row.finishReason === 'stop' && row.textBytes === 0) ||
		(state === 'completed' && !AGENT_RUN_STEP_FINISH_REASONS.some((reason) => reason === row.finishReason)) ||
		(state !== 'completed' && row.finishReason !== undefined) ||
		(state === 'failed' && row.failureCode !== 'DISPATCH_NOT_STARTED') ||
		(state !== 'failed' && row.failureCode !== undefined) ||
		(row.inputTokens === undefined) !== (row.outputTokens === undefined)
	) {
		throw new InvalidAgentPayload();
	}
	return {
		runId: readAgentId(row.runId),
		stepIndex: agentInteger(row.stepIndex, 1, AGENT_RUN_STEP_MAX_COUNT),
		state,
		revision: agentInteger(row.revision, 1),
		runVersion: agentInteger(row.runVersion, 1),
		textBytes: agentInteger(row.textBytes, 0, AGENT_RUN_STEP_MAX_TEXT_BYTES),
		...(row.finishReason === 'stop' || row.finishReason === 'tool_calls' ? { finishReason: row.finishReason } : {}),
		...(row.inputTokens === undefined
			? {}
			: {
					inputTokens: agentInteger(row.inputTokens),
					outputTokens: agentInteger(row.outputTokens),
				}),
		...(row.failureCode === 'DISPATCH_NOT_STARTED' ? { failureCode: row.failureCode } : {}),
		createdAt: agentInteger(row.createdAt),
		updatedAt: agentInteger(row.updatedAt),
	};
}

export function readAgentRunStepEvent(input: unknown): AgentRunStepEventView {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		throw new InvalidAgentPayload();
	}
	const kind = (input as Record<string, unknown>).kind;
	const base = ['runId', 'stepIndex', 'sequence', 'kind', 'createdAt'];
	const row = agentRecord(
		input,
		kind === 'text.delta'
			? [...base, 'textBytes']
			: kind === 'usage'
				? [...base, 'inputTokens', 'outputTokens']
				: base,
	);
	const identity = {
		runId: readAgentId(row.runId),
		stepIndex: agentInteger(row.stepIndex, 1, AGENT_RUN_STEP_MAX_COUNT),
		sequence: agentInteger(row.sequence, 1),
		createdAt: agentInteger(row.createdAt),
	};
	if (kind === 'text.delta') {
		return { ...identity, kind, textBytes: agentInteger(row.textBytes, 1, AGENT_RUN_STEP_MAX_TEXT_BYTES) };
	}
	if (kind === 'usage') {
		return {
			...identity,
			kind,
			inputTokens: agentInteger(row.inputTokens),
			outputTokens: agentInteger(row.outputTokens),
		};
	}
	if (kind === 'step.completed' || kind === 'step.failed' || kind === 'step.unknown') {
		return { ...identity, kind };
	}
	throw new InvalidAgentPayload();
}

export function readAgentRunStepEventsResponse(input: unknown): AgentRunStepEventsResponse {
	const row = agentRecord(input, ['items', 'nextCursor']);
	if (!Array.isArray(row.items) || row.items.length > AGENT_RUN_EVENT_MAX_LIMIT) {
		throw new InvalidAgentPayload();
	}
	const items = row.items.map(readAgentRunStepEvent);
	const nextCursor = agentInteger(row.nextCursor);
	for (let index = 0; index < items.length; index++) {
		if (
			index > 0 &&
			(items[index].runId !== items[0].runId ||
				items[index].stepIndex !== items[0].stepIndex ||
				items[index].sequence <= items[index - 1].sequence)
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
