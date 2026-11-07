import type {
	ToolRemoteTextPageInput,
	ToolRemoteListPageInput,
	ToolRemoteTextPageResult,
	ToolRemoteListPageResult,
} from './tool-remote-file-types.js';
import type { HostToolCommand } from './host-tool-command.js';
import { ToolBatchExecutionUnknown, ToolBatchCleanupFailure } from './tool-batch-failure.js';
import type { ToolBatchResult } from './tool-batch-types.js';
import type { HostOperationResult } from './host-operation-result.js';
import { posix } from 'node:path';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';
import type { ToolJobResult } from './tool-job-types.js';
import type { RemoteMachineOperations, RemoteMachineOperationScope } from '../../../remote/public.js';
import type { RemoteProcessRequest, RemoteProcessChannel } from '../../../remote/public.js';
import { RemoteMachineOperationError } from '../../../remote/public-errors.js';
import type { ToolOperationScope, ToolFileContent } from './tool-types.js';
import {
	AgentFailure,
	ToolOperationRefusal,
	ToolMutationAdmissionRefusal,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	aggregateToolFailures,
	isAgentDrainFailure,
} from '../../agent-failure.js';

type ToolRemoteModelResult = Extract<
	HostOperationResult,
	{
		operation:
			| 'docker.inspect'
			| 'docker.control'
			| 'remote.write'
			| 'remote.move'
			| 'remote.delete'
			| 'remote.patch'
			| 'remote.inspect'
			| 'remote.search'
			| 'diagnostics.readTarget';
	}
>;

function batchFailureCode(error: unknown) {
	return error instanceof RemoteMachineOperationError &&
		(error.code === 'not_found' ||
			error.code === 'not_text' ||
			error.code === 'conflict' ||
			error.code === 'command_failed' ||
			error.code === 'invalid_input' ||
			error.code === 'limit_exceeded')
		? error.code
		: null;
}

export class ToolRemoteModel {
	constructor(private readonly operations: RemoteMachineOperations) {}

	async withProcess(
		scope: ToolOperationScope,
		request: RemoteProcessRequest,
		consume: (channel: RemoteProcessChannel) => Promise<void>,
	): Promise<void> {
		try {
			return await this.operations.withProcess(
				{
					operationId: scope.operationId,
					targetId: scope.target.id,
					fingerprint: scope.target.fingerprint,
					timeoutMs: scope.timeoutMs,
					signal: scope.signal,
					validate: scope.validate,
				},
				{ argv: request.argv.map((arg) => arg), cwd: request.cwd, maxReadBytes: request.maxReadBytes },
				consume,
			);
		} catch (error) {
			return this.failure(error);
		}
	}

	snapshot(): {
		connections: number;
		files: number;
		operations: number;
		targets: number[];
		closing: boolean;
		cleanupFailed: boolean;
	} {
		const value = this.operations.snapshot();
		return {
			connections: value.sshConnections,
			files: value.sftpChannels,
			operations: value.activeOperations,
			targets: value.targetIds.map((id) => id),
			closing: value.closing,
			cleanupFailed: value.cleanupFailed,
		};
	}

	async close(): Promise<void> {
		try {
			await this.operations.close();
		} catch (error) {
			this.failure(error);
		}
	}

