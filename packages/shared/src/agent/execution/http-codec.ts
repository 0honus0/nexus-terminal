import { agentRecord, agentInteger, agentText, readAgentId, InvalidAgentPayload } from '../http-codec.js';
import { AGENT_CHILD_PROFILES } from '../collaboration/values.js';
import {
	AGENT_EXECUTION_LIMIT_KEYS,
	AGENT_EXECUTION_LIMIT_MAXIMA,
	AGENT_EXECUTION_SETTINGS_MAX_BYTES,
} from './values.js';
import type {
	AgentExecutionLimits,
	AgentExecutionProfile,
	AgentExecutionSettingsView,
	AgentHardLimitPreviewView,
	AgentProfileModel,
} from './model.js';
import type {
	AgentExecutionSettingsUpdate,
	AgentHardLimitPreviewRequest,
	AgentHardLimitConfirmRequest,
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
		maxSingleArtifactBytes: field('maxSingleArtifactBytes'),
		maxArtifactBytes: field('maxArtifactBytes'),
		artifactTtlSeconds: field('artifactTtlSeconds'),
	};
}

export function readAgentExecutionProfiles(value: unknown): AgentExecutionProfile[] {
	if (!Array.isArray(value) || value.length !== AGENT_CHILD_PROFILES.length) {
		throw new InvalidAgentPayload();
	}
	const items = value.map((raw: unknown) => {
		const r = agentRecord(raw, ['name', 'enabled', 'model', 'maxRequests', 'maxSeconds', 'tools']);
		const name = AGENT_CHILD_PROFILES.find((v) => v === r.name);
		if (!name || typeof r.enabled !== 'boolean' || !Array.isArray(r.tools) || r.tools.length > 128) {
			throw new InvalidAgentPayload();
		}
		const model = agentRecord(
			r.model,
			r.model !== null && typeof r.model === 'object' && 'kind' in r.model && r.model.kind === 'inherit'
				? ['kind']
				: ['kind', 'providerId', 'modelId', 'configurationVersion'],
		);
		let selection: AgentProfileModel;
		if (model.kind === 'inherit') {
			selection = { kind: 'inherit' };
		} else if (model.kind === 'explicit') {
			selection = {
				kind: 'explicit',
				providerId: readAgentId(model.providerId),
				modelId: agentText(model.modelId, 256),
				configurationVersion: agentInteger(model.configurationVersion, 1),
			};
		} else {
			throw new InvalidAgentPayload();
		}
		const tools = r.tools.map((tool: unknown) => {
			const name = agentText(tool, 256);
			if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
				throw new InvalidAgentPayload();
			}
			return name;
		});
		if (new Set(tools).size !== tools.length) {
			throw new InvalidAgentPayload();
		}
		return {
			name,
			enabled: r.enabled,
			model: selection,
			maxRequests: agentInteger(r.maxRequests, 1, 32),
			maxSeconds: agentInteger(r.maxSeconds, 1, 7200),
			tools,
		};
	});
	if (new Set(items.map((v) => v.name)).size !== AGENT_CHILD_PROFILES.length) {
		throw new InvalidAgentPayload();
	}
	return items;
}

export function readAgentExecutionSettingsUpdate(value: unknown): AgentExecutionSettingsUpdate {
	const r = agentRecord(
		value,
		['expectedVersion', 'enabled', 'limits', 'profiles'],
		AGENT_EXECUTION_SETTINGS_MAX_BYTES,
	);
	if (typeof r.enabled !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return {
		expectedVersion: agentInteger(r.expectedVersion),
		enabled: r.enabled,
		limits: readAgentExecutionLimits(r.limits),
		profiles: readAgentExecutionProfiles(r.profiles),
	};
}

export function readAgentExecutionSettingsView(value: unknown): AgentExecutionSettingsView {
	const r = agentRecord(
		value,
		['version', 'enabled', 'limits', 'hardLimits', 'profiles', 'updatedAt'],
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
		profiles: readAgentExecutionProfiles(r.profiles),
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
