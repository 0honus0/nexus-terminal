import {
	AGENT_EXECUTION_COMPACTION_MODES,
	AGENT_EXECUTION_CONTEXT_PROFILES,
} from '@nexus-terminal/shared/agent/governance/values';
import {
	AGENT_EXECUTION_LIMIT_KEYS,
	AGENT_EXECUTION_PROFILE_MAX_REQUESTS,
	AGENT_EXECUTION_PROFILE_MAX_TOOLS,
	AGENT_EXECUTION_PROFILE_MODEL_MAX_BYTES,
	AGENT_EXECUTION_PROFILE_TOOL_MAX_BYTES,
	AGENT_EXECUTION_LIMIT_MAXIMA,
	AGENT_EXECUTION_SETTINGS_MAX_BYTES,
} from '@nexus-terminal/shared/agent/execution/values';
import { AGENT_CHILD_PROFILES } from '@nexus-terminal/shared/agent/collaboration/values';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type {
	StoredExecutionLimits,
	StoredExecutionSettings,
	StoredExecutionProfile,
	StoredProfileModel,
} from '../../storage/execution-storage.js';

export function executionInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt execution integer');
	}
	return value;
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Corrupt execution object');
	}
	const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
	if (keys.length !== Object.keys(record).length || Object.keys(record).some((key) => !keys.includes(key))) {
		throw new Error('Corrupt execution keys');
	}
	return record;
}

function text(value: unknown, max: number): string {
	if (
		typeof value !== 'string' ||
		!value ||
		Buffer.byteLength(value, 'utf8') > max ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt execution text');
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new Error('Corrupt execution boolean');
	}
	return value;
}

export function executionLimits(value: unknown): StoredExecutionLimits {
	const r = object(value, AGENT_EXECUTION_LIMIT_KEYS);
	return {
		maxModelRequests: executionInteger(r.maxModelRequests, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests),
		maxToolExecutions: executionInteger(r.maxToolExecutions, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxToolExecutions),
		maxActiveSeconds: executionInteger(r.maxActiveSeconds, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxActiveSeconds),
		toolTimeoutSeconds: executionInteger(r.toolTimeoutSeconds, 1, AGENT_EXECUTION_LIMIT_MAXIMA.toolTimeoutSeconds),
		maxToolOutputBytes: executionInteger(r.maxToolOutputBytes, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxToolOutputBytes),
		maxTokenReservations: executionInteger(
			r.maxTokenReservations,
			1,
			AGENT_EXECUTION_LIMIT_MAXIMA.maxTokenReservations,
		),
		maxConcurrentRuns: executionInteger(r.maxConcurrentRuns, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxConcurrentRuns),
		maxConcurrentModelCalls: executionInteger(
			r.maxConcurrentModelCalls,
			1,
			AGENT_EXECUTION_LIMIT_MAXIMA.maxConcurrentModelCalls,
		),
		maxChildren: executionInteger(r.maxChildren, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxChildren),
		maxMessages: executionInteger(r.maxMessages, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxMessages),
		maxMessageBytes: executionInteger(r.maxMessageBytes, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxMessageBytes),
		maxRecallItems: executionInteger(r.maxRecallItems, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxRecallItems),
		maxRecallBytes: executionInteger(r.maxRecallBytes, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxRecallBytes),
		maxSingleArtifactBytes: executionInteger(
			r.maxSingleArtifactBytes,
			1,
			AGENT_EXECUTION_LIMIT_MAXIMA.maxSingleArtifactBytes,
		),
		maxArtifactBytes: executionInteger(r.maxArtifactBytes, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxArtifactBytes),
		artifactTtlSeconds: executionInteger(r.artifactTtlSeconds, 1, AGENT_EXECUTION_LIMIT_MAXIMA.artifactTtlSeconds),
	};
}

function profiles(value: unknown): StoredExecutionProfile[] {
	if (!Array.isArray(value) || value.length !== 3) {
		throw new Error('Corrupt execution profiles');
	}
	const items = value.map((raw: unknown) => {
		const r = object(raw, ['name', 'enabled', 'model', 'maxRequests', 'maxSeconds', 'tools']);
		const name = AGENT_CHILD_PROFILES.find((v) => v === r.name);
		if (!name || !Array.isArray(r.tools) || r.tools.length > AGENT_EXECUTION_PROFILE_MAX_TOOLS) {
			throw new Error('Corrupt execution profile');
		}
		const model = object(
			r.model,
			r.model !== null && typeof r.model === 'object' && 'kind' in r.model && r.model.kind === 'inherit'
				? ['kind']
				: ['kind', 'providerId', 'modelId', 'configurationVersion'],
		);
		let selection: StoredProfileModel;
		if (model.kind === 'inherit') {
			selection = { kind: 'inherit' };
		} else if (model.kind === 'explicit') {
			const providerId = text(model.providerId, 36);
			if (!AGENT_ID_PATTERN.test(providerId)) {
				throw new Error('Corrupt profile model');
			}
			selection = {
				kind: 'explicit',
				providerId,
				modelId: text(model.modelId, AGENT_EXECUTION_PROFILE_MODEL_MAX_BYTES),
				configurationVersion: executionInteger(model.configurationVersion, 1),
			};
		} else {
			throw new Error('Corrupt profile selection');
		}
		const tools = r.tools.map((v: unknown) => text(v, AGENT_EXECUTION_PROFILE_TOOL_MAX_BYTES));
		if (new Set(tools).size !== tools.length || tools.some((v) => !/^[a-z][a-z0-9_]*$/u.test(v))) {
			throw new Error('Corrupt profile tools');
		}
		return {
			name,
			enabled: boolean(r.enabled),
			model: selection,
			maxRequests: executionInteger(r.maxRequests, 1, AGENT_EXECUTION_PROFILE_MAX_REQUESTS),
			maxSeconds: executionInteger(r.maxSeconds, 1, AGENT_EXECUTION_LIMIT_MAXIMA.maxActiveSeconds),
			tools,
		};
	});
	if (new Set(items.map((item) => item.name)).size !== 3) {
		throw new Error('Duplicate execution profiles');
	}
	return items;
}

export function executionDocument(json: unknown): StoredExecutionSettings {
	if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > AGENT_EXECUTION_SETTINGS_MAX_BYTES) {
		throw new Error('Corrupt execution JSON');
	}
	const r = object(JSON.parse(json), [
		'version',
		'enabled',
		'limits',
		'hardLimits',
		'profiles',
		'updatedAt',
		'contextCompactionMode',
		'contextProfile',
	]);
	const contextCompactionMode = AGENT_EXECUTION_COMPACTION_MODES.find((value) => value === r.contextCompactionMode);
	const contextProfile = AGENT_EXECUTION_CONTEXT_PROFILES.find((value) => value === r.contextProfile);
	if (!contextCompactionMode || !contextProfile) {
		throw new Error('Corrupt frozen context policy');
	}
	const limits = executionLimits(r.limits);
	const hardLimits = executionLimits(r.hardLimits);
	if (AGENT_EXECUTION_LIMIT_KEYS.some((k) => limits[k] > hardLimits[k])) {
		throw new Error('Corrupt execution limit relationship');
	}
	return {
		contextCompactionMode,
		contextProfile,
		version: executionInteger(r.version),
		enabled: boolean(r.enabled),
		limits,
		hardLimits,
		profiles: profiles(r.profiles),
		updatedAt: executionInteger(r.updatedAt),
	};
}
