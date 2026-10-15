import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type { ToolJobStorage, StoredToolJob, StoredJobScope } from '../storage/tool-job-storage.js';
import type { ToolJob, ToolJobInput, ToolJobScope, ToolJobResult } from './tool-job-types.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';

function scope(value: ToolJobScope): StoredJobScope {
	return { userId: value.userId, appId: value.appId, runId: value.runId };
}

function commandResult(text: string): ToolJobResult {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (cause) {
		throw new AgentFailure('internal_failure', { cause });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AgentFailure('internal_failure');
	}
	if (!('status' in value)) {
		throw new AgentFailure('internal_failure');
	}
	if (value.status === 'not_started' && Object.keys(value).length === 1) {
		return { status: value.status };
	}
	if (
		(value.status !== 'completed' && value.status !== 'nonzero') ||
		!('exitCode' in value) ||
		typeof value.exitCode !== 'number' ||
		!Number.isSafeInteger(value.exitCode) ||
		value.exitCode < 0 ||
		(value.status === 'completed') !== (value.exitCode === 0) ||
		!('signal' in value) ||
		(value.signal !== null && typeof value.signal !== 'string') ||
		!('stdout' in value) ||
		typeof value.stdout !== 'string' ||
		!('stderr' in value) ||
		typeof value.stderr !== 'string' ||
		!('truncated' in value) ||
		typeof value.truncated !== 'boolean' ||
		Object.keys(value).length !== 6 ||
		Buffer.byteLength(value.stdout, 'utf8') + Buffer.byteLength(value.stderr, 'utf8') > 32 * 1024 + 4 ||
		(value.signal !== null && Buffer.byteLength(value.signal, 'utf8') > 128)
	) {
		throw new AgentFailure('internal_failure');
	}
	return {
		status: value.status,
		exitCode: value.exitCode,
		signal: value.signal,
		stdout: value.stdout,
		stderr: value.stderr,
		truncated: value.truncated,
	};
}

function fromStorage(value: StoredToolJob): ToolJob {
	const result = value.resultText === null ? null : commandResult(value.resultText);
	const terminal = value.state === 'completed' || value.state === 'failed';
	if (terminal !== (result !== null) || (value.state === 'completed') !== (result?.status === 'completed')) {
		throw new AgentFailure('internal_failure');
	}
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
		const resultText =
			result === null
				? null
				: JSON.stringify(
						result.status === 'not_started'
							? { status: result.status }
							: {
									status: result.status,
									exitCode: result.exitCode,
									signal: result.signal,
									stdout: result.stdout,
									stderr: result.stderr,
									truncated: result.truncated,
								},
					);
		if (resultText !== null && Buffer.byteLength(resultText, 'utf8') > TOOL_RESULT_MAX_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		return mutation(
			await agentStorage(() =>
				this.storage.change({
					scope: scope(value),
					id: value.id,
					expectedRevision: value.revision,
					state,
					resultText,
				}),
			),
		);
	}

	commandResult(text: string): Exclude<ToolJobResult, { status: 'not_started' }> {
		const result = commandResult(text);
		if (result.status === 'not_started') {
			throw new AgentFailure('internal_failure');
		}
		return result;
	}

	reconcile(): Promise<void> {
		return agentStorage(() => this.storage.reconcile());
	}
}
