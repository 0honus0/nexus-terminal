import type { MachineProcessChannel, MachineProcessRequest } from '../model/operation-types.js';
import type {
	ReadTextPageRequest,
	ReadTextPageResult,
	ReadDirectoryPageRequest,
	ReadDirectoryPageResult,
} from '../model/operation-types.js';
import { inspectTextPage, inspectDirectoryPage } from '../../files/service/file-inspection.js';
import type { MachineMutationService } from './mutation-service.js';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import { REMOTE_FILE_MAX_PATH_BYTES } from '@nexus-terminal/shared/remote/files/values';
import { createHash, randomUUID } from 'node:crypto';
import type { MachineCommandModel } from '../model/command-model.js';
import type { RemoteMachineScopeModel } from '../model/machine-scope-model.js';
import type {
	MachineResourceSnapshot,
	ExecuteCommandRequest,
	ExecuteCommandResult,
	DockerInspection,
	DockerControlRequest,
	DockerControlResult,
} from '../model/operation-types.js';
import { ObservationFailure } from '../../monitoring/model/observation-types.js';
import { capturePath, requireMissingPath } from '../../files/service/file-snapshot.js';
import { patchInspectedText, moveInspectedPath, deleteInspectedPath } from '../../files/service/file-mutation.js';
import type {
	InspectPathResult,
	PatchTextRequest,
	MovePathRequest,
	MovePathResult,
	DeletePathRequest,
	DeletePathResult,
} from '../model/operation-types.js';
import { writeInspectedText } from '../../files/service/file-write.js';
import type { WriteTextRequest, WriteTextResult } from '../model/operation-types.js';
import type { RemoteFileModel } from '../../files/model/file-model.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import type { FileResource } from '../../files/model/file-types.js';
import type { ObservationModel } from '../../monitoring/model/observation-model.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	consumeInspectedFile,
	inspectInfo,
	inspectionPath,
	inspectText,
	inspectDirectory,
	inspectSearch,
} from '../../files/service/file-inspection.js';
import type {
	MachineOperationScope,
	FileContent,
	ReadTextResult,
	ReadEntry,
	ReadSearchResult,
	ReadDiagnostics,
	FileInspectionContext,
} from '../model/operation-types.js';

function validateCommand(input: {
	command: import('../model/operation-types.js').ExecutionCommand;
	cwd: string | null;
}): void {
	const args = input.command.kind === 'argv' ? input.command.argv : [input.command.script];
	const invalidProgram =
		input.command.kind === 'argv' && (!input.command.argv[0] || input.command.argv[0].startsWith('-'));
	const invalidContent =
		!args.length ||
		args.some((text) => !isWellFormedFileText(text) || text.includes('\0')) ||
		(input.command.kind === 'shell' && !input.command.script);
	const cwd = input.cwd;
	const invalidDirectory =
		cwd !== null &&
		(!cwd.startsWith('/') ||
			cwd.split('/').includes('..') ||
			/[\u0000-\u001f\u007f]/u.test(cwd) ||
			!isWellFormedFileText(cwd) ||
			Buffer.byteLength(cwd, 'utf8') > REMOTE_FILE_MAX_PATH_BYTES);
	if (invalidProgram || invalidContent || invalidDirectory) {
		throw new RemoteFileFailure('invalid_input');
	}
}

/** Independent machine operations never claim ordinary Workspace or Files attachments. */
export class RemoteMachineOperationService {
	private closing = false;
	private cleanupFailed = false;
	private closePromise: Promise<void> | null = null;
	private readonly tasks = new Map<AbortController, Promise<unknown>>();
	private readonly cleanupFailures: unknown[] = [];
	private readonly idleFiles = new Map<string, { targetId: number; resources: FileResource[] }>();
	private readonly retainedFiles = new Set<FileResource>();

	constructor(
		private readonly files: RemoteFileModel,
		private readonly observations: ObservationModel,
		private readonly commands: MachineCommandModel,
		private readonly mutations: MachineMutationService,
		private readonly machines: RemoteMachineScopeModel,
		private readonly changed: () => void = () => {},
	) {}

	snapshot(): MachineResourceSnapshot {
		const machines = this.machines.snapshot();
		return {
			connections: machines.connections,
			targetIds: machines.targetIds.map((id) => id),
			files: this.retainedFiles.size,
			active: this.tasks.size,
			closing: this.closing,
			cleanupFailed: this.cleanupFailed || this.cleanupFailures.length > 0 || machines.cleanupFailed,
		};
	}