	async perform(
		input: Extract<
			HostToolCommand,
			{
				kind:
					| 'docker_inspect'
					| 'write'
					| 'move'
					| 'delete'
					| 'docker_control'
					| 'patch'
					| 'diagnostics'
					| 'inspect'
					| 'search';
			}
		>,
		scope: ToolOperationScope,
	): Promise<ToolRemoteModelResult> {
		let validationFailure: unknown = null;

		const validate = async () => {
			try {
				await scope.validate();
			} catch (error) {
				validationFailure = error;
				throw error;
			}
		};

		const request: RemoteMachineOperationScope = {
			operationId: scope.operationId,
			targetId: scope.target.id,
			fingerprint: scope.target.fingerprint,
			timeoutMs: scope.timeoutMs,
			signal: scope.signal,
			validate,
		};
		try {
			if (input.kind === 'docker_inspect') {
				try {
					const value = await this.operations.inspectDocker(request, input.containerId);
					await validate();
					return {
						operation: 'docker.inspect',
						value: {
							status: 'ok',
							value: {
								containerId: value.containerId,
								state: value.state,
								image: value.image,
								fingerprint: value.fingerprint,
							},
						},
					};
				} catch (error) {
					if (
						validationFailure === null &&
						error instanceof RemoteMachineOperationError &&
						error.code === 'not_found'
					) {
						return { operation: 'docker.inspect', value: { status: 'not_found' } };
					}
					throw error;
				}
			}
			if (
				input.kind === 'write' ||
				input.kind === 'move' ||
				input.kind === 'delete' ||
				input.kind === 'docker_control'
			) {
				return await this.batchMutations(input, request);
			}
			if (input.kind === 'patch') {
				const value = await this.operations.patchText(request, {
					path: input.path,
					expectedSha256: input.expectedSha256,
					edits: input.edits.map((edit) => ({ oldText: edit.oldText, newText: edit.newText })),
				});
				return {
					operation: 'remote.patch',
					value: {
						path: value.path,
						status: value.status,
						bytes: value.bytes,
						sha256: value.sha256,
					},
				};
			}
			if (input.kind === 'diagnostics') {
				const value = await this.operations.diagnose(request);
				return {
					operation: 'diagnostics.readTarget',
					value: {
						generatedAt: value.generatedAt,
						cpuPercent: value.cpuPercent,
						memUsedBytes: value.memUsedBytes,
						memTotalBytes: value.memTotalBytes,
						diskUsedBytes: value.diskUsedBytes,
						diskTotalBytes: value.diskTotalBytes,
						loadAverage: value.loadAverage.map((number) => number),
					},
				};
			}
			if (input.kind === 'inspect') {
				try {
					const value = await this.operations.inspectPath(request, input.path);
					await validate();
					return {
						operation: 'remote.inspect',
						value: {
							status: 'ok',
							value: {
								path: value.path,
								kind: value.kind,
								fingerprint: value.fingerprint,
								fileCount: value.fileCount,
								directoryCount: value.directoryCount,
								bytes: value.bytes,
							},
						},
					};
				} catch (error) {
					if (
						validationFailure === null &&
						error instanceof RemoteMachineOperationError &&
						(error.code === 'not_found' || error.code === 'not_text')
					) {
						return { operation: 'remote.inspect', value: { status: error.code } };
					}
					throw error;
				}
			}
			const value = await this.operations.search(
				request,
				input.path,
				input.queries.map((query) => query),
				input.maxResults,
			);
			return {
				operation: 'remote.search',
				value: {
					matches: value.matches.map((match) => ({
						queryIndex: match.queryIndex,
						path: match.path,
						line: match.line,
						column: match.column,
						text: match.text,
					})),
					truncated: value.truncated,
				},
			};
		} catch (error) {
			if (error instanceof ToolBatchExecutionUnknown) {
				throw error;
			}
			this.failure(error, validationFailure);
		}
	}

	async readTextPage(input: ToolRemoteTextPageInput, scope: ToolOperationScope): Promise<ToolRemoteTextPageResult> {
		let validationFailure: unknown = null;
		const request: RemoteMachineOperationScope = {
			operationId: scope.operationId,
			targetId: scope.target.id,
			fingerprint: scope.target.fingerprint,
			timeoutMs: scope.timeoutMs,
			signal: scope.signal,

			validate: async () => {
				try {
					await scope.validate();
				} catch (error) {
					validationFailure = error;
					throw error;
				}
			},
		};
		try {
			const value = await this.operations.readTextPage(request, {
				path: input.path,
				offset: input.offset,
				maxBytes: input.maxBytes,
			});
			await request.validate();
			return {
				status: 'ok',
				value: {
					path: value.path,
					text: value.text,
					bytes: value.bytes,
					sizeBytes: value.sizeBytes,
					offset: value.offset,
					nextOffset: value.nextOffset,
					sha256: value.sha256,
					pageSha256: value.pageSha256,
					fingerprint: value.fingerprint,
				},
			};
		} catch (error) {
			if (
				validationFailure === null &&
				error instanceof RemoteMachineOperationError &&
				(error.code === 'not_found' || error.code === 'not_text')
			) {
				return { status: error.code };
			}
			this.failure(error, validationFailure);
		}
	}

