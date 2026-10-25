import type { ToolJobResult } from './tool-job-types.js';
import type { ProjectDirectoryEntry, ProjectInstruction } from './tool-project-types.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { HostDiagnostics } from '../../../system/public.js';
import { SystemOperationError } from '../../../system/public-errors.js';
import type {
	RemoteMachineOperations,
	RemoteMachineOperationScope,
	RemoteExecutionCommand,
} from '../../../remote/public.js';
import { RemoteMachineOperationError } from '../../../remote/public-errors.js';
import type { ToolTarget, ToolOperationScope, ToolInput } from './tool-types.js';
import type { ConnectionCatalog } from '../../../targets/public.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import {
	AgentFailure,
	ToolOperationRefusal,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	isAgentDrainFailure,
} from '../../agent-failure.js';
import type { ToolConnection } from './tool-types.js';

export class ToolModel {
	constructor(
		private readonly targets: ConnectionCatalog,
		private readonly resolver: TrustedSshTargetResolver,
		private readonly operations: RemoteMachineOperations,
		private readonly diagnostics: HostDiagnostics,
	) {}

	async hostDiagnostics(): Promise<string> {
		try {
			const value = await this.diagnostics.collect();
			return JSON.stringify({
				collectedAt: value.collectedAt,
				process: {
					uptimeSeconds: value.process.uptimeSeconds,
					residentBytes: value.process.residentBytes,
					heapUsedBytes: value.process.heapUsedBytes,
					runtimeVersion: value.process.runtimeVersion,
					heapTotalBytes: value.process.heapTotalBytes,
					externalBytes: value.process.externalBytes,
					arrayBufferBytes: value.process.arrayBufferBytes,
					cpuUserSeconds: value.process.cpuUserSeconds,
					cpuSystemSeconds: value.process.cpuSystemSeconds,
					gcCount: value.process.gcCount,
					gcDurationSeconds: value.process.gcDurationSeconds,
				},
				modules: value.modules.map((module) => ({
					id: module.id,
					status: module.status,
					metrics: module.metrics.map((metric) => ({
						name: metric.name,
						unit: metric.unit,
						value: metric.value,
					})),
				})),
				database: { available: value.database.available, schemaVersion: value.database.schemaVersion },
			});
		} catch (error) {
			if (error instanceof SystemOperationError) {
				throw new ToolOperationRefusal('remote_unavailable', { cause: error });
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async connections(ids: number[]): Promise<ToolConnection[]> {
		try {
			return (await this.targets.listEntries(ids.map((id) => id))).map((entry) => ({
				id: entry.id,
				version: entry.version,
				type: entry.type,
				name: entry.name,
				host: entry.host,
				port: entry.port,
				username: entry.username,
			}));
		} catch (error) {
			if (error instanceof TargetOperationError) {
				throw new AgentFailure(
					error.code === 'storage_unavailable' ? 'storage_unavailable' : 'internal_failure',
					{ cause: error },
				);
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async target(id: number): Promise<ToolTarget> {
		const before = (await this.connections([id]))[0];
		if (!before || before.type !== 'SSH') {
			throw new AgentFailure('not_found');
		}
		try {
			const fingerprint = await this.resolver.fingerprintStored(id);
			const after = (await this.connections([id]))[0];
			if (!after || after.type !== 'SSH' || before.version !== after.version) {
				throw new AgentFailure('version_conflict');
			}
			return { id, version: after.version, fingerprint };
		} catch (error) {
			if (error instanceof AgentFailure) {
				throw error;
			}
			if (error instanceof TargetOperationError) {
				const code =
					error.code === 'storage_unavailable'
						? 'storage_unavailable'
						: error.code === 'reference_not_found'
							? 'not_found'
							: error.code === 'unresolvable'
								? 'invalid_input'
								: error.code === 'conflict'
									? 'version_conflict'
									: 'internal_failure';
				throw new AgentFailure(code, { cause: error });
			}
			throw new AgentFailure('internal_failure', { cause: error });
		}
	}

	async validateTarget(target: ToolTarget): Promise<void> {
		const current = await this.target(target.id);
		if (current.version !== target.version || current.fingerprint !== target.fingerprint) {
			throw new AgentFailure('version_conflict');
		}
	}

	async perform(
		input: Exclude<
			ToolInput,
			| { kind: 'connections' }
			| { kind: 'job' }
			| { kind: 'collaboration' }
			| { kind: 'project' }
			| { kind: 'result' }
			| { kind: 'memory' }
			| { kind: 'image_models' }
			| { kind: 'image_generate' }
			| { kind: 'artifact' }
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
		if (input.kind === 'shell') {
			return JSON.stringify(await this.command(input, scope));
		}
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
				const value = await this.operations.inspectDocker(request, input.containerId);
				return JSON.stringify({
					containerId: value.containerId,
					state: value.state,
					image: value.image,
					fingerprint: value.fingerprint,
				});
			}
			if (input.kind === 'docker_control') {
				const value = await this.operations.controlDocker(request, {
					containerId: input.containerId,
					action: input.action,
					expectedFingerprint: input.expectedFingerprint,
				});
				return JSON.stringify({ containerId: value.containerId, action: value.action, state: value.state });
			}
			if (input.kind === 'inspect') {
				const value = await this.operations.inspectPath(request, input.path);
				return JSON.stringify({
					path: value.path,
					kind: value.kind,
					fingerprint: value.fingerprint,
					fileCount: value.fileCount,
					directoryCount: value.directoryCount,
					bytes: value.bytes,
				});
			}
			if (input.kind === 'patch') {
				const value = await this.operations.patchText(request, {
					path: input.path,
					expectedSha256: input.expectedSha256,
					oldText: input.oldText,
					newText: input.newText,
				});
				return JSON.stringify({
					path: value.path,
					status: value.status,
					bytes: value.bytes,
					sha256: value.sha256,
				});
			}
			if (input.kind === 'move') {
				const value = await this.operations.movePath(request, {
					path: input.path,
					destinationPath: input.destinationPath,
					expectedFingerprint: input.expectedFingerprint,
				});
				return JSON.stringify({
					path: value.path,
					destinationPath: value.destinationPath,
					kind: value.kind,
					fingerprint: value.fingerprint,
				});
			}
			if (input.kind === 'delete') {
				const value = await this.operations.deletePath(request, {
					path: input.path,
					expectedFingerprint: input.expectedFingerprint,
					scope: input.scope,
				});
				return JSON.stringify({
					path: value.path,
					kind: value.kind,
					fileCount: value.fileCount,
					directoryCount: value.directoryCount,
				});
			}
			if (input.kind === 'write') {
				const value = await this.operations.writeText(request, {
					path: input.path,
					content: input.content,
					expectedSha256: input.expectedSha256,
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
			if (input.kind === 'read') {
				const value = await this.operations.readText(request, input.path);
				return JSON.stringify({ path: value.path, text: value.text, bytes: value.bytes, sha256: value.sha256 });
			}
			if (input.kind === 'list') {
				const values = await this.operations.list(request, input.path);
				return JSON.stringify({
					path: input.path,
					entries: values.map((entry) => ({
						name: entry.name,
						kind: entry.kind,
						size: entry.size,
						modifiedAt: entry.modifiedAt,
					})),
				});
			}
			const value = await this.operations.search(request, input.path, input.query, input.maxResults);
			return JSON.stringify({
				matches: value.matches.map((match) => ({
					path: match.path,
					line: match.line,
					column: match.column,
					text: match.text,
				})),
				truncated: value.truncated,
			});
		} catch (error) {
			this.failure(error, validationFailure, permissionFailure);
		}
	}

	async command(
		input: Extract<ToolInput, { kind: 'shell' }>,
		scope: ToolOperationScope,
	): Promise<Exclude<ToolJobResult, { status: 'not_started' }>> {
		return this.withOperation(scope, async (request) => {
			const command: RemoteExecutionCommand =
				input.command.kind === 'argv'
					? { kind: 'argv', argv: input.command.argv.map((arg) => arg) }
					: { kind: 'shell', script: input.command.script };
			const value = await this.operations.executeCommand(request, { command, cwd: input.cwd });
			return {
				status: value.status,
				exitCode: value.exitCode,
				signal: value.signal,
				stdout: value.stdout,
				stderr: value.stderr,
				truncated: value.truncated,
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
			this.failure(error, validationFailure);
		}
	}

	private failure(error: unknown, validationFailure: unknown = null, permissionFailure: unknown = null): never {
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
				error.code === 'command_failed'
			) {
				throw new ToolOperationRefusal(error.code, { cause: error });
			}
			const code =
				error.code === 'limit_exceeded'
					? 'limit_exceeded'
					: error.code === 'not_found'
						? 'not_found'
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
