import { ToolBatchExecutionUnknown } from './tool-batch-failure.js';
import type { ToolBatchResult } from './tool-batch-types.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';
import type { ToolJobResult } from './tool-job-types.js';
import type { ProjectDirectoryEntry, ProjectInstruction } from './tool-project-types.js';
import type { RemoteMachineOperations, RemoteMachineOperationScope } from '../../../remote/public.js';
import { RemoteMachineOperationError } from '../../../remote/public-errors.js';
import type { ToolOperationScope, ToolInput, ToolFileContent } from './tool-types.js';
import {
	AgentFailure,
	ToolOperationRefusal,
	ToolMutationAdmissionRefusal,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	aggregateToolFailures,
	isAgentDrainFailure,
} from '../../agent-failure.js';

export class ToolRemoteModel {
	constructor(private readonly operations: RemoteMachineOperations) {}

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
		input: Exclude<
			ToolInput,
			| { kind: 'plugin' }
			| { kind: 'connections' }
			| { kind: 'job' }
			| { kind: 'shell' }
			| { kind: 'collaboration' }
			| { kind: 'project' }
			| { kind: 'result' }
			| { kind: 'memory' }
			| { kind: 'browser_targets' }
			| { kind: 'acp_integrations' }
			| { kind: 'image_models' }
			| { kind: 'image_generate' }
			| { kind: 'artifact' }
			| { kind: 'deliver' }
			| { kind: 'checkpoint' }
			| { kind: 'host_diagnostics' }
			| { kind: 'mcp' }
			| { kind: 'mcp_discovery' }
			| { kind: 'browser' }
			| { kind: 'skill' }
			| { kind: 'acp_integration' }
		>,
		scope: ToolOperationScope,
	): Promise<string> {
		let validationFailure: unknown = null;
		let permissionFailure: unknown = null;

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
			if (input.kind === 'acp') {
				if (!scope.permission) {
					throw new AgentFailure('internal_failure');
				}
				const permission = scope.permission;
				const value = await this.operations.executeAcp(request, {
					argv: input.argv.map((arg) => arg),
					cwd: input.cwd,
					prompt: input.prompt,

					permission: async (value, signal) => {
						try {
							const response = await permission(
								{
									sessionId: value.sessionId,
									toolCallId: value.toolCallId,
									requestId: value.requestId,
									title: value.title,
									kind: value.kind,
									inputJson: value.inputJson,
								},
								signal,
							);
							return {
								decision: response.decision,

								delivered: async () => {
									try {
										await response.delivered();
									} catch (error) {
										permissionFailure = error;
										throw error;
									}
								},
							};
						} catch (error) {
							permissionFailure = error;
							throw error;
						}
					},
				});
				return JSON.stringify({ text: value.text, stopReason: value.stopReason });
			}
			if (input.kind === 'docker_inspect') {
				const values = await this.operations.inspectDockers(
					request,
					input.containerIds.map((id) => id),
				);
				return JSON.stringify({
					items: values.map((value, index) =>
						value
							? {
									index,
									containerId: value.containerId,
									state: value.state,
									image: value.image,
									fingerprint: value.fingerprint,
								}
							: { index, containerId: input.containerIds[index], failureCode: 'not_found' },
					),
				});
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
				return JSON.stringify({
					path: value.path,
					status: value.status,
					bytes: value.bytes,
					sha256: value.sha256,
				});
			}
			if (input.kind === 'diagnostics') {
				const value = await this.operations.diagnose(request);
				return JSON.stringify({
					generatedAt: value.generatedAt,
					cpuPercent: value.cpuPercent,
					memUsedBytes: value.memUsedBytes,
					memTotalBytes: value.memTotalBytes,
					diskUsedBytes: value.diskUsedBytes,
					diskTotalBytes: value.diskTotalBytes,
					loadAverage: value.loadAverage.map((number) => number),
				});
			}
			if (input.kind === 'read' || input.kind === 'list' || input.kind === 'inspect') {
				const items: Array<
					| { index: number; path: string; value: unknown }
					| { index: number; path: string; failureCode: 'not_found' | 'not_text' }
				> = [];
				let size = 128;
				for (let index = 0; index < input.paths.length; index++) {
					const path = input.paths[index];
					await validate();
					let item: (typeof items)[number];
					try {
						if (input.kind === 'read') {
							const value = await this.operations.readTextPage(request, {
								path,
								offset: input.offset,
								maxBytes: input.maxBytes,
							});
							item = {
								index,
								path,
								value: {
									path: value.path,
									text: value.text,
									bytes: value.bytes,
									sha256: value.sha256,
									pageSha256: value.pageSha256,
									sizeBytes: value.sizeBytes,
									offset: value.offset,
									nextOffset: value.nextOffset,
									fingerprint: value.fingerprint,
								},
							};
						} else if (input.kind === 'list') {
							const value = await this.operations.listPage(request, { path, after: input.after });
							item = {
								index,
								path,
								value: {
									nextAfter: value.nextAfter,
									fingerprint: value.fingerprint,
									entries: value.entries.map((entry) => ({
										name: entry.name,
										kind: entry.kind,
										size: entry.size,
										modifiedAt: entry.modifiedAt,
									})),
								},
							};
						} else {
							const value = await this.operations.inspectPath(request, path);
							item = {
								index,
								path,
								value: {
									path: value.path,
									kind: value.kind,
									fingerprint: value.fingerprint,
									fileCount: value.fileCount,
									directoryCount: value.directoryCount,
									bytes: value.bytes,
								},
							};
						}
					} catch (error) {
						if (
							!(error instanceof RemoteMachineOperationError) ||
							(error.code !== 'not_found' && error.code !== 'not_text')
						) {
							throw error;
						}
						item = { index, path, failureCode: error.code };
					}
					const bytes = Buffer.byteLength(JSON.stringify(item)) + 1;
					if (size + bytes > TOOL_RESULT_MAX_BYTES) {
						if (!items.length) {
							throw new AgentFailure('limit_exceeded');
						}
						return JSON.stringify({ items, nextIndex: index });
					}
					items.push(item);
					size += bytes;
				}
				return JSON.stringify({ items, nextIndex: null });
			}
			const value = await this.operations.search(
				request,
				input.path,
				input.queries.map((query) => query),
				input.maxResults,
			);
			return JSON.stringify({
				matches: value.matches.map((match) => ({
					queryIndex: match.queryIndex,
					path: match.path,
					line: match.line,
					column: match.column,
					text: match.text,
				})),
				truncated: value.truncated,
			});
		} catch (error) {
			if (error instanceof ToolBatchExecutionUnknown) {
				throw error;
			}
			this.failure(error, validationFailure, permissionFailure);
		}
	}

	private async batchMutations(
		input: Extract<ToolInput, { kind: 'write' | 'move' | 'delete' | 'docker_control' }>,
		request: RemoteMachineOperationScope,
	): Promise<string> {
		const results: ToolBatchResult[] = [];

		const knownFailure = (error: unknown) =>
			error instanceof RemoteMachineOperationError &&
			(error.code === 'not_found' ||
				error.code === 'not_text' ||
				error.code === 'conflict' ||
				error.code === 'command_failed' ||
				error.code === 'invalid_input' ||
				error.code === 'limit_exceeded')
				? error.code
				: null;

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

		const absent = async (path: string) => {
			try {
				await this.operations.inspectPath(request, path);
			} catch (error) {
				if (error instanceof RemoteMachineOperationError && error.code === 'not_found') {
					return;
				}
				throw error;
			}
			throw new RemoteMachineOperationError('conflict');
		};

		// Preflight the complete plan; individual execution still performs its own fingerprint checks.
		for (let index = 0; index < input.items.length; index++) {
			await request.validate();
			try {
				if (input.kind === 'write') {
					const item = input.items[index];
					if (item.expectedSha256 === 'absent') {
						await absent(item.path);
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
						await absent(input.items[index].destinationPath);
					}
				}
			} catch (error) {
				const code = knownFailure(error);
				if (code === null) {
					throw error;
				}
				return JSON.stringify({
					items: input.items.map((_, itemIndex) =>
						itemIndex === index
							? { index: itemIndex, status: 'failed', failureCode: code }
							: { index: itemIndex, status: 'not_started' },
					),
				});
			}
		}
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
				if (input.kind === 'write') {
					const item = input.items[index];
					const value = await this.operations.writeText(scope, {
						path: item.path,
						content: item.content,
						expectedSha256: item.expectedSha256,
					});
					results.push({
						index,
						status: 'completed',
						value: { path: value.path, status: value.status, bytes: value.bytes, sha256: value.sha256 },
					});
				} else if (input.kind === 'move') {
					const item = input.items[index];
					const value = await this.operations.movePath(scope, {
						path: item.path,
						destinationPath: item.destinationPath,
						expectedFingerprint: item.expectedFingerprint,
					});
					results.push({
						index,
						status: 'completed',
						value: {
							path: value.path,
							destinationPath: value.destinationPath,
							kind: value.kind,
							fingerprint: value.fingerprint,
						},
					});
				} else if (input.kind === 'delete') {
					const item = input.items[index];
					const value = await this.operations.deletePath(scope, {
						path: item.path,
						expectedFingerprint: item.expectedFingerprint,
						scope: item.scope,
					});
					results.push({
						index,
						status: 'completed',
						value: {
							path: value.path,
							kind: value.kind,
							fileCount: value.fileCount,
							directoryCount: value.directoryCount,
						},
					});
				} else {
					const item = input.items[index];
					const value = await this.operations.controlDocker(scope, {
						containerId: item.containerId,
						action: item.action,
						expectedFingerprint: item.expectedFingerprint,
					});
					results.push({
						index,
						status: 'completed',
						value: { containerId: value.containerId, action: value.action, state: value.state },
					});
				}
			} catch (error) {
				const code = knownFailure(error);
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
					if (failure instanceof ToolExecutionUnknown && !(failure instanceof ToolCleanupFailure)) {
						throw new ToolBatchExecutionUnknown(
							JSON.stringify({ failureCode: 'tool_result_unconfirmed', items: results }),
							failure,
						);
					}
					throw failure;
				}
			}
		}
		return JSON.stringify({ items: results });
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
		input: Extract<ToolInput, { kind: 'shell' }>,
		scope: ToolOperationScope,
		onOutput?: (index: number, stream: 'stdout' | 'stderr', text: string) => void,
	): Promise<Exclude<ToolJobResult, { status: 'not_started' }>> {
		return this.withOperation(scope, async (request) => {
			const value = await this.operations.executeCommand(request, {
				commands: input.commands.map((script) => ({ kind: 'shell', script })),
				cwd: input.cwd,
				onError: input.onError,

				onOutput: (index, stream, text) => onOutput?.(index, stream, text),
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

	async projectDirectory(path: string, scope: ToolOperationScope): Promise<ProjectDirectoryEntry[]> {
		return this.withOperation(scope, async (request) =>
			(await this.operations.list(request, path)).map((entry) => ({
				name: entry.name,
				kind: entry.kind,
				size: entry.size,
			})),
		);
	}

	async projectInstruction(path: string, scope: ToolOperationScope): Promise<ProjectInstruction> {
		return this.withOperation(scope, async (request) => {
			const value = await this.operations.readText(request, path);
			return { path: value.path, text: value.text, bytes: value.bytes, sha256: value.sha256 };
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

	private failure(error: unknown, validationFailure: unknown = null, permissionFailure: unknown = null): never {
		if (
			error instanceof AgentFailure ||
			error instanceof ToolOperationRefusal ||
			error instanceof ToolExecutionUnknown ||
			error instanceof ToolMutationAdmissionRefusal
		) {
			throw error;
		}
		if (
			permissionFailure !== null &&
			isAgentDrainFailure(permissionFailure) &&
			!(permissionFailure instanceof ToolExecutionUnknown)
		) {
			const cause = new AggregateError([permissionFailure, error], 'ACP permission and execution failed');
			if (error instanceof RemoteMachineOperationError && error.code === 'cleanup_failed') {
				throw new ToolCleanupFailure({ cause });
			}
			throw cause;
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
