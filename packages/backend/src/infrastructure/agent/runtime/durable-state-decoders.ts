import type { JsonValue } from '../../../modules/agent/agent.types';
import type {
	AgentModelCapability,
	ModelCapabilitySnapshot,
	ModelRef,
	ReasoningEffort,
} from '../../../modules/agent/ai/model.types';
import { normalizeRequiredModelCapabilities } from '../../../modules/agent/ai/model-capability-requirements';
import type { ToolInspection, ToolResult } from '../../../modules/agent/capabilities/tool.types';
import { normalizePlanItems, type RunPlan } from '../../../modules/agent/runtime/planning/plan.types';
import type { RunBudget, RunDefinitionSnapshot, RunUsage } from '../../../modules/agent/runtime/runs/run.types';

const MAX_COLLECTION_ITEMS = 16_384;
const MAX_STRING_BYTES = 2 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;

type UnknownRecord = Record<string, unknown>;

const invalid = (): never => {
	throw new Error('AGENT_DURABLE_STATE_INVALID');
};

export const parseDurableJson = (raw: string): unknown => {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return invalid();
	}
};

export const durableRecord = (value: unknown): UnknownRecord => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
	return value as UnknownRecord;
};

const assertDurableKeys = (record: UnknownRecord, allowed: readonly string[]): void => {
	const keys = new Set(allowed);
	if (Object.keys(record).some((key) => !keys.has(key))) return invalid();
};

export const durableString = (value: unknown, nullable = false): string | null => {
	if (nullable && value === null) return null;
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) return invalid();
	return value;
};

export const durableInteger = (value: unknown, minimum = 0): number => {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) return invalid();
	return Number(value);
};

export const durableBoolean = (value: unknown): boolean => {
	if (typeof value !== 'boolean') return invalid();
	return value;
};

export const decodeDurableJsonValue = (value: unknown, depth = 0): JsonValue => {
	if (depth > MAX_JSON_DEPTH) return invalid();
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') return durableString(value) as string;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return invalid();
		return value;
	}
	if (Array.isArray(value)) {
		if (value.length > MAX_COLLECTION_ITEMS) return invalid();
		return value.map((item) => decodeDurableJsonValue(item, depth + 1));
	}
	const record = durableRecord(value);
	const entries = Object.entries(record);
	if (entries.length > MAX_COLLECTION_ITEMS) return invalid();
	return Object.fromEntries(entries.map(([key, item]) => [key, decodeDurableJsonValue(item, depth + 1)]));
};

export const parseDurableJsonValue = (raw: string): JsonValue => decodeDurableJsonValue(parseDurableJson(raw));

export const decodeDurableStringArray = (value: unknown, maxItems = 4096): string[] => {
	if (!Array.isArray(value) || value.length > maxItems) return invalid();
	return value.map((item) => durableString(item) as string);
};

export const decodeDurableIntegerArray = (value: unknown, maxItems = 4096, minimum = 0): number[] => {
	if (!Array.isArray(value) || value.length > maxItems) return invalid();
	return value.map((item) => durableInteger(item, minimum));
};

export const decodeRunPlan = (value: unknown): RunPlan => {
	const record = durableRecord(value);
	if (record.schemaVersion !== 1) return invalid();
	return {
		schemaVersion: 1,
		revision: durableInteger(record.revision),
		items: normalizePlanItems(record.items),
	};
};

export const parseRunPlan = (raw: string): RunPlan => decodeRunPlan(parseDurableJson(raw));

