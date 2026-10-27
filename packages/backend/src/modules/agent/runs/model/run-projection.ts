import type { StoredRun, StoredRunEvent, StoredFrozenInput } from '../storage/run-storage.js';
import type { AgentRun, AgentRunEvent, RunFrozenInput } from './run-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { fromStoredModel, toStoredModel } from '../../providers/model/provider-projection.js';

export function fromStoredRun(value: StoredRun): AgentRun {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		approvalMode: value.approvalMode,
		status: value.status,
		failure: null,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromStoredEvent(value: StoredRunEvent): AgentRunEvent {
	return {
		runId: value.runId,
		sequence: value.sequence,
		type: value.type,
		runVersion: value.runVersion,
		createdAt: value.createdAt,
	};
}

export function fromStoredFrozen(value: StoredFrozenInput): RunFrozenInput {
	const capabilities = fromStoredModel(value.capabilities);
	if (value.protocol !== 'images' && capabilities.maxOutputTokens === undefined) {
		throw new AgentFailure('provider_unavailable');
	}
	return {
		providerId: value.providerId,
		providerVersion: value.providerVersion,
		credentialRevision: value.credentialRevision,
		modelId: value.modelId,
		baseUrl: value.baseUrl,
		protocol: value.protocol,
		capabilities,
		executionPolicy: value.executionPolicy,
	};
}

export function toStoredFrozen(value: RunFrozenInput): StoredFrozenInput {
	return {
		providerId: value.providerId,
		providerVersion: value.providerVersion,
		credentialRevision: value.credentialRevision,
		modelId: value.modelId,
		baseUrl: value.baseUrl,
		protocol: value.protocol,
		capabilities: toStoredModel(value.capabilities),
		executionPolicy: value.executionPolicy,
	};
}