	private admitted<T>(
		scope: MachineOperationScope,
		work: (signal: AbortSignal, remaining: () => number, validate: () => Promise<void>) => Promise<T>,
		mutation = false,
		validateResult = true,
	): Promise<T> {
		if (this.closing || this.cleanupFailures.length >= 8) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		if (
			!scope.operationId ||
			scope.operationId.length > 128 ||
			!Number.isSafeInteger(scope.targetId) ||
			scope.targetId < 1 ||
			!scope.fingerprint ||
			!Number.isSafeInteger(scope.timeoutMs) ||
			scope.timeoutMs < 1 ||
			// Node timers cannot represent a longer deadline; policy belongs to the caller.
			scope.timeoutMs > 2_147_483_647
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		const controller = new AbortController();

		const cancel = () => controller.abort();

		const deadline = Date.now() + scope.timeoutMs;
		scope.signal.addEventListener('abort', cancel, { once: true });
		if (scope.signal.aborted) {
			cancel();
		}
		const timer = setTimeout(cancel, scope.timeoutMs);

		const remaining = () => {
			controller.signal.throwIfAborted();
			const milliseconds = deadline - Date.now();
			if (milliseconds < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return milliseconds;
		};

		const validate = async () => {
			remaining();
			await scope.validate();
			remaining();
		};

		const pending = Promise.resolve().then(async () => {
			try {
				await validate();

				const execute = async () => {
					const result = await work(controller.signal, remaining, validate);
					try {
						if (validateResult) {
							await validate();
						}
					} catch (cause) {
						if (mutation) {
							throw new RemoteFileFailure('operation_unknown', { cause });
						}
						throw cause;
					}
					return result;
				};

				const result = mutation
					? await this.mutations.run(
							scope.operationId,
							'agent',
							[{ targetId: scope.targetId, fingerprint: scope.fingerprint }],
							execute,
						)
					: await execute();
				return result;
			} catch (error) {
				if (error instanceof RemoteResourceCleanupFailure) {
					this.cleanupFailures.push(error);
				}
				throw error;
			} finally {
				clearTimeout(timer);
				scope.signal.removeEventListener('abort', cancel);
				this.tasks.delete(controller);
				this.changed();
			}
		});
		this.tasks.set(controller, pending);
		this.changed();
		return pending;
	}

	private withFiles<T>(
		scope: MachineOperationScope,
		work: (context: FileInspectionContext) => Promise<T>,
		mutation = false,
		validateResult = true,
	): Promise<T> {
		return this.admitted(
			scope,
			async (signal, remaining, validate) => {
				let resource: FileResource | null = null;
				let failure: unknown = null;
				let reusable = false;
				let key = '';
				try {
					key = await this.machines.key({
						targetId: scope.targetId,
						expectedFingerprint: scope.fingerprint,
						timeoutMs: remaining(),
						signal,
						validate,
					});
					const stale = [...this.idleFiles].filter(
						([cachedKey, entry]) => entry.targetId === scope.targetId && cachedKey !== key,
					);
					const closed = await Promise.allSettled(
						stale.flatMap(([cachedKey, entry]) => {
							this.idleFiles.delete(cachedKey);
							return entry.resources.map((file) => Promise.resolve().then(() => this.closeFile(file)));
						}),
					);
					const failures = closed.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
					if (failures.length) {
						throw new RemoteResourceCleanupFailure(failures);
					}
					resource = this.idleFiles.get(key)?.resources.pop() ?? null;
					while (resource && !resource.isOpen) {
						const expired = resource;
						resource = null;
						await this.closeFile(expired);
						resource = this.idleFiles.get(key)?.resources.pop() ?? null;
					}
					resource ??= await this.files.open(
						scope.targetId,
						remaining(),
						signal,
						scope.fingerprint,
						validate,
					);
					this.retainedFiles.add(resource);
					await validate();
					if (!resource.isOpen) {
						throw new RemoteFileFailure('remote_unavailable');
					}
					const result = await work({ resource, signal, remaining, validate });
					await validate();
					reusable = resource.isOpen;
					return result;
				} catch (error) {
					failure = error;
					throw error;
				} finally {
					if (resource) {
						try {
							if (reusable && !this.closing) {
								let cached = this.idleFiles.get(key);
								if (!cached) {
									cached = { targetId: scope.targetId, resources: [] };
									this.idleFiles.set(key, cached);
								}
								cached.resources.push(resource);
							} else {
								await this.closeFile(resource);
							}
						} catch (cleanup) {
							throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
						}
					}
				}
			},
			mutation,
		);
	}

	private async closeFile(resource: FileResource): Promise<void> {
		await resource.close();
		this.retainedFiles.delete(resource);
	}

	writeText(scope: MachineOperationScope, request: WriteTextRequest): Promise<WriteTextResult> {
		return this.withFiles(scope, (context) => writeInspectedText(context, request), true);
	}

	inspectPath(scope: MachineOperationScope, path: string): Promise<InspectPathResult> {
		return this.withFiles(scope, async (context) => {
			const value = await capturePath(context, path);
			return {
				path: value.path,
				kind: value.kind,
				fingerprint: value.fingerprint,
				fileCount: value.fileCount,
				directoryCount: value.directoryCount,
				bytes: value.bytes,
			};
		});
	}

	assertMissingPath(scope: MachineOperationScope, path: string): Promise<void> {
		return this.withFiles(scope, (context) => requireMissingPath(context, path));
	}

	patchText(scope: MachineOperationScope, request: PatchTextRequest): Promise<WriteTextResult> {
		return this.withFiles(scope, (context) => patchInspectedText(context, request), true);
	}

	movePath(scope: MachineOperationScope, request: MovePathRequest): Promise<MovePathResult> {
		return this.withFiles(scope, (context) => moveInspectedPath(context, request), true);
	}

	deletePath(scope: MachineOperationScope, request: DeletePathRequest): Promise<DeletePathResult> {
		return this.withFiles(scope, (context) => deleteInspectedPath(context, request), true);
	}

	fileInfo(scope: MachineOperationScope, path: string): Promise<FileContent> {
		return this.withFiles(scope, async (context) => {
			const requested = inspectionPath(path);
			const info = await inspectInfo(context, requested);
			if (info.kind !== 'file') {
				throw new RemoteFileFailure('invalid_input');
			}
			return { path: requested, name: requested.slice(requested.lastIndexOf('/') + 1), sizeBytes: info.size };
		});
	}

	consumeFile<T>(
		scope: MachineOperationScope,
		path: string,
		maxBytes: number,
		consume: (file: FileContent, source: AsyncIterable<Uint8Array>) => Promise<T>,
	): Promise<T> {
		return this.withFiles(scope, (context) => consumeInspectedFile(context, path, maxBytes, consume));
	}

	readTextPage(scope: MachineOperationScope, request: ReadTextPageRequest): Promise<ReadTextPageResult> {
		return this.withFiles(scope, (context) => inspectTextPage(context, request));
	}

	listPage(scope: MachineOperationScope, request: ReadDirectoryPageRequest): Promise<ReadDirectoryPageResult> {
		return this.withFiles(scope, (context) => inspectDirectoryPage(context, request));
	}

	readText(scope: MachineOperationScope, path: string): Promise<ReadTextResult> {
		return this.withFiles(scope, (context) => inspectText(context, path));
	}

	list(scope: MachineOperationScope, path: string): Promise<ReadEntry[]> {
		return this.withFiles(scope, async (context) =>
			(await inspectDirectory(context, path)).map((entry) => ({
				name: entry.name,
				kind: entry.info.kind,
				size: entry.info.size,
				modifiedAt: entry.info.modifiedAt,
			})),
		);
	}

	search(
		scope: MachineOperationScope,
		path: string,
		queries: string[],
		maxResults: number,
	): Promise<ReadSearchResult> {
		return this.withFiles(scope, (context) => inspectSearch(context, path, queries, maxResults));
	}

	diagnose(scope: MachineOperationScope): Promise<ReadDiagnostics> {
		return this.admitted(scope, async (signal, _remaining, validate) => {
			const key = 'read:' + randomUUID();
			try {
				return await this.observations.diagnose(
					{ targetId: scope.targetId, fingerprint: scope.fingerprint, signal, validate },
					key,
				);
			} finally {
				this.observations.clear(key);
			}
		});
	}

	withProcess(
		scope: MachineOperationScope,
		input: MachineProcessRequest,
		consume: (channel: MachineProcessChannel) => Promise<void>,
	): Promise<void> {
		validateCommand({ command: { kind: 'argv', argv: input.argv }, cwd: input.cwd });
		if (!Number.isSafeInteger(input.maxReadBytes) || input.maxReadBytes < 1) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.admitted(
			scope,
			(signal, remaining, validate) =>
				this.commands.withProcess(
					{
						operationId: scope.operationId,
						targetId: scope.targetId,
						fingerprint: scope.fingerprint,
						timeoutMs: remaining(),
						signal,
						validate,
					},
					input,
					consume,
				),
			true,
			false,
		);
	}

	executeCommand(scope: MachineOperationScope, input: ExecuteCommandRequest): Promise<ExecuteCommandResult> {
		if (!input.commands.length || (input.onError !== 'stop' && input.onError !== 'continue')) {
			throw new RemoteFileFailure('invalid_input');
		}
		for (const command of input.commands) {
			validateCommand({ command, cwd: input.cwd });
		}
		return this.admitted(
			scope,
			(signal, remaining, validate) =>
				this.commands.execute(
					{
						operationId: scope.operationId,
						targetId: scope.targetId,
						fingerprint: scope.fingerprint,
						timeoutMs: remaining(),
						signal,
						validate,
					},
					input,
					32 * 1024,
				),
			true,
		);
	}

	private async dockerInspection(scope: MachineOperationScope, containerId: string): Promise<DockerInspection> {
		if (!/^[a-f0-9]{64}$/.test(containerId)) {
			throw new RemoteFileFailure('invalid_input');
		}
		const value = await this.observations.inspectDocker(scope, containerId);
		if (!value) {
			throw new RemoteFileFailure('not_found');
		}
		if (Buffer.byteLength(value.image, 'utf8') > 4096 || Buffer.byteLength(value.state, 'utf8') > 128) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		const fingerprint = createHash('sha256')
			.update(JSON.stringify([value.id, value.state, value.image, value.created]))
			.digest('hex');
		return { containerId: value.id, state: value.state, image: value.image, fingerprint };
	}

	inspectDockers(scope: MachineOperationScope, containerIds: string[]): Promise<Array<DockerInspection | null>> {
		if (
			!containerIds.length ||
			new Set(containerIds).size !== containerIds.length ||
			containerIds.some((id) => !/^[a-f0-9]{64}$/.test(id))
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.admitted(scope, async (signal, _remaining, validate) => {
			const values = await this.observations.inspectDockers(
				{ targetId: scope.targetId, fingerprint: scope.fingerprint, signal, validate },
				containerIds,
			);
			return containerIds.map((containerId) => {
				const value = values.find((item) => item.id === containerId);
				if (!value) {
					return null;
				}
				if (Buffer.byteLength(value.image) > 4096 || Buffer.byteLength(value.state) > 128) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				return {
					containerId: value.id,
					state: value.state,
					image: value.image,
					fingerprint: createHash('sha256')
						.update(JSON.stringify([value.id, value.state, value.image, value.created]))
						.digest('hex'),
				};
			});
		});
	}

	inspectDocker(scope: MachineOperationScope, containerId: string): Promise<DockerInspection> {
		return this.admitted(scope, (signal, _remaining, validate) =>
			this.dockerInspection(
				{
					operationId: scope.operationId,
					targetId: scope.targetId,
					fingerprint: scope.fingerprint,
					signal,
					timeoutMs: scope.timeoutMs,
					validate,
				},
				containerId,
			),
		);
	}

	controlDocker(scope: MachineOperationScope, input: DockerControlRequest): Promise<DockerControlResult> {
		return this.admitted(
			scope,
			async (signal, _remaining, validate) => {
				if (
					!['start', 'stop', 'restart', 'remove'].includes(input.action) ||
					!/^[a-f0-9]{64}$/.test(input.expectedFingerprint)
				) {
					throw new RemoteFileFailure('invalid_input');
				}
				const context = {
					operationId: scope.operationId,
					targetId: scope.targetId,
					fingerprint: scope.fingerprint,
					timeoutMs: scope.timeoutMs,
					signal,
					validate,
				};
				const before = await this.dockerInspection(context, input.containerId);
				if (before.fingerprint !== input.expectedFingerprint) {
					throw new RemoteFileFailure('conflict');
				}
				await validate();
				try {
					await this.observations.commandDocker(context, input.containerId, input.action);
				} catch (cause) {
					if (cause instanceof RemoteResourceCleanupFailure) {
						throw cause;
					}
					if (
						cause instanceof ObservationFailure &&
						(cause.code === 'command_failed' || cause.code === 'operation_unknown')
					) {
						throw cause;
					}
					// This step may have been dispatched before an unexpected failure.
					throw new RemoteFileFailure('operation_unknown', { cause });
				}
				try {
					const current = await this.observations.inspectDocker(context, input.containerId);
					const confirmed =
						input.action === 'remove'
							? !current
							: current &&
								(input.action === 'stop' ? current.state === 'exited' : current.state === 'running');
					if (!confirmed) {
						throw new RemoteFileFailure('conflict');
					}
					await validate();
					return { containerId: input.containerId, action: input.action, state: current?.state ?? null };
				} catch (cause) {
					if (cause instanceof RemoteResourceCleanupFailure) {
						throw cause;
					}
					throw new RemoteFileFailure('operation_unknown', { cause });
				}
			},
			true,
		);
	}

	quiesce(): void {
		this.closing = true;
		this.changed();
		this.machines.quiesce();
		for (const controller of this.tasks.keys()) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled(this.tasks.values());
				const files = [...this.retainedFiles];
				this.idleFiles.clear();
				const released = await Promise.allSettled(
					files.map((file) => Promise.resolve().then(() => this.closeFile(file))),
				);
				const failures = this.cleanupFailures.concat(
					released.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
				);
				try {
					await this.machines.close();
				} catch (error) {
					failures.push(error);
				}
				if (failures.length) {
					this.cleanupFailed = true;
					this.changed();
					throw new RemoteResourceCleanupFailure(failures);
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
