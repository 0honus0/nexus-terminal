import type { StoredRunAppExecution } from '../storage/run-storage.js';
import type { RunAppExecution } from './run-app-execution-types.js';
import type { StoredRun, StoredRunEvent, StoredFrozenInput } from '../storage/run-storage.js';
import type { AgentRun, AgentRunEvent, RunFrozenInput } from './run-types.js';

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

export function fromStoredAppExecution(value: StoredRunAppExecution): RunAppExecution {
	return value.kind === 'retired'
		? { kind: 'retired' }
		: {
				kind: 'plugin',
				package: {
					packageId: value.package.packageId,
					version: value.package.version,
					packageHash: value.package.packageHash,
					publisherKeyId: value.package.publisherKeyId,
				},
				codeDependencies: value.codeDependencies.map((dependency) => ({
					packageId: dependency.packageId,
					version: dependency.version,
					packageHash: dependency.packageHash,
					publisherKeyId: dependency.publisherKeyId,
				})),
				handler: value.handler,
			};
}

export function fromStoredFrozen(value: StoredFrozenInput): RunFrozenInput {
	return { appExecution: fromStoredAppExecution(value.appExecution), inputJson: value.inputJson };
}
