import type { AgentProviderFailureCode, AgentProviderProtocol, AgentModelCapabilityField } from './values.js';
import { agentInteger, agentText, readAgentId, InvalidAgentPayload, encodeAgentJson } from '../http-codec.js';
import {
	AGENT_PROVIDER_MAX_BODY_BYTES,
	AGENT_PROVIDER_MAX_RESPONSE_BYTES,
	AGENT_PROVIDER_MAX_MODEL_ID_BYTES,
	AGENT_PROVIDER_MAX_NAME_BYTES,
	AGENT_PROVIDER_MAX_SECRET_BYTES,
	AGENT_PROVIDER_MAX_URL_BYTES,
	AGENT_PROVIDER_MODEL_LIMIT,
	AGENT_PROVIDER_DISCOVERY_LIMIT,
	AGENT_REASONING_EFFORTS,
	AGENT_PROVIDER_FAILURE_CODES,
	AGENT_REGISTRY_MAX_MODEL_ID_BYTES,
	AGENT_MODEL_CAPABILITY_FIELDS,
} from './values.js';
import type {
	AgentProviderInput,
	AgentProviderModelInput,
	AgentProviderModelView,
	AgentProviderView,
	AgentDiscoveredModel,
} from './model.js';
import type {
	AgentProviderUpdateRequest,
	AgentProviderDiscoverEndpointRequest,
	AgentProviderTestRequest,
	AgentProviderTestResponse,
	AgentProviderDeleteQuery,
	AgentProviderDeleteResponse,
	AgentRegistryResolveQuery,
} from './http.js';
import type { AgentRegistryDefaults, AgentRegistryResolveResponse, AgentRegistryStatus } from './registry.js';
import { AGENT_REGISTRY_ERROR_CODES } from './values.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readCapabilityField(value: unknown): AgentModelCapabilityField {
	for (const field of AGENT_MODEL_CAPABILITY_FIELDS) {
		if (value === field) {
			return field;
		}
	}
	throw new InvalidAgentPayload();
}

function agentRecord(
	value: unknown,
	keys: readonly string[],
	maxBytes = AGENT_PROVIDER_MAX_RESPONSE_BYTES,
): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new InvalidAgentPayload();
	}
	encodeAgentJson(value, maxBytes);
	const row = value;
	if (Object.keys(row).some((k) => !keys.includes(k))) {
		throw new InvalidAgentPayload();
	}
	return row;
}