	async listPage(input: ToolRemoteListPageInput, scope: ToolOperationScope): Promise<ToolRemoteListPageResult> {
		let validationFailure: unknown = null;
		const request: RemoteMachineOperationScope = {
			operationId: scope.operationId,
			targetId: scope.target.id,
			fingerprint: scope.target.fingerprint,
			timeoutMs: scope.timeoutMs,
			signal: scope.signal,

			validate: async () => {
				try {
					await scope.validate();
				} catch (error) {
					validationFailure = error;
					throw error;
				}
			},
		};
		try {
			const value = await this.operations.listPage(request, { path: input.path, after: input.after });
			await request.validate();
			return {
				status: 'ok',
				value: {
					entries: value.entries.map((entry) => ({
						name: entry.name,
						kind: entry.kind,
						size: entry.size,
						modifiedAt: entry.modifiedAt,
					})),
					nextAfter: value.nextAfter,
					fingerprint: value.fingerprint,
				},
			};
		} catch (error) {
			if (
				validationFailure === null &&
				error instanceof RemoteMachineOperationError &&
				error.code === 'not_found'
			) {
				return { status: 'not_found' };
			}
			this.failure(error, validationFailure);
		}
	}

	private async batchMutations(
		input: Extract<HostToolCommand, { kind: 'write' | 'move' | 'delete' | 'docker_control' }>,
		request: RemoteMachineOperationScope,
	): Promise<
		Extract<
			ToolRemoteModelResult,
			{ operation: 'remote.write' | 'remote.move' | 'remote.delete' | 'docker.control' }
		>
	> {
		if (!input.items.length) {
			throw new AgentFailure('invalid_input');
		}
		if (input.kind === 'docker_control') {
			if (new Set(input.items.map((item) => item.containerId)).size !== input.items.length) {
				throw new AgentFailure('invalid_input');
			}
		} else {
			const paths: string[] = [];
			for (const item of input.items) {
				const itemPaths = 'destinationPath' in item ? [item.path, item.destinationPath] : [item.path];
				for (const path of itemPaths) {
					if (
						path === '/' ||
						!posix.isAbsolute(path) ||
						posix.normalize(path) !== path ||
						/[\u0000-\u001f\u007f]/u.test(path) ||
						paths.some(
							(other) => path === other || path.startsWith(other + '/') || other.startsWith(path + '/'),
						)
					) {
						throw new AgentFailure('invalid_input');
					}
					paths.push(path);
				}
			}
		}

		// Reserve all fixed per-item results before the first side effect.
		if (
			Buffer.byteLength(
				JSON.stringify(
					input.items.map((item, index) => ({
						index,
						status: 'completed',
						value:
							'containerId' in item
								? { containerId: item.containerId, action: item.action, state: 'x'.repeat(128) }
								: {
										path: item.path,
										destinationPath: 'destinationPath' in item ? item.destinationPath : '',
										status: 'replaced',
										kind: 'directory',
										fileCount: Number.MAX_SAFE_INTEGER,
										directoryCount: Number.MAX_SAFE_INTEGER,
										bytes: Number.MAX_SAFE_INTEGER,
										sha256: 'f'.repeat(64),
										fingerprint: 'f'.repeat(64),
									},
					})),
				),
			) +
				128 >
			TOOL_RESULT_MAX_BYTES
		) {
			throw new AgentFailure('limit_exceeded');
		}

		// Preflight the complete plan; individual execution still performs its own fingerprint checks.
		for (let index = 0; index < input.items.length; index++) {
			await request.validate();
			try {
				if (input.kind === 'write') {
					const item = input.items[index];
					if (item.expectedSha256 === 'absent') {
						await this.operations.assertMissingPath(request, item.path);
					} else if ((await this.operations.readText(request, item.path)).sha256 !== item.expectedSha256) {
						throw new RemoteMachineOperationError('conflict');
					}
				} else if (input.kind === 'docker_control') {
					const item = input.items[index];
					if (
						(await this.operations.inspectDocker(request, item.containerId)).fingerprint !==
						item.expectedFingerprint
					) {
						throw new RemoteMachineOperationError('conflict');
					}
				} else {
					const item = input.items[index];
					if (
						(await this.operations.inspectPath(request, item.path)).fingerprint !== item.expectedFingerprint
					) {
						throw new RemoteMachineOperationError('conflict');
					}
					if (input.kind === 'move') {
						await this.operations.assertMissingPath(request, input.items[index].destinationPath);
					}
				}
			} catch (error) {
				const code = batchFailureCode(error);
				if (code === null) {
					throw error;
				}
				const items: ToolBatchResult<never>[] = input.items.map((_, itemIndex) =>
					itemIndex === index
						? { index: itemIndex, status: 'failed', failureCode: code }
						: { index: itemIndex, status: 'not_started' },
				);
				if (input.kind === 'write') {
					return { operation: 'remote.write', value: { items } };
				}
				if (input.kind === 'move') {
					return { operation: 'remote.move', value: { items } };
				}
				if (input.kind === 'delete') {
					return { operation: 'remote.delete', value: { items } };
				}
				return { operation: 'docker.control', value: { items } };
			}
		}
		if (input.kind === 'write') {
			return {
				operation: 'remote.write',
				value: await this.executeMutations(input, request, async (scope, item) => {
					const value = await this.operations.writeText(scope, {
						path: item.path,
						content: item.content,
						expectedSha256: item.expectedSha256,
					});
					return { path: value.path, status: value.status, bytes: value.bytes, sha256: value.sha256 };
				}),
			};
		}
		if (input.kind === 'move') {
			return {
				operation: 'remote.move',
				value: await this.executeMutations(input, request, async (scope, item) => {
					const value = await this.operations.movePath(scope, {
						path: item.path,
						destinationPath: item.destinationPath,
						expectedFingerprint: item.expectedFingerprint,
					});
					return {
						path: value.path,
						destinationPath: value.destinationPath,
						kind: value.kind,
						fingerprint: value.fingerprint,
					};
				}),
			};
		}
		if (input.kind === 'delete') {
			return {
				operation: 'remote.delete',
				value: await this.executeMutations(input, request, async (scope, item) => {
					const value = await this.operations.deletePath(scope, {
						path: item.path,
						expectedFingerprint: item.expectedFingerprint,
						scope: item.scope,
					});
					return {
						path: value.path,
						kind: value.kind,
						fileCount: value.fileCount,
						directoryCount: value.directoryCount,
					};
				}),
			};
		}
		return {
			operation: 'docker.control',
			value: await this.executeMutations(input, request, async (scope, item) => {
				const value = await this.operations.controlDocker(scope, {
					containerId: item.containerId,
					action: item.action,
					expectedFingerprint: item.expectedFingerprint,
				});
				return { containerId: value.containerId, action: value.action, state: value.state };
			}),
		};
	}