export const parseRunBudget = (raw: string): RunBudget => {
	const record = durableRecord(parseDurableJson(raw));
	assertDurableKeys(record, [
		'contextPolicy',
		'maxModelRequests',
		'modelRequestCeiling',
		'activeExecutionCeilingSeconds',
		'maxToolExecutions',
		'phase',
		'stopReason',
		'extensionCount',
		'progressSequence',
		'maxActiveExecutionSeconds',
		'toolTimeoutSeconds',
		'maxToolOutputBytes',
		'maxRecallItems',
		'maxRecallBytes',
		'maxSubagentMessages',
		'maxSubagentMessageBytes',
		'contextCompactionMode',
		'revision',
	]);
	if (
		!['executing', 'finishing'].includes(String(record.phase)) ||
		![null, 'model_request_limit', 'active_time_limit', 'tool_execution_limit', 'no_progress'].some(
			(value) => value === record.stopReason,
		)
	)
		throw new Error('AGENT_DURABLE_STATE_INVALID');
	const compactionMode = record.contextCompactionMode;
	if (!['aggressive', 'balanced', 'conservative'].includes(String(compactionMode))) return invalid();
	const contextPolicy = durableRecord(record.contextPolicy);
	assertDurableKeys(contextPolicy, [
		'profile',
		'effectiveWindowPercent',
		'softPressurePercent',
		'toolOutputFloorPercent',
	]);
	if (!['normal', 'extended'].includes(String(contextPolicy.profile))) return invalid();
	const effectiveWindowPercent = durableInteger(contextPolicy.effectiveWindowPercent, 1);
	const softPressurePercent = durableInteger(contextPolicy.softPressurePercent, 1);
	const toolOutputFloorPercent = durableInteger(contextPolicy.toolOutputFloorPercent, 1);
	if (effectiveWindowPercent > 100 || softPressurePercent > 100 || toolOutputFloorPercent > 100) return invalid();
	return {
		contextPolicy: {
			profile: contextPolicy.profile as RunBudget['contextPolicy']['profile'],
			effectiveWindowPercent,
			softPressurePercent,
			toolOutputFloorPercent,
		},
		maxModelRequests: durableInteger(record.maxModelRequests, 1),
		modelRequestCeiling: durableInteger(record.modelRequestCeiling, 1),
		activeExecutionCeilingSeconds: durableInteger(record.activeExecutionCeilingSeconds, 1),
		maxToolExecutions: durableInteger(record.maxToolExecutions, 1),
		phase: record.phase as RunBudget['phase'],
		stopReason: record.stopReason as RunBudget['stopReason'],
		extensionCount: durableInteger(record.extensionCount),
		progressSequence: durableInteger(record.progressSequence),
		maxActiveExecutionSeconds: durableInteger(record.maxActiveExecutionSeconds, 1),
		toolTimeoutSeconds: durableInteger(record.toolTimeoutSeconds, 1),
		maxToolOutputBytes: durableInteger(record.maxToolOutputBytes, 1),
		maxRecallItems: durableInteger(record.maxRecallItems, 1),
		maxRecallBytes: durableInteger(record.maxRecallBytes, 1),
		maxSubagentMessages: durableInteger(record.maxSubagentMessages, 1),
		maxSubagentMessageBytes: durableInteger(record.maxSubagentMessageBytes, 1),
		contextCompactionMode: compactionMode as RunBudget['contextCompactionMode'],
		revision: durableInteger(record.revision, 1),
	};
};

const decodeRunContextModel = (value: unknown): ModelRef => {
	const record = durableRecord(value);
	return {
		providerId: durableString(record.providerId) as string,
		modelId: durableString(record.modelId) as string,
		configurationVersion: durableInteger(record.configurationVersion, 1),
	};
};

export const parseRunUsage = (raw: string): RunUsage => {
	const record = durableRecord(parseDurableJson(raw));
	assertDurableKeys(record, [
		'inputTokens',
		'outputTokens',
		'cachedInputTokens',
		'modelRequests',
		'toolExecutions',
		'subagentMessages',
		'subagentMessageBytes',
		'context',
	]);
	const context = record.context === undefined ? null : durableRecord(record.context);
	if (context && !['estimated', 'anchored_estimate', 'provider'].includes(String(context.source))) return invalid();
	return {
		inputTokens: durableInteger(record.inputTokens),
		outputTokens: durableInteger(record.outputTokens),
		cachedInputTokens: durableInteger(record.cachedInputTokens),
		modelRequests: durableInteger(record.modelRequests),
		toolExecutions: durableInteger(record.toolExecutions),
		subagentMessages: durableInteger(record.subagentMessages),
		subagentMessageBytes: durableInteger(record.subagentMessageBytes),
		...(context === null
			? {}
			: {
					context: {
						inputTokens: durableInteger(context.inputTokens),
						...(context.heuristicInputTokens === undefined
							? {}
							: { heuristicInputTokens: durableInteger(context.heuristicInputTokens, 1) }),
						reservedOutputTokens: durableInteger(context.reservedOutputTokens),
						contextWindowTokens: durableInteger(context.contextWindowTokens, 1),
						source: context.source as NonNullable<RunUsage['context']>['source'],
						...(context.model === undefined ? {} : { model: decodeRunContextModel(context.model) }),
						...(context.contextEpoch === undefined
							? {}
							: { contextEpoch: durableString(context.contextEpoch) as string }),
						updatedAt: durableInteger(context.updatedAt),
					},
				}),
	};
};

