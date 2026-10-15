import type { ExecutionCommand } from './machines/model/operation-types.js';
import { RemoteMachineOperationError } from './public-errors.js';
import { RemoteFileFailure } from './files/model/file-types.js';
import { ObservationFailure } from './monitoring/model/observation-types.js';
import { RemoteHostKeyUntrustedError } from './machines/model/machine-errors.js';
import { RemoteResourceCleanupFailure } from './resource-errors.js';
import type { RemoteMachineOperationService } from './machines/service/operation-service.js';
import type { MachineOperationScope } from './machines/model/operation-types.js';
import type { RemoteMachineOperationScope, RemoteMachineOperations } from './public.js';

function scope(input: RemoteMachineOperationScope): MachineOperationScope {
	return {
		operationId: input.operationId,
		targetId: input.targetId,
		fingerprint: input.fingerprint,
		timeoutMs: input.timeoutMs,
		signal: input.signal,

		validate: () => input.validate(),
	};
}

async function boundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof RemoteResourceCleanupFailure) {
			throw new RemoteMachineOperationError('cleanup_failed');
		}
		if (error instanceof RemoteFileFailure) {
			throw new RemoteMachineOperationError(error.code);
		}
		if (error instanceof RemoteHostKeyUntrustedError) {
			throw new RemoteMachineOperationError('host_key_untrusted');
		}
		if (error instanceof ObservationFailure) {
			throw new RemoteMachineOperationError(
				error.code === 'command_failed'
					? 'command_failed'
					: error.code === 'operation_unknown'
						? 'operation_unknown'
						: error.code === 'host_key_untrusted'
							? 'host_key_untrusted'
							: error.code === 'conflict'
								? 'conflict'
								: error.code === 'not_found'
									? 'not_found'
									: error.code === 'limit_exceeded'
										? 'limit_exceeded'
										: 'remote_unavailable',
			);
		}
		throw new RemoteMachineOperationError('remote_unavailable');
	}
}

export function remoteOperations(service: RemoteMachineOperationService): RemoteMachineOperations {
	return {
		executeAcp: (input, request) =>
			boundary(async () => {
				const value = await service.executeAcp(scope(input), {
					argv: request.argv.map((arg) => arg),
					cwd: request.cwd,
					prompt: request.prompt,

					permission: async (value, signal) => {
						const response = await request.permission(
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

							delivered: () => response.delivered(),
						};
					},
				});
				return { text: value.text, stopReason: value.stopReason };
			}),

		executeCommand: (input, request) =>
			boundary(async () => {
				const command: ExecutionCommand =
					request.command.kind === 'argv'
						? { kind: 'argv', argv: request.command.argv.map((arg) => arg) }
						: { kind: 'shell', script: request.command.script };
				const value = await service.executeCommand(scope(input), { command, cwd: request.cwd });
				return {
					status: value.status,
					exitCode: value.exitCode,
					signal: value.signal,
					stdout: value.stdout,
					stderr: value.stderr,
					truncated: value.truncated,
				};
			}),

		inspectDocker: (input, containerId) =>
			boundary(async () => {
				const value = await service.inspectDocker(scope(input), containerId);
				return {
					containerId: value.containerId,
					state: value.state,
					image: value.image,
					fingerprint: value.fingerprint,
				};
			}),

		controlDocker: (input, request) =>
			boundary(async () => {
				const value = await service.controlDocker(scope(input), {
					containerId: request.containerId,
					action: request.action,
					expectedFingerprint: request.expectedFingerprint,
				});
				return { containerId: value.containerId, action: value.action, state: value.state };
			}),

		inspectPath: (input, path) =>
			boundary(async () => {
				const value = await service.inspectPath(scope(input), path);
				return {
					path: value.path,
					kind: value.kind,
					fingerprint: value.fingerprint,
					fileCount: value.fileCount,
					directoryCount: value.directoryCount,
					bytes: value.bytes,
				};
			}),

		patchText: (input, request) =>
			boundary(async () => {
				const value = await service.patchText(scope(input), {
					path: request.path,
					expectedSha256: request.expectedSha256,
					oldText: request.oldText,
					newText: request.newText,
				});
				return { path: value.path, status: value.status, bytes: value.bytes, sha256: value.sha256 };
			}),

		movePath: (input, request) =>
			boundary(async () => {
				const value = await service.movePath(scope(input), {
					path: request.path,
					destinationPath: request.destinationPath,
					expectedFingerprint: request.expectedFingerprint,
				});
				return {
					path: value.path,
					destinationPath: value.destinationPath,
					kind: value.kind,
					fingerprint: value.fingerprint,
				};
			}),

		deletePath: (input, request) =>
			boundary(async () => {
				const value = await service.deletePath(scope(input), {
					path: request.path,
					expectedFingerprint: request.expectedFingerprint,
					scope: request.scope,
				});
				return {
					path: value.path,
					kind: value.kind,
					fileCount: value.fileCount,
					directoryCount: value.directoryCount,
				};
			}),

		writeText: (input, request) =>
			boundary(async () => {
				const value = await service.writeText(scope(input), {
					path: request.path,
					content: request.content,
					expectedSha256: request.expectedSha256,
				});
				return { path: value.path, status: value.status, bytes: value.bytes, sha256: value.sha256 };
			}),

		readText: (input, path) =>
			boundary(async () => {
				const value = await service.readText(scope(input), path);
				return { path: value.path, text: value.text, bytes: value.bytes, sha256: value.sha256 };
			}),

		list: (input, path) =>
			boundary(async () =>
				(await service.list(scope(input), path)).map((entry) => ({
					name: entry.name,
					kind: entry.kind,
					size: entry.size,
					modifiedAt: entry.modifiedAt,
				})),
			),

		search: (input, path, query, maxResults) =>
			boundary(async () => {
				const value = await service.search(scope(input), path, query, maxResults);
				return {
					matches: value.matches.map((match) => ({
						path: match.path,
						line: match.line,
						column: match.column,
						text: match.text,
					})),
					truncated: value.truncated,
				};
			}),

		diagnose: (input) =>
			boundary(async () => {
				const value = await service.diagnose(scope(input));
				return {
					generatedAt: value.generatedAt,
					cpuPercent: value.cpuPercent,
					memUsedBytes: value.memUsedBytes,
					memTotalBytes: value.memTotalBytes,
					diskUsedBytes: value.diskUsedBytes,
					diskTotalBytes: value.diskTotalBytes,
					loadAverage: value.loadAverage.map((number) => number),
				};
			}),
	};
}
