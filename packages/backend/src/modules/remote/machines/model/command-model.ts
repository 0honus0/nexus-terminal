import type { RemoteMachineProvider } from './machine-types.js';
import type { CommandPort, NativeCommand } from '../../../../platform/commands/command-port.js';
import { MachineDispatchFailure, MACHINE_CONNECT_MAX_TIMEOUT_MS } from '../../../../platform/ssh/ssh-port.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { RemoteHostKeyUntrustedError } from './machine-errors.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { MachineOperationScope, ExecuteCommandRequest, ExecuteCommandResult } from './operation-types.js';

export class MachineCommandModel {
	constructor(
		private readonly machines: RemoteMachineProvider,
		private readonly commands: CommandPort,
	) {}

	async execute(
		scope: MachineOperationScope,
		input: ExecuteCommandRequest,
		maxOutputBytes: number,
	): Promise<ExecuteCommandResult> {
		const deadline = Date.now() + scope.timeoutMs;
		let machine: Awaited<ReturnType<RemoteMachineProvider['open']>>['machine'] | null = null;
		let dispatched = false;
		let failure: unknown = null;
		try {
			await scope.validate();
			const opened = await this.machines.open({
				targetId: scope.targetId,
				expectedFingerprint: scope.fingerprint,
				timeoutMs: Math.min(scope.timeoutMs, MACHINE_CONNECT_MAX_TIMEOUT_MS),
				signal: scope.signal,

				validate: () => scope.validate(),
			});
			machine = opened.machine;
			await scope.validate();
			scope.signal.throwIfAborted();
			const remaining = deadline - Date.now();
			if (remaining < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			const commands: NativeCommand[] = input.commands.map((command) =>
				command.kind === 'argv'
					? { kind: 'argv', argv: command.argv.map((arg) => arg) }
					: { kind: 'shell', script: command.script },
			);
			dispatched = true;
			const result = await this.commands.executeBatch(
				(text, signal) => opened.machine.openRawCommand(text, signal, 'signal'),
				commands,
				input.cwd,
				input.onError,
				{
					timeoutMs: remaining,
					maxOutputBytes,
					signal: scope.signal,

					onOutput: (index, stream, text) => input.onOutput?.(index, stream, text),
				},
			);
			await scope.validate();
			return {
				status: result.results.some((item) => item.status === 'nonzero') ? 'nonzero' : 'completed',
				commands: result.results.map((item) =>
					item.status === 'not_started'
						? { index: item.index, status: item.status }
						: {
								index: item.index,
								status: item.status,
								exitCode: item.exitCode,
								signal: null,
								stdout: item.stdout,
								stderr: item.stderr,
								truncated: item.truncated,
							},
				),
			};
		} catch (cause) {
			if (cause instanceof RemoteResourceCleanupFailure || cause instanceof RemoteFileFailure) {
				failure = cause;
			} else if (cause instanceof MachineDispatchFailure) {
				failure = new RemoteFileFailure(
					cause.outcome === 'unknown' ? 'operation_unknown' : 'remote_unavailable',
					{ cause },
				);
			} else if (dispatched) {
				failure = new RemoteFileFailure('operation_unknown', { cause });
			} else if (cause instanceof RemoteHostKeyUntrustedError) {
				failure = new RemoteFileFailure('host_key_untrusted', { cause });
			} else if (cause instanceof TargetOperationError && cause.code === 'conflict') {
				failure = new RemoteFileFailure('conflict', { cause });
			} else {
				failure = new RemoteFileFailure('remote_unavailable', { cause });
			}
			throw failure;
		} finally {
			if (machine) {
				try {
					await this.machines.release(machine, failure === null);
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
				}
			}
		}
	}
}