const reasoningEfforts = new Set<ReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export const decodeModelCapabilitySnapshot = (value: unknown): ModelCapabilitySnapshot => {
	const record = durableRecord(value);
	assertDurableKeys(record, [
		'contextWindow',
		'maxOutputTokens',
		'supportsTools',
		'supportsImageInput',
		'supportsFileInput',
		'supportsPromptCacheKey',
		'reasoningEfforts',
		'defaultReasoningEffort',
		'reasoningMandatory',
	]);
	const contextWindow = durableInteger(record.contextWindow, 1);
	const maxOutputTokens = durableInteger(record.maxOutputTokens, 1);
	if (maxOutputTokens > contextWindow) return invalid();
	if (
		typeof record.supportsTools !== 'boolean' ||
		typeof record.supportsImageInput !== 'boolean' ||
		typeof record.supportsFileInput !== 'boolean'
	) {
		return invalid();
	}
	let supportedEfforts: ReasoningEffort[] | undefined;
	if (record.reasoningEfforts !== undefined) {
		if (!Array.isArray(record.reasoningEfforts) || record.reasoningEfforts.length > reasoningEfforts.size)
			return invalid();
		supportedEfforts = record.reasoningEfforts.map((effort) => {
			if (!reasoningEfforts.has(effort as ReasoningEffort)) return invalid();
			return effort as ReasoningEffort;
		});
		if (new Set(supportedEfforts).size !== supportedEfforts.length) return invalid();
	}
	const defaultEffort = record.defaultReasoningEffort;
	if (
		defaultEffort !== undefined &&
		(!reasoningEfforts.has(defaultEffort as ReasoningEffort) ||
			!supportedEfforts?.includes(defaultEffort as ReasoningEffort))
	) {
		return invalid();
	}
	if (record.reasoningMandatory !== undefined && typeof record.reasoningMandatory !== 'boolean') return invalid();
	if (record.supportsPromptCacheKey !== undefined && typeof record.supportsPromptCacheKey !== 'boolean')
		return invalid();
	return {
		contextWindow,
		maxOutputTokens,
		supportsTools: record.supportsTools,
		supportsImageInput: record.supportsImageInput,
		supportsFileInput: record.supportsFileInput,
		...(record.supportsPromptCacheKey === undefined
			? {}
			: { supportsPromptCacheKey: record.supportsPromptCacheKey }),
		...(supportedEfforts === undefined ? {} : { reasoningEfforts: supportedEfforts }),
		...(defaultEffort === undefined ? {} : { defaultReasoningEffort: defaultEffort as ReasoningEffort }),
		...(record.reasoningMandatory === undefined ? {} : { reasoningMandatory: record.reasoningMandatory }),
	};
};

