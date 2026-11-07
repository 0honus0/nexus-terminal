import type { CommandPort } from '../../../../platform/commands/command-port.js';
import { MachineCommandDuplex } from '../../../../platform/ssh/command-duplex.js';
import { MachineDispatchFailure, MACHINE_CONNECT_MAX_TIMEOUT_MS } from '../../../../platform/ssh/ssh-port.js';
import type { RemoteMachineProvider } from './machine-types.js';
import type { MachineOperationScope, MachineProcessChannel, MachineProcessRequest } from './operation-types.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { RemoteHostKeyUntrustedError } from './machine-errors.js';
import { TargetOperationError } from '../../../targets/public-errors.js';

/** The callback's lifetime owns the command and the borrowed machine, including late channel close. */
export async function withMachineProcess(
	machines: RemoteMachineProvider,
	commands: CommandPort,
	scope: MachineOperationScope,
	input: MachineProcessRequest,
	consume: (channel: MachineProcessChannel) => Promise<void>,
): Promise<void> {
	let machine: Awaited<ReturnType<RemoteMachineProvider['open']>>['machine'] | null = null;
	let duplex: MachineCommandDuplex | null = null;
	let failure: unknown = null;
	let dispatched = false;
	try {
		await scope.validate();
		const opened = await machines.open({
			targetId: scope.targetId,
			expectedFingerprint: scope.fingerprint,
			timeoutMs: Math.min(scope.timeoutMs, MACHINE_CONNECT_MAX_TIMEOUT_MS),
			signal: scope.signal,

			validate: () => scope.validate(),
		});
		machine = opened.machine;
		await scope.validate();
		scope.signal.throwIfAborted();
		dispatched = true;
		const command = await commands.open(
			(text, signal) => opened.machine.openRawCommand(text, signal),
			{ kind: 'argv', argv: input.argv.map((arg) => arg) },
			input.cwd,
			scope.signal,
		);
		const io = new MachineCommandDuplex(command, scope.signal, input.maxReadBytes);
		duplex = io;
		await consume({
			read: async (stream, maxBytes) => {
				await scope.validate();
				const result = await io.read(stream, maxBytes);
				await scope.validate();
				return result;
			},

			write: async (bytes) => {
				await scope.validate();
				await io.write(bytes);
			},

			end: () => io.end(),

			outcome: async () => {
				const value = await io.outcome;
				return value.status === 'unknown'
					? {
							kind: value.status,
							reason: value.reason,
							signal: value.reason === 'remote_signal' ? value.signal : null,
						}
					: { kind: value.status, exitCode: value.exitCode };
			},

			cancel: () => io.cancel(),

			close: () => io.close(),
		});
		// No data or outcome is delivered after the lifetime owner releases this channel.
	} catch (cause) {
		if (cause instanceof RemoteResourceCleanupFailure || cause instanceof RemoteFileFailure) {
			failure = cause;
		} else if (cause instanceof MachineDispatchFailure) {
			failure = new RemoteFileFailure(cause.outcome === 'unknown' ? 'operation_unknown' : 'remote_unavailable', {
				cause,
			});
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
		const failures: unknown[] = [];
		if (duplex) {
			try {
				await duplex.close();
			} catch (error) {
				failures.push(error);
			}
		}
		if (machine) {
			try {
				await machines.release(machine, failure === null && failures.length === 0);
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) {
			throw new RemoteResourceCleanupFailure(failure === null ? failures : [failure, ...failures]);
		}
	}
}