	private async executeMutations<Item, Value>(
		input: { items: Item[]; onError: 'stop' | 'continue' },
		request: RemoteMachineOperationScope,
		execute: (scope: RemoteMachineOperationScope, item: Item) => Promise<Value>,
	): Promise<{ items: ToolBatchResult<Value>[] }> {
		const results: ToolBatchResult<Value>[] = [];

		let stopped = false;
		for (let index = 0; index < input.items.length; index++) {
			if (stopped) {
				results.push({ index, status: 'not_started' });
				continue;
			}
			const scope: RemoteMachineOperationScope = {
				operationId: request.operationId + ':' + index,
				targetId: request.targetId,
				fingerprint: request.fingerprint,
				timeoutMs: request.timeoutMs,
				signal: request.signal,

				validate: () => request.validate(),
			};
			try {
				await request.validate();
				const value = await execute(scope, input.items[index]);
				results.push({ index, status: 'completed', value });
			} catch (error) {
				const code = batchFailureCode(error);
				if (code !== null) {
					results.push({ index, status: 'failed', failureCode: code });
					stopped = input.onError === 'stop';
					continue;
				}
				// Retain known earlier results and leave the unresolved item fenced, never replay the group.
				results.push({ index, status: 'unknown' });
				for (let rest = index + 1; rest < input.items.length; rest++) {
					results.push({ index: rest, status: 'not_started' });
				}
				try {
					this.failure(error);
				} catch (failure) {
					if (failure instanceof ToolExecutionUnknown) {
						const Failure =
							failure instanceof ToolCleanupFailure ? ToolBatchCleanupFailure : ToolBatchExecutionUnknown;
						throw new Failure(
							JSON.stringify({ failureCode: 'tool_result_unconfirmed', items: results }),
							failure,
						);
					}
					throw failure;
				}
			}
		}
		return { items: results };
	}

	async fileInfo(path: string, scope: ToolOperationScope): Promise<ToolFileContent> {
		return this.withOperation(scope, async (request) => {
			const value = await this.operations.fileInfo(request, path);
			return { name: value.name, sizeBytes: value.sizeBytes };
		});
	}

	async consumeFile<T>(
		path: string,
		maxBytes: number,
		scope: ToolOperationScope,
		consume: (file: ToolFileContent, source: AsyncIterable<Uint8Array>) => Promise<T>,
	): Promise<T> {
		let consumerFailure: unknown = null;
		return this.withOperation(
			scope,
			(request) =>
				this.operations.consumeFile(request, path, maxBytes, async (file, source) => {
					const model = this;

					async function* content(): AsyncIterable<Uint8Array> {
						try {
							yield* source;
						} catch (error) {
							model.failure(error);
						}
					}

					try {
						return await consume({ name: file.name, sizeBytes: file.sizeBytes }, content());
					} catch (error) {
						consumerFailure = error;
						throw error;
					}
				}),
			() => consumerFailure,
		);
	}