export const parseRunDefinition = (raw: string): RunDefinitionSnapshot => {
	const record = durableRecord(parseDurableJson(raw));
	assertDurableKeys(record, [
		'schemaVersion',
		'agentDefinitionId',
		'requiredModelCapabilities',
		'model',
		'modelCapabilities',
		'rootModelRoutes',
		'reasoningEffort',
		'approvalMode',
		'executionMode',
		'connectionIds',
		'policyRevision',
		'settingsRevision',
		'contextBoundary',
	]);
	if (record.schemaVersion !== 1) return invalid();
	const model = durableRecord(record.model);
	assertDurableKeys(model, ['providerId', 'modelId', 'configurationVersion']);
	const reasoningEffort = record.reasoningEffort;
	if (reasoningEffort !== undefined && !reasoningEfforts.has(reasoningEffort as ReasoningEffort)) return invalid();
	if (!['ask', 'full_access'].includes(String(record.approvalMode))) return invalid();
	if (!['execute', 'plan'].includes(String(record.executionMode))) return invalid();
	let contextBoundary: RunDefinitionSnapshot['contextBoundary'];
	if (record.contextBoundary !== undefined) {
		const boundary = durableRecord(record.contextBoundary);
		assertDurableKeys(boundary, ['baseThrough', 'runThrough']);
		const runThrough = durableRecord(boundary.runThrough);
		if (Object.keys(runThrough).length > 4096) return invalid();
		contextBoundary = {
			baseThrough: durableInteger(boundary.baseThrough),
			runThrough: Object.fromEntries(
				Object.entries(runThrough).map(([runId, sequence]) => [runId, durableInteger(sequence)]),
			),
		};
	}
	if (!Array.isArray(record.rootModelRoutes) || record.rootModelRoutes.length > 8) return invalid();
	const rootModelRoutes: RunDefinitionSnapshot['rootModelRoutes'] = record.rootModelRoutes.map((rawRoute) => {
		const route = durableRecord(rawRoute);
		assertDurableKeys(route, ['model', 'modelCapabilities']);
		const routeModel = durableRecord(route.model);
		assertDurableKeys(routeModel, ['providerId', 'modelId', 'configurationVersion']);
		return {
			model: {
				providerId: durableString(routeModel.providerId) as string,
				modelId: durableString(routeModel.modelId) as string,
				configurationVersion: durableInteger(routeModel.configurationVersion, 1),
			},
			modelCapabilities: decodeModelCapabilitySnapshot(route.modelCapabilities),
		};
	});
	const rawRequirements = decodeDurableStringArray(record.requiredModelCapabilities, 32);
	if (new Set(rawRequirements).size !== rawRequirements.length) return invalid();
	const requiredModelCapabilities: AgentModelCapability[] =
		normalizeRequiredModelCapabilities(rawRequirements) ?? invalid();
	return {
		schemaVersion: 1,
		agentDefinitionId: durableString(record.agentDefinitionId) as string,
		requiredModelCapabilities,
		model: {
			providerId: durableString(model.providerId) as string,
			modelId: durableString(model.modelId) as string,
			configurationVersion: durableInteger(model.configurationVersion, 1),
		},
		modelCapabilities: decodeModelCapabilitySnapshot(record.modelCapabilities),
		rootModelRoutes,
		...(reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort as ReasoningEffort }),
		approvalMode: record.approvalMode as 'ask' | 'full_access',
		executionMode: record.executionMode as 'execute' | 'plan',
		connectionIds: decodeDurableIntegerArray(record.connectionIds, 1024, 1),
		policyRevision: durableInteger(record.policyRevision, 1),
		settingsRevision: durableInteger(record.settingsRevision, 1),
		...(contextBoundary === undefined ? {} : { contextBoundary }),
	};
};

