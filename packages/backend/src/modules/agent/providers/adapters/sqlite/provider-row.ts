import {
	AGENT_REASONING_EFFORTS,
	AGENT_PROVIDER_MODEL_LIMIT,
	AGENT_PROVIDER_DISCOVERY_LIMIT,
	AGENT_PROVIDER_MAX_MODEL_ID_BYTES,
	AGENT_PROVIDER_MAX_NAME_BYTES,
	AGENT_PROVIDER_MAX_URL_BYTES,
} from '@nexus-terminal/shared/agent/providers/values';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { AgentReasoningEffort, AgentProviderProtocol } from '@nexus-terminal/shared/agent/providers/values';
import type {
	ProviderStoredRow,
	StoredProviderModel,
	StoredProviderObservation,
} from '../../storage/provider-storage.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
		throw new Error('Corrupt provider record');
	}
	return value;
}

function text(value: unknown, maxBytes: number): string {
	if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maxBytes) {
		throw new Error('Corrupt provider text');
	}
	return value;
}

function integer(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt provider integer');
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new Error('Corrupt provider boolean');
	}
	return value;
}

function protocol(value: unknown): AgentProviderProtocol {
	if (value !== 'chat-completions' && value !== 'responses' && value !== 'images') {
		throw new Error('Corrupt provider protocol');
	}
	return value;
}

function effort(value: unknown): AgentReasoningEffort {
	for (const item of AGENT_REASONING_EFFORTS) {
		if (item === value) {
			return item;
		}
	}
	throw new Error('Corrupt provider reasoning effort');
}

const capabilityKeys = [
	'contextWindow',
	'maxOutputTokens',
	'supportsTools',
	'supportsImageInput',
	'supportsImageGeneration',
	'supportsFileInput',
	'supportsPromptCacheKey',
	'reasoningEfforts',
	'defaultReasoningEffort',
	'reasoningMandatory',
];

function capabilities(value: unknown): StoredProviderObservation['capabilities'] {
	const row = record(value, capabilityKeys);
	let efforts: AgentReasoningEffort[] | undefined;
	if (row.reasoningEfforts !== undefined) {
		if (
			!Array.isArray(row.reasoningEfforts) ||
			row.reasoningEfforts.length < 1 ||
			row.reasoningEfforts.length > AGENT_REASONING_EFFORTS.length
		) {
			throw new Error('Corrupt provider reasoning');
		}
		efforts = row.reasoningEfforts.map(effort);
		if (new Set(efforts).size !== efforts.length) {
			throw new Error('Corrupt provider reasoning');
		}
	}
	const defaultEffort = row.defaultReasoningEffort === undefined ? undefined : effort(row.defaultReasoningEffort);
	if (defaultEffort !== undefined && !efforts?.includes(defaultEffort)) {
		throw new Error('Corrupt provider reasoning default');
	}
	const mandatory = row.reasoningMandatory === undefined ? undefined : boolean(row.reasoningMandatory);
	if (mandatory === true && !efforts?.length) {
		throw new Error('Corrupt provider mandatory reasoning');
	}
	const contextWindow = row.contextWindow === undefined ? undefined : integer(row.contextWindow, 1);
	const maxOutputTokens = row.maxOutputTokens === undefined ? undefined : integer(row.maxOutputTokens, 1);
	if (contextWindow !== undefined && maxOutputTokens !== undefined && maxOutputTokens > contextWindow) {
		throw new Error('Corrupt provider token limits');
	}
	return {
		...(contextWindow === undefined ? {} : { contextWindow }),
		...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
		...(row.supportsTools === undefined ? {} : { supportsTools: boolean(row.supportsTools) }),
		...(row.supportsImageInput === undefined ? {} : { supportsImageInput: boolean(row.supportsImageInput) }),
		...(row.supportsImageGeneration === undefined
			? {}
			: { supportsImageGeneration: boolean(row.supportsImageGeneration) }),
		...(row.supportsFileInput === undefined ? {} : { supportsFileInput: boolean(row.supportsFileInput) }),
		...(row.supportsPromptCacheKey === undefined
			? {}
			: { supportsPromptCacheKey: boolean(row.supportsPromptCacheKey) }),
		...(efforts === undefined ? {} : { reasoningEfforts: efforts }),
		...(defaultEffort === undefined ? {} : { defaultReasoningEffort: defaultEffort }),
		...(mandatory === undefined ? {} : { reasoningMandatory: mandatory }),
	};
}