function protocol(value: unknown): AgentProviderProtocol {
	if (value !== 'responses' && value !== 'chat-completions') {
		throw new InvalidAgentPayload();
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return value === undefined ? undefined : boolean(value);
}

function optionalEffort(value: unknown): (typeof AGENT_REASONING_EFFORTS)[number] | undefined {
	if (value === undefined) {
		return undefined;
	}
	for (const effort of AGENT_REASONING_EFFORTS) {
		if (value === effort) {
			return effort;
		}
	}
	throw new InvalidAgentPayload();
}

function model(value: unknown): AgentProviderModelInput {
	const r = agentRecord(
		value,
		[
			'id',
			'protocol',
			'contextWindow',
			'maxOutputTokens',
			'supportsTools',
			'supportsImageInput',
			'supportsFileInput',
			'supportsPromptCacheKey',
			'reasoningEfforts',
			'defaultReasoningEffort',
			'reasoningMandatory',
		],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	const contextWindow = agentInteger(r.contextWindow, 1);
	const maxOutputTokens = agentInteger(r.maxOutputTokens, 1, contextWindow);
	const efforts =
		r.reasoningEfforts === undefined
			? undefined
			: (() => {
					if (
						!Array.isArray(r.reasoningEfforts) ||
						r.reasoningEfforts.length === 0 ||
						r.reasoningEfforts.length > AGENT_REASONING_EFFORTS.length
					) {
						throw new InvalidAgentPayload();
					}
					const a = r.reasoningEfforts.map((value) => {
						const effort = optionalEffort(value);
						if (effort === undefined) {
							throw new InvalidAgentPayload();
						}
						return effort;
					});
					if (new Set(a).size !== a.length) {
						throw new InvalidAgentPayload();
					}
					return a;
				})();
	const defaultReasoningEffort = optionalEffort(r.defaultReasoningEffort);
	if (defaultReasoningEffort && !efforts?.includes(defaultReasoningEffort)) {
		throw new InvalidAgentPayload();
	}
	if (r.reasoningMandatory === true && !efforts?.length) {
		throw new InvalidAgentPayload();
	}
	return {
		id: agentText(r.id, AGENT_PROVIDER_MAX_MODEL_ID_BYTES).trim(),
		...(r.protocol === undefined ? {} : { protocol: protocol(r.protocol) }),
		contextWindow,
		maxOutputTokens,
		supportsTools: boolean(r.supportsTools),
		...(r.supportsImageInput === undefined ? {} : { supportsImageInput: boolean(r.supportsImageInput) }),
		...(r.supportsFileInput === undefined ? {} : { supportsFileInput: boolean(r.supportsFileInput) }),
		...(r.supportsPromptCacheKey === undefined
			? {}
			: { supportsPromptCacheKey: boolean(r.supportsPromptCacheKey) }),
		...(efforts === undefined ? {} : { reasoningEfforts: efforts }),
		...(defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort }),
		...(r.reasoningMandatory === undefined ? {} : { reasoningMandatory: boolean(r.reasoningMandatory) }),
	};
}

function input(value: unknown, isUpdate: boolean): AgentProviderInput {
	const r = agentRecord(
		value,
		[
			'kind',
			'displayName',
			'baseUrl',
			'protocol',
			'models',
			'enabled',
			'credential',
			'clearCredential',
			...(isUpdate ? ['expectedVersion'] : []),
		],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	if (
		r.kind !== 'openai-compatible' ||
		!Array.isArray(r.models) ||
		r.models.length < 1 ||
		r.models.length > AGENT_PROVIDER_MODEL_LIMIT
	) {
		throw new InvalidAgentPayload();
	}
	const models = r.models.map(model);
	if (new Set(models.map((m) => m.id)).size !== models.length) {
		throw new InvalidAgentPayload();
	}
	const credential =
		r.credential === undefined ? undefined : agentText(r.credential, AGENT_PROVIDER_MAX_SECRET_BYTES);
	const clearCredential = optionalBoolean(r.clearCredential);
	if (credential !== undefined && clearCredential) {
		throw new InvalidAgentPayload();
	}
	return {
		kind: 'openai-compatible',
		displayName: agentText(r.displayName, AGENT_PROVIDER_MAX_NAME_BYTES).trim(),
		baseUrl: agentText(r.baseUrl, AGENT_PROVIDER_MAX_URL_BYTES).trim(),
		protocol: protocol(r.protocol),
		models,
		enabled: boolean(r.enabled),
		...(credential === undefined ? {} : { credential }),
		...(clearCredential === undefined ? {} : { clearCredential }),
	};
}

export function readAgentProviderCreateRequest(v: unknown): AgentProviderInput {
	return input(v, false);
}

export function readAgentProviderUpdateRequest(v: unknown): AgentProviderUpdateRequest {
	const r = agentRecord(
		v,
		[
			'kind',
			'displayName',
			'baseUrl',
			'protocol',
			'models',
			'enabled',
			'credential',
			'clearCredential',
			'expectedVersion',
		],
		AGENT_PROVIDER_MAX_BODY_BYTES,
	);
	if (r.kind !== undefined && r.kind !== 'openai-compatible') {
		throw new InvalidAgentPayload();
	}
	let models: AgentProviderModelInput[] | undefined;
	if (r.models !== undefined) {
		if (!Array.isArray(r.models) || r.models.length < 1 || r.models.length > AGENT_PROVIDER_MODEL_LIMIT) {
			throw new InvalidAgentPayload();
		}
		models = r.models.map(model);
		if (new Set(models.map((item) => item.id)).size !== models.length) {
			throw new InvalidAgentPayload();
		}
	}
	const credential =
		r.credential === undefined ? undefined : agentText(r.credential, AGENT_PROVIDER_MAX_SECRET_BYTES);
	const clearCredential = optionalBoolean(r.clearCredential);
	if (credential !== undefined && clearCredential === true) {
		throw new InvalidAgentPayload();
	}
	return {
		expectedVersion: agentInteger(r.expectedVersion, 1),
		...(r.kind === undefined ? {} : { kind: 'openai-compatible' }),
		...(r.displayName === undefined
			? {}
			: { displayName: agentText(r.displayName, AGENT_PROVIDER_MAX_NAME_BYTES).trim() }),
		...(r.baseUrl === undefined ? {} : { baseUrl: agentText(r.baseUrl, AGENT_PROVIDER_MAX_URL_BYTES).trim() }),
		...(r.protocol === undefined ? {} : { protocol: protocol(r.protocol) }),
		...(models === undefined ? {} : { models }),
		...(r.enabled === undefined ? {} : { enabled: boolean(r.enabled) }),
		...(credential === undefined ? {} : { credential }),
		...(clearCredential === undefined ? {} : { clearCredential }),
	};
}

export function readAgentProviderDeleteVersion(v: unknown): number {
	if (typeof v !== 'string' || !/^[1-9][0-9]{0,14}$/.test(v)) {
		throw new InvalidAgentPayload();
	}
	return agentInteger(Number(v), 1);
}

export function readAgentProviderId(v: unknown): string {
	return readAgentId(v);
}

export function readAgentProviderEndpointRequest(v: unknown): AgentProviderDiscoverEndpointRequest {
	const r = agentRecord(v, ['baseUrl', 'credential'], AGENT_PROVIDER_MAX_BODY_BYTES);
	return {
		baseUrl: agentText(r.baseUrl, AGENT_PROVIDER_MAX_URL_BYTES).trim(),
		...(r.credential === undefined ? {} : { credential: agentText(r.credential, AGENT_PROVIDER_MAX_SECRET_BYTES) }),
	};
}

export function readAgentProviderTestRequest(v: unknown): AgentProviderTestRequest {
	const r = agentRecord(v, ['modelId']);
	return { modelId: agentText(r.modelId, AGENT_PROVIDER_MAX_MODEL_ID_BYTES).trim() };
}

export function readAgentProviderEmptyRequest(v: unknown): void {
	agentRecord(v, []);
}

export function readAgentProviderView(v: unknown): AgentProviderView {
	const r = agentRecord(v, [
		'id',
		'kind',
		'displayName',
		'baseUrl',
		'protocol',
		'models',
		'enabled',
		'hasCredential',
		'credentialRevision',
		'version',
		'createdAt',
		'updatedAt',
	]);
	if (!Array.isArray(r.models) || r.models.length < 1 || r.models.length > AGENT_PROVIDER_MODEL_LIMIT) {
		throw new InvalidAgentPayload();
	}
	const models: AgentProviderModelView[] = r.models.map((raw) => {
		const row = agentRecord(raw, [
			'id',
			'protocol',
			'contextWindow',
			'maxOutputTokens',
			'supportsTools',
			'supportsImageInput',
			'supportsFileInput',
			'supportsPromptCacheKey',
			'reasoningEfforts',
			'defaultReasoningEffort',
			'reasoningMandatory',
			'capabilitySources',
			'providerCapabilities',
			'capabilityConflicts',
		]);
		const base = model({
			id: row.id,
			protocol: row.protocol,
			contextWindow: row.contextWindow,
			maxOutputTokens: row.maxOutputTokens,
			supportsTools: row.supportsTools,
			supportsImageInput: row.supportsImageInput,
			supportsFileInput: row.supportsFileInput,
			supportsPromptCacheKey: row.supportsPromptCacheKey,
			reasoningEfforts: row.reasoningEfforts,
			defaultReasoningEffort: row.defaultReasoningEffort,
			reasoningMandatory: row.reasoningMandatory,
		});
		const source = agentRecord(row.capabilitySources, AGENT_MODEL_CAPABILITY_FIELDS);
		const capabilitySources: AgentProviderModelView['capabilitySources'] = {};
		for (const key of AGENT_MODEL_CAPABILITY_FIELDS) {
			const value = source[key];
			if (value === undefined) {
				continue;
			}
			if (value !== 'manual' && value !== 'provider' && value !== 'registry') {
				throw new InvalidAgentPayload();
			}
			capabilitySources[key] = value;
		}
		let providerCapabilities: AgentProviderModelView['providerCapabilities'];
		if (row.providerCapabilities !== undefined) {
			const o = agentRecord(row.providerCapabilities, ['source', 'sourceVersion', 'updatedAt', 'capabilities']);
			const observation = readAgentDiscoveredModels([{ id: base.id, providerCapabilities: o.capabilities }])[0];
			if (!observation.providerCapabilities || Object.keys(observation.providerCapabilities).length === 0) {
				throw new InvalidAgentPayload();
			}
			providerCapabilities = {
				source: agentText(o.source, 256),
				sourceVersion: agentText(o.sourceVersion, 256),
				updatedAt: agentInteger(o.updatedAt),
				capabilities: observation.providerCapabilities,
			};
		}
		let capabilityConflicts: AgentModelCapabilityField[] | undefined;
		if (row.capabilityConflicts !== undefined) {
			if (
				!Array.isArray(row.capabilityConflicts) ||
				row.capabilityConflicts.length > 9 ||
				new Set(row.capabilityConflicts).size !== row.capabilityConflicts.length
			) {
				throw new InvalidAgentPayload();
			}
			for (const name of row.capabilityConflicts) {
				if (
					![
						'contextWindow',
						'maxOutputTokens',
						'supportsTools',
						'supportsImageInput',
						'supportsFileInput',
						'supportsPromptCacheKey',
						'reasoningEfforts',
						'defaultReasoningEffort',
						'reasoningMandatory',
					].includes(name)
				) {
					throw new InvalidAgentPayload();
				}
			}
			capabilityConflicts = row.capabilityConflicts.map(readCapabilityField);
		}
		return {
			...base,
			capabilitySources,
			...(providerCapabilities === undefined ? {} : { providerCapabilities }),
			...(capabilityConflicts === undefined ? {} : { capabilityConflicts }),
		};
	});
	const core = input(
		{
			kind: r.kind,
			displayName: r.displayName,
			baseUrl: r.baseUrl,
			protocol: r.protocol,
			models: models.map((m) => ({
				id: m.id,
				...(m.protocol === undefined ? {} : { protocol: m.protocol }),
				contextWindow: m.contextWindow,
				maxOutputTokens: m.maxOutputTokens,
				supportsTools: m.supportsTools,
				...(m.supportsImageInput === undefined ? {} : { supportsImageInput: m.supportsImageInput }),
				...(m.supportsFileInput === undefined ? {} : { supportsFileInput: m.supportsFileInput }),
				...(m.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: m.supportsPromptCacheKey }),
				...(m.reasoningEfforts === undefined ? {} : { reasoningEfforts: m.reasoningEfforts }),
				...(m.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: m.defaultReasoningEffort }),
				...(m.reasoningMandatory === undefined ? {} : { reasoningMandatory: m.reasoningMandatory }),
			})),
			enabled: r.enabled,
		},
		false,
	);
	return {
		id: readAgentId(r.id),
		kind: core.kind,
		displayName: core.displayName,
		baseUrl: core.baseUrl,
		protocol: core.protocol,
		models,
		enabled: core.enabled,
		hasCredential: boolean(r.hasCredential),
		credentialRevision: agentInteger(r.credentialRevision, 1),
		version: agentInteger(r.version, 1),
		createdAt: agentInteger(r.createdAt),
		updatedAt: agentInteger(r.updatedAt),
	};
}

