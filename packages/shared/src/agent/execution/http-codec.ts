import { agentRecord, agentInteger, readAgentId, InvalidAgentPayload } from '../http-codec.js';

import {
	AGENT_EXECUTION_LIMIT_KEYS,
	AGENT_EXECUTION_LIMIT_MAXIMA,
	AGENT_EXECUTION_SETTINGS_MAX_BYTES,
} from './values.js';
import type { AgentExecutionLimits, AgentExecutionSettingsView, AgentHardLimitPreviewView } from './model.js';
import type {
	AgentExecutionSettingsUpdate,
	AgentHardLimitPreviewRequest,
	AgentHardLimitConfirmRequest,
	AgentExecutionSettingsResponse,
	AgentHardLimitPreviewResponse,
} from './http.js';

export function readAgentExecutionLimits(value: unknown): AgentExecutionLimits {
	const r = agentRecord(value, AGENT_EXECUTION_LIMIT_KEYS);

	function field(k: keyof AgentExecutionLimits): number {
		return agentInteger(r[k], 1, AGENT_EXECUTION_LIMIT_MAXIMA[k]);
	}

	return {
		maxModelRequests: field('maxModelRequests'),
		maxToolExecutions: field('maxToolExecutions'),
		maxActiveSeconds: field('maxActiveSeconds'),
		toolTimeoutSeconds: field('toolTimeoutSeconds'),
		maxToolOutputBytes: field('maxToolOutputBytes'),
		maxTokenReservations: field('maxTokenReservations'),
		maxConcurrentRuns: field('maxConcurrentRuns'),
		maxConcurrentModelCalls: field('maxConcurrentModelCalls'),
		maxChildren: field('maxChildren'),
		maxMessages: field('maxMessages'),
		maxMessageBytes: field('maxMessageBytes'),
		maxRecallItems: field('maxRecallItems'),
		maxRecallBytes: field('maxRecallBytes'),
		maxArtifactBytes: field('maxArtifactBytes'),
		artifactTtlSeconds: field('artifactTtlSeconds'),
	};
}

export function readAgentExecutionSettingsUpdate(value: unknown): AgentExecutionSettingsUpdate {
	const r = agentRecord(value, ['expectedVersion', 'enabled', 'limits'], AGENT_EXECUTION_SETTINGS_MAX_BYTES);
	if (typeof r.enabled !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return {
		expectedVersion: agentInteger(r.expectedVersion),
		enabled: r.enabled,
		limits: readAgentExecutionLimits(r.limits),
	};
}

export function readAgentExecutionSettingsView(value: unknown): AgentExecutionSettingsView {
	const r = agentRecord(
		value,
		['version', 'enabled', 'limits', 'hardLimits', 'updatedAt'],
		AGENT_EXECUTION_SETTINGS_MAX_BYTES,
	);
	if (typeof r.enabled !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	const limits = readAgentExecutionLimits(r.limits);
	const hardLimits = readAgentExecutionLimits(r.hardLimits);
	if (AGENT_EXECUTION_LIMIT_KEYS.some((k) => limits[k] > hardLimits[k])) {
		throw new InvalidAgentPayload();
	}
	return {
		version: agentInteger(r.version),
		enabled: r.enabled,
		limits,
		hardLimits,

		updatedAt: agentInteger(r.updatedAt),
	};
}

export function readAgentHardLimitPreview(value: unknown): AgentHardLimitPreviewRequest {
	const r = agentRecord(value, ['expectedVersion', 'proposed']);
	return { expectedVersion: agentInteger(r.expectedVersion), proposed: readAgentExecutionLimits(r.proposed) };
}

export function readAgentHardLimitConfirm(value: unknown): AgentHardLimitConfirmRequest {
	return { confirmationId: readAgentId(agentRecord(value, ['confirmationId']).confirmationId) };
}

export function readAgentHardLimitPreviewView(value: unknown): AgentHardLimitPreviewView {
	const r = agentRecord(value, [
		'id',
		'expectedVersion',
		'expiresAt',
		'proposed',
		'occupiedArtifactBytes',
		'activeRuns',
	]);
	return {
		id: readAgentId(r.id),
		expectedVersion: agentInteger(r.expectedVersion),
		expiresAt: agentInteger(r.expiresAt, 1),
		proposed: readAgentExecutionLimits(r.proposed),
		occupiedArtifactBytes: agentInteger(r.occupiedArtifactBytes),
		activeRuns: agentInteger(r.activeRuns),
	};
}

export function readAgentExecutionSettingsResponse(value: unknown): AgentExecutionSettingsResponse {
	const row = agentRecord(value, ['settings'], AGENT_EXECUTION_SETTINGS_MAX_BYTES);
	return { settings: readAgentExecutionSettingsView(row.settings) };
}

export function readAgentHardLimitPreviewResponse(value: unknown): AgentHardLimitPreviewResponse {
	const row = agentRecord(value, ['confirmation'], AGENT_EXECUTION_SETTINGS_MAX_BYTES);
	return { confirmation: readAgentHardLimitPreviewView(row.confirmation) };
}
