import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type {
	ToolJobStorage,
	StoredToolJob,
	StoredJobScope,
	StoredToolJobResult,
} from '../storage/tool-job-storage.js';
import type { ToolJob, ToolJobInput, ToolJobScope, ToolJobResult } from './tool-job-types.js';

function scope(value: ToolJobScope): StoredJobScope {
	return { userId: value.userId, appId: value.appId, runId: value.runId };
}

function fromStoredResult(value: StoredToolJobResult): ToolJobResult {
	return value.status === 'not_started'
		? { status: value.status }
		: {
				status: value.status,
				exitCode: value.exitCode,
				signal: value.signal,
				stdout: value.stdout,
				stderr: value.stderr,
				truncated: value.truncated,
			};
}

function toStoredResult(value: ToolJobResult): StoredToolJobResult {
	return value.status === 'not_started'
		? { status: value.status }
		: {
				status: value.status,
				exitCode: value.exitCode,
				signal: value.signal,
				stdout: value.stdout,
				stderr: value.stderr,
				truncated: value.truncated,
			};
}

function fromStorage(value: StoredToolJob): ToolJob {
	const result = value.result === null ? null : fromStoredResult(value.result);
	return {
		id: value.id,
		userId: value.userId,
		appId: value.appId,
		runId: value.runId,
		connectionId: value.connectionId,
		targetVersion: value.targetVersion,
		fingerprint: value.fingerprint,
		policyRevision: value.policyRevision,
		state: value.state,
		revision: value.revision,
		result,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function mutation(value: StoredToolJob | 'version_conflict' | 'limit_exceeded'): ToolJob {
	if (typeof value === 'string') {
		throw new AgentFailure(value);
	}
	return fromStorage(value);
}

export class ToolJobModel {
	constructor(private readonly storage: ToolJobStorage) {}

	async create(value: ToolJobInput, maxHistory: number): Promise<ToolJob> {
		return mutation(
			await agentStorage(() =>
				this.storage.create({
					id: value.id,
					userId: value.userId,
					appId: value.appId,
					runId: value.runId,
					connectionId: value.connectionId,
					targetVersion: value.targetVersion,
					fingerprint: value.fingerprint,
					policyRevision: value.policyRevision,
					maxHistory,
				}),
			),
		);
	}

	async get(value: ToolJobScope, id: string): Promise<ToolJob | null> {
		const record = await agentStorage(() => this.storage.get(scope(value), id));
		return record === null ? null : fromStorage(record);
	}

	async list(value: ToolJobScope, connectionId: number, limit: number): Promise<ToolJob[]> {
		return (await agentStorage(() => this.storage.list(scope(value), connectionId, limit))).map(fromStorage);
	}

	async change(
		value: ToolJob,
		state: 'dispatched' | 'completed' | 'failed' | 'unknown',
		result: ToolJobResult | null,
	): Promise<ToolJob> {
		return mutation(
			await agentStorage(() =>
				this.storage.change({
					scope: scope(value),
					id: value.id,
					expectedRevision: value.revision,
					state,
					result: result === null ? null : toStoredResult(result),
				}),
			),
		);
	}

	reconcile(): Promise<void> {
		return agentStorage(() => this.storage.reconcile());
	}
}
