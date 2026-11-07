import type { ExecutionCommand } from './machines/model/operation-types.js';
import { RemoteMachineOperationError } from './public-errors.js';
import { RemoteFileFailure } from './files/model/file-types.js';
import { ObservationFailure } from './monitoring/model/observation-types.js';
import { RemoteHostKeyUntrustedError } from './machines/model/machine-errors.js';
import { RemoteResourceCleanupFailure } from './resource-errors.js';
import { MachineMutationAdmissionFailure } from './machines/model/mutation-types.js';
import type { RemoteMachineOperationService } from './machines/service/operation-service.js';
import type { MachineOperationScope } from './machines/model/operation-types.js';
import type { RemoteMachineOperationScope, RemoteMachineOperations } from './public.js';
import type { RemoteMachineOperationFactory } from './public.js';
import type { RemoteMachineOperationFactoryService } from './machines/service/operation-factory-service.js';

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

function operationFailure(error: unknown): never {
	if (error instanceof RemoteResourceCleanupFailure) {
		throw new RemoteMachineOperationError('cleanup_failed');
	}
	if (error instanceof MachineMutationAdmissionFailure) {
		throw new RemoteMachineOperationError(error.reason === 'blocked' ? 'mutation_blocked' : 'mutation_busy');
	}
	if (error instanceof RemoteFileFailure) {
		throw new RemoteMachineOperationError(error.code);
	}
	if (error instanceof RemoteHostKeyUntrustedError) {
		throw new RemoteMachineOperationError('host_key_untrusted');
	}
	if (error instanceof ObservationFailure) {
		switch (error.code) {
			case 'command_failed':
			case 'operation_unknown':
			case 'host_key_untrusted':
			case 'conflict':
			case 'not_found':
			case 'limit_exceeded':
				throw new RemoteMachineOperationError(error.code);
			default:
				throw new RemoteMachineOperationError('remote_unavailable');
		}
	}
	throw new RemoteMachineOperationError('remote_unavailable');
}

async function boundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		operationFailure(error);
	}
}

/** Stream reads and iterator cleanup cross the same boundary as the initial request. */
async function* fileContent(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
	try {
		yield* source;
	} catch (error) {
		operationFailure(error);
	}
}

export function remoteOperationFactory(factory: RemoteMachineOperationFactoryService): RemoteMachineOperationFactory {
	return {
		create: (changed) => {
			try {
				const service = factory.create(changed);
				return remoteOperations(service, () => factory.release(service));
			} catch (error) {
				operationFailure(error);
			}
		},
	};
}

export function remoteOperations(
	service: RemoteMachineOperationService,
	close: () => Promise<void>,
): RemoteMachineOperations {
	return {
		snapshot: () => {
			const value = service.snapshot();
			return {
				sshConnections: value.connections,
				sftpChannels: value.files,
				activeOperations: value.active,
				targetIds: value.targetIds.map((id) => id),
				closing: value.closing,
				cleanupFailed: value.cleanupFailed,
			};
		},

		close: () => boundary(close),

		withProcess: (input, request, consume) =>
			boundary(() =>
				service.withProcess(
					scope(input),
					{
						argv: request.argv.map((arg) => arg),
						cwd: request.cwd,
						maxReadBytes: request.maxReadBytes,
					},
					(channel) =>
						consume({
							read: (stream, maxBytes) => boundary(() => channel.read(stream, maxBytes)),

							write: (bytes) => boundary(() => channel.write(bytes)),

							end: () => boundary(() => channel.end()),

							outcome: () => boundary(() => channel.outcome()),

							cancel: () => {
								try {
									channel.cancel();
								} catch (error) {
									operationFailure(error);
								}
							},

							close: () => boundary(() => channel.close()),
						}),
				),
			),

		executeCommand: (input, request) =>
			boundary(async () => {
				const commands: ExecutionCommand[] = request.commands.map((command) =>
					command.kind === 'argv'
						? { kind: 'argv', argv: command.argv.map((arg) => arg) }
						: { kind: 'shell', script: command.script },
				);
				const value = await service.executeCommand(scope(input), {
					commands,
					cwd: request.cwd,
					onError: request.onError,

					onOutput: async (index, stream, text, signal) => request.onOutput?.(index, stream, text, signal),
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
			}),

		inspectDockers: (input, ids) =>
			boundary(async () =>
				(
					await service.inspectDockers(
						scope(input),
						ids.map((id) => id),
					)
				).map((value) =>
					value === null
						? null
						: {
								containerId: value.containerId,
								state: value.state,
								image: value.image,
								fingerprint: value.fingerprint,
							},
				),
			),

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

		assertMissingPath: (input, path) => boundary(() => service.assertMissingPath(scope(input), path)),

		patchText: (input, request) =>
			boundary(async () => {
				const value = await service.patchText(scope(input), {
					path: request.path,
					expectedSha256: request.expectedSha256,
					edits: request.edits.map((edit) => ({ oldText: edit.oldText, newText: edit.newText })),
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

		fileInfo: (input, path) =>
			boundary(async () => {
				const value = await service.fileInfo(scope(input), path);
				return { path: value.path, name: value.name, sizeBytes: value.sizeBytes };
			}),

		consumeFile: (input, path, maxBytes, consume) =>
			boundary(() =>
				service.consumeFile(scope(input), path, maxBytes, (file, source) =>
					consume(
						{
							path: file.path,
							name: file.name,
							sizeBytes: file.sizeBytes,
						},
						fileContent(source),
					),
				),
			),

		readTextPage: (input, request) =>
			boundary(async () => {
				const value = await service.readTextPage(scope(input), {
					path: request.path,
					offset: request.offset,
					maxBytes: request.maxBytes,
				});
				return {
					path: value.path,
					text: value.text,
					bytes: value.bytes,
					sizeBytes: value.sizeBytes,
					offset: value.offset,
					nextOffset: value.nextOffset,
					sha256: value.sha256,
					pageSha256: value.pageSha256,
					fingerprint: value.fingerprint,
				};
			}),

		listPage: (input, request) =>
			boundary(async () => {
				const value = await service.listPage(scope(input), { path: request.path, after: request.after });
				return {
					entries: value.entries.map((entry) => ({
						name: entry.name,
						kind: entry.kind,
						size: entry.size,
						modifiedAt: entry.modifiedAt,
					})),
					nextAfter: value.nextAfter,
					fingerprint: value.fingerprint,
				};
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

		search: (input, path, queries, maxResults) =>
			boundary(async () => {
				const value = await service.search(
					scope(input),
					path,
					queries.map((query) => query),
					maxResults,
				);
				return {
					matches: value.matches.map((match) => ({
						queryIndex: match.queryIndex,
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
