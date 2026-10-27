import type { RemoteMachineModel } from './machine-model.js';
import type { CommandPort, NativeCommand } from '../../../../platform/commands/command-port.js';
import { MachineDispatchFailure } from '../../../../platform/ssh/ssh-port.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { RemoteHostKeyUntrustedError } from './machine-errors.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { MachineOperationScope, ExecuteCommandRequest, ExecuteCommandResult } from './operation-types.js';

export class MachineCommandModel {
	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly commands: CommandPort,
	) {}

	async execute(
		scope: MachineOperationScope,
		input: ExecuteCommandRequest,
		maxOutputBytes: number,
	): Promise<ExecuteCommandResult> {
		const deadline = Date.now() + scope.timeoutMs;
		let machine: Awaited<ReturnType<RemoteMachineModel['open']>>['machine'] | null = null;
		let dispatched = false;
		let failure: unknown = null;
		try {
			await scope.validate();
			const opened = await this.machines.open({
				targetId: scope.targetId,
				expectedFingerprint: scope.fingerprint,
				timeoutMs: scope.timeoutMs,
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
			const command: NativeCommand =
				input.command.kind === 'argv'
					? { kind: 'argv', argv: input.command.argv.map((arg) => arg) }
					: { kind: 'shell', script: input.command.script };
			dispatched = true;
			const result = await this.commands.execute(
				(text, options) => opened.machine.execute(text, options),
				command,
				input.cwd,
				{ timeoutMs: remaining, maxOutputBytes, signal: scope.signal },
			);
			if (result.outcome.status === 'unknown') {
				throw new RemoteFileFailure('operation_unknown');
			}
			await scope.validate();
			return {
				status: result.outcome.status,
				exitCode: result.outcome.exitCode,
				signal: result.outcome.signal,
				stdout: result.stdout,
				stderr: result.stderr,
				truncated: result.truncated,
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
					await machine.close();
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure(failure === null ? [cleanup] : [failure, cleanup]);
				}
			}
		}
	}
}