export const parseToolInspection = (raw: string): ToolInspection => {
	const record = durableRecord(parseDurableJson(raw));
	assertDurableKeys(record, [
		'toolName',
		'toolVersion',
		'normalizedArguments',
		'target',
		'resourceKeys',
		'risk',
		'rejectionCode',
		'mutation',
		'operationHash',
		'operationHashVersion',
		'preconditions',
		'policyRevision',
		'inputRevision',
	]);
	if (!['read', 'control', 'mutate', 'destructive', 'forbidden'].includes(String(record.risk))) return invalid();
	if (record.operationHashVersion !== 1) return invalid();
	if (
		record.rejectionCode !== undefined &&
		(record.risk !== 'forbidden' ||
			record.mutation !== false ||
			typeof record.rejectionCode !== 'string' ||
			!/^[A-Z][A-Z0-9_]+$/.test(record.rejectionCode))
	)
		return invalid();
	const target = durableRecord(record.target);
	assertDurableKeys(target, [
		'kind',
		'target',
		'id',
		'targetIdentity',
		'endpoint',
		'loginUser',
		'configurationHash',
		'connectionId',
		'integrationId',
		'schemaHash',
		'browserSessionId',
		'snapshotId',
		'hostKeyTrust',
	]);
	const targetKind = String(target.kind);
	if (!['ssh', 'integration', 'browser', 'run'].includes(targetKind)) return invalid();
	const canonicalTarget = targetKind === 'ssh';
	if (canonicalTarget) {
		if (target.target !== targetKind || typeof target.id !== 'string' || target.id.length < 1) return invalid();
	} else if (target.target !== undefined || target.id !== undefined) {
		return invalid();
	}
	if (!Array.isArray(record.preconditions) || record.preconditions.length > 256) return invalid();
	return {
		toolName: durableString(record.toolName) as string,
		toolVersion: durableString(record.toolVersion) as string,
		normalizedArguments: decodeDurableJsonValue(record.normalizedArguments),
		target: {
			kind: targetKind as ToolInspection['target']['kind'],
			...(canonicalTarget ? { target: targetKind as 'ssh', id: durableString(target.id) as string } : {}),
			targetIdentity: durableString(target.targetIdentity) as string,
			endpoint: durableString(target.endpoint) as string,
			loginUser: durableString(target.loginUser) as string,
			configurationHash: durableString(target.configurationHash) as string,
			...(target.connectionId === undefined ? {} : { connectionId: durableInteger(target.connectionId, 1) }),
			...(target.integrationId === undefined
				? {}
				: { integrationId: durableString(target.integrationId) as string }),
			...(target.schemaHash === undefined ? {} : { schemaHash: durableString(target.schemaHash) as string }),
			...(target.browserSessionId === undefined
				? {}
				: { browserSessionId: durableString(target.browserSessionId) as string }),
			...(target.snapshotId === undefined ? {} : { snapshotId: durableString(target.snapshotId) as string }),
			...(target.hostKeyTrust === undefined
				? {}
				: target.hostKeyTrust === 'unavailable'
					? { hostKeyTrust: 'unavailable' as const }
					: invalid()),
		} as ToolInspection['target'],
		resourceKeys: decodeDurableStringArray(record.resourceKeys, 256),
		risk: record.risk as ToolInspection['risk'],
		...(record.rejectionCode === undefined ? {} : { rejectionCode: durableString(record.rejectionCode) as string }),
		mutation: durableBoolean(record.mutation),
		operationHash: durableString(record.operationHash) as string,
		operationHashVersion: 1,
		preconditions: record.preconditions.map((item) => {
			const precondition = durableRecord(item);
			assertDurableKeys(precondition, ['kind', 'key', 'observedValue']);
			if (!['fileHash', 'metadata', 'serviceState'].includes(String(precondition.kind))) return invalid();
			return {
				kind: precondition.kind as ToolInspection['preconditions'][number]['kind'],
				key: durableString(precondition.key) as string,
				observedValue: decodeDurableJsonValue(precondition.observedValue),
			};
		}),
		policyRevision: durableInteger(record.policyRevision, 1),
		inputRevision: durableInteger(record.inputRevision),
	};
};

export const parseToolResult = (raw: string): ToolResult => {
	const record = durableRecord(parseDurableJson(raw));
	if (!['confirmed', 'unknown'].includes(String(record.outcome))) return invalid();
	const verification = durableRecord(record.verification);
	if (!['verified', 'unverified', 'failed'].includes(String(verification.status))) return invalid();
	let semantic: ToolResult['semantic'];
	if (record.semantic !== undefined) {
		const rawSemantic = durableRecord(record.semantic);
		assertDurableKeys(rawSemantic, ['kind', 'target', 'status']);
		if (rawSemantic.kind !== 'execution') return invalid();
		const target = durableRecord(rawSemantic.target);
		assertDurableKeys(target, ['target', 'id']);
		if (target.target !== 'ssh' || typeof target.id !== 'string' || !target.id) {
			return invalid();
		}
		if (
			!['pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'].includes(String(rawSemantic.status))
		) {
			return invalid();
		}
		semantic = {
			kind: 'execution',
			target: { target: target.target, id: target.id } as NonNullable<ToolResult['semantic']>['target'],
			status: rawSemantic.status as NonNullable<ToolResult['semantic']>['status'],
		};
	}
	return {
		ok: durableBoolean(record.ok),
		summary: durableString(record.summary) as string,
		...(record.data === undefined ? {} : { data: decodeDurableJsonValue(record.data) }),
		artifactRefs: decodeDurableStringArray(record.artifactRefs, 4096),
		truncated: durableBoolean(record.truncated),
		outcome: record.outcome as ToolResult['outcome'],
		...(record.errorCode === undefined ? {} : { errorCode: durableString(record.errorCode) as string }),
		...(semantic === undefined ? {} : { semantic }),
		verification: {
			status: verification.status as ToolResult['verification']['status'],
			summary: durableString(verification.summary) as string,
			evidenceRefs: decodeDurableStringArray(verification.evidenceRefs, 4096),
		},
	};
};