	async command(
		input: Extract<HostToolCommand, { kind: 'shell' }>,
		scope: ToolOperationScope,
		onOutput?: (index: number, stream: 'stdout' | 'stderr', text: string, signal: AbortSignal) => Promise<void>,
	): Promise<Exclude<ToolJobResult, { status: 'not_started' }>> {
		return this.withOperation(scope, async (request) => {
			const value = await this.operations.executeCommand(request, {
				commands: input.commands.map((script) => ({ kind: 'shell', script })),
				cwd: input.cwd,
				onError: input.onError,

				onOutput: async (index, stream, text, signal) => onOutput?.(index, stream, text, signal),
			});
			return {
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
		});
	}

	private async withOperation<T>(
		scope: ToolOperationScope,
		work: (request: RemoteMachineOperationScope) => Promise<T>,
		getConsumerFailure?: () => unknown,
	): Promise<T> {
		let validationFailure: unknown = null;
		const request: RemoteMachineOperationScope = {
			operationId: scope.operationId,
			targetId: scope.target.id,
			fingerprint: scope.target.fingerprint,
			signal: scope.signal,
			timeoutMs: scope.timeoutMs,

			validate: async () => {
				try {
					await scope.validate();
				} catch (error) {
					validationFailure = error;
					throw error;
				}
			},
		};
		try {
			return await work(request);
		} catch (error) {
			const consumerFailure = getConsumerFailure?.() ?? null;
			if (consumerFailure !== null) {
				const failures: unknown[] = [consumerFailure];
				if (validationFailure !== null && validationFailure !== consumerFailure) {
					failures.push(validationFailure);
				}
				if (error instanceof RemoteMachineOperationError && error.code === 'cleanup_failed') {
					throw new ToolCleanupFailure({
						cause: new AggregateError([...failures, error], 'File import and remote cleanup failed'),
					});
				}
				if (failures.length > 1 && failures.some(isAgentDrainFailure)) {
					throw aggregateToolFailures(failures, 'File import and authority validation failed');
				}
				throw validationFailure ?? consumerFailure;
			}
			this.failure(error, validationFailure);
		}
	}

	private failure(error: unknown, validationFailure: unknown = null): never {
		if (
			error instanceof AgentFailure ||
			error instanceof ToolOperationRefusal ||
			error instanceof ToolExecutionUnknown ||
			error instanceof ToolMutationAdmissionRefusal
		) {
			throw error;
		}
		if (
			validationFailure !== null &&
			!(
				error instanceof RemoteMachineOperationError &&
				(error.code === 'cleanup_failed' || error.code === 'operation_unknown')
			)
		) {
			throw validationFailure;
		}
		if (error instanceof RemoteMachineOperationError) {
			if (error.code === 'mutation_busy' || error.code === 'mutation_blocked') {
				throw new ToolMutationAdmissionRefusal(error.code, { cause: error });
			}
			if (error.code === 'cleanup_failed') {
				throw new ToolCleanupFailure({
					cause:
						validationFailure === null
							? error
							: new AggregateError(
									[validationFailure, error],
									'Authorization and resource cleanup failed',
								),
				});
			}
			if (error.code === 'operation_unknown') {
				throw new ToolExecutionUnknown({
					cause:
						validationFailure === null
							? error
							: new AggregateError(
									[validationFailure, error],
									'Authorization and remote operation failed',
								),
				});
			}
			if (
				error.code === 'remote_unavailable' ||
				error.code === 'host_key_untrusted' ||
				error.code === 'not_text' ||
				error.code === 'not_found' ||
				error.code === 'forbidden' ||
				error.code === 'command_failed'
			) {
				throw new ToolOperationRefusal(error.code, { cause: error });
			}
			const code =
				error.code === 'limit_exceeded'
					? 'limit_exceeded'
					: error.code === 'conflict' || error.code === 'stale_target'
						? 'version_conflict'
						: 'invalid_input';
			throw new AgentFailure(code, {
				cause:
					validationFailure === null
						? error
						: new AggregateError([validationFailure, error], 'Tool authorization and operation failed'),
			});
		}
		throw new AgentFailure('internal_failure', { cause: error });
	}
}