export function decodeStoredModel(value: unknown): StoredProviderModel {
	const row = record(value, ['id', 'protocol', ...capabilityKeys]);
	const checked = capabilities({
		contextWindow: row.contextWindow,
		maxOutputTokens: row.maxOutputTokens,
		supportsTools: row.supportsTools,
		supportsImageInput: row.supportsImageInput,
		supportsImageGeneration: row.supportsImageGeneration,
		supportsFileInput: row.supportsFileInput,
		supportsPromptCacheKey: row.supportsPromptCacheKey,
		reasoningEfforts: row.reasoningEfforts,
		defaultReasoningEffort: row.defaultReasoningEffort,
		reasoningMandatory: row.reasoningMandatory,
	});
	return {
		id: text(row.id, AGENT_PROVIDER_MAX_MODEL_ID_BYTES),
		...(row.protocol === undefined ? {} : { protocol: protocol(row.protocol) }),
		...(checked.contextWindow === undefined ? {} : { contextWindow: checked.contextWindow }),
		...(checked.maxOutputTokens === undefined ? {} : { maxOutputTokens: checked.maxOutputTokens }),
		supportsTools: boolean(checked.supportsTools),
		...(checked.supportsImageInput === undefined ? {} : { supportsImageInput: checked.supportsImageInput }),
		...(checked.supportsImageGeneration === undefined
			? {}
			: { supportsImageGeneration: checked.supportsImageGeneration }),
		...(checked.supportsFileInput === undefined ? {} : { supportsFileInput: checked.supportsFileInput }),
		...(checked.supportsPromptCacheKey === undefined
			? {}
			: { supportsPromptCacheKey: checked.supportsPromptCacheKey }),
		...(checked.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...checked.reasoningEfforts] }),
		...(checked.defaultReasoningEffort === undefined
			? {}
			: { defaultReasoningEffort: checked.defaultReasoningEffort }),
		...(checked.reasoningMandatory === undefined ? {} : { reasoningMandatory: checked.reasoningMandatory }),
	};
}

export function readStoredObservations(raw: unknown): StoredProviderObservation[] {
	const parsed: unknown = JSON.parse(text(raw, 4 * 1024 * 1024));
	if (!Array.isArray(parsed) || parsed.length > AGENT_PROVIDER_DISCOVERY_LIMIT) {
		throw new Error('Corrupt provider observations');
	}
	const seen = new Set<string>();
	return parsed.map((item) => {
		const row = record(item, ['modelId', 'source', 'sourceVersion', 'updatedAt', 'capabilities']);
		const modelId = text(row.modelId, AGENT_PROVIDER_MAX_MODEL_ID_BYTES);
		if (seen.has(modelId)) {
			throw new Error('Duplicate provider observation');
		}
		seen.add(modelId);
		const decoded = capabilities(row.capabilities);
		if (Object.keys(decoded).length === 0) {
			throw new Error('Empty provider observation');
		}
		return {
			modelId,
			source: text(row.source, 256),
			sourceVersion: text(row.sourceVersion, 256),
			updatedAt: integer(row.updatedAt),
			capabilities: decoded,
		};
	});
}

export function decodeProviderRow(row: Record<string, unknown>): ProviderStoredRow {
	const id = text(row.id, 36);
	if (!AGENT_ID_PATTERN.test(id)) {
		throw new Error('Corrupt provider ID');
	}
	if (row.enabled !== 0 && row.enabled !== 1) {
		throw new Error('Corrupt provider enabled');
	}
	if (
		row.protected_credential !== null &&
		(typeof row.protected_credential !== 'string' || !row.protected_credential)
	) {
		throw new Error('Corrupt provider credential');
	}
	const parsed: unknown = JSON.parse(text(row.models_json, 128 * 1024));
	if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > AGENT_PROVIDER_MODEL_LIMIT) {
		throw new Error('Corrupt provider models');
	}
	const models = parsed.map(decodeStoredModel);
	if (new Set(models.map((model) => model.id)).size !== models.length) {
		throw new Error('Duplicate provider models');
	}
	return {
		id,
		userId: integer(row.user_id, 1),
		displayName: text(row.display_name, AGENT_PROVIDER_MAX_NAME_BYTES),
		baseUrl: text(row.base_url, AGENT_PROVIDER_MAX_URL_BYTES),
		protocol: protocol(row.protocol),
		models,
		observations: readStoredObservations(row.observations_json),
		enabled: row.enabled === 1,
		hasCredential: row.protected_credential !== null,
		credentialRevision: integer(row.credential_revision, 1),
		version: integer(row.version, 1),
		createdAt: integer(row.created_at),
		updatedAt: integer(row.updated_at),
	};
}
