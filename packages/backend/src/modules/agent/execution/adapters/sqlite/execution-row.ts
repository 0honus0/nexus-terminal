import {
	AGENT_EXECUTION_COMPACTION_MODES,
	AGENT_EXECUTION_CONTEXT_PROFILES,
} from '@nexus-terminal/shared/agent/governance/values';
import {
	AGENT_EXECUTION_LIMIT_KEYS,
	AGENT_EXECUTION_LIMIT_MAXIMA,
	AGENT_EXECUTION_SETTINGS_MAX_BYTES,
} from '@nexus-terminal/shared/agent/execution/values';

import type { StoredExecutionLimits, StoredExecutionSettings } from '../../storage/execution-storage.js';

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

export function executionDocument(json: unknown): StoredExecutionSettings {
	if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > AGENT_EXECUTION_SETTINGS_MAX_BYTES) {
		throw new Error('Corrupt execution JSON');
	}
	const r = object(JSON.parse(json), [
		'version',
		'enabled',
		'limits',
		'hardLimits',

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

		updatedAt: executionInteger(r.updatedAt),
	};
}
