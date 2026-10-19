import type { MachineMutationService } from './mutation-service.js';
import { isWellFormedFileText } from '@nexus-terminal/shared/remote/files/text-codec';
import { createHash, randomUUID } from 'node:crypto';
import type { MachineAcpModel } from '../model/acp-model.js';
import type { ExecuteAcpRequest, ExecuteAcpResult } from '../model/operation-types.js';
import type { MachineCommandModel } from '../model/command-model.js';
import type {
	ExecuteCommandRequest,
	ExecuteCommandResult,
	DockerInspection,
	DockerControlRequest,
	DockerControlResult,
} from '../model/operation-types.js';
import { ObservationFailure } from '../../monitoring/model/observation-types.js';
import { capturePath } from '../../files/service/file-snapshot.js';
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
import { inspectText, inspectDirectory, inspectSearch } from '../../files/service/file-inspection.js';
import type {
	MachineOperationScope,
	ReadTextResult,
	ReadEntry,
	ReadSearchResult,
	ReadDiagnostics,
	FileInspectionContext,
} from '../model/operation-types.js';

function validateCommand(input: ExecuteCommandRequest): void {
	const args = input.command.kind === 'argv' ? input.command.argv : [input.command.script];
	const invalidProgram =
		input.command.kind === 'argv' &&
		(!input.command.argv[0] || input.command.argv[0].startsWith('-') || args.length > 128);
	const invalidContent =
		!args.length ||
		args.some((text) => !isWellFormedFileText(text) || text.includes('\0')) ||
		args.reduce((bytes, text) => bytes + Buffer.byteLength(text, 'utf8'), 0) > 8192 ||
		(input.command.kind === 'shell' && !input.command.script);
	const cwd = input.cwd;
	const invalidDirectory =
		cwd !== null &&
		(!cwd.startsWith('/') ||
			cwd.split('/').includes('..') ||
			/[\u0000-\u001f\u007f]/u.test(cwd) ||
			!isWellFormedFileText(cwd) ||
			Buffer.byteLength(cwd, 'utf8') > 256);
	if (invalidProgram || invalidContent || invalidDirectory) {
		throw new RemoteFileFailure('invalid_input');
	}
}

/** Independent machine operations never claim ordinary Workspace or Files attachments. */
export class RemoteMachineOperationService {
	private closing = false;
	private closePromise: Promise<void> | null = null;
	private readonly tasks = new Map<AbortController, Promise<unknown>>();
	private readonly cleanupFailures: unknown[] = [];

	constructor(
		private readonly files: RemoteFileModel,
		private readonly observations: ObservationModel,
		private readonly commands: MachineCommandModel,
		private readonly acp: MachineAcpModel,
		private readonly mutations: MachineMutationService,
	) {}

	private admitted<T>(
		scope: MachineOperationScope,
		work: (signal: AbortSignal, remaining: () => number, validate: () => Promise<void>) => Promise<T>,
		mutation = false,
	): Promise<T> {
		if (this.closing || this.tasks.size + this.cleanupFailures.length >= 8) {
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
			scope.timeoutMs > 45000
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
						await validate();
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
			}
		});
		this.tasks.set(controller, pending);
		return pending;
	}

	private withFiles<T>(
		scope: MachineOperationScope,
		work: (context: FileInspectionContext) => Promise<T>,
		mutation = false,
	): Promise<T> {
		return this.admitted(
			scope,
			async (signal, remaining, validate) => {
				let resource: FileResource | null = null;
				let failure: unknown = null;
				try {
					resource = await this.files.open(scope.targetId, remaining(), signal, scope.fingerprint, validate);
					await validate();
					return await work({ resource, signal, remaining, validate });
				} catch (error) {
					failure = error;
					throw error;
				} finally {
					if (resource) {
						try {
							await resource.close();
						} catch (cleanup) {
							throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
						}
					}
				}
			},
			mutation,
		);
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

	patchText(scope: MachineOperationScope, request: PatchTextRequest): Promise<WriteTextResult> {
		return this.withFiles(scope, (context) => patchInspectedText(context, request), true);
	}

	movePath(scope: MachineOperationScope, request: MovePathRequest): Promise<MovePathResult> {
		return this.withFiles(scope, (context) => moveInspectedPath(context, request), true);
	}

	deletePath(scope: MachineOperationScope, request: DeletePathRequest): Promise<DeletePathResult> {
		return this.withFiles(scope, (context) => deleteInspectedPath(context, request), true);
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

	search(scope: MachineOperationScope, path: string, query: string, maxResults: number): Promise<ReadSearchResult> {
		return this.withFiles(scope, (context) => inspectSearch(context, path, query, maxResults));
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

	executeAcp(scope: MachineOperationScope, input: ExecuteAcpRequest): Promise<ExecuteAcpResult> {
		validateCommand({ command: { kind: 'argv', argv: input.argv }, cwd: input.cwd });
		if (
			!input.prompt.trim() ||
			!isWellFormedFileText(input.prompt) ||
			input.prompt.includes('\0') ||
			Buffer.byteLength(input.prompt, 'utf8') > 8192
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.admitted(
			scope,
			(signal, remaining, validate) =>
				this.acp.execute(
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
					{ name: 'nexus-terminal', version: '1' },
				),
			true,
		);
	}

	executeCommand(scope: MachineOperationScope, input: ExecuteCommandRequest): Promise<ExecuteCommandResult> {
		validateCommand(input);
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
		const status = await this.observations.getDocker(scope);
		if (!status.available) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		const value = status.containers.find((row) => row.id === containerId);
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
					const after = await this.observations.getDocker(context);
					if (!after.available) {
						throw new RemoteFileFailure('remote_unavailable');
					}
					const current = after.containers.find((row) => row.id === input.containerId);
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
		for (const controller of this.tasks.keys()) {
			controller.abort();
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled(this.tasks.values());
				if (this.cleanupFailures.length) {
					throw new RemoteResourceCleanupFailure(this.cleanupFailures);
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