/** Strict response decoder for the installed GET /ai/providers consumer. */
export function readAgentProviderListResponse(v: unknown): AgentProviderView[] {
	encodeAgentJson(v, AGENT_PROVIDER_MAX_RESPONSE_BYTES);
	if (!Array.isArray(v)) {
		throw new InvalidAgentPayload();
	}
	const providers = v.map(readAgentProviderView);
	if (new Set(providers.map((item) => item.id)).size !== providers.length) {
		throw new InvalidAgentPayload();
	}
	return providers;
}

export function readAgentProviderDeleteResponse(value: unknown): AgentProviderDeleteResponse {
	const row = agentRecord(value, ['deleted']);
	if (row.deleted !== true) {
		throw new InvalidAgentPayload();
	}
	return { deleted: true };
}

export function readAgentDiscoveredModels(v: unknown): AgentDiscoveredModel[] {
	encodeAgentJson(v, AGENT_PROVIDER_MAX_RESPONSE_BYTES);
	if (!Array.isArray(v) || v.length > AGENT_PROVIDER_DISCOVERY_LIMIT) {
		throw new InvalidAgentPayload();
	}
	const discovered = v.map((raw) => {
		const r = agentRecord(raw, ['id', 'ownedBy', 'createdAt', 'providerCapabilities']);
		if (r.providerCapabilities !== undefined) {
			const cap = agentRecord(r.providerCapabilities, [
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
			const fields: NonNullable<AgentDiscoveredModel['providerCapabilities']> = {};
			for (const k of ['contextWindow', 'maxOutputTokens'] as const) {
				if (cap[k] !== undefined) {
					fields[k] = agentInteger(cap[k], 1);
				}
			}
			if (
				fields.contextWindow !== undefined &&
				fields.maxOutputTokens !== undefined &&
				fields.maxOutputTokens > fields.contextWindow
			) {
				throw new InvalidAgentPayload();
			}
			for (const k of [
				'supportsTools',
				'supportsImageInput',
				'supportsFileInput',
				'supportsPromptCacheKey',
				'reasoningMandatory',
			] as const) {
				if (cap[k] !== undefined) {
					fields[k] = boolean(cap[k]);
				}
			}
			if (cap.reasoningEfforts !== undefined) {
				if (
					!Array.isArray(cap.reasoningEfforts) ||
					cap.reasoningEfforts.length < 1 ||
					cap.reasoningEfforts.length > AGENT_REASONING_EFFORTS.length
				) {
					throw new InvalidAgentPayload();
				}
				const efforts = cap.reasoningEfforts.map((value) => {
					const effort = optionalEffort(value);
					if (effort === undefined) {
						throw new InvalidAgentPayload();
					}
					return effort;
				});
				if (new Set(efforts).size !== efforts.length) {
					throw new InvalidAgentPayload();
				}
				fields.reasoningEfforts = efforts;
			}
			if (cap.defaultReasoningEffort !== undefined) {
				const effort = optionalEffort(cap.defaultReasoningEffort);
				if (!effort || !fields.reasoningEfforts?.includes(effort)) {
					throw new InvalidAgentPayload();
				}
				fields.defaultReasoningEffort = effort;
			}
			if (cap.reasoningMandatory === true && !fields.reasoningEfforts?.length) {
				throw new InvalidAgentPayload();
			}
			return {
				id: agentText(r.id, AGENT_PROVIDER_MAX_MODEL_ID_BYTES),
				...(r.ownedBy === undefined ? {} : { ownedBy: agentText(r.ownedBy, 512) }),
				...(r.createdAt === undefined ? {} : { createdAt: agentInteger(r.createdAt) }),
				providerCapabilities: fields,
			};
		}
		return {
			id: agentText(r.id, AGENT_PROVIDER_MAX_MODEL_ID_BYTES),
			...(r.ownedBy === undefined ? {} : { ownedBy: agentText(r.ownedBy, 512) }),
			...(r.createdAt === undefined ? {} : { createdAt: agentInteger(r.createdAt) }),
		};
	});
	if (new Set(discovered.map((item) => item.id)).size !== discovered.length) {
		throw new InvalidAgentPayload();
	}
	return discovered;
}

function isProviderHttpFailure(value: unknown): value is `PROVIDER_HTTP_${number}` {
	return typeof value === 'string' && /^PROVIDER_HTTP_[1-5][0-9]{2}$/u.test(value);
}

export function readAgentProviderFailureCode(value: unknown): AgentProviderFailureCode {
	for (const code of AGENT_PROVIDER_FAILURE_CODES) {
		if (value === code) {
			return code;
		}
	}
	if (isProviderHttpFailure(value)) {
		return value;
	}
	throw new InvalidAgentPayload();
}

export function readAgentProviderTestResponse(value: unknown): AgentProviderTestResponse {
	const row = agentRecord(value, ['ok', 'latencyMs', 'usage', 'errorCode']);
	const latencyMs = agentInteger(row.latencyMs);
	if (row.ok === false && row.usage === undefined) {
		return { ok: false, latencyMs, errorCode: readAgentProviderFailureCode(row.errorCode) };
	}
	if (row.ok !== true || row.errorCode !== undefined) {
		throw new InvalidAgentPayload();
	}
	if (row.usage === undefined) {
		return { ok: true, latencyMs };
	}
	const reported = agentRecord(row.usage, ['inputTokens', 'outputTokens']);
	return {
		ok: true,
		latencyMs,
		usage: {
			inputTokens: agentInteger(reported.inputTokens),
			outputTokens: agentInteger(reported.outputTokens),
		},
	};
}

function queryValue(params: URLSearchParams, key: string): string {
	const values = params.getAll(key);
	if (values.length !== 1 || [...params.keys()].some((name) => name !== key)) {
		throw new InvalidAgentPayload();
	}
	return values[0];
}

export function readAgentProviderDeleteQuery(params: URLSearchParams): AgentProviderDeleteQuery {
	return { expectedVersion: readAgentProviderDeleteVersion(queryValue(params, 'expectedVersion')) };
}

export function readAgentRegistryResolveQuery(params: URLSearchParams): AgentRegistryResolveQuery {
	return { modelId: agentText(queryValue(params, 'modelId'), AGENT_REGISTRY_MAX_MODEL_ID_BYTES) };
}

function registryTimestamp(value: unknown): number | null {
	// The wire uses seconds; callers may convert to safe-integer milliseconds.
	return value === null ? null : agentInteger(value, 0, Math.floor(Number.MAX_SAFE_INTEGER / 1000));
}

export function readAgentRegistryStatus(value: unknown): AgentRegistryStatus {
	const row = agentRecord(value, [
		'sourceUrl',
		'activeSource',
		'entryCount',
		'generatedAt',
		'sourceRevision',
		'lastAttemptAt',
		'lastSuccessAt',
		'lastErrorCode',
	]);
	if (row.activeSource !== 'remote' && row.activeSource !== 'unavailable') {
		throw new InvalidAgentPayload();
	}
	const generatedAt = registryTimestamp(row.generatedAt);
	const entryCount = agentInteger(row.entryCount);
	if (row.sourceRevision !== null && typeof row.sourceRevision !== 'string') {
		throw new InvalidAgentPayload();
	}
	const sourceRevision = row.sourceRevision;
	if (
		(row.activeSource === 'remote' && generatedAt === null) ||
		(row.activeSource === 'unavailable' && (generatedAt !== null || entryCount !== 0 || sourceRevision !== null))
	) {
		throw new InvalidAgentPayload();
	}
	const lastErrorCode =
		row.lastErrorCode === null ? null : AGENT_REGISTRY_ERROR_CODES.find((code) => code === row.lastErrorCode);
	if (lastErrorCode === undefined) {
		throw new InvalidAgentPayload();
	}
	return {
		sourceUrl: agentText(row.sourceUrl, AGENT_PROVIDER_MAX_RESPONSE_BYTES),
		activeSource: row.activeSource,
		entryCount,
		generatedAt,
		sourceRevision,
		lastAttemptAt: registryTimestamp(row.lastAttemptAt),
		lastSuccessAt: registryTimestamp(row.lastSuccessAt),
		lastErrorCode,
	};
}

function registryDefaults(value: unknown): AgentRegistryDefaults {
	const row = agentRecord(value, [
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
	const contextWindow = agentInteger(row.contextWindow, 1);
	let reasoningEfforts: AgentRegistryDefaults['reasoningEfforts'];
	if (row.reasoningEfforts !== undefined) {
		if (
			!Array.isArray(row.reasoningEfforts) ||
			row.reasoningEfforts.length === 0 ||
			row.reasoningEfforts.length > AGENT_REASONING_EFFORTS.length
		) {
			throw new InvalidAgentPayload();
		}
		reasoningEfforts = row.reasoningEfforts.map((value) => {
			const effort = optionalEffort(value);
			if (effort === undefined) {
				throw new InvalidAgentPayload();
			}
			return effort;
		});
		if (new Set(reasoningEfforts).size !== reasoningEfforts.length) {
			throw new InvalidAgentPayload();
		}
	}
	const defaultReasoningEffort = optionalEffort(row.defaultReasoningEffort);
	if (defaultReasoningEffort && !reasoningEfforts?.includes(defaultReasoningEffort)) {
		throw new InvalidAgentPayload();
	}
	if (row.reasoningMandatory === true && !reasoningEfforts?.length) {
		throw new InvalidAgentPayload();
	}
	return {
		contextWindow,
		maxOutputTokens: agentInteger(row.maxOutputTokens, 1, contextWindow),
		...(row.supportsTools === undefined ? {} : { supportsTools: boolean(row.supportsTools) }),
		...(row.supportsImageInput === undefined ? {} : { supportsImageInput: boolean(row.supportsImageInput) }),
		...(row.supportsFileInput === undefined ? {} : { supportsFileInput: boolean(row.supportsFileInput) }),
		...(row.supportsPromptCacheKey === undefined
			? {}
			: { supportsPromptCacheKey: boolean(row.supportsPromptCacheKey) }),
		...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
		...(defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort }),
		...(row.reasoningMandatory === undefined ? {} : { reasoningMandatory: boolean(row.reasoningMandatory) }),
	};
}

export function readAgentRegistryResolveResponse(value: unknown): AgentRegistryResolveResponse {
	const row = agentRecord(value, ['modelId', 'defaults']);
	if (!Object.hasOwn(row, 'defaults')) {
		throw new InvalidAgentPayload();
	}
	return {
		modelId: agentText(row.modelId, AGENT_REGISTRY_MAX_MODEL_ID_BYTES),
		defaults: row.defaults === null ? null : registryDefaults(row.defaults),
	};
}
