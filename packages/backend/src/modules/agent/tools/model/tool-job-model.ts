import { agentStorage } from '../../agent-storage-failure.js';
import { TextLogFailure } from '../../../../platform/blobs/text-log-store.js';
import type { TextLogStore } from '../../../../platform/blobs/text-log-store.js';
import type { ToolOutputPage, ToolOutputWriter } from './tool-job-types.js';
import { ToolCleanupFailure } from '../../agent-failure.js';
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
				commands: value.commands.map((item) =>
					item.status === 'not_started'
						? { index: item.index, status: item.status }
						: {
								index: item.index,
								status: item.status,
								exitCode: item.exitCode,
								signal: item.signal,
								stdout: item.stdout,
								stderr: item.stderr,
								truncated: item.truncated,
							},
				),
			};
}

function toStoredResult(value: ToolJobResult): StoredToolJobResult {
	return value.status === 'not_started'
		? { status: value.status }
		: {
				status: value.status,
				commands: value.commands.map((item) =>
					item.status === 'not_started'
						? { index: item.index, status: item.status }
						: {
								index: item.index,
								status: item.status,
								exitCode: item.exitCode,
								signal: item.signal,
								stdout: item.stdout,
								stderr: item.stderr,
								truncated: item.truncated,
							},
				),
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
	constructor(
		private readonly storage: ToolJobStorage,
		private readonly logs: TextLogStore,
	) {}

	async openOutput(id: string): Promise<ToolOutputWriter> {
		try {
			const writer = await this.logs.create(id);
			return {
				append: async (event, signal, blocked) => {
					try {
						await writer.append(
							{ tag: event.commandIndex * 2 + (event.stream === 'stderr' ? 1 : 0), text: event.text },
							signal,
							blocked,
						);
					} catch (cause) {
						throw new AgentFailure('internal_failure', { cause });
					}
				},

				flush: async (signal, blocked) => {
					try {
						await writer.flush(signal, blocked);
					} catch (cause) {
						throw new AgentFailure('internal_failure', { cause });
					}
				},

				close: async () => {
					try {
						await writer.close();
					} catch (cause) {
						throw new ToolCleanupFailure({ cause });
					}
				},
			};
		} catch (cause) {
			throw new AgentFailure('internal_failure', { cause });
		}
	}

	async output(id: string, offset: number, maxBytes: number): Promise<ToolOutputPage | null> {
		try {
			const page = await this.logs.read(id, offset, maxBytes);
			return {
				output: page.records.map((record) => ({
					commandIndex: Math.floor(record.tag / 2),
					stream: record.tag % 2 === 0 ? 'stdout' : 'stderr',
					text: record.text,
				})),
				nextOffset: page.nextOffset,
				capturedBytes: page.totalBytes,
			};
		} catch (cause) {
			if (cause instanceof TextLogFailure && cause.reason === 'not_found') {
				return null;
			}
			if (cause instanceof TextLogFailure && cause.reason === 'cleanup_failed') {
				throw new ToolCleanupFailure({ cause });
			}
			if (cause instanceof TextLogFailure && cause.reason === 'invalid_offset') {
				throw new AgentFailure('invalid_input', { cause });
			}
			throw new AgentFailure('internal_failure', { cause });
		}
	}

	async *outputKeys(): AsyncIterable<string> {
		try {
			for await (const id of this.logs.keys()) {
				yield id;
			}
		} catch (cause) {
			throw new ToolCleanupFailure({ cause });
		}
	}

	outputOwnerExists(id: string): Promise<boolean> {
		return agentStorage(() => this.storage.exists(id));
	}

	async removeOutput(id: string): Promise<void> {
		try {
			await this.logs.remove(id);
		} catch (cause) {
			throw new ToolCleanupFailure({ cause });
		}
	}

	async create(value: ToolJobInput, maxHistory: number): Promise<ToolJob> {
		return mutation(
			await agentStorage(() =>
				this.storage.create({
					id: value.id,
					operationHash: value.operationHash,
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

	async list(value: ToolJobScope, connectionId: number, limit: number, offset: number): Promise<ToolJob[]> {
		return (await agentStorage(() => this.storage.list(scope(value), connectionId, limit, offset))).map(
			fromStorage,
		);
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
