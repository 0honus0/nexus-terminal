import {
	readAgentExecutionSettingsResponse,
	readAgentExecutionSettingsUpdate,
	readAgentHardLimitPreview,
	readAgentHardLimitPreviewResponse,
	readAgentHardLimitConfirm,
} from '@nexus-terminal/shared/agent/execution/http-codec';
import {
	AGENT_EXECUTION_LIMIT_KEYS,
	AGENT_EXECUTION_SETTINGS_MAX_BYTES,
} from '@nexus-terminal/shared/agent/execution/values';
import { readAgentProviderListResponse } from '@nexus-terminal/shared/agent/providers/http-codec';
import { AGENT_PROVIDER_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/providers/values';
import type { AgentExecutionSettingsUpdate } from '@nexus-terminal/shared/agent/execution/http';
import {
	fromExecutionSettings,
	fromHardLimitConfirmation,
	toExecutionLimits,
	toExecutionUpdate,
	toExecutionModelChoices,
} from '../model/execution-mapper';
import type {
	ExecutionSettings,
	ExecutionLimits,
	HardLimitConfirmation,
	ExecutionModelChoice,
} from '../model/execution-types';
import { requestAgentManagement } from './management-request';

const ROOT = '/execution-settings';

export async function getExecutionSettings(signal?: AbortSignal): Promise<ExecutionSettings> {
	const response = await requestAgentManagement({
		method: 'GET',
		path: ROOT,
		maxRequestBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
		maxResponseBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
		decode: readAgentExecutionSettingsResponse,
		signal,
	});
	return fromExecutionSettings(response.settings);
}

export async function saveExecutionSettings(
	draft: ExecutionSettings,
	signal?: AbortSignal,
): Promise<ExecutionSettings> {
	const expectedVersion = draft.version;
	let expected: AgentExecutionSettingsUpdate | null = null;
	const response = await requestAgentManagement({
		method: 'PUT',
		path: ROOT,

		input() {
			expected = readAgentExecutionSettingsUpdate(toExecutionUpdate(draft));
			return expected;
		},

		maxRequestBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
		maxResponseBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,

		decode(value) {
			const result = readAgentExecutionSettingsResponse(value);
			if (result.settings.version !== expectedVersion + 1) {
				throw new Error('Execution update confirmation has an unexpected version');
			}
			if (
				!expected ||
				result.settings.enabled !== expected.enabled ||
				AGENT_EXECUTION_LIMIT_KEYS.some(
					(key) =>
						result.settings.limits[key] !== expected?.limits[key] ||
						result.settings.hardLimits[key] !== draft.hardLimits[key],
				) ||
				JSON.stringify(result.settings.profiles) !== JSON.stringify(expected.profiles)
			) {
				throw new Error('Execution update does not match the submitted settings');
			}
			return result;
		},

		signal,
	});
	return fromExecutionSettings(response.settings);
}

export async function previewExecutionHardLimits(
	expectedVersion: number,
	proposed: ExecutionLimits,
	signal?: AbortSignal,
): Promise<HardLimitConfirmation> {
	const response = await requestAgentManagement({
		method: 'POST',
		path: ROOT + '/hard-limits/preview',

		input: () => readAgentHardLimitPreview({ expectedVersion, proposed: toExecutionLimits(proposed) }),

		maxRequestBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
		maxResponseBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,

		decode(value) {
			const result = readAgentHardLimitPreviewResponse(value);
			if (
				result.confirmation.expectedVersion !== expectedVersion ||
				AGENT_EXECUTION_LIMIT_KEYS.some((key) => result.confirmation.proposed[key] !== proposed[key])
			) {
				throw new Error('Hard-limit confirmation does not match the proposed update');
			}
			return result;
		},

		signal,
	});
	return fromHardLimitConfirmation(response.confirmation);
}

export async function confirmExecutionHardLimits(
	confirmation: HardLimitConfirmation,
	signal?: AbortSignal,
): Promise<ExecutionSettings> {
	const response = await requestAgentManagement({
		method: 'POST',
		path: ROOT + '/hard-limits/confirm',

		input: () => readAgentHardLimitConfirm({ confirmationId: confirmation.id }),

		maxRequestBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
		maxResponseBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,

		decode(value) {
			const result = readAgentExecutionSettingsResponse(value);
			if (
				result.settings.version !== confirmation.expectedVersion + 1 ||
				AGENT_EXECUTION_LIMIT_KEYS.some((key) => result.settings.hardLimits[key] !== confirmation.proposed[key])
			) {
				throw new Error('Hard-limit result does not match the confirmed update');
			}
			return result;
		},

		signal,
	});
	return fromExecutionSettings(response.settings);
}

export async function getExecutionModelChoices(signal?: AbortSignal): Promise<ExecutionModelChoice[]> {
	const response = await requestAgentManagement({
		method: 'GET',
		path: '/ai/providers',
		maxRequestBytes: AGENT_EXECUTION_SETTINGS_MAX_BYTES,
		maxResponseBytes: AGENT_PROVIDER_MAX_RESPONSE_BYTES,
		decode: readAgentProviderListResponse,
		signal,
	});
	return toExecutionModelChoices(response);
}
